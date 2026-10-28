import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueFeedService from "./DataSecurityIssueFeedService";
import { DataSecurityIssueFeedEventType } from "../../Models/DatabaseModels/DataSecurityIssueFeed";
import DatabaseConfig from "../DatabaseConfig";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { queueDataSecurityEvaluation } from "../Utils/DataSecurity/DataSecurityJobs";
import URL from "../../Types/API/URL";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import DataSecurityIssueStatus, {
  isDataSecurityIssueStatus,
} from "../../Types/DataSecurity/DataSecurityIssueStatus";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * Issues are opened, updated and resolved by OneUptime as checks run
 * (DataSecurityIssueReconciler). What a person does to one is decide what
 * happens next:
 *
 *  - Accept the risk: a reason and an expiry date, at most a year away; the
 *    issue opens again then if its check still fails.
 *  - Mark it resolved: the store is checked again at once, and the issue
 *    opens again if the check still fails.
 *  - Say it is not an issue: it stays closed.
 *  - Open it again, or assign it.
 *
 * Every change is written to the issue's timeline.
 */

// The longest a risk can be accepted for before someone looks again.
export const MAX_ACCEPTANCE_IN_DAYS: number = 366;

interface IssueChange {
  id: string;
  projectId: string;
  title: string;
  fromStatus: string | undefined;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static readStatus(value: unknown): DataSecurityIssueStatus {
    if (!isDataSecurityIssueStatus(value)) {
      throw new BadDataException(
        "An issue is Open, Accepted, Resolved or Not an issue.",
      );
    }

    return value;
  }

  public static readAcceptedUntil(value: unknown, now: Date): Date {
    const until: Date | null =
      value instanceof Date
        ? value
        : typeof value === "string" && value
          ? new Date(value)
          : null;

    if (!until || Number.isNaN(until.getTime())) {
      throw new BadDataException(
        "Choose the date the accepted risk expires on.",
      );
    }

    if (until.getTime() <= now.getTime()) {
      throw new BadDataException("An accepted risk expires in the future.");
    }

    if (
      until.getTime() >
      OneUptimeDate.addRemoveDays(now, MAX_ACCEPTANCE_IN_DAYS).getTime()
    ) {
      throw new BadDataException(
        "A risk can be accepted for at most a year; accept it again when it expires.",
      );
    }

    return until;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.props.isRoot) {
      return { updateBy, carryForward: [] };
    }

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    const now: Date = OneUptimeDate.getCurrentDate();

    if (data["status"] !== undefined) {
      const status: DataSecurityIssueStatus = Service.readStatus(
        data["status"],
      );

      data["status"] = status;

      if (status === DataSecurityIssueStatus.Accepted) {
        const reason: string =
          typeof data["acceptedReason"] === "string"
            ? data["acceptedReason"].trim()
            : "";

        if (!reason) {
          throw new BadDataException("Say why the risk is accepted.");
        }

        data["acceptedReason"] = reason;
        data["acceptedUntil"] = Service.readAcceptedUntil(
          data["acceptedUntil"],
          now,
        );

        if (updateBy.props.userId) {
          data["acceptedByUserId"] = updateBy.props.userId;
        }
      } else {
        data["acceptedReason"] = null;
        data["acceptedUntil"] = null;
      }

      if (status === DataSecurityIssueStatus.Resolved) {
        data["resolvedAt"] = now;
        data["recheckRequestedAt"] = now;
      }
    } else if (
      data["acceptedReason"] !== undefined ||
      data["acceptedUntil"] !== undefined
    ) {
      throw new BadDataException(
        "Accept the risk by setting the issue's status to Accepted, with a reason and an expiry date.",
      );
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, projectId: true, status: true, title: true },
    );

    const changes: Array<IssueChange> = rows
      .filter((row: Model) => {
        return Boolean(row.id && row.projectId);
      })
      .map((row: Model): IssueChange => {
        return {
          id: row.id!.toString(),
          projectId: row.projectId!.toString(),
          title: row.title || "",
          fromStatus: row.status,
        };
      });

    return { updateBy, carryForward: changes };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const changes: Array<IssueChange> =
      (onUpdate.carryForward as Array<IssueChange> | undefined) || [];
    const data: JSONObject = onUpdate.updateBy.data as unknown as JSONObject;
    const userId: ObjectID | undefined =
      onUpdate.updateBy.props.userId || undefined;
    const status: string | undefined =
      typeof data["status"] === "string" ? data["status"] : undefined;
    const projectIds: Set<string> = new Set();

    for (const change of changes) {
      projectIds.add(change.projectId);

      if (status && status !== change.fromStatus) {
        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId: new ObjectID(change.projectId),
          dataSecurityIssueId: new ObjectID(change.id),
          eventType:
            status === DataSecurityIssueStatus.Accepted
              ? DataSecurityIssueFeedEventType.Accepted
              : status === DataSecurityIssueStatus.Resolved
                ? DataSecurityIssueFeedEventType.RecheckRequested
                : DataSecurityIssueFeedEventType.StatusChanged,
          displayColor: Service.statusColor(status),
          feedInfoInMarkdown: (status === DataSecurityIssueStatus.Accepted
            ? mdText`The risk was accepted until **${OneUptimeDate.getDateAsUserFriendlyFormattedString(
                new Date(String(data["acceptedUntil"])),
              )}**: ${String(data["acceptedReason"] || "")}`
            : status === DataSecurityIssueStatus.Resolved
              ? mdText`Marked resolved. The store is being checked again; the issue opens again if its check still fails.`
              : mdText`Status changed from **${change.fromStatus || "Open"}** to **${status}**.`
          ).toString(),
          userId,
        });
      }

      if (
        data["assignedToUserId"] !== undefined ||
        data["assignedToTeamId"] !== undefined
      ) {
        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId: new ObjectID(change.projectId),
          dataSecurityIssueId: new ObjectID(change.id),
          eventType: DataSecurityIssueFeedEventType.AssigneeChanged,
          displayColor: Blue500,
          feedInfoInMarkdown: mdText`The issue was assigned.`.toString(),
          userId,
        });
      }
    }

    // A resolve or re-open asks for the store to be checked again.
    if (
      status === DataSecurityIssueStatus.Resolved ||
      status === DataSecurityIssueStatus.Open
    ) {
      for (const projectId of projectIds) {
        await queueDataSecurityEvaluation(new ObjectID(projectId));
      }
    }

    return onUpdate;
  }

  public static statusColor(status: string): Color {
    switch (status) {
      case DataSecurityIssueStatus.Resolved:
        return Green500;
      case DataSecurityIssueStatus.Accepted:
        return Yellow500;
      case DataSecurityIssueStatus.NotAnIssue:
        return Gray500;
      default:
        return Blue500;
    }
  }

  @CaptureSpan()
  public async getIssueLinkInDashboard(
    projectId: ObjectID,
    issueId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/data-security/issues/${issueId.toString()}`,
    );
  }
}

export default new Service();
