import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import SecurityCaseNote from "../../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_CASE_STORY_MAX_ALERTS,
  SECURITY_CASE_STORY_MAX_CHANGES,
  SECURITY_CASE_STORY_MAX_DETECTIONS,
  SECURITY_CASE_STORY_MAX_EVENTS,
  SECURITY_CASE_STORY_MAX_EXCEPTIONS,
  SECURITY_CASE_STORY_MAX_INCIDENTS,
  SECURITY_CASE_STORY_MAX_ITEMS,
  SECURITY_CASE_STORY_MAX_NOTES,
  SECURITY_CASE_STORY_MAX_PLAYBOOK_RUNS,
  SecurityCaseStoryItemJson,
  SecurityCaseStoryItemKind,
  SecurityCaseStoryJson,
  SecurityCaseStoryMilestone,
  SecurityCaseStorySource,
} from "../../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectedResourceJson,
  SecurityConnectionKind,
  SecurityConnectionsJson,
} from "../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntity } from "../../../../Types/SecurityCase/SecurityEntity";
import { getSecurityPlaybookRunStatusColor } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { getObservableSearchValues } from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  STORY_EVENT_ATTRIBUTE_KEYS,
  StoryEventRow,
  buildStoryExceptionItems,
  cutStoryText,
  firstLine,
  mergeStoryItems,
  readStoryEventRow,
  runStoryEvents,
} from "../../../../Utils/SecurityCase/SecurityCaseStoryItems";
import { readChangeEventFields } from "../../../../Utils/Telemetry/ChangeEventFields";
import AlertService from "../../../Services/AlertService";
import ChangeEventService from "../../../Services/ChangeEventService";
import IncidentService from "../../../Services/IncidentService";
import SecurityCaseNoteService from "../../../Services/SecurityCaseNoteService";
import SecurityDetectionService from "../../../Services/SecurityDetectionService";
import SecurityEventService, {
  SECURITY_CONNECTION_READ_TIME_LIMIT,
  SECURITY_FINDING_CLASS_UIDS,
} from "../../../Services/SecurityEventService";
import SecurityPlaybookRunService from "../../../Services/SecurityPlaybookRunService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import SecurityConnections, {
  MAX_CHANGES_READ,
  RECORD_RELATION_COLUMNS,
} from "../../SecurityEvent/Connections/SecurityConnections";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../../Telemetry/TelemetryReadScope";
import {
  SecurityCaseContextScope,
  SecurityCaseSourceTracker,
  readSecurityCaseContextScope,
} from "./SecurityCaseContextScope";

/*
 * A SECURITY CASE'S STORY: what happened, in order, across OneUptime
 * (Types/SecurityCase/SecurityCaseContext.ts says what it holds).
 *
 * Read around the case's window, the one Connected Signals reads, with the
 * reader's own permissions:
 *
 *   detections      the case's own, each at the time it first fired;
 *   events          the security events naming the case's entities - told
 *                   in runs, each with how far its requests got and the
 *                   trace, exception and session it links to - and the
 *                   exceptions their requests threw, as their own items;
 *   changes         what changed on the records the case names (the ones
 *                   Connected Signals lists), deploys and rollouts first;
 *   incidents,      raised on those records in the window, and the
 *   alerts          incident the case declared, whenever it was;
 *   response        the case's playbook runs and notes, and its milestones:
 *                   opened, acknowledged, contained, closed.
 *
 * Each source is read on its own: one the reader's role cannot read is said
 * to be (unreadableSources), one that fails is said to have (failedSources),
 * and the rest of the story is still told. Every read is bounded.
 */

// The longest stretch of an event's target a story reads.
export const STORY_EVENT_TARGET_LENGTH: number = 500;

// Which story source each item kind came from, for what a bound left out.
const SOURCE_OF_KIND: Partial<
  Record<SecurityCaseStoryItemKind, SecurityCaseStorySource>
> = {
  [SecurityCaseStoryItemKind.Detection]: SecurityCaseStorySource.Detections,
  [SecurityCaseStoryItemKind.Events]: SecurityCaseStorySource.Events,
  [SecurityCaseStoryItemKind.Exception]: SecurityCaseStorySource.Exceptions,
  [SecurityCaseStoryItemKind.Change]: SecurityCaseStorySource.Changes,
  [SecurityCaseStoryItemKind.Incident]: SecurityCaseStorySource.Incidents,
  [SecurityCaseStoryItemKind.Alert]: SecurityCaseStorySource.Alerts,
  [SecurityCaseStoryItemKind.PlaybookRun]: SecurityCaseStorySource.PlaybookRuns,
  [SecurityCaseStoryItemKind.Note]: SecurityCaseStorySource.Notes,
};

function iso(value: Date | string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The records of the case Connected Signals lists, by kind, as ids.
export function getRecordIdsByKind(
  resources: ReadonlyArray<SecurityConnectedResourceJson>,
): Map<SecurityConnectionKind, Array<string>> {
  const byKind: Map<SecurityConnectionKind, Array<string>> = new Map();

  for (const resource of resources) {
    const ids: Array<string> = byKind.get(resource.kind) || [];

    if (!ids.includes(resource.id)) {
      ids.push(resource.id);
    }

    byKind.set(resource.kind, ids);
  }

  return byKind;
}

/*
 * The SQL that reads the events naming the case's entities: the case's
 * window, the reader's resources, oldest first, findings left out (they are
 * the case's detections, told from the case's own rows).
 */
export function buildStoryEventsStatement(data: {
  projectId: ObjectID;
  values: Array<string>;
  start: Date;
  end: Date;
  serviceFilter: TelemetryServiceFilter;
  limit: number;
}): Statement {
  const statement: Statement = SQL`SELECT time, eventUid, className, message, severityName, severityId, principalUser, principalHost, principalIp, substring(targetResource, 1, ${{
    type: TableColumnType.Number,
    value: STORY_EVENT_TARGET_LENGTH,
  }}) AS targetResource, requestOutcome, traceId, spanId, sessionId, mapFilter((key, value) -> has(${{
    type: TableColumnType.ArrayText,
    value: Object.values(STORY_EVENT_ATTRIBUTE_KEYS),
  }}, key), attributes) AS attributes FROM ${AnalyticsTableName.SecurityEvent} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: data.projectId,
  }} AND time >= ${{
    type: TableColumnType.DateTime64,
    value: data.start,
  }} AND time <= ${{
    type: TableColumnType.DateTime64,
    value: data.end,
  }} AND hasAny(observables, ${{
    type: TableColumnType.ArrayText,
    value: data.values,
  }})`;

  /*
   * Appended as text, not through SQL``: a plain string in the tag is bound
   * as an identifier, and these are the code's own numbers.
   */
  statement.append(
    ` AND classUid NOT IN (${SECURITY_FINDING_CLASS_UIDS.map(
      (classUid: number): string => {
        return String(Math.trunc(classUid));
      },
    ).join(", ")})`,
  );

  TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);

  statement.append(
    SQL` ORDER BY time ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

export default class SecurityCaseStory {
  @CaptureSpan()
  public static async build(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityCaseStoryJson | null> {
    const scope: SecurityCaseContextScope | null =
      await readSecurityCaseContextScope(data);

    if (!scope) {
      return null;
    }

    const tracker: SecurityCaseSourceTracker<SecurityCaseStorySource> =
      new SecurityCaseSourceTracker<SecurityCaseStorySource>(
        "Security case story",
      );
    const projectId: ObjectID = data.projectId;
    const props: DatabaseCommonInteractionProps = data.props;

    const [detections, eventRows, connections, runs, notes]: [
      Array<SecurityDetection> | null,
      Array<StoryEventRow> | null,
      SecurityConnectionsJson | null,
      Array<SecurityPlaybookRun> | null,
      Array<SecurityCaseNote> | null,
    ] = await Promise.all([
      tracker.read(SecurityCaseStorySource.Detections, () => {
        return this.readDetections({ ...data, tracker });
      }),
      tracker.read(SecurityCaseStorySource.Events, () => {
        return this.readEvents({
          projectId,
          entities: scope.entities,
          scope,
          props,
          tracker,
        });
      }),
      this.readConnections({ ...data, tracker }),
      tracker.read(SecurityCaseStorySource.PlaybookRuns, () => {
        return this.readPlaybookRuns({ ...data, tracker });
      }),
      tracker.read(SecurityCaseStorySource.Notes, () => {
        return this.readNotes({ ...data, tracker });
      }),
    ]);

    const resources: Array<SecurityConnectedResourceJson> =
      connections?.resources || [];

    const [changes, incidents, alerts, exceptionIds]: [
      Array<SecurityCaseStoryItemJson> | null,
      Array<SecurityCaseStoryItemJson> | null,
      Array<SecurityCaseStoryItemJson> | null,
      Map<string, string> | null,
    ] = await Promise.all([
      connections
        ? tracker.read(SecurityCaseStorySource.Changes, () => {
            return this.readChanges({ projectId, scope, resources, props });
          })
        : Promise.resolve(null),
      connections
        ? tracker.read(SecurityCaseStorySource.Incidents, () => {
            return this.readIncidents({
              projectId,
              scope,
              resources,
              props,
              tracker,
            });
          })
        : Promise.resolve(null),
      connections
        ? tracker.read(SecurityCaseStorySource.Alerts, () => {
            return this.readAlerts({
              projectId,
              scope,
              resources,
              props,
              tracker,
            });
          })
        : Promise.resolve(null),
      tracker.read(SecurityCaseStorySource.Exceptions, () => {
        return this.readExceptionIds({
          projectId,
          rows: eventRows || [],
          props,
        });
      }),
    ]);

    const items: Array<SecurityCaseStoryItemJson> = [
      ...this.milestoneItems(scope),
      ...(detections || []).map(toDetectionItem),
      ...runStoryEvents(eventRows || []),
      ...this.exceptionItems(eventRows || [], exceptionIds),
      ...(changes || []),
      ...(incidents || []),
      ...(alerts || []),
      ...(runs || []).map(toPlaybookRunItem),
      ...(notes || []).map(toNoteItem),
    ];

    const merged: {
      items: Array<SecurityCaseStoryItemJson>;
      isTruncated: boolean;
    } = mergeStoryItems(items, SECURITY_CASE_STORY_MAX_ITEMS);

    if (merged.isTruncated) {
      const kept: Set<string> = new Set(
        merged.items.map((item: SecurityCaseStoryItemJson): string => {
          return item.key;
        }),
      );

      for (const item of items) {
        const source: SecurityCaseStorySource | undefined =
          SOURCE_OF_KIND[item.kind];

        if (source && !kept.has(item.key)) {
          tracker.markTruncated(source);
        }
      }
    }

    return {
      windowStart: scope.window.start.toISOString(),
      windowEnd: scope.window.end.toISOString(),
      items: merged.items,
      truncatedSources: tracker.getTruncated(),
      unreadableSources: tracker.getUnreadable(),
      failedSources: tracker.getFailed(),
    };
  }

  // How the case opened, and each step it has taken since.
  private static milestoneItems(
    scope: SecurityCaseContextScope,
  ): Array<SecurityCaseStoryItemJson> {
    const items: Array<SecurityCaseStoryItemJson> = [];
    const opened: string | null = iso(scope.securityCase.createdAt);

    if (opened) {
      items.push({
        key: "case:opened",
        kind: SecurityCaseStoryItemKind.CaseOpened,
        time: opened,
        title: "",
        links: {},
      });
    }

    for (const [milestone, value] of [
      [
        SecurityCaseStoryMilestone.Acknowledged,
        scope.securityCase.acknowledgedAt,
      ],
      [SecurityCaseStoryMilestone.Contained, scope.securityCase.containedAt],
      [SecurityCaseStoryMilestone.Closed, scope.securityCase.closedAt],
    ] as Array<[SecurityCaseStoryMilestone, Date | undefined]>) {
      const time: string | null = iso(value);

      if (time) {
        items.push({
          key: `case:${milestone.toLowerCase()}`,
          kind: SecurityCaseStoryItemKind.Milestone,
          time,
          title: "",
          milestone,
          links: {},
        });
      }
    }

    return items;
  }

  private static exceptionItems(
    rows: Array<StoryEventRow>,
    exceptionIds: Map<string, string> | null,
  ): Array<SecurityCaseStoryItemJson> {
    return buildStoryExceptionItems(rows)
      .slice(0, SECURITY_CASE_STORY_MAX_EXCEPTIONS)
      .map((item: SecurityCaseStoryItemJson): SecurityCaseStoryItemJson => {
        const exceptionId: string | undefined = item.links.exceptionFingerprint
          ? exceptionIds?.get(item.links.exceptionFingerprint)
          : undefined;

        return exceptionId
          ? { ...item, links: { ...item.links, exceptionId } }
          : item;
      });
  }

  private static async readDetections(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    tracker: SecurityCaseSourceTracker<SecurityCaseStorySource>;
  }): Promise<Array<SecurityDetection>> {
    const rows: Array<SecurityDetection> =
      await SecurityDetectionService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        },
        select: {
          _id: true,
          title: true,
          severity: true,
          ruleName: true,
          groupValue: true,
          eventCount: true,
          fireCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
          eventUid: true,
          createdAt: true,
        },
        sort: { firstSeenAt: SortOrder.Ascending },
        limit: SECURITY_CASE_STORY_MAX_DETECTIONS + 1,
        skip: 0,
        props: data.props,
      });

    return data.tracker.bound(
      SecurityCaseStorySource.Detections,
      rows,
      SECURITY_CASE_STORY_MAX_DETECTIONS,
    );
  }

  /*
   * The events naming the case's entities, in the reader's resources. A
   * case that names nothing has none to read.
   */
  private static async readEvents(data: {
    projectId: ObjectID;
    entities: Array<SecurityEntity>;
    scope: SecurityCaseContextScope;
    props: DatabaseCommonInteractionProps;
    tracker: SecurityCaseSourceTracker<SecurityCaseStorySource>;
  }): Promise<Array<StoryEventRow>> {
    const values: Array<string> = getObservableSearchValues(
      data.entities.map((entity: SecurityEntity): string => {
        return entity.value;
      }),
    );

    if (values.length === 0) {
      return [];
    }

    // Whose events the reader may read; a refusal is the source's to say.
    const serviceFilter: TelemetryServiceFilter =
      await TelemetryReadAccess.getServiceFilter({
        modelType: SecurityEvent,
        props: data.props,
      });

    const result: Awaited<
      ReturnType<typeof SecurityEventService.executeQuery>
    > = await SecurityEventService.executeQuery(
      buildStoryEventsStatement({
        projectId: data.projectId,
        values,
        start: data.scope.window.start,
        end: data.scope.window.end,
        serviceFilter,
        limit: SECURITY_CASE_STORY_MAX_EVENTS + 1,
      }),
    );
    const response: { data?: Array<JSONObject> } = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<StoryEventRow> = (response.data || [])
      .map((row: JSONObject): StoryEventRow | null => {
        return readStoryEventRow(row);
      })
      .filter((row: StoryEventRow | null): row is StoryEventRow => {
        return Boolean(row);
      });

    return data.tracker.bound(
      SecurityCaseStorySource.Events,
      rows,
      SECURITY_CASE_STORY_MAX_EVENTS,
    );
  }

  /*
   * The records the case names, as Connected Signals reads them. A failure
   * here leaves the story without what happened on them: said as such.
   */
  private static async readConnections(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
    tracker: SecurityCaseSourceTracker<SecurityCaseStorySource>;
  }): Promise<SecurityConnectionsJson | null> {
    try {
      return await SecurityConnections.forCase({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        props: data.props,
        now: data.now,
      });
    } catch {
      for (const source of [
        SecurityCaseStorySource.Changes,
        SecurityCaseStorySource.Incidents,
        SecurityCaseStorySource.Alerts,
      ]) {
        data.tracker.markFailed(source);
      }

      return null;
    }
  }

  /*
   * What changed on the case's records in its window, read as Connected
   * Signals reads changes (the latest MAX_CHANGES_READ of the project's, each
   * matched to a record by the ids it names), oldest first.
   */
  private static async readChanges(data: {
    projectId: ObjectID;
    scope: SecurityCaseContextScope;
    resources: Array<SecurityConnectedResourceJson>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<SecurityCaseStoryItemJson>> {
    const byId: Map<string, SecurityConnectedResourceJson> = new Map();

    for (const resource of data.resources) {
      if (
        resource.kind !== SecurityConnectionKind.User &&
        resource.kind !== SecurityConnectionKind.NetworkDevice
      ) {
        byId.set(resource.id, resource);
      }
    }

    if (byId.size === 0) {
      return [];
    }

    const rows: Array<ChangeEvent> = await ChangeEventService.findBy({
      query: {
        projectId: data.projectId,
        time: new InBetween(data.scope.window.start, data.scope.window.end),
      } as never,
      select: {
        _id: true,
        time: true,
        eventType: true,
        title: true,
        primaryEntityId: true,
        attributes: true,
      } as never,
      sort: { time: SortOrder.Descending } as never,
      limit: MAX_CHANGES_READ,
      skip: 0,
      props: data.props,
    });

    const items: Array<SecurityCaseStoryItemJson> = [];

    for (const row of rows) {
      const time: string | null = iso(row.time);

      if (!time) {
        continue;
      }

      const fields: Dictionary<string | undefined> = readChangeEventFields(
        (row.attributes as Dictionary<unknown>) || {},
      ) as Dictionary<string | undefined>;
      const resource: SecurityConnectedResourceJson | undefined = [
        row.primaryEntityId?.toString(),
        fields["kubernetesClusterId"],
        fields["resourceId"],
      ]
        .map(
          (
            id: string | undefined,
          ): SecurityConnectedResourceJson | undefined => {
            return id ? byId.get(id) : undefined;
          },
        )
        .find((found: SecurityConnectedResourceJson | undefined): boolean => {
          return Boolean(found);
        });

      if (!resource) {
        continue;
      }

      const version: string | undefined = fields["version"];

      items.push({
        key: `change:${row._id?.toString() || time}`,
        kind: SecurityCaseStoryItemKind.Change,
        time,
        title: cutStoryText(row.title || row.eventType || "Change"),
        ...(version ? { detail: cutStoryText(version) } : {}),
        stateName: row.eventType || "change",
        links: {
          resource: {
            kind: resource.kind,
            id: resource.id,
            name: resource.name,
          },
        },
      });
    }

    return items.slice(0, SECURITY_CASE_STORY_MAX_CHANGES);
  }

  // The incidents raised on the case's records in its window, and the one it declared.
  private static async readIncidents(data: {
    projectId: ObjectID;
    scope: SecurityCaseContextScope;
    resources: Array<SecurityConnectedResourceJson>;
    props: DatabaseCommonInteractionProps;
    tracker: SecurityCaseSourceTracker<SecurityCaseStorySource>;
  }): Promise<Array<SecurityCaseStoryItemJson>> {
    const items: Map<string, SecurityCaseStoryItemJson> = new Map();
    const select: JSONObject = {
      _id: true,
      title: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      createdAt: true,
      currentIncidentState: { name: true, color: true },
    };

    const add: (
      incident: Incident,
      resource?: SecurityConnectedResourceJson | undefined,
    ) => void = (
      incident: Incident,
      resource?: SecurityConnectedResourceJson | undefined,
    ): void => {
      const id: string = incident.id?.toString() || "";
      const time: string | null = iso(incident.createdAt);

      if (!id || !time || items.has(id)) {
        return;
      }

      items.set(id, {
        key: `incident:${id}`,
        kind: SecurityCaseStoryItemKind.Incident,
        time,
        title: cutStoryText(incident.title || ""),
        ...(incident.incidentNumberWithPrefix ||
        incident.incidentNumber !== undefined
          ? {
              number:
                incident.incidentNumberWithPrefix ||
                `#${incident.incidentNumber}`,
            }
          : {}),
        ...(incident.currentIncidentState?.name
          ? { stateName: incident.currentIncidentState.name }
          : {}),
        ...(incident.currentIncidentState?.color
          ? { stateColor: incident.currentIncidentState.color.toString() }
          : {}),
        links: {
          incidentId: id,
          ...(resource
            ? {
                resource: {
                  kind: resource.kind,
                  id: resource.id,
                  name: resource.name,
                },
              }
            : {}),
        },
      });
    };

    const declaredId: ObjectID | undefined = data.scope.securityCase.incidentId;

    if (declaredId) {
      const declared: Incident | null = await IncidentService.findOneBy({
        query: { _id: declaredId, projectId: data.projectId },
        select: select as never,
        props: data.props,
      });

      if (declared) {
        add(declared);
      }
    }

    for (const [kind, ids] of Array.from(
      getRecordIdsByKind(data.resources).entries(),
    )) {
      const column: string | undefined = RECORD_RELATION_COLUMNS[kind];

      if (!column || ids.length === 0) {
        continue;
      }

      const rows: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: data.projectId,
          [column]: QueryHelper.inRelationArray(
            ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          createdAt: new InBetween(
            data.scope.window.start,
            data.scope.window.end,
          ),
        } as never,
        select: { ...select, [column]: { _id: true } } as never,
        sort: { createdAt: SortOrder.Ascending },
        limit: SECURITY_CASE_STORY_MAX_INCIDENTS + 1,
        skip: 0,
        props: data.props,
      });

      if (rows.length > SECURITY_CASE_STORY_MAX_INCIDENTS) {
        data.tracker.markTruncated(SecurityCaseStorySource.Incidents);
      }

      for (const incident of rows.slice(0, SECURITY_CASE_STORY_MAX_INCIDENTS)) {
        add(
          incident,
          findLinkedResource(incident, column, data.resources, kind),
        );
      }
    }

    return Array.from(items.values());
  }

  // The alerts raised on the case's records in its window.
  private static async readAlerts(data: {
    projectId: ObjectID;
    scope: SecurityCaseContextScope;
    resources: Array<SecurityConnectedResourceJson>;
    props: DatabaseCommonInteractionProps;
    tracker: SecurityCaseSourceTracker<SecurityCaseStorySource>;
  }): Promise<Array<SecurityCaseStoryItemJson>> {
    const items: Map<string, SecurityCaseStoryItemJson> = new Map();

    for (const [kind, ids] of Array.from(
      getRecordIdsByKind(data.resources).entries(),
    )) {
      const column: string | undefined = RECORD_RELATION_COLUMNS[kind];

      if (!column || ids.length === 0) {
        continue;
      }

      const rows: Array<Alert> = await AlertService.findBy({
        query: {
          projectId: data.projectId,
          [column]: QueryHelper.inRelationArray(
            ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          createdAt: new InBetween(
            data.scope.window.start,
            data.scope.window.end,
          ),
        } as never,
        select: {
          _id: true,
          title: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          createdAt: true,
          currentAlertState: { name: true, color: true },
          [column]: { _id: true },
        } as never,
        sort: { createdAt: SortOrder.Ascending },
        limit: SECURITY_CASE_STORY_MAX_ALERTS + 1,
        skip: 0,
        props: data.props,
      });

      if (rows.length > SECURITY_CASE_STORY_MAX_ALERTS) {
        data.tracker.markTruncated(SecurityCaseStorySource.Alerts);
      }

      for (const alert of rows.slice(0, SECURITY_CASE_STORY_MAX_ALERTS)) {
        const id: string = alert.id?.toString() || "";
        const time: string | null = iso(alert.createdAt);

        if (!id || !time || items.has(id)) {
          continue;
        }

        const resource: SecurityConnectedResourceJson | undefined =
          findLinkedResource(alert, column, data.resources, kind);

        items.set(id, {
          key: `alert:${id}`,
          kind: SecurityCaseStoryItemKind.Alert,
          time,
          title: cutStoryText(alert.title || ""),
          ...(alert.alertNumberWithPrefix || alert.alertNumber !== undefined
            ? {
                number: alert.alertNumberWithPrefix || `#${alert.alertNumber}`,
              }
            : {}),
          ...(alert.currentAlertState?.name
            ? { stateName: alert.currentAlertState.name }
            : {}),
          ...(alert.currentAlertState?.color
            ? { stateColor: alert.currentAlertState.color.toString() }
            : {}),
          links: {
            alertId: id,
            ...(resource
              ? {
                  resource: {
                    kind: resource.kind,
                    id: resource.id,
                    name: resource.name,
                  },
                }
              : {}),
          },
        });
      }
    }

    return Array.from(items.values());
  }

  private static async readPlaybookRuns(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    tracker: SecurityCaseSourceTracker<SecurityCaseStorySource>;
  }): Promise<Array<SecurityPlaybookRun>> {
    const rows: Array<SecurityPlaybookRun> =
      await SecurityPlaybookRunService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        },
        select: {
          _id: true,
          playbookName: true,
          status: true,
          createdAt: true,
          triggeredByUser: { name: true, email: true },
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: SECURITY_CASE_STORY_MAX_PLAYBOOK_RUNS + 1,
        skip: 0,
        props: data.props,
      });

    return data.tracker.bound(
      SecurityCaseStorySource.PlaybookRuns,
      rows,
      SECURITY_CASE_STORY_MAX_PLAYBOOK_RUNS,
    );
  }

  private static async readNotes(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    tracker: SecurityCaseSourceTracker<SecurityCaseStorySource>;
  }): Promise<Array<SecurityCaseNote>> {
    const rows: Array<SecurityCaseNote> = await SecurityCaseNoteService.findBy({
      query: {
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
      },
      select: {
        _id: true,
        note: true,
        createdAt: true,
        createdByUser: { name: true, email: true },
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: SECURITY_CASE_STORY_MAX_NOTES + 1,
      skip: 0,
      props: data.props,
    });

    return data.tracker.bound(
      SecurityCaseStorySource.Notes,
      rows,
      SECURITY_CASE_STORY_MAX_NOTES,
    );
  }

  /*
   * The exception groups (TelemetryException) the events' requests threw
   * into, by fingerprint, so each can be opened. A reader who may not read
   * exceptions still sees what was thrown (the events say it), without the
   * link - and is told why.
   */
  private static async readExceptionIds(data: {
    projectId: ObjectID;
    rows: Array<StoryEventRow>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const fingerprints: Array<string> = Array.from(
      new Set(
        data.rows
          .map((row: StoryEventRow): string => {
            return row.exceptionFingerprint;
          })
          .filter(Boolean),
      ),
    ).slice(0, SECURITY_CASE_STORY_MAX_EXCEPTIONS);

    const ids: Map<string, string> = new Map();

    if (fingerprints.length === 0) {
      return ids;
    }

    const groups: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: {
          projectId: data.projectId,
          fingerprint: new Includes(fingerprints),
        },
        select: { _id: true, fingerprint: true },
        limit: fingerprints.length * 2,
        skip: 0,
        props: data.props,
      });

    for (const group of groups) {
      if (group.fingerprint && group.id && !ids.has(group.fingerprint)) {
        ids.set(group.fingerprint, group.id.toString());
      }
    }

    return ids;
  }
}

// The record an incident or alert names, among the case's.
function findLinkedResource(
  row: Incident | Alert,
  column: string,
  resources: Array<SecurityConnectedResourceJson>,
  kind: SecurityConnectionKind,
): SecurityConnectedResourceJson | undefined {
  const related: unknown = (row as unknown as Dictionary<unknown>)[column];

  if (!Array.isArray(related)) {
    return undefined;
  }

  const relatedIds: Set<string> = new Set(
    related
      .map((item: unknown): string => {
        const value: unknown =
          (item as { _id?: unknown; id?: unknown })?._id ||
          (item as { _id?: unknown; id?: unknown })?.id;

        return value ? String(value) : "";
      })
      .filter(Boolean),
  );

  return resources.find((resource: SecurityConnectedResourceJson): boolean => {
    return resource.kind === kind && relatedIds.has(resource.id);
  });
}

export function toDetectionItem(
  detection: SecurityDetection,
): SecurityCaseStoryItemJson {
  const id: string = detection.id?.toString() || "";
  const first: string =
    iso(detection.firstSeenAt) ||
    iso(detection.createdAt) ||
    new Date(0).toISOString();
  const last: string | null = iso(detection.lastSeenAt);

  const item: SecurityCaseStoryItemJson = {
    key: `detection:${id}`,
    kind: SecurityCaseStoryItemKind.Detection,
    time: first,
    title: cutStoryText(detection.title || detection.ruleName || ""),
    count: detection.fireCount || 1,
    links: {
      detectionId: id,
      ...(detection.eventUid ? { eventUid: detection.eventUid } : {}),
      ...(detection.groupValue ? { observable: detection.groupValue } : {}),
    },
  };

  if (last && new Date(last).getTime() > new Date(first).getTime()) {
    item.endTime = last;
  }

  if (detection.severity) {
    item.severityName = detection.severity;
  }

  if (detection.groupValue) {
    item.detail = cutStoryText(detection.groupValue);
  }

  return item;
}

export function toPlaybookRunItem(
  run: SecurityPlaybookRun,
): SecurityCaseStoryItemJson {
  const id: string = run.id?.toString() || "";
  const actor: string =
    run.triggeredByUser?.name?.toString() ||
    run.triggeredByUser?.email?.toString() ||
    "";

  return {
    key: `run:${id}`,
    kind: SecurityCaseStoryItemKind.PlaybookRun,
    time: iso(run.createdAt) || new Date(0).toISOString(),
    title: cutStoryText(run.playbookName || ""),
    ...(run.status
      ? {
          stateName: run.status,
          stateColor: getSecurityPlaybookRunStatusColor(run.status).toString(),
        }
      : {}),
    ...(actor ? { actorName: actor } : {}),
    links: { playbookRunId: id },
  };
}

export function toNoteItem(note: SecurityCaseNote): SecurityCaseStoryItemJson {
  const id: string = note.id?.toString() || "";
  const actor: string =
    note.createdByUser?.name?.toString() ||
    note.createdByUser?.email?.toString() ||
    "";

  return {
    key: `note:${id}`,
    kind: SecurityCaseStoryItemKind.Note,
    time: iso(note.createdAt) || new Date(0).toISOString(),
    title: firstLine(note.note),
    ...(actor ? { actorName: actor } : {}),
    links: {},
  };
}
