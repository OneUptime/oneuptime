import QueryPermission from "../../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import AlertEpisodeFeed, {
  AlertEpisodeFeedEventType,
} from "../../../../Models/DatabaseModels/AlertEpisodeFeed";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../../Models/DatabaseModels/AlertFeed";
import CephClusterFeed, {
  CephClusterFeedEventType,
} from "../../../../Models/DatabaseModels/CephClusterFeed";
import CloudResourceFeed, {
  CloudResourceFeedEventType,
} from "../../../../Models/DatabaseModels/CloudResourceFeed";
import DatabaseServerFeed, {
  DatabaseServerFeedEventType,
} from "../../../../Models/DatabaseModels/DatabaseServerFeed";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHostFeed, {
  DockerHostFeedEventType,
} from "../../../../Models/DatabaseModels/DockerHostFeed";
import DockerSwarmClusterFeed, {
  DockerSwarmClusterFeedEventType,
} from "../../../../Models/DatabaseModels/DockerSwarmClusterFeed";
import HostFeed, {
  HostFeedEventType,
} from "../../../../Models/DatabaseModels/HostFeed";
import IncidentEpisodeFeed, {
  IncidentEpisodeFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentEpisodeFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import KubernetesClusterFeed, {
  KubernetesClusterFeedEventType,
} from "../../../../Models/DatabaseModels/KubernetesClusterFeed";
import MonitorFeed, {
  MonitorFeedEventType,
} from "../../../../Models/DatabaseModels/MonitorFeed";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import PodmanHostFeed, {
  PodmanHostFeedEventType,
} from "../../../../Models/DatabaseModels/PodmanHostFeed";
import ProxmoxClusterFeed, {
  ProxmoxClusterFeedEventType,
} from "../../../../Models/DatabaseModels/ProxmoxClusterFeed";
import ScheduledMaintenanceFeed, {
  ScheduledMaintenanceFeedEventType,
} from "../../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import ServiceFeed, {
  ServiceFeedEventType,
} from "../../../../Models/DatabaseModels/ServiceFeed";
import ServiceLevelObjectiveFeed, {
  ServiceLevelObjectiveFeedEventType,
} from "../../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import VMwareVCenterFeed, {
  VMwareVCenterFeedEventType,
} from "../../../../Models/DatabaseModels/VMwareVCenterFeed";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import {
  FEED_SORT_ORDER_OPTIONS,
  FeedOptions,
  getFeedEventTypeQuery,
} from "../../../../UI/Components/Feed/FeedOptions";
import { FindOperator } from "typeorm";
import { describe, expect, it, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The server half of the dashboard feeds' "Filter & Sort" button.
 *
 * Filtering and sorting are done by the API, never in the browser: a feed is
 * read a window at a time, so the dashboard sends
 *
 *   query: { <resource id column>: ObjectID,
 *            <event type column>: new Includes([...checked event types]) }
 *   sort:  { postedAt: "ASC" | "DESC" }
 *
 * to the feed model's list endpoint. Every link of that trip fails for the
 * reader and not for the developer - a 403 or an unfiltered feed looks the same
 * as "no activity" until somebody ticks a box on a feed they happen to watch.
 * So each link is asserted here, for every feed model, rather than for the one
 * a reviewer happened to click:
 *
 *  1. the query and the sort survive the wire: JSONFunctions.serialize on the
 *     client, JSON over HTTP, JSONFunctions.deserialize in BaseAPI. An Includes
 *     that came back as a plain `{ _type, value }` object would reach TypeORM
 *     as an equality against an object and match nothing.
 *  2. QueryPermission lets every reader of the feed filter on both columns - a
 *     WHERE clause is held to the same read standard as a SELECT.
 *  3. which is only true while the event type column's read list is the
 *     table's read list: a reader who may open the feed but not read that
 *     column would see the feed and get a 403 the moment they filter it.
 *  4. QueryUtil turns the Includes into a real `IN (...)` over bound
 *     parameters, instead of letting it through as an object.
 *
 * The table below is checked against the model directory, so a feed model
 * added later cannot ship its Filter & Sort button without these guarantees.
 */

const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Models",
  "DatabaseModels",
);

/*
 * What makes a model a filterable activity feed: an exported event type enum,
 * which is what the checklist offers. The calendar feeds and ThreatIntelFeed
 * are also named *Feed but have no such enum, and no Filter & Sort button.
 */
const FEED_EVENT_TYPE_ENUM: RegExp = /export enum (\w+FeedEventType)\b/;

interface FeedModelEntry {
  // The model's file name in Models/DatabaseModels, without ".ts".
  file: string;
  // The event type enum that file exports.
  enumName: string;
  modelType: DatabaseBaseModelType;
  // Every value of that enum - the checklist the dashboard offers.
  eventTypes: Array<string>;
  // The foreign key the dashboard scopes the feed by.
  resourceIdColumn: string;
  // The column the event type filter is applied to.
  eventTypeColumn: string;
}

/*
 * The column names are the ones the dashboard sends: the feed components
 * under App/FeatureSet/Dashboard/src/Components (Incident, Alert, their
 * episodes, Monitor, On-Call Policy, Scheduled Maintenance) name them in their
 * getList queries, and every resource feed page passes them to ResourceFeed as
 * resourceIdColumn / eventTypeColumn (SloFeed through getSloResourceFeedProps).
 */
const FEED_MODELS: Array<FeedModelEntry> = [
  {
    file: "AlertEpisodeFeed",
    enumName: "AlertEpisodeFeedEventType",
    modelType: AlertEpisodeFeed,
    eventTypes: Object.values(AlertEpisodeFeedEventType),
    resourceIdColumn: "alertEpisodeId",
    eventTypeColumn: "alertEpisodeFeedEventType",
  },
  {
    file: "AlertFeed",
    enumName: "AlertFeedEventType",
    modelType: AlertFeed,
    eventTypes: Object.values(AlertFeedEventType),
    resourceIdColumn: "alertId",
    eventTypeColumn: "alertFeedEventType",
  },
  {
    file: "CephClusterFeed",
    enumName: "CephClusterFeedEventType",
    modelType: CephClusterFeed,
    eventTypes: Object.values(CephClusterFeedEventType),
    resourceIdColumn: "cephClusterId",
    eventTypeColumn: "cephClusterFeedEventType",
  },
  {
    file: "CloudResourceFeed",
    enumName: "CloudResourceFeedEventType",
    modelType: CloudResourceFeed,
    eventTypes: Object.values(CloudResourceFeedEventType),
    resourceIdColumn: "cloudResourceId",
    eventTypeColumn: "cloudResourceFeedEventType",
  },
  {
    file: "DatabaseServerFeed",
    enumName: "DatabaseServerFeedEventType",
    modelType: DatabaseServerFeed,
    eventTypes: Object.values(DatabaseServerFeedEventType),
    resourceIdColumn: "databaseServerId",
    eventTypeColumn: "databaseServerFeedEventType",
  },
  {
    file: "DockerHostFeed",
    enumName: "DockerHostFeedEventType",
    modelType: DockerHostFeed,
    eventTypes: Object.values(DockerHostFeedEventType),
    resourceIdColumn: "dockerHostId",
    eventTypeColumn: "dockerHostFeedEventType",
  },
  {
    file: "DockerSwarmClusterFeed",
    enumName: "DockerSwarmClusterFeedEventType",
    modelType: DockerSwarmClusterFeed,
    eventTypes: Object.values(DockerSwarmClusterFeedEventType),
    resourceIdColumn: "dockerSwarmClusterId",
    eventTypeColumn: "dockerSwarmClusterFeedEventType",
  },
  {
    file: "HostFeed",
    enumName: "HostFeedEventType",
    modelType: HostFeed,
    eventTypes: Object.values(HostFeedEventType),
    resourceIdColumn: "hostId",
    eventTypeColumn: "hostFeedEventType",
  },
  {
    file: "IncidentEpisodeFeed",
    enumName: "IncidentEpisodeFeedEventType",
    modelType: IncidentEpisodeFeed,
    eventTypes: Object.values(IncidentEpisodeFeedEventType),
    resourceIdColumn: "incidentEpisodeId",
    eventTypeColumn: "incidentEpisodeFeedEventType",
  },
  {
    file: "IncidentFeed",
    enumName: "IncidentFeedEventType",
    modelType: IncidentFeed,
    eventTypes: Object.values(IncidentFeedEventType),
    resourceIdColumn: "incidentId",
    eventTypeColumn: "incidentFeedEventType",
  },
  {
    file: "KubernetesClusterFeed",
    enumName: "KubernetesClusterFeedEventType",
    modelType: KubernetesClusterFeed,
    eventTypes: Object.values(KubernetesClusterFeedEventType),
    resourceIdColumn: "kubernetesClusterId",
    eventTypeColumn: "kubernetesClusterFeedEventType",
  },
  {
    file: "MonitorFeed",
    enumName: "MonitorFeedEventType",
    modelType: MonitorFeed,
    eventTypes: Object.values(MonitorFeedEventType),
    resourceIdColumn: "monitorId",
    eventTypeColumn: "monitorFeedEventType",
  },
  {
    file: "OnCallDutyPolicyFeed",
    enumName: "OnCallDutyPolicyFeedEventType",
    modelType: OnCallDutyPolicyFeed,
    eventTypes: Object.values(OnCallDutyPolicyFeedEventType),
    resourceIdColumn: "onCallDutyPolicyId",
    eventTypeColumn: "onCallDutyPolicyFeedEventType",
  },
  {
    file: "PodmanHostFeed",
    enumName: "PodmanHostFeedEventType",
    modelType: PodmanHostFeed,
    eventTypes: Object.values(PodmanHostFeedEventType),
    resourceIdColumn: "podmanHostId",
    eventTypeColumn: "podmanHostFeedEventType",
  },
  {
    file: "ProxmoxClusterFeed",
    enumName: "ProxmoxClusterFeedEventType",
    modelType: ProxmoxClusterFeed,
    eventTypes: Object.values(ProxmoxClusterFeedEventType),
    resourceIdColumn: "proxmoxClusterId",
    eventTypeColumn: "proxmoxClusterFeedEventType",
  },
  {
    file: "ScheduledMaintenanceFeed",
    enumName: "ScheduledMaintenanceFeedEventType",
    modelType: ScheduledMaintenanceFeed,
    eventTypes: Object.values(ScheduledMaintenanceFeedEventType),
    resourceIdColumn: "scheduledMaintenanceId",
    eventTypeColumn: "scheduledMaintenanceFeedEventType",
  },
  {
    file: "ServiceFeed",
    enumName: "ServiceFeedEventType",
    modelType: ServiceFeed,
    eventTypes: Object.values(ServiceFeedEventType),
    resourceIdColumn: "serviceId",
    eventTypeColumn: "serviceFeedEventType",
  },
  {
    file: "ServiceLevelObjectiveFeed",
    enumName: "ServiceLevelObjectiveFeedEventType",
    modelType: ServiceLevelObjectiveFeed,
    eventTypes: Object.values(ServiceLevelObjectiveFeedEventType),
    resourceIdColumn: "serviceLevelObjectiveId",
    eventTypeColumn: "serviceLevelObjectiveFeedEventType",
  },
  {
    file: "VMwareVCenterFeed",
    enumName: "VMwareVCenterFeedEventType",
    modelType: VMwareVCenterFeed,
    eventTypes: Object.values(VMwareVCenterFeedEventType),
    resourceIdColumn: "vmwareVCenterId",
    eventTypeColumn: "vmwareVCenterFeedEventType",
  },
];

// The column every feed sorts by, whichever way the reader picked.
const SORT_COLUMN: string = "postedAt";

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const resourceId: ObjectID = ObjectID.generate();

type DiscoverFeedModelsFunction = () => Array<string>;

// "<file>:<enum name>" for every model file that exports a feed event type enum.
const discoverFeedModels: DiscoverFeedModelsFunction = (): Array<string> => {
  const discovered: Array<string> = [];

  for (const fileName of fs.readdirSync(MODELS_DIRECTORY)) {
    if (!fileName.endsWith("Feed.ts")) {
      continue;
    }

    const source: string = fs.readFileSync(
      path.join(MODELS_DIRECTORY, fileName),
      "utf8",
    );
    const match: RegExpExecArray | null = FEED_EVENT_TYPE_ENUM.exec(source);

    if (match) {
      discovered.push(`${fileName.replace(/\.ts$/, "")}:${match[1]}`);
    }
  }

  return discovered.sort();
};

type GetCheckedEventTypesFunction = (entry: FeedModelEntry) => Array<string>;

/*
 * Two different event types - the first and the last the checklist offers -
 * so an IN that collapsed to its first value, or a round trip that dropped one,
 * shows up as a missing value rather than passing on a list of one.
 */
const getCheckedEventTypes: GetCheckedEventTypesFunction = (
  entry: FeedModelEntry,
): Array<string> => {
  return [entry.eventTypes[0]!, entry.eventTypes[entry.eventTypes.length - 1]!];
};

type GetClientQueryFunction = (
  entry: FeedModelEntry,
  eventTypes: Array<string>,
) => JSONObject;

/*
 * Built the way every dashboard feed builds it - the resource id, spread with
 * getFeedEventTypeQuery - so a change to the client's filter shape is judged
 * by the server-side checks below rather than by a copy of the old shape. The
 * first assertion in each test pins that shape.
 */
const getClientQuery: GetClientQueryFunction = (
  entry: FeedModelEntry,
  eventTypes: Array<string>,
): JSONObject => {
  const options: FeedOptions = {
    sortOrder: SortOrder.Ascending,
    eventTypes: eventTypes,
  };

  return {
    [entry.resourceIdColumn]: resourceId,
    ...(getFeedEventTypeQuery<JSONObject>(
      entry.eventTypeColumn,
      options,
    ) as unknown as JSONObject),
  } as JSONObject;
};

type OverTheWireFunction = (value: JSONObject) => JSONObject;

// ModelAPI.getList's serialize, the HTTP body, then BaseAPI.getList's deserialize.
const overTheWire: OverTheWireFunction = (value: JSONObject): JSONObject => {
  const body: string = JSON.stringify(JSONFunctions.serialize(value));

  return JSONFunctions.deserialize(JSON.parse(body) as JSONObject);
};

type GetServerQueryFunction = (
  entry: FeedModelEntry,
  eventTypes: Array<string>,
) => JSONObject;

// The query as BaseAPI hands it to the permission layer and the service.
const getServerQuery: GetServerQueryFunction = (
  entry: FeedModelEntry,
  eventTypes: Array<string>,
): JSONObject => {
  return overTheWire(getClientQuery(entry, eventTypes));
};

type MakePropsFunction = (
  tenantPermissions: Array<Permission>,
) => DatabaseCommonInteractionProps;

/*
 * A signed-in project member holding exactly `tenantPermissions`, with the
 * global permissions AccessTokenService grants every user. Fresh per call:
 * DatabaseCommonInteractionPropsUtil MUTATES the props it is handed (it pushes
 * Public and CurrentUser onto the global list), so a shared object would carry
 * state from one assertion to the next.
 */
const makeProps: MakePropsFunction = (
  tenantPermissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: userId,
    tenantId: projectId,
    userGlobalAccessPermission: {
      projectIds: [projectId],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: tenantPermissions.map(
          (permission: Permission): UserPermission => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            };
          },
        ),
        _type: "UserTenantAccessPermission",
      },
    },
  };
};

type CheckQueryFunction = (
  entry: FeedModelEntry,
  query: JSONObject,
  props: DatabaseCommonInteractionProps,
) => void;

const checkQuery: CheckQueryFunction = (
  entry: FeedModelEntry,
  query: JSONObject,
  props: DatabaseCommonInteractionProps,
): void => {
  QueryPermission.checkQueryPermission<BaseModel>(
    entry.modelType,
    query as unknown as Query<BaseModel>,
    props,
  );
};

type SortedFunction = (permissions: Array<Permission>) => Array<Permission>;

// Read lists are sets; the order they are written in means nothing.
const sorted: SortedFunction = (
  permissions: Array<Permission>,
): Array<Permission> => {
  return [...permissions].sort();
};

type RawOperatorParametersFunction = (
  operator: FindOperator<unknown>,
) => Record<string, unknown>;

const rawOperatorParameters: RawOperatorParametersFunction = (
  operator: FindOperator<unknown>,
): Record<string, unknown> => {
  return (operator.objectLiteralParameters || {}) as Record<string, unknown>;
};

type RawOperatorSqlFunction = (
  operator: FindOperator<unknown>,
  alias: string,
) => string;

const rawOperatorSql: RawOperatorSqlFunction = (
  operator: FindOperator<unknown>,
  alias: string,
): string => {
  const getSql: ((alias: string) => string) | undefined = operator.getSql;

  if (!getSql) {
    throw new Error("Expected a Raw FindOperator with a SQL generator.");
  }

  return getSql(alias);
};

describe("feed event type filter - the table of feed models", () => {
  /*
   * Without this, a new feed model gets the dashboard's Filter & Sort button
   * (it only needs an enum and a column name) while nothing below checks that
   * its server side can actually answer it.
   */
  it("covers exactly the feed models that export an event type enum", () => {
    const covered: Array<string> = FEED_MODELS.map(
      (entry: FeedModelEntry): string => {
        return `${entry.file}:${entry.enumName}`;
      },
    ).sort();

    expect(covered).toEqual(discoverFeedModels());
  });

  test.each(FEED_MODELS)(
    "$file: the entry is the model its file declares, with a checklist to filter",
    (entry: FeedModelEntry) => {
      // A mis-paired import would test one model's columns against another's.
      expect(new entry.modelType().tableName).toBe(entry.file);

      // Two distinct string values to filter by - the enum is string-valued.
      expect(new Set(getCheckedEventTypes(entry)).size).toBe(2);

      for (const eventType of entry.eventTypes) {
        expect(typeof eventType).toBe("string");
      }
    },
  );
});

describe("feed event type filter - over the wire", () => {
  test.each(FEED_MODELS)(
    "$file: the query survives serialize -> JSON -> deserialize",
    (entry: FeedModelEntry) => {
      const eventTypes: Array<string> = getCheckedEventTypes(entry);
      const clientQuery: JSONObject = getClientQuery(entry, eventTypes);

      // The shape the dashboard sends.
      expect(clientQuery[entry.eventTypeColumn]).toBeInstanceOf(Includes);
      expect(clientQuery[entry.eventTypeColumn]).toEqual(
        new Includes(eventTypes),
      );

      const serverQuery: JSONObject = overTheWire(clientQuery);

      expect(Object.keys(serverQuery).sort()).toEqual(
        [entry.resourceIdColumn, entry.eventTypeColumn].sort(),
      );

      /*
       * A real Includes, not a `{ _type: "Includes", value }` object -
       * QueryUtil dispatches on instanceof, and anything else reaches TypeORM
       * as an equality against an object.
       */
      const includes: Includes = serverQuery[
        entry.eventTypeColumn
      ] as unknown as Includes;

      expect(includes).toBeInstanceOf(Includes);
      expect(includes.values).toEqual(eventTypes);

      // ...and the feed is still scoped to its one resource.
      const serverResourceId: ObjectID = serverQuery[
        entry.resourceIdColumn
      ] as unknown as ObjectID;

      expect(serverResourceId).toBeInstanceOf(ObjectID);
      expect(serverResourceId.toString()).toBe(resourceId.toString());
    },
  );

  /*
   * Every sort order the control offers, and "Oldest first" in particular:
   * TypeORM's `order` takes the literal "ASC" / "DESC", so the value has to
   * arrive as that string and not as anything wrapped.
   */
  test.each(FEED_MODELS)(
    "$file: every offered sort order survives the round trip on a real Date column",
    (entry: FeedModelEntry) => {
      expect(
        overTheWire({
          [SORT_COLUMN]: SortOrder.Ascending,
        })[SORT_COLUMN],
      ).toBe("ASC");

      for (const option of FEED_SORT_ORDER_OPTIONS) {
        expect(
          overTheWire({
            [SORT_COLUMN]: option.value,
          }),
        ).toEqual({
          [SORT_COLUMN]: option.value,
        });
      }

      // ORDER BY a column the model does not have is a 500, not a no-op.
      const model: BaseModel = new entry.modelType();

      expect(model.getTableColumns().columns).toContain(SORT_COLUMN);
      expect(model.getTableColumnMetadata(SORT_COLUMN).type).toBe(
        TableColumnType.Date,
      );
    },
  );
});

describe("feed event type filter - query permissions", () => {
  test.each(FEED_MODELS)(
    "$file: every reader of the feed may filter it by event type",
    (entry: FeedModelEntry) => {
      const readers: Array<Permission> = new entry.modelType()
        .readRecordPermissions;

      expect(readers.length).toBeGreaterThan(0);

      const query: JSONObject = getServerQuery(
        entry,
        getCheckedEventTypes(entry),
      );

      for (const permission of readers) {
        expect(() => {
          return checkQuery(entry, query, makeProps([permission]));
        }).not.toThrow();
      }
    },
  );

  /*
   * The counterpart: the gate really evaluates the event type column, so the
   * test above passes because every reader may read it rather than because
   * nothing was checked. A signed-in user with no role in the project holds
   * only the global permissions, none of which reads a feed.
   */
  test.each(FEED_MODELS)(
    "$file: a caller who cannot read the feed may not filter it",
    (entry: FeedModelEntry) => {
      expect(() => {
        return checkQuery(
          entry,
          overTheWire({
            [entry.eventTypeColumn]: new Includes(getCheckedEventTypes(entry)),
          } as unknown as JSONObject),
          makeProps([]),
        );
      }).toThrow(NotAuthorizedException);
    },
  );

  /*
   * Why the reader loop above holds, stated where it can break. A column read
   * list narrower than the table's is a reader who sees the feed and 403s on
   * the first ticked box; a wider one is a column nobody extra can use.
   */
  test.each(FEED_MODELS)(
    "$file: the event type column is a ShortText column readable by exactly the feed's readers",
    (entry: FeedModelEntry) => {
      const model: BaseModel = new entry.modelType();

      expect(model.getTableColumns().columns).toContain(entry.eventTypeColumn);

      const metadata: TableColumnMetadata = model.getTableColumnMetadata(
        entry.eventTypeColumn,
      );

      expect(metadata.type).toBe(TableColumnType.ShortText);

      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(entry.eventTypeColumn);

      expect(accessControl).not.toBeNull();
      expect(sorted(accessControl!.read)).toEqual(
        sorted(model.readRecordPermissions),
      );
    },
  );

  test.each(FEED_MODELS)(
    "$file: the resource id the feed is scoped by is a real ObjectID column",
    (entry: FeedModelEntry) => {
      const model: BaseModel = new entry.modelType();

      expect(model.getTableColumns().columns).toContain(entry.resourceIdColumn);
      expect(model.getTableColumnMetadata(entry.resourceIdColumn).type).toBe(
        TableColumnType.ObjectID,
      );
    },
  );
});

describe("feed event type filter - QueryUtil.serializeQuery", () => {
  test.each(FEED_MODELS)(
    "$file: the Includes becomes an IN over bound parameters",
    (entry: FeedModelEntry) => {
      const eventTypes: Array<string> = getCheckedEventTypes(entry);

      // serializeQuery rewrites the query in place, so hand it a copy.
      const serialized: JSONObject = QueryUtil.serializeQuery<BaseModel>(
        entry.modelType,
        {
          ...getServerQuery(entry, eventTypes),
        } as unknown as Query<BaseModel>,
      ) as unknown as JSONObject;

      const operator: FindOperator<unknown> = serialized[
        entry.eventTypeColumn
      ] as unknown as FindOperator<unknown>;

      expect(operator).toBeInstanceOf(FindOperator);
      expect(operator).not.toBeInstanceOf(Includes);
      expect(operator.type).toBe("raw");

      /*
       * One bound list parameter holding both values, and the SQL expands
       * exactly that parameter inside the IN. The parameter name is random, so
       * it is read back rather than assumed; the values never appear in the
       * SQL text itself.
       */
      const parameters: Record<string, unknown> =
        rawOperatorParameters(operator);
      const parameterNames: Array<string> = Object.keys(parameters);

      expect(parameterNames).toHaveLength(1);
      expect(parameters[parameterNames[0]!]).toEqual(eventTypes);

      const sql: string = rawOperatorSql(operator, "feed.eventType");

      expect(sql).toContain(" IN (");
      expect(sql).toContain(`feed.eventType IN (:...${parameterNames[0]})`);

      for (const eventType of eventTypes) {
        expect(sql).not.toContain(eventType);
      }

      // The resource scope beside it is still a plain equality on the id.
      const scope: FindOperator<unknown> = serialized[
        entry.resourceIdColumn
      ] as unknown as FindOperator<unknown>;

      expect(scope).toBeInstanceOf(FindOperator);
      expect(Object.values(rawOperatorParameters(scope))).toEqual([
        resourceId.toString(),
      ]);
      expect(rawOperatorSql(scope, "feed.resourceId")).toContain(
        "feed.resourceId = :",
      );
    },
  );
});
