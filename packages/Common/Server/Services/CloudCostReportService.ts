import Model from "../../Models/DatabaseModels/CloudCostReport";
import User from "../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { isCloudCostBasis } from "../../Types/Cloud/CloudCostBasis";
import {
  CLOUD_COST_REPORT_MAX_CHANNELS,
  CloudCostReportPeriod,
  CloudCostReportScope,
  isCloudCostReportPeriod,
  isCloudCostReportScope,
  readCloudCostReportEmailAddresses,
} from "../../Types/Cloud/CloudCostReport";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Timezone from "../../Types/Timezone";
import WorkspaceSummaryScheduleUtil, {
  WorkspaceSummaryScheduleColumns,
  WorkspaceSummaryScheduleWrite,
} from "../../Utils/Workspace/WorkspaceSummarySchedule";
import WorkspaceSummarySetup from "../../Utils/Workspace/WorkspaceSummarySetup";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CallerPermission from "../Utils/Permission/CallerPermission";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";
import UserService from "./UserService";

/*
 * SCHEDULED CLOUD COST REPORTS (CloudCostReport, #11009).
 *
 * Every write is guarded here, whoever sends it - the Dashboard, the API,
 * the CLI, Terraform or an MCP client:
 *
 *   - What it covers names one record of its kind and no other: an account
 *     for Account, a cost view for CostView, a cost group for CostGroup,
 *     none for AllAccounts. The records are the project's own
 *     (ProjectReferencesService), and so are its people and teams.
 *   - Addresses are addresses (at most 25), channels names (at most 10 of
 *     each), each kept once.
 *   - Addresses outside the project and channels - whose readers OneUptime
 *     cannot check - are set by a Cloud admin (Cloud Admin, Project Admin or
 *     Project Owner) signed in as themselves: the report is read as that
 *     person for them (outsideRecipientsSetByUserId), so it never shows
 *     more than they may read. An API key cannot set them: it is no person
 *     whose access a send can be read as.
 *   - The schedule follows the workspace summaries' rules
 *     (WorkspaceSummaryScheduleUtil): weekly unless told, the first one at
 *     09:00 next Monday (or on the 1st) in the creator's time zone, and the
 *     next send worked out again only when the schedule really changes or
 *     the report is switched back on.
 */

// Who may send a report outside the project: a Cloud admin.
export const CLOUD_COST_REPORT_OUTSIDE_PERMISSIONS: ReadonlyArray<Permission> =
  [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.CloudAdmin];

export const CLOUD_COST_REPORT_OUTSIDE_REFUSAL: string =
  "Only a Cloud admin can send a report outside the project: to an address that is not a project member's, or to a Slack or Microsoft Teams channel. Ask someone with Cloud Admin, Project Admin or Project Owner to add them.";

export const CLOUD_COST_REPORT_OUTSIDE_API_KEY_REFUSAL: string =
  "Addresses outside the project and channels are set by a Cloud admin signed in to OneUptime, so the report is read as that person. Set them from the Dashboard, or leave them out of this request.";

// The columns that send a report outside the project.
const OUTSIDE_COLUMNS: ReadonlyArray<string> = [
  "emailAddresses",
  "slackChannelNames",
  "microsoftTeamsChannelNames",
];

// The column each scope names its record by.
const SCOPE_COLUMNS: Readonly<Record<CloudCostReportScope, string | null>> = {
  [CloudCostReportScope.AllAccounts]: null,
  [CloudCostReportScope.Account]: "cloudAccountId",
  [CloudCostReportScope.CostView]: "cloudCostViewId",
  [CloudCostReportScope.CostGroup]: "cloudCostGroupId",
};

const SCOPE_ID_COLUMNS: ReadonlyArray<string> = [
  "cloudAccountId",
  "cloudCostViewId",
  "cloudCostGroupId",
];

function getScheduleColumns(
  data: Record<string, unknown>,
): WorkspaceSummaryScheduleColumns {
  const columns: WorkspaceSummaryScheduleColumns = {};

  if (data["recurringInterval"] !== undefined) {
    columns.recurringInterval = data[
      "recurringInterval"
    ] as WorkspaceSummaryScheduleColumns["recurringInterval"];
  }

  if (data["sendFirstReportAt"] !== undefined) {
    columns.sendFirstReportAt = data[
      "sendFirstReportAt"
    ] as WorkspaceSummaryScheduleColumns["sendFirstReportAt"];
  }

  if (data["nextSendAt"] !== undefined) {
    columns.nextSendAt = data[
      "nextSendAt"
    ] as WorkspaceSummaryScheduleColumns["nextSendAt"];
  }

  if (data["isEnabled"] !== undefined) {
    columns.isEnabled = data["isEnabled"] as boolean | null;
  }

  if (data["timezone"] !== undefined) {
    columns.timezone = data["timezone"] as string | null;
  }

  return columns;
}

function applyScheduleWrite(
  data: Record<string, unknown>,
  write: WorkspaceSummaryScheduleWrite,
): void {
  if (write.recurringInterval) {
    data["recurringInterval"] = write.recurringInterval;
  }

  if (write.sendFirstReportAt) {
    data["sendFirstReportAt"] = write.sendFirstReportAt;
  }

  if (write.nextSendAt) {
    data["nextSendAt"] = write.nextSendAt;
  }

  if (write.timezone) {
    data["timezone"] = write.timezone;
  }
}

/*
 * The intervals a report goes out at: a week or a month, every one or
 * every few. Hourly or daily figures move before the clouds settle them.
 */
export function getCloudCostReportIntervalProblem(
  value: unknown,
): string | null {
  const recurring: ReturnType<typeof WorkspaceSummaryScheduleUtil.toRecurring> =
    WorkspaceSummaryScheduleUtil.toRecurring(value);

  if (!recurring) {
    return null;
  }

  const type: string = String(recurring.intervalType);

  if (type !== "Week" && type !== "Month") {
    return "A cost report goes out every week or every month: send recurringInterval with an intervalType of Week or Month.";
  }

  return null;
}

// A report's channel names as they are kept: each once, at most ten.
export function readCloudCostReportChannelNames(
  value: unknown,
  what: string,
): Array<string> {
  if (value === null || value === undefined || value === "") {
    return [];
  }

  const names: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const name of WorkspaceSummarySetup.readChannelNames(value)) {
    const key: string = name.replace(/^#/, "").toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(name.slice(0, 200));
  }

  if (names.length > CLOUD_COST_REPORT_MAX_CHANNELS) {
    throw new BadDataException(
      `A report posts to at most ${CLOUD_COST_REPORT_MAX_CHANNELS} ${what}.`,
    );
  }

  return names;
}

// Whether a write sends the report outside the project.
function namesOutsideRecipients(data: Record<string, unknown>): boolean {
  return OUTSIDE_COLUMNS.some((column: string): boolean => {
    const value: unknown = data[column];
    return Array.isArray(value) && value.length > 0;
  });
}

// Whether a write touches who outside the project the report goes to.
function touchesOutsideRecipients(data: Record<string, unknown>): boolean {
  return OUTSIDE_COLUMNS.some((column: string): boolean => {
    return data[column] !== undefined;
  });
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Whether a person may send a report outside the project in a project:
   * a Cloud admin, by the check every permission goes through.
   */
  public static maySendOutside(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): boolean {
    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    return CallerPermission.holdsAnyOf(
      props,
      CLOUD_COST_REPORT_OUTSIDE_PERMISSIONS,
      { projectId },
    );
  }

  // A write's addresses and channels, read: refused with what to fix.
  public static normalizeRecipients(data: Record<string, unknown>): void {
    if (data["emailAddresses"] !== undefined) {
      try {
        data["emailAddresses"] = readCloudCostReportEmailAddresses(
          data["emailAddresses"],
        );
      } catch (error) {
        throw new BadDataException((error as Error).message);
      }
    }

    if (data["slackChannelNames"] !== undefined) {
      data["slackChannelNames"] = readCloudCostReportChannelNames(
        data["slackChannelNames"],
        "Slack channels",
      );
    }

    if (data["microsoftTeamsChannelNames"] !== undefined) {
      data["microsoftTeamsChannelNames"] = readCloudCostReportChannelNames(
        data["microsoftTeamsChannelNames"],
        "Microsoft Teams channels",
      );
    }

    if (typeof data["microsoftTeamsTeamName"] === "string") {
      data["microsoftTeamsTeamName"] =
        data["microsoftTeamsTeamName"].trim() || null;
    }
  }

  /*
   * What a report covers, read: the scope names its record and no other.
   * `stored` is what an update leaves as it was.
   */
  public static normalizeScope(
    data: Record<string, unknown>,
    stored?: Record<string, unknown> | undefined,
  ): void {
    const scope: unknown =
      data["scope"] !== undefined ? data["scope"] : stored?.["scope"];

    if (scope === undefined || scope === null || scope === "") {
      if (data["scope"] !== undefined || !stored) {
        data["scope"] = CloudCostReportScope.AllAccounts;
      }
    } else if (!isCloudCostReportScope(scope)) {
      throw new BadDataException(
        "Send scope as AllAccounts, Account, CostGroup or CostView.",
      );
    }

    const effective: CloudCostReportScope = isCloudCostReportScope(
      data["scope"],
    )
      ? (data["scope"] as CloudCostReportScope)
      : isCloudCostReportScope(stored?.["scope"])
        ? (stored!["scope"] as CloudCostReportScope)
        : CloudCostReportScope.AllAccounts;
    const column: string | null = SCOPE_COLUMNS[effective];

    // The scope's own record: sent now, or kept.
    if (column) {
      const value: unknown =
        data[column] !== undefined ? data[column] : stored?.[column];

      if (value === undefined || value === null || value === "") {
        throw new BadDataException(
          effective === CloudCostReportScope.Account
            ? "A report of one account needs its account: send cloudAccountId."
            : effective === CloudCostReportScope.CostView
              ? "A report of a cost view needs its view: send cloudCostViewId."
              : "A report of a cost group needs its group: send cloudCostGroupId.",
        );
      }
    }

    // Every other scope's record is left out, so nothing reads it by mistake.
    if (data["scope"] !== undefined || !stored) {
      for (const other of SCOPE_ID_COLUMNS) {
        if (other !== column) {
          data[other] = null;
        }
      }
    }

    if (
      data["isSentToGroupTeams"] === true &&
      effective !== CloudCostReportScope.CostView
    ) {
      throw new BadDataException(
        "Only a report of a cost view sends each group's team its own section.",
      );
    }

    if (
      (data["scope"] !== undefined || !stored) &&
      effective !== CloudCostReportScope.CostView &&
      data["isSentToGroupTeams"] === undefined
    ) {
      data["isSentToGroupTeams"] = false;
    }
  }

  // A write's period and basis, read: refused with what to fix.
  public static normalizePeriodAndBasis(data: Record<string, unknown>): void {
    if (data["period"] !== undefined) {
      if (data["period"] === null || data["period"] === "") {
        data["period"] = CloudCostReportPeriod.LastWeek;
      } else if (!isCloudCostReportPeriod(data["period"])) {
        throw new BadDataException(
          "Send period as LastWeek, LastMonth or MonthToDate.",
        );
      }
    }

    if (data["costBasis"] !== undefined) {
      if (data["costBasis"] === "" || data["costBasis"] === null) {
        data["costBasis"] = null;
      } else if (!isCloudCostBasis(data["costBasis"])) {
        throw new BadDataException(
          "Send costBasis as billed, amortized or net, or leave it out for the project's.",
        );
      }
    }
  }

  /*
   * Who outside the project a write sends the report to, checked: a Cloud
   * admin signed in as themselves sets them, and the report is read as
   * them for those recipients. Clearing them all is anyone's to do.
   */
  public static checkOutsideRecipients(data: {
    write: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): void {
    if (!touchesOutsideRecipients(data.write)) {
      return;
    }

    if (!namesOutsideRecipients(data.write)) {
      // Every outside recipient gone: nobody's access is read for them.
      data.write["outsideRecipientsSetByUserId"] = null;
      return;
    }

    if (data.props.isRoot) {
      return;
    }

    if (!data.props.userId) {
      throw new NotAuthorizedException(
        CLOUD_COST_REPORT_OUTSIDE_API_KEY_REFUSAL,
      );
    }

    if (!Service.maySendOutside(data.props, data.projectId)) {
      throw new NotAuthorizedException(CLOUD_COST_REPORT_OUTSIDE_REFUSAL);
    }

    data.write["outsideRecipientsSetByUserId"] = data.props.userId;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException("A cost report needs its project.");
    }

    if (!data["name"] || !String(data["name"]).trim()) {
      throw new BadDataException("Name the report: its emails' subject.");
    }

    Service.normalizeScope(data);
    Service.normalizePeriodAndBasis(data);

    if (data["period"] === undefined) {
      data["period"] = CloudCostReportPeriod.LastWeek;
    }

    Service.normalizeRecipients(data);
    Service.checkOutsideRecipients({
      write: data,
      props: createBy.props,
      projectId,
    });

    const write: WorkspaceSummaryScheduleColumns = getScheduleColumns(data);
    const problem: string | null =
      WorkspaceSummaryScheduleUtil.getWriteProblem(write) ||
      getCloudCostReportIntervalProblem(write.recurringInterval);

    if (problem) {
      throw new BadDataException(problem);
    }

    // The next send is the server's to work out; a caller's is ignored.
    delete write.nextSendAt;
    delete data["nextSendAt"];

    const creatorTimezone: Timezone | undefined =
      WorkspaceSummaryScheduleUtil.toTimezone(write.timezone)
        ? undefined
        : await this.getCreatorTimezone(createBy.props);

    applyScheduleWrite(
      data,
      WorkspaceSummaryScheduleUtil.getCreateWrite({
        write,
        timezone: creatorTimezone,
      }),
    );

    if (createBy.props.userId && !data["createdByUserId"]) {
      data["createdByUserId"] = createBy.props.userId;
    }

    return { createBy, carryForward: null };
  }

  /*
   * The time zone in the profile of the person a write comes from, or
   * nothing: an API key is no person, and a person may have none.
   */
  private async getCreatorTimezone(
    props: DatabaseCommonInteractionProps,
  ): Promise<Timezone | undefined> {
    if (!props.userId) {
      return undefined;
    }

    const user: User | null = await UserService.findOneById({
      id: props.userId,
      select: { timezone: true },
      props: { isRoot: true },
    });

    return WorkspaceSummaryScheduleUtil.toCurrentTimezone(user?.timezone);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    Service.normalizePeriodAndBasis(data);
    Service.normalizeRecipients(data);

    const touchesScope: boolean =
      data["scope"] !== undefined ||
      data["isSentToGroupTeams"] !== undefined ||
      SCOPE_ID_COLUMNS.some((column: string): boolean => {
        return data[column] !== undefined;
      });
    const write: WorkspaceSummaryScheduleColumns = getScheduleColumns(data);
    const isReschedule: boolean =
      WorkspaceSummaryScheduleUtil.isRescheduleWrite(write) &&
      write.nextSendAt === undefined;

    if (!touchesScope && !touchesOutsideRecipients(data) && !isReschedule) {
      return { updateBy, carryForward: null };
    }

    const problem: string | null =
      WorkspaceSummaryScheduleUtil.getWriteProblem(write) ||
      getCloudCostReportIntervalProblem(write.recurringInterval);

    if (problem) {
      throw new BadDataException(problem);
    }

    const reports: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        scope: true,
        cloudAccountId: true,
        cloudCostViewId: true,
        cloudCostGroupId: true,
        recurringInterval: true,
        sendFirstReportAt: true,
        nextSendAt: true,
        isEnabled: true,
        timezone: true,
      },
    );

    if (reports.length === 0) {
      return { updateBy, carryForward: null };
    }

    // One write for every report it matches: they are read alike.
    const stored: Model = reports[0]!;
    const projectId: ObjectID | undefined =
      stored.projectId || updateBy.props.tenantId;

    if (touchesScope) {
      Service.normalizeScope(
        data,
        stored as unknown as Record<string, unknown>,
      );
    }

    if (projectId) {
      Service.checkOutsideRecipients({
        write: data,
        props: updateBy.props,
        projectId,
      });
    }

    if (isReschedule) {
      const scheduleWrite: WorkspaceSummaryScheduleWrite =
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write,
          stored: getScheduleColumns(
            stored as unknown as Record<string, unknown>,
          ),
        });

      if (scheduleWrite.nextSendAt) {
        data["nextSendAt"] = scheduleWrite.nextSendAt;
      }
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
