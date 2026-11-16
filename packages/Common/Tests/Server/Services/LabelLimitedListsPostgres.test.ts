import Entities from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import AccessControlPermission from "../../../Server/Types/Database/Permissions/AccessControlPermission";
import Query from "../../../Server/Types/Database/Query";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import logger from "../../../Server/Utils/Logger";
import { combineWithPrivacyClause } from "../../../Server/Utils/PrivacyFilterUtil";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * A LABEL-LIMITED READER SEES THE VERY RECORDS THEY SAW BEFORE (#8113), on
 * Postgres.
 *
 * A grant limited to labels used to narrow a labelled model's read through
 * its labels relation (`labels: [permitted ids]`), and a filter by labels
 * (the dashboard's label chips) went through the relation too: to-many
 * joins in the WHERE, which kept every page of such a list on TypeORM's
 * SELECT DISTINCT over all its joins, and its count on a DISTINCT. Both are
 * now a condition on the record's own id (AccessControlPermission
 * .addLabelIdsToQuery, QueryUtil.getLabelsFilterCondition). That is only a
 * fix if it changes nothing about WHICH records a reader gets.
 *
 * So every read here runs twice through the real services, permission
 * pipeline, serializer, PagedFind and CappedCount - once with the code as it
 * was (the three functions the change replaced, frozen below) and once as it
 * is - on synthetic alerts, incidents and monitors with zero to four labels
 * each, a deleted label among them, and the other project's records beside
 * them. For a matrix of grants (none, limited to one label, two, one nobody
 * carries, a deleted one, through two teams, the model's own permission, an
 * API key's rows), blocks with labels, labels beside a grant scoped to
 * Owned, and filters (by labels in every operator, by id, by a search, by a
 * date range), each list, page, order, count, capped count, read by id and
 * update must reach the same records, in the same order, as before.
 *
 * And, against the rows themselves rather than the old code:
 *
 *   - no record reaches a reader outside their labels: each carries a
 *     permitted label that is not deleted, and no blocked one;
 *   - each record is read with every label it carries - the old filter
 *     trimmed them to the permitted ones, so a label-limited editor's form
 *     saved the others away - and no deleted one;
 *   - the filters the old code dropped are kept: an id filter beside a
 *     filter by labels, `labels: null` (no labels), an id filter whose key
 *     comes after a filter on the labels.
 *
 * Opt in with RUN_POSTGRES_LABEL_LIMITED_LIST_TESTS=true against a database
 * the registered migrations have run on (LABEL_LIMITED_LIST_TEST_DATABASE_HOST,
 * _PORT, _NAME; DATABASE_USERNAME / DATABASE_PASSWORD). The tables it writes
 * are copied from public into a schema of its own, every row is synthetic,
 * and the schema is dropped afterwards. CI runs it in
 * .github/workflows/postgres-schema-drift.yaml.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_LABEL_LIMITED_LIST_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The audit trail of an update is written elsewhere.
jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: jest.fn(),
      recordUpdate: jest.fn(),
      recordDelete: jest.fn(),
    },
  };
});

// The tables this suite writes; every other table is read, empty, from public.
const TABLES: Array<string> = [
  "Project",
  "Label",
  "Monitor",
  "MonitorLabel",
  "MonitorStatus",
  "MonitorOwnerUser",
  "MonitorOwnerTeam",
  "Alert",
  "AlertLabel",
  "AlertState",
  "AlertSeverity",
  "AlertOwnerUser",
  "AlertOwnerTeam",
  "Incident",
  "IncidentLabel",
  "IncidentMonitor",
  "IncidentState",
  "IncidentSeverity",
  "IncidentOwnerUser",
  "IncidentOwnerTeam",
];

/*
 * THE CODE AS IT WAS, for the reads made "before". Verbatim but for the
 * types: AccessControlPermission.addLabelIdsToQuery,
 * AccessControlPermission.addGrantToQuery's condition for labels beside a
 * grant scoped to Owned, and the filter by labels QueryUtil kept on the
 * relation (getLabelsFilterCondition answering null is that path).
 */
function legacyAddLabelIdsToQuery<TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  query: Query<TBaseModel>,
  accessControlIds: Array<ObjectID>,
): Query<TBaseModel> {
  const model: BaseModel = new modelType();

  if (model.getAccessControlColumn()) {
    if (accessControlIds.length > 0) {
      const accessControlColumn: string =
        model.getAccessControlColumn() as string;
      const existingFilter: unknown = (query as any)[accessControlColumn];

      if (existingFilter === undefined || existingFilter === null) {
        (query as any)[accessControlColumn] = accessControlIds;
      } else {
        const manyToManyMeta: ReturnType<
          typeof QueryUtil.getManyToManyRelationMetadata
        > = QueryUtil.getManyToManyRelationMetadata(
          modelType,
          accessControlColumn,
        );

        if (!manyToManyMeta) {
          throw new Error("The label join table is always known here.");
        }

        (query as any)._id = combineWithPrivacyClause(
          (query as any)._id,
          QueryHelper.anyOfEntitiesInManyToMany({
            values: accessControlIds,
            joinTableName: manyToManyMeta.joinTableName,
            ownerColumnName: manyToManyMeta.ownerColumnName,
            relationColumnName: manyToManyMeta.relationColumnName,
          }),
        );
      }
    }
  }

  return query;
}

function legacyCarriesLabelsCondition(
  modelType: { new (): BaseModel },
  labelIds: Array<ObjectID>,
): FindWhereProperty<any> | null {
  const accessControlColumn: string | null =
    new modelType().getAccessControlColumn();

  if (!accessControlColumn) {
    return null;
  }

  const labelsMeta: ReturnType<typeof QueryUtil.getManyToManyRelationMetadata> =
    QueryUtil.getManyToManyRelationMetadata(modelType, accessControlColumn);

  return labelsMeta
    ? QueryHelper.anyOfEntitiesInManyToMany({
        values: labelIds,
        ...labelsMeta,
      })
    : null;
}

// Runs `read` as the code was before #8113.
async function asBefore<T>(read: () => Promise<T>): Promise<T> {
  const spies: Array<{ mockRestore: () => void }> = [
    jest
      .spyOn(AccessControlPermission, "addLabelIdsToQuery")
      .mockImplementation(legacyAddLabelIdsToQuery as never),
    jest
      .spyOn(AccessControlPermission, "getCarriesLabelsCondition")
      .mockImplementation(legacyCarriesLabelsCondition as never),
    jest.spyOn(QueryUtil, "getLabelsFilterCondition").mockReturnValue(null),
  ];

  try {
    return await read();
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
}

type AnyService = DatabaseService<BaseModel>;

interface Listed {
  name: string;
  modelType: { new (): BaseModel };
  service: AnyService;
  table: string;
  labelTable: string;
  recordColumn: string;
  ownerUserTable: string;
  ownerTeamTable: string;
  // A related record a list shows and can be sorted by: its relation and column.
  sortedRelation: { relation: string; column: string };
  select: Dictionary<unknown>;
  // A column the update writes: harmless to every rule.
  writableColumn: string;
}

describePostgres(
  "a label-limited reader's lists, before and after #8113, on Postgres",
  () => {
    const schema: string = `label_lists_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    const teamA: ObjectID = ObjectID.generate();
    const teamB: ObjectID = ObjectID.generate();

    // L0 - L4 carried by records, L5 by none, LD deleted, LQ the other project's.
    const labels: Array<ObjectID> = [0, 1, 2, 3, 4, 5].map((): ObjectID => {
      return ObjectID.generate();
    });
    const deletedLabel: ObjectID = ObjectID.generate();
    const otherProjectLabel: ObjectID = ObjectID.generate();
    const [L0, L1, L2, L3, L4, L5] = labels as [
      ObjectID,
      ObjectID,
      ObjectID,
      ObjectID,
      ObjectID,
      ObjectID,
    ];

    // Each record's labels, as the join table holds them (deleted label included).
    const linksOf: Map<string, Set<string>> = new Map();
    // The records of each table in the project, and in the other one.
    const recordsOf: Dictionary<Array<string>> = {};
    const otherRecordsOf: Dictionary<Array<string>> = {};
    // The records the member owns, per table.
    const ownedOf: Dictionary<Set<string>> = {};
    // The private records (no owner the member is).
    const privateRecords: Set<string> = new Set();

    let sequence: number = 0;

    // An id that sorts after every id made before it.
    function nextId(): string {
      sequence++;
      return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
    }

    const LISTED: Array<Listed> = [
      {
        name: "Alerts",
        modelType: Alert,
        service: AlertService as unknown as AnyService,
        table: "Alert",
        labelTable: "AlertLabel",
        recordColumn: "alertId",
        ownerUserTable: "AlertOwnerUser",
        ownerTeamTable: "AlertOwnerTeam",
        sortedRelation: { relation: "currentAlertState", column: "order" },
        select: {
          _id: true,
          title: true,
          createdAt: true,
          alertNumber: true,
          labels: { _id: true, name: true, color: true },
          currentAlertState: { _id: true, name: true, order: true },
          alertSeverity: { _id: true, name: true },
          monitor: { _id: true, name: true },
        },
        writableColumn: "description",
      },
      {
        name: "Incidents",
        modelType: Incident,
        service: IncidentService as unknown as AnyService,
        table: "Incident",
        labelTable: "IncidentLabel",
        recordColumn: "incidentId",
        ownerUserTable: "IncidentOwnerUser",
        ownerTeamTable: "IncidentOwnerTeam",
        sortedRelation: { relation: "incidentSeverity", column: "order" },
        select: {
          _id: true,
          title: true,
          createdAt: true,
          incidentNumber: true,
          labels: { _id: true, name: true, color: true },
          monitors: { _id: true, name: true },
          currentIncidentState: { _id: true, name: true },
          incidentSeverity: { _id: true, name: true, order: true },
        },
        writableColumn: "description",
      },
      {
        name: "Monitors",
        modelType: Monitor,
        service: MonitorService as unknown as AnyService,
        table: "Monitor",
        labelTable: "MonitorLabel",
        recordColumn: "monitorId",
        ownerUserTable: "MonitorOwnerUser",
        ownerTeamTable: "MonitorOwnerTeam",
        sortedRelation: {
          relation: "currentMonitorStatus",
          column: "priority",
        },
        select: {
          _id: true,
          name: true,
          createdAt: true,
          labels: { _id: true, name: true, color: true },
          currentMonitorStatus: { _id: true, name: true, priority: true },
        },
        writableColumn: "description",
      },
    ];

    // The reader's permission rows, with the membership every member holds.
    function propsWith(
      rows: Array<UserPermission>,
      options: { isApiKey?: boolean } = {},
    ): DatabaseCommonInteractionProps {
      return {
        ...(options.isApiKey ? { userType: UserType.API } : { userId: userId }),
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
            permissions: [
              ...rows,
              ...(options.isApiKey
                ? []
                : [
                    {
                      permission: Permission.ProjectUser,
                      labelIds: [],
                      isBlockPermission: false,
                      _type: "UserPermission",
                    } as UserPermission,
                  ]),
            ],
            _type: "UserTenantAccessPermission",
          },
        },
      };
    }

    function grant(
      permission: Permission,
      labelIds: Array<ObjectID> | null,
      teamId: ObjectID | undefined = teamA,
      scope?: PermissionScope,
    ): UserPermission {
      return {
        permission: permission,
        labelIds: labelIds || [],
        isBlockPermission: false,
        scope:
          scope || (labelIds ? PermissionScope.Labels : PermissionScope.All),
        ...(teamId ? { teamId: teamId } : {}),
        _type: "UserPermission",
      };
    }

    function block(
      permission: Permission,
      labelIds: Array<ObjectID>,
    ): UserPermission {
      return {
        permission: permission,
        labelIds: labelIds,
        isBlockPermission: true,
        teamId: teamA,
        _type: "UserPermission",
      };
    }

    interface Reader {
      name: string;
      props: () => DatabaseCommonInteractionProps;
      // The labels a record must carry one of (alive), or null: no grant limit.
      grantedLabels: Array<ObjectID> | null;
      // The labels a record must carry none of (any link counts).
      blockedLabels: Array<ObjectID>;
      // Also reaches the records the member owns.
      reachesOwned: boolean;
      // The model this reader's rows grant on; null: every model.
      onlyFor?: { new (): BaseModel } | undefined;
      /*
       * A label of the grant is deleted. The old code let it reach the
       * records linked to it once the reader also filtered by labels - the
       * condition it added beside the reader's filter counted a link to a
       * deleted label, the relation it filtered through otherwise did not -
       * and a deleted label grants nothing now, filtered or not: the reads
       * give the old records but those, which no rule gives them.
       */
      grantsDeletedLabel?: boolean | undefined;
    }

    const READERS: Array<Reader> = [
      {
        name: "an unlimited member",
        props: () => {
          return propsWith([grant(Permission.ProjectMember, null)]);
        },
        grantedLabels: null,
        blockedLabels: [],
        reachesOwned: false,
      },
      {
        name: "a member limited to one label",
        props: () => {
          return propsWith([grant(Permission.ProjectMember, [L0])]);
        },
        grantedLabels: [L0],
        blockedLabels: [],
        reachesOwned: false,
      },
      {
        name: "a member limited to two labels",
        props: () => {
          return propsWith([grant(Permission.ProjectMember, [L1, L3])]);
        },
        grantedLabels: [L1, L3],
        blockedLabels: [],
        reachesOwned: false,
      },
      {
        name: "a member limited to a label nobody carries",
        props: () => {
          return propsWith([grant(Permission.ProjectMember, [L5])]);
        },
        grantedLabels: [L5],
        blockedLabels: [],
        reachesOwned: false,
      },
      {
        name: "a member limited to a deleted label and one more",
        props: () => {
          return propsWith([
            grant(Permission.ProjectMember, [deletedLabel, L4]),
          ]);
        },
        grantedLabels: [deletedLabel, L4],
        blockedLabels: [],
        reachesOwned: false,
        grantsDeletedLabel: true,
      },
      {
        name: "a member limited to another project's label",
        props: () => {
          return propsWith([
            grant(Permission.ProjectMember, [otherProjectLabel]),
          ]);
        },
        grantedLabels: [otherProjectLabel],
        blockedLabels: [],
        reachesOwned: false,
      },
      {
        name: "a member of two teams, each limited to a label",
        props: () => {
          return propsWith([
            grant(Permission.ProjectMember, [L0], teamA),
            grant(Permission.ProjectMember, [L2], teamB),
          ]);
        },
        grantedLabels: [L0, L2],
        blockedLabels: [],
        reachesOwned: false,
      },
      {
        name: "an unlimited member with a block with labels",
        props: () => {
          return propsWith([
            grant(Permission.ProjectMember, null),
            block(Permission.ProjectMember, [L1]),
          ]);
        },
        grantedLabels: null,
        blockedLabels: [L1],
        reachesOwned: false,
      },
      {
        name: "a member limited to labels, one of them blocked",
        props: () => {
          return propsWith([
            grant(Permission.ProjectMember, [L0, L1, L2]),
            block(Permission.ProjectMember, [L1, deletedLabel]),
          ]);
        },
        grantedLabels: [L0, L1, L2],
        blockedLabels: [L1, deletedLabel],
        reachesOwned: false,
      },
      {
        name: "a member limited to a label by one team and to what they own by another",
        props: () => {
          return propsWith([
            grant(Permission.ProjectMember, [L3], teamA),
            grant(Permission.ProjectMember, null, teamB, PermissionScope.Owned),
          ]);
        },
        grantedLabels: [L3],
        blockedLabels: [],
        reachesOwned: true,
      },
      {
        name: "an API key limited to two labels",
        props: () => {
          return propsWith(
            [grant(Permission.ProjectMember, [L0, L4], undefined)],
            { isApiKey: true },
          );
        },
        grantedLabels: [L0, L4],
        blockedLabels: [],
        reachesOwned: false,
      },
      {
        name: "an alert reader limited to a label by the alerts' own permission",
        props: () => {
          return propsWith([grant(Permission.ReadAlert, [L2])]);
        },
        grantedLabels: [L2],
        blockedLabels: [],
        reachesOwned: false,
        onlyFor: Alert,
      },
    ];

    interface Filter {
      name: string;
      query: (listed: Listed) => Dictionary<unknown>;
      // The records the filter keeps, by their labels (all links) and id.
      keeps: (record: string, listed: Listed) => boolean;
    }

    function carriesAlive(record: string, labelIds: Array<ObjectID>): boolean {
      const links: Set<string> = linksOf.get(record) || new Set();

      return labelIds.some((labelId: ObjectID): boolean => {
        return (
          labelId.toString() !== deletedLabel.toString() &&
          links.has(labelId.toString())
        );
      });
    }

    function carriesAny(record: string, labelIds: Array<ObjectID>): boolean {
      const links: Set<string> = linksOf.get(record) || new Set();

      return labelIds.some((labelId: ObjectID): boolean => {
        return links.has(labelId.toString());
      });
    }

    function idsOf(
      listed: Listed,
      every: number,
      offset: number = 0,
    ): Array<string> {
      return (recordsOf[listed.table] || []).filter(
        (_id: string, index: number): boolean => {
          return index % every === offset;
        },
      );
    }

    const FILTERS: Array<Filter> = [
      {
        name: "no filter",
        query: () => {
          return {};
        },
        keeps: () => {
          return true;
        },
      },
      {
        name: "a label chip (Includes)",
        query: () => {
          return { labels: new Includes([L1]) };
        },
        keeps: (record: string) => {
          return carriesAlive(record, [L1]);
        },
      },
      {
        name: "two label chips, one deleted (Includes)",
        query: () => {
          return { labels: new Includes([L0, deletedLabel, L3]) };
        },
        keeps: (record: string) => {
          return carriesAlive(record, [L0, L3]);
        },
      },
      {
        name: "labels as a list of ids",
        query: () => {
          return { labels: [L2.toString()] };
        },
        keeps: (record: string) => {
          return carriesAlive(record, [L2]);
        },
      },
      {
        name: "labels as a list of { _id }",
        query: () => {
          return { labels: [{ _id: L4.toString() }, { _id: L0.toString() }] };
        },
        keeps: (record: string) => {
          return carriesAlive(record, [L4, L0]);
        },
      },
      {
        name: "every one of two labels (IncludesAll)",
        query: () => {
          return { labels: new IncludesAll([L0, L1]) };
        },
        keeps: (record: string) => {
          return carriesAny(record, [L0]) && carriesAny(record, [L1]);
        },
      },
      {
        name: "none of a label (IncludesNone)",
        query: () => {
          return { labels: new IncludesNone([L0]) };
        },
        keeps: (record: string) => {
          return !carriesAny(record, [L0]);
        },
      },
      {
        name: "no labels (IsNull)",
        query: () => {
          return { labels: new IsNull() };
        },
        keeps: (record: string) => {
          return (linksOf.get(record) || new Set()).size === 0;
        },
      },
      {
        name: "some label (NotNull)",
        query: () => {
          return { labels: new NotNull() };
        },
        keeps: (record: string) => {
          return (linksOf.get(record) || new Set()).size > 0;
        },
      },
      {
        name: "a label of each group (IncludesAnyOfGroups)",
        query: () => {
          return {
            labels: new IncludesAnyOfGroups([
              [L0.toString(), L1.toString()],
              [L2.toString()],
            ]),
          };
        },
        keeps: (record: string) => {
          return carriesAny(record, [L0, L1]) && carriesAny(record, [L2]);
        },
      },
      {
        name: "some ids, and a label chip",
        query: (listed: Listed) => {
          return {
            _id: new Includes(idsOf(listed, 2)),
            labels: new Includes([L0, L2]),
          };
        },
        keeps: (record: string, listed: Listed) => {
          return (
            idsOf(listed, 2).includes(record) && carriesAlive(record, [L0, L2])
          );
        },
      },
      {
        name: "one id",
        query: (listed: Listed) => {
          return { _id: (recordsOf[listed.table] || [])[7]! };
        },
        keeps: (record: string, listed: Listed) => {
          return record === (recordsOf[listed.table] || [])[7];
        },
      },
      {
        name: "all but one id",
        query: (listed: Listed) => {
          return { _id: new NotEqual((recordsOf[listed.table] || [])[3]!) };
        },
        keeps: (record: string, listed: Listed) => {
          return record !== (recordsOf[listed.table] || [])[3];
        },
      },
      {
        name: "a search, and a label chip",
        query: (listed: Listed) => {
          return {
            [listed.table === "Monitor" ? "name" : "title"]: new Search("1"),
            labels: new Includes([L0, L1, L2, L3]),
          };
        },
        keeps: () => {
          // Held to the code as it was only.
          return true;
        },
      },
      {
        name: "a range of dates",
        query: () => {
          return {
            createdAt: new InBetween(at(10), at(40)),
          };
        },
        keeps: () => {
          return true;
        },
      },
    ];

    const NOW: number = Date.UTC(2026, 10, 1, 12, 0, 0);

    function at(minutes: number): Date {
      return new Date(NOW + minutes * 60 * 1000);
    }

    // Whether the reader may see the record at all, by the rules and the rows.
    function isReachable(
      reader: Reader,
      listed: Listed,
      record: string,
    ): boolean {
      if (!(recordsOf[listed.table] || []).includes(record)) {
        return false;
      }

      if (privateRecords.has(record)) {
        return false;
      }

      if (carriesAny(record, reader.blockedLabels)) {
        return false;
      }

      if (!reader.grantedLabels) {
        return true;
      }

      return (
        carriesAlive(record, reader.grantedLabels) ||
        (reader.reachesOwned &&
          (ownedOf[listed.table] || new Set()).has(record))
      );
    }

    // The records the old code gave a reader that the rules still give them.
    function expectedOf(
      reader: Reader,
      listed: Listed,
      before: Array<string>,
    ): Array<string> {
      if (!reader.grantsDeletedLabel) {
        return before;
      }

      return before.filter((record: string): boolean => {
        return isReachable(reader, listed, record);
      });
    }

    function readersFor(listed: Listed): Array<Reader> {
      return READERS.filter((reader: Reader): boolean => {
        return !reader.onlyFor || reader.onlyFor === listed.modelType;
      });
    }

    async function list(data: {
      listed: Listed;
      reader: Reader;
      query: Dictionary<unknown>;
      sort?: Dictionary<unknown> | undefined;
      skip?: number | undefined;
      limit?: number | undefined;
    }): Promise<Array<BaseModel>> {
      return await data.listed.service.findBy({
        query: { ...data.query } as never,
        select: data.listed.select as never,
        sort: (data.sort || { createdAt: SortOrder.Descending }) as never,
        skip: data.skip || 0,
        limit: data.limit || 100,
        props: data.reader.props(),
      });
    }

    async function count(data: {
      listed: Listed;
      reader: Reader;
      query: Dictionary<unknown>;
      upTo?: number | undefined;
    }): Promise<number> {
      return (
        await data.listed.service.countBy({
          query: { ...data.query } as never,
          props: data.reader.props(),
          ...(data.upTo !== undefined ? { upTo: data.upTo } : {}),
        })
      ).toNumber();
    }

    function idsIn(rows: Array<BaseModel>): Array<string> {
      return rows.map((row: BaseModel): string => {
        return row.id!.toString();
      });
    }

    function labelsIn(row: BaseModel): Array<string> {
      return ((row.getColumnValue("labels") as Array<Label> | undefined) || [])
        .map((label: Label): string => {
          return label.id!.toString();
        })
        .sort();
    }

    async function insert(
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> {
      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          const value: unknown = row[column];
          return value instanceof ObjectID ? value.toString() : value;
        }),
      );
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["LABEL_LIMITED_LIST_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["LABEL_LIMITED_LIST_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["LABEL_LIMITED_LIST_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        /*
         * No schema of its own: table names stay unqualified, so the copies
         * are found first and every other table a read names (a team's
         * members, an owner of a record never written here) is found, empty,
         * in public.
         */
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        // A fixture names only what the reads touch: other columns may be empty.
        const required: Array<{ column_name: string }> = await database.query(
          `SELECT c.column_name FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
           AND NOT EXISTS (
             SELECT 1 FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
             WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass
               AND i.indisprimary AND a.attname = c.column_name
           )`,
          [schema, table],
        );

        if (required.length > 0) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ${required
              .map((column: { column_name: string }): string => {
                return `ALTER COLUMN "${column.column_name}" DROP NOT NULL`;
              })
              .join(", ")}`,
          );
        }
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const id of [projectId, otherProjectId]) {
        await insert("Project", {
          _id: id,
          name: `Project ${id.toString().slice(0, 6)}`,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const [index, id] of [...labels, deletedLabel].entries()) {
        await insert("Label", {
          _id: id,
          projectId: projectId,
          name: `Label ${index}`,
          slug: `label-${index}`,
          color: "#000000",
          version: 1,
          ...(id === deletedLabel ? { deletedAt: at(-1) } : {}),
        });
      }

      await insert("Label", {
        _id: otherProjectLabel,
        projectId: otherProjectId,
        name: "Other",
        slug: "other",
        color: "#000000",
        version: 1,
      });

      // Each table's related records: states, severities, statuses.
      const related: Dictionary<Array<string>> = {};

      for (const [table, extra] of [
        ["AlertState", { color: "#000000" }],
        ["AlertSeverity", { color: "#000000", slug: "s" }],
        ["IncidentState", { color: "#000000", slug: "s" }],
        ["IncidentSeverity", { color: "#000000", slug: "s" }],
        ["MonitorStatus", { color: "#000000", slug: "s" }],
      ] as Array<[string, Dictionary<unknown>]>) {
        related[table] = [];

        for (let index: number = 0; index < 3; index++) {
          const id: string = nextId();
          related[table]!.push(id);
          await insert(table, {
            _id: id,
            projectId: projectId,
            name: `${table} ${index}`,
            version: 1,
            ...extra,
            ...(table === "MonitorStatus"
              ? { priority: 3 - index }
              : { order: (index * 2) % 3 }),
          });
        }
      }

      /*
       * The records: 0 to 4 labels each, the deleted label among them, ties in
       * createdAt and in the related record's place; a few the member owns, by
       * themselves or through team B; one private; the other project's beside.
       */
      const plans: Array<{
        table: string;
        labelTable: string;
        recordColumn: string;
        ownerUserTable: string;
        ownerTeamTable: string;
        count: number;
        row: (index: number) => Dictionary<unknown>;
      }> = [
        {
          table: "Monitor",
          labelTable: "MonitorLabel",
          recordColumn: "monitorId",
          ownerUserTable: "MonitorOwnerUser",
          ownerTeamTable: "MonitorOwnerTeam",
          count: 36,
          row: (index: number) => {
            return {
              name: `Monitor ${index % 7}`,
              slug: `monitor-${index}`,
              monitorType: "Manual",
              currentMonitorStatusId: related["MonitorStatus"]![index % 3],
            };
          },
        },
        {
          table: "Alert",
          labelTable: "AlertLabel",
          recordColumn: "alertId",
          ownerUserTable: "AlertOwnerUser",
          ownerTeamTable: "AlertOwnerTeam",
          count: 48,
          row: (index: number) => {
            return {
              title: `Alert ${index % 11}`,
              alertNumber: index + 1,
              currentAlertStateId: related["AlertState"]![index % 3],
              alertSeverityId: related["AlertSeverity"]![index % 2],
              isPrivate: index === 15,
            };
          },
        },
        {
          table: "Incident",
          labelTable: "IncidentLabel",
          recordColumn: "incidentId",
          ownerUserTable: "IncidentOwnerUser",
          ownerTeamTable: "IncidentOwnerTeam",
          count: 40,
          row: (index: number) => {
            return {
              title: `Incident ${index % 9}`,
              incidentNumber: index + 1,
              currentIncidentStateId: related["IncidentState"]![index % 3],
              incidentSeverityId: related["IncidentSeverity"]![index % 3],
              isPrivate: index === 17,
              declaredAt: at(index % 5),
            };
          },
        },
      ];

      const linkable: Array<ObjectID> = [L0, L1, L2, L3, L4, deletedLabel];

      for (const plan of plans) {
        recordsOf[plan.table] = [];
        otherRecordsOf[plan.table] = [];
        ownedOf[plan.table] = new Set();

        for (let index: number = 0; index < plan.count; index++) {
          const id: string = nextId();
          recordsOf[plan.table]!.push(id);

          await insert(plan.table, {
            _id: id,
            projectId: projectId,
            version: 1,
            createdAt: at(Math.floor(index / 3)),
            ...plan.row(index),
          });

          if (index === 15 && plan.table === "Alert") {
            privateRecords.add(id);
          }

          if (index === 17 && plan.table === "Incident") {
            privateRecords.add(id);
          }

          const links: Set<string> = new Set();

          for (let label: number = 0; label < index % 5; label++) {
            const labelId: ObjectID =
              linkable[(index * 7 + label) % linkable.length]!;

            if (links.has(labelId.toString())) {
              continue;
            }

            links.add(labelId.toString());
            await insert(plan.labelTable, {
              [plan.recordColumn]: id,
              labelId: labelId,
            });
          }

          linksOf.set(id, links);

          // Owned: by the member themselves, or by team B.
          if (index % 6 === 1) {
            ownedOf[plan.table]!.add(id);
            await insert(plan.ownerUserTable, {
              _id: nextId(),
              projectId: projectId,
              [plan.recordColumn]: id,
              userId: userId,
              version: 1,
            });
          } else if (index % 6 === 4) {
            ownedOf[plan.table]!.add(id);
            await insert(plan.ownerTeamTable, {
              _id: nextId(),
              projectId: projectId,
              [plan.recordColumn]: id,
              teamId: teamB,
              version: 1,
            });
          }
        }

        // The other project's records, carrying the other project's label.
        for (let index: number = 0; index < 5; index++) {
          const id: string = nextId();
          otherRecordsOf[plan.table]!.push(id);

          await insert(plan.table, {
            _id: id,
            projectId: otherProjectId,
            version: 1,
            createdAt: at(index),
            ...plan.row(index),
            ...(plan.table === "Monitor"
              ? { slug: `other-monitor-${index}` }
              : { isPrivate: false }),
          });
          await insert(plan.labelTable, {
            [plan.recordColumn]: id,
            labelId: index % 2 === 0 ? otherProjectLabel : L0,
          });
          linksOf.set(
            id,
            new Set([(index % 2 === 0 ? otherProjectLabel : L0).toString()]),
          );
        }
      }

      // An incident's monitors, for the list's Monitors column.
      for (const [index, incidentId] of (
        recordsOf["Incident"] || []
      ).entries()) {
        for (let monitor: number = 0; monitor < index % 3; monitor++) {
          await insert("IncidentMonitor", {
            incidentId: incidentId,
            monitorId: recordsOf["Monitor"]![(index + monitor) % 36],
          });
        }
      }

      for (const table of TABLES) {
        await database.query(`ANALYZE "${schema}"."${table}"`);
      }
    }, 300000);

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    }, 120000);

    beforeEach(() => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Workflows run elsewhere.
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);

      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation((() => {
          return undefined;
        }) as never);
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the fixture has records with every number of labels, in both projects", () => {
      for (const listed of LISTED) {
        const sizes: Set<number> = new Set(
          (recordsOf[listed.table] || []).map((record: string): number => {
            return (linksOf.get(record) || new Set()).size;
          }),
        );

        expect(Array.from(sizes).sort()).toEqual([0, 1, 2, 3, 4]);
        expect(
          (recordsOf[listed.table] || []).some((record: string): boolean => {
            return (linksOf.get(record) || new Set()).has(
              deletedLabel.toString(),
            );
          }),
        ).toBe(true);
      }
    });

    describe.each(LISTED)("$name", (listed: Listed) => {
      /*
       * Every reader with every filter: the same records in the same order,
       * the same count and capped count as before - and, by the rows, none
       * outside the reader's labels, each read with every label it carries.
       */
      test.each(
        readersFor(listed).map((reader: Reader): [string, Reader] => {
          return [reader.name, reader];
        }),
      )(
        "%s: every filter lists and counts the records it did before",
        async (_name: string, reader: Reader) => {
          let compared: number = 0;

          for (const filter of FILTERS) {
            const query: Dictionary<unknown> = filter.query(listed);

            const before: Array<BaseModel> = await asBefore(() => {
              return list({ listed, reader, query });
            });
            const after: Array<BaseModel> = await list({
              listed,
              reader,
              query,
            });

            const context: string = `${reader.name}, ${filter.name}`;
            const expected: Array<string> = expectedOf(
              reader,
              listed,
              idsIn(before),
            );

            expect({ context, ids: idsIn(after) }).toEqual({
              context,
              ids: expected,
            });

            const beforeCount: number = await asBefore(() => {
              return count({ listed, reader, query });
            });
            const afterCount: number = await count({ listed, reader, query });

            expect({ context, count: afterCount }).toEqual({
              context,
              count: reader.grantsDeletedLabel ? expected.length : beforeCount,
            });
            expect({ context, count: afterCount }).toEqual({
              context,
              count: after.length,
            });

            const beforeCapped: number = await asBefore(() => {
              return count({ listed, reader, query, upTo: 3 });
            });
            const afterCapped: number = await count({
              listed,
              reader,
              query,
              upTo: 3,
            });

            expect({ context, capped: afterCapped }).toEqual({
              context,
              capped: reader.grantsDeletedLabel
                ? Math.min(afterCount, 4)
                : beforeCapped,
            });
            expect({ context, capped: afterCapped }).toEqual({
              context,
              capped: Math.min(afterCount, 4),
            });

            for (const row of after) {
              const record: string = row.id!.toString();

              // Never a record outside the reader's labels, or the filter's.
              expect({ context, record, reachable: true }).toEqual({
                context,
                record,
                reachable: isReachable(reader, listed, record),
              });
              expect({ context, record, kept: true }).toEqual({
                context,
                record,
                kept: filter.keeps(record, listed),
              });

              // Every label the record carries, and no deleted one.
              const alive: Array<string> = Array.from(
                linksOf.get(record) || new Set<string>(),
              )
                .filter((labelId: string): boolean => {
                  return labelId !== deletedLabel.toString();
                })
                .sort();

              expect({ context, record, labels: labelsIn(row) }).toEqual({
                context,
                record,
                labels: alive,
              });
            }

            // The rows before: the same records, their labels at most these.
            const afterById: Map<string, BaseModel> = new Map(
              after.map((row: BaseModel): [string, BaseModel] => {
                return [row.id!.toString(), row];
              }),
            );

            for (const row of before) {
              const now: BaseModel | undefined = afterById.get(
                row.id!.toString(),
              );

              if (!now) {
                continue;
              }

              for (const labelId of labelsIn(row)) {
                expect(labelsIn(now)).toContain(labelId);
              }
            }

            compared += after.length;
          }

          const reachesSome: boolean = (recordsOf[listed.table] || []).some(
            (record: string): boolean => {
              return isReachable(reader, listed, record);
            },
          );

          expect({ reader: reader.name, compared: compared > 0 }).toEqual({
            reader: reader.name,
            compared: reachesSome,
          });
        },
      );

      test("with no filter, a reader gets exactly the records the rules give them", async () => {
        for (const reader of readersFor(listed)) {
          const after: Array<BaseModel> = await list({
            listed,
            reader,
            query: {},
          });

          expect({ reader: reader.name, ids: idsIn(after).sort() }).toEqual({
            reader: reader.name,
            ids: (recordsOf[listed.table] || [])
              .filter((record: string): boolean => {
                return isReachable(reader, listed, record);
              })
              .sort(),
          });
        }
      });

      test("every page, in every order, is the page it was before", async () => {
        const readers: Array<Reader> = readersFor(listed).filter(
          (reader: Reader): boolean => {
            return [
              "an unlimited member",
              "a member limited to two labels",
              "a member limited to labels, one of them blocked",
              "a member limited to a label by one team and to what they own by another",
            ].includes(reader.name);
          },
        );

        const orders: Array<Dictionary<unknown>> = [
          { createdAt: SortOrder.Descending },
          { createdAt: SortOrder.Ascending },
          {
            [listed.table === "Monitor" ? "name" : "title"]:
              SortOrder.Ascending,
          },
          {
            [listed.sortedRelation.relation]: {
              [listed.sortedRelation.column]: SortOrder.Ascending,
            },
          },
        ];

        let pages: number = 0;

        for (const reader of readers) {
          for (const sort of orders) {
            for (const query of [{}, { labels: new Includes([L0, L3]) }]) {
              for (const limit of [4, 7]) {
                for (let skip: number = 0; skip < 50; skip += limit) {
                  const before: Array<BaseModel> = await asBefore(() => {
                    return list({ listed, reader, query, sort, skip, limit });
                  });
                  const after: Array<BaseModel> = await list({
                    listed,
                    reader,
                    query,
                    sort,
                    skip,
                    limit,
                  });

                  expect({
                    reader: reader.name,
                    sort,
                    skip,
                    limit,
                    ids: idsIn(after),
                  }).toEqual({
                    reader: reader.name,
                    sort,
                    skip,
                    limit,
                    ids: idsIn(before),
                  });

                  pages++;

                  if (after.length < limit) {
                    break;
                  }
                }
              }
            }
          }
        }

        expect(pages).toBeGreaterThan(40);
      }, 300000);

      test("a record read by its id: the same records found, with every label they carry", async () => {
        const records: Array<string> = [
          ...(recordsOf[listed.table] || []),
          ...(otherRecordsOf[listed.table] || []),
        ];

        for (const reader of readersFor(listed)) {
          for (const record of records) {
            const read: () => Promise<BaseModel | null> =
              (): Promise<BaseModel | null> => {
                return listed.service.findOneById({
                  id: new ObjectID(record),
                  select: listed.select as never,
                  props: reader.props(),
                });
              };

            const before: BaseModel | null = await asBefore(read);
            const after: BaseModel | null = await read();

            expect({
              reader: reader.name,
              record,
              found: Boolean(after),
            }).toEqual({
              reader: reader.name,
              record,
              found: Boolean(before),
            });
            expect({
              reader: reader.name,
              record,
              found: Boolean(after),
            }).toEqual({
              reader: reader.name,
              record,
              found: isReachable(reader, listed, record),
            });

            if (after) {
              expect(labelsIn(after)).toEqual(
                Array.from(linksOf.get(record) || new Set<string>())
                  .filter((labelId: string): boolean => {
                    return labelId !== deletedLabel.toString();
                  })
                  .sort(),
              );
            }
          }
        }
      }, 300000);

      test("an update by a query changes the records it did before, and no other", async () => {
        const editors: Array<Reader> = readersFor(listed).filter(
          (reader: Reader): boolean => {
            return !reader.onlyFor;
          },
        );

        // The records an update wrote its token to, read as the database's owner.
        const updated: (token: string) => Promise<Array<string>> = async (
          token: string,
        ): Promise<Array<string>> => {
          const rows: Array<{ _id: string }> = await database.query(
            `SELECT "_id" FROM "${schema}"."${listed.table}" WHERE "${listed.writableColumn}" = $1 ORDER BY "_id"`,
            [token],
          );

          return rows.map((row: { _id: string }): string => {
            return row._id;
          });
        };

        for (const reader of editors) {
          for (const filter of FILTERS.slice(0, 7)) {
            const query: Dictionary<unknown> = filter.query(listed);

            const beforeToken: string = `before ${ObjectID.generate().toString()}`;
            const afterToken: string = `after ${ObjectID.generate().toString()}`;

            await asBefore(() => {
              return listed.service.updateBy({
                query: { ...query } as never,
                data: { [listed.writableColumn]: beforeToken } as never,
                limit: 1000,
                skip: 0,
                props: reader.props(),
              });
            });

            const changedBefore: Array<string> = await updated(beforeToken);

            await listed.service.updateBy({
              query: { ...query } as never,
              data: { [listed.writableColumn]: afterToken } as never,
              limit: 1000,
              skip: 0,
              props: reader.props(),
            });

            const changedAfter: Array<string> = await updated(afterToken);

            expect({
              reader: reader.name,
              filter: filter.name,
              changed: changedAfter,
            }).toEqual({
              reader: reader.name,
              filter: filter.name,
              changed: expectedOf(reader, listed, changedBefore),
            });

            for (const record of changedAfter) {
              expect({ reader: reader.name, record, reachable: true }).toEqual({
                reader: reader.name,
                record,
                reachable: isReachable(reader, listed, record),
              });
            }
          }
        }
      }, 300000);
    });

    /*
     * What the old code got wrong, held to the rows: the filters it dropped
     * or replaced are kept.
     */
    describe("the filters the old code dropped", () => {
      const alerts: Listed = LISTED[0]!;
      const limited: Reader = READERS[2]!; // limited to L1 and L3

      test("an id filter the label rule used to take the place of, beside a filter by labels", async () => {
        const excluded: string = (recordsOf["Alert"] || []).find(
          (record: string): boolean => {
            return (
              isReachable(limited, alerts, record) &&
              carriesAlive(record, [L1, L3])
            );
          },
        )!;

        expect(excluded).toBeDefined();

        const query: Dictionary<unknown> = {
          _id: new NotEqual(excluded),
          labels: new Includes([L1, L3]),
        };

        // Before: the NotEqual was dropped, and the excluded record came back.
        const before: Array<string> = idsIn(
          await asBefore(() => {
            return list({ listed: alerts, reader: limited, query });
          }),
        );
        const after: Array<string> = idsIn(
          await list({ listed: alerts, reader: limited, query }),
        );

        expect(before).toContain(excluded);
        expect(after).not.toContain(excluded);
        expect(after.sort()).toEqual(
          (recordsOf["Alert"] || [])
            .filter((record: string): boolean => {
              return (
                record !== excluded &&
                isReachable(limited, alerts, record) &&
                carriesAlive(record, [L1, L3])
              );
            })
            .sort(),
        );
      });

      test("a deleted label in a grant reached records once the reader filtered by labels, and reaches none now", async () => {
        const reader: Reader = READERS.find((each: Reader): boolean => {
          return Boolean(each.grantsDeletedLabel);
        })!;

        // Linked to the deleted label and a label the reader filters by, and to no live granted one.
        const onlyThroughTheDeletedLabel: Array<string> = (
          recordsOf["Alert"] || []
        ).filter((record: string): boolean => {
          return (
            !privateRecords.has(record) &&
            carriesAny(record, [deletedLabel]) &&
            !carriesAlive(record, [L4])
          );
        });

        expect(onlyThroughTheDeletedLabel.length).toBeGreaterThan(0);

        const filterLabels: Array<ObjectID> = [L0, L1, L2, L3];
        const query: Dictionary<unknown> = {
          labels: new Includes(filterLabels),
        };

        const before: Array<string> = idsIn(
          await asBefore(() => {
            return list({ listed: alerts, reader, query });
          }),
        );
        const after: Array<string> = idsIn(
          await list({ listed: alerts, reader, query }),
        );
        const unfilteredBefore: Array<string> = idsIn(
          await asBefore(() => {
            return list({ listed: alerts, reader, query: {} });
          }),
        );

        const leaked: Array<string> = onlyThroughTheDeletedLabel.filter(
          (record: string): boolean => {
            return carriesAlive(record, filterLabels);
          },
        );

        expect(leaked.length).toBeGreaterThan(0);

        for (const record of leaked) {
          // Before: in the filtered list, though not in the unfiltered one.
          expect(before).toContain(record);
          expect(unfilteredBefore).not.toContain(record);
          // Now: in neither.
          expect(after).not.toContain(record);
        }

        expect(after).toEqual(expectedOf(reader, alerts, before));
      });

      test("labels: null lists the records with no labels, which a label-limited reader has none of", async () => {
        const unlimited: Reader = READERS[0]!;

        expect(
          idsIn(
            await list({
              listed: alerts,
              reader: unlimited,
              query: { labels: null },
            }),
          ).sort(),
        ).toEqual(
          (recordsOf["Alert"] || [])
            .filter((record: string): boolean => {
              return (
                isReachable(unlimited, alerts, record) &&
                (linksOf.get(record) || new Set()).size === 0
              );
            })
            .sort(),
        );

        // Before: the label rule took the filter's place, and listed every permitted record.
        expect(
          (
            await asBefore(() => {
              return list({
                listed: alerts,
                reader: limited,
                query: { labels: null },
              });
            })
          ).length,
        ).toBeGreaterThan(0);
        expect(
          await list({
            listed: alerts,
            reader: limited,
            query: { labels: null },
          }),
        ).toEqual([]);
      });

      test("an id filter whose key comes after a filter on the labels", async () => {
        const unlimited: Reader = READERS[0]!;
        const some: Array<string> = (recordsOf["Alert"] || []).slice(0, 12);

        const after: Array<string> = idsIn(
          await list({
            listed: alerts,
            reader: unlimited,
            query: { labels: new IsNull(), _id: new Includes(some) },
          }),
        );

        expect(after.sort()).toEqual(
          some
            .filter((record: string): boolean => {
              return (
                isReachable(unlimited, alerts, record) &&
                (linksOf.get(record) || new Set()).size === 0
              );
            })
            .sort(),
        );
      });
    });
  },
);
