import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import { Green500, Red500, Yellow500 } from "../../../Types/BrandColors";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseStatuses from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import SecurityCaseValues from "./SecurityCaseValues";
import SecurityCaseVerdict, {
  isSecurityCaseVerdict,
} from "../../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  CLOSE_ALERTS_WHEN_CASE_CLOSES_KEY,
  getSecurityEventConnectorTitle,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityDetectionService from "../../Services/SecurityDetectionService";
import SecurityEventConnectionService from "../../Services/SecurityEventConnectionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  SOURCE_ALERTS_PER_CLOSE_LIMIT,
  SecurityAlertCloser,
  SourceAlertCloseResult,
  SourceAlertClosing,
} from "../SecurityEvent/Connectors/AlertClosing/SecurityAlertCloser";
import SecurityAlertCloserRegistry from "../SecurityEvent/Connectors/AlertClosing/SecurityAlertCloserRegistry";
import { SecurityConnectorSettings } from "../SecurityEvent/Connectors/Types";

/*
 * CLOSING A CASE CLOSES ITS ALERTS WHERE THEY CAME FROM.
 *
 * A case opened by alerts a connected product raised (Google SecOps today)
 * is often worked in both places. When it is closed in OneUptime, each
 * connection with "Close alerts when their case closes" on has its alerts
 * closed in its own product too - with the case's verdict, its closing note
 * and a link back - so nobody closes the same alert twice. The case's
 * timeline says what was closed where, or why it could not be.
 *
 * The case's service only queues a job (SECURITY_CASE_SOURCE_ALERTS_JOB) and
 * never waits on, or fails because of, another product. The job first reads
 * which connections the case's alerts came from and queues one job for each,
 * so a product that is slow or rate limited is tried again (with backoff) on
 * its own, without closing the others' alerts twice. A case reopened before
 * its job runs closes nothing.
 */

export const SECURITY_CASE_SOURCE_ALERTS_JOB: string =
  "SecurityCases:CloseSourceAlerts";

// Tries per connection, with exponential backoff from this delay.
export const SECURITY_CASE_SOURCE_ALERTS_ATTEMPTS: number = 5;
export const SECURITY_CASE_SOURCE_ALERTS_BACKOFF_IN_MS: number = 60 * 1000;

// The detections of one case read for their alerts, at most.
const DETECTIONS_READ_LIMIT: number = 1000;

export enum SecurityCaseSourceAlertsJobKind {
  // Which connections the closed case's alerts came from.
  Case = "case",
  // One connection's alerts, closed in its product.
  Connection = "connection",
}

function readId(data: JSONObject, key: string): ObjectID | undefined {
  const value: JSONValue | undefined = data[key];

  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? new ObjectID(value)
    : undefined;
}

export function sourceAlertsClosedMarkdown(data: {
  productName: string;
  connectionName: string;
  result: SourceAlertCloseResult;
}): MarkdownText {
  const { result } = data;
  const parts: Array<MarkdownValue> = [
    mdText`Closed ${String(result.closed)} alert${result.closed === 1 ? "" : "s"} in **${data.productName}** through the connection **${data.connectionName}**.`,
  ];

  // Alerts the product answered it does not have (deleted or merged there).
  if (result.notFound > 0) {
    parts.push(
      mdText`${String(result.notFound)} ${result.notFound === 1 ? "was" : "were"} not found there.`,
    );
  }

  if (result.refused > 0) {
    parts.push(
      mdText`${data.productName} refused to close ${String(result.refused)}.`,
    );
  }

  return FeedMarkdown.join(parts, " ");
}

export function sourceAlertsFailedMarkdown(data: {
  productName: string;
  connectionName: string;
  result: SourceAlertCloseResult;
}): MarkdownText {
  const { result } = data;
  const closedPart: MarkdownValue =
    result.closed > 0
      ? mdText` It closed ${String(result.closed)} before it stopped.`
      : FeedMarkdown.empty();

  return mdText`Could not close the case's alerts in **${data.productName}** through the connection **${data.connectionName}**: ${result.failure}${closedPart}`;
}

export default class SecurityCaseSourceAlerts {
  // Queues the closing of a closed case's alerts. Never throws: a case closes whatever another product says.
  public static async caseClosed(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<void> {
    await this.enqueue(
      {
        kind: SecurityCaseSourceAlertsJobKind.Case,
        projectId: data.projectId.toString(),
        securityCaseId: data.securityCaseId.toString(),
      },
      { attempts: 3 },
    );
  }

  private static async enqueue(
    data: JSONObject,
    options: { attempts: number },
  ): Promise<void> {
    try {
      await Queue.addJob(
        QueueName.Worker,
        `security-case-source-alerts-${ObjectID.generate().toString()}`,
        SECURITY_CASE_SOURCE_ALERTS_JOB,
        data,
        {
          attempts: options.attempts,
          backoffDelayInMs: SECURITY_CASE_SOURCE_ALERTS_BACKOFF_IN_MS,
          skipExistenceCheck: true,
        },
      );
    } catch (error) {
      logger.error(
        `SecurityCaseSourceAlerts: could not queue the closing of case ${String(data["securityCaseId"])}'s alerts:`,
      );
      logger.error(error);
    }
  }

  // ---------- The job ----------

  @CaptureSpan()
  public static async runJob(
    data: JSONObject,
    attempt: { isLastAttempt: boolean } = { isLastAttempt: true },
  ): Promise<void> {
    const projectId: ObjectID | undefined = readId(data, "projectId");
    const securityCaseId: ObjectID | undefined = readId(data, "securityCaseId");

    if (!projectId || !securityCaseId) {
      return;
    }

    if (data["kind"] === SecurityCaseSourceAlertsJobKind.Connection) {
      const connectionId: ObjectID | undefined = readId(data, "connectionId");

      if (connectionId) {
        await this.closeConnectionAlerts({
          projectId,
          securityCaseId,
          connectionId,
          isLastAttempt: attempt.isLastAttempt,
        });
      }

      return;
    }

    await this.queueConnections({ projectId, securityCaseId });
  }

  /*
   * The closed case's alerts, by the connection they came from: one job for
   * each connection that closes alerts in its product.
   */
  public static async queueConnections(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const securityCase: SecurityCase | null = await this.readClosedCase(data);

    if (!securityCase) {
      return [];
    }

    const connectionIds: Map<string, ObjectID> = new Map();

    for (const detection of await this.readCaseAlerts(data)) {
      if (detection.securityEventConnectionId) {
        connectionIds.set(
          detection.securityEventConnectionId.toString(),
          detection.securityEventConnectionId,
        );
      }
    }

    const queued: Array<ObjectID> = [];

    for (const connectionId of connectionIds.values()) {
      const connection: SecurityEventConnection | null =
        await SecurityEventConnectionService.findOneById({
          id: connectionId,
          select: {
            _id: true,
            projectId: true,
            provider: true,
            config: true,
          },
          props: { isRoot: true },
        });

      if (
        !connection ||
        connection.projectId?.toString() !== data.projectId.toString() ||
        !this.closesAlerts(connection)
      ) {
        continue;
      }

      await this.enqueue(
        {
          kind: SecurityCaseSourceAlertsJobKind.Connection,
          projectId: data.projectId.toString(),
          securityCaseId: data.securityCaseId.toString(),
          connectionId: connectionId.toString(),
        },
        { attempts: SECURITY_CASE_SOURCE_ALERTS_ATTEMPTS },
      );

      queued.push(connectionId);
    }

    return queued;
  }

  // A connection closes alerts when its product can and its option is on.
  public static closesAlerts(connection: SecurityEventConnection): boolean {
    const config: JSONObject | null =
      connection.config && typeof connection.config === "object"
        ? (connection.config as JSONObject)
        : null;

    return Boolean(
      config &&
        config[CLOSE_ALERTS_WHEN_CASE_CLOSES_KEY] === true &&
        SecurityAlertCloserRegistry.getCloser(connection.provider),
    );
  }

  /*
   * One connection's alerts of the case, closed in its product. A failure
   * that may pass (rate limited, unreachable) is thrown back to the queue,
   * which tries again with backoff; the case's timeline says what happened
   * once, when the closing is done or has been given up on.
   */
  public static async closeConnectionAlerts(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    connectionId: ObjectID;
    isLastAttempt: boolean;
  }): Promise<SourceAlertCloseResult | null> {
    const securityCase: SecurityCase | null = await this.readClosedCase(data);

    if (!securityCase) {
      return null;
    }

    const connection: SecurityEventConnection | null =
      await SecurityEventConnectionService.findOneById({
        id: data.connectionId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          config: true,
          secrets: true,
          alertingOnly: true,
        },
        props: { isRoot: true },
      });

    if (
      !connection ||
      connection.projectId?.toString() !== data.projectId.toString() ||
      !this.closesAlerts(connection)
    ) {
      return null;
    }

    const closer: SecurityAlertCloser | undefined =
      SecurityAlertCloserRegistry.getCloser(connection.provider);

    if (!closer) {
      return null;
    }

    const alertIds: Array<string> = (await this.readCaseAlerts(data))
      .filter((detection: SecurityDetection): boolean => {
        return (
          detection.securityEventConnectionId?.toString() ===
            data.connectionId.toString() && Boolean(detection.eventUid)
        );
      })
      .map((detection: SecurityDetection): string => {
        return detection.eventUid!;
      });

    if (alertIds.length === 0) {
      return null;
    }

    const settings: SecurityConnectorSettings =
      await SecurityEventConnectionService.getConnectorSettings(connection);

    const closing: SourceAlertClosing = {
      verdict: isSecurityCaseVerdict(securityCase.verdict)
        ? securityCase.verdict
        : SecurityCaseVerdict.Undetermined,
      closingNote: securityCase.closingNote || "",
      caseLabel: securityCase.caseNumberWithPrefix || "",
      caseUrl: await this.caseUrl(data),
    };

    const result: SourceAlertCloseResult = await closer.closeAlerts({
      settings,
      alertIds,
      closing,
    });

    if (result.failure && result.retryable && !data.isLastAttempt) {
      // The queue tries again after its backoff; nothing is written yet.
      throw new Error(result.failure);
    }

    const productName: string = getSecurityEventConnectorTitle(
      connection.provider,
    );
    const connectionName: string = connection.name || productName;

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown: (result.failure
        ? sourceAlertsFailedMarkdown({ productName, connectionName, result })
        : sourceAlertsClosedMarkdown({ productName, connectionName, result })
      ).toString(),
      eventType: SecurityCaseFeedEventType.ResponseAction,
      displayColor: result.failure
        ? Red500
        : result.refused > 0
          ? Yellow500
          : Green500,
    });

    return result;
  }

  // The case, while it is closed; null once it is reopened or gone.
  private static async readClosedCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<SecurityCase | null> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: {
          _id: data.securityCaseId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          securityCaseStatusId: true,
          verdict: true,
          closingNote: true,
          caseNumberWithPrefix: true,
        },
        props: { isRoot: true },
      });

    if (!securityCase) {
      return null;
    }

    // Closed: its status is the project's closed one, or one after it.
    return SecurityCaseStatuses.isClosed(
      await SecurityCaseValues.getStatuses(data.projectId),
      securityCase.securityCaseStatusId,
    )
      ? securityCase
      : null;
  }

  // The case's detections that are a connected product's alerts.
  private static async readCaseAlerts(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<Array<SecurityDetection>> {
    return SecurityDetectionService.findBy({
      query: {
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        source: SecurityDetectionSource.ConnectedProduct,
        securityEventConnectionId: QueryHelper.notNull(),
      },
      select: {
        _id: true,
        securityEventConnectionId: true,
        eventUid: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      limit: Math.min(DETECTIONS_READ_LIMIT, SOURCE_ALERTS_PER_CLOSE_LIMIT * 5),
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static async caseUrl(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<string> {
    try {
      return (
        await SecurityCaseService.getCaseLinkInDashboard(
          data.projectId,
          data.securityCaseId,
        )
      ).toString();
    } catch {
      return "";
    }
  }
}
