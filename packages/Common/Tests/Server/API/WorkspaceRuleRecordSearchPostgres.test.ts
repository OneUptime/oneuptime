import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  ListRequest,
  valuesOf,
} from "./PostgresListRouteHarness";
import ArchivableValueAPI from "../../../Server/API/ArchivableValueAPI";
import BaseAPI from "../../../Server/API/BaseAPI";
import OnCallDutyPolicyAPI from "../../../Server/API/OnCallDutyPolicyAPI";
import OnCallDutyPolicyScheduleAPI from "../../../Server/API/OnCallDutyPolicyScheduleAPI";
import ServiceLevelObjectiveAPI from "../../../Server/API/ServiceLevelObjectiveAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import LabelService, {
  Service as LabelServiceType,
} from "../../../Server/Services/LabelService";
import TeamService, {
  Service as TeamServiceType,
} from "../../../Server/Services/TeamService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import PolicyNameConditionSwitch, {
  PolicyNameConditionMatch,
} from "../../../Types/Workspace/NotificationRules/PolicyNameConditionSwitch";
import { withSearch } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import {
  RECORD_CONDITION_KINDS,
  RecordConditionKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/RecordConditionPicker";
import { readPoliciesNamedByWords } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/ConditionRecordReads";
import {
  createHeldRuleRecordCache,
  getHeldRuleIds,
  getHeldRuleRecords,
  HeldRuleRecordCache,
  HeldRuleRecords,
  readHeldRuleRecords,
  readProjectUsersByIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceRuleHeldRecords";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A WORKSPACE RULE'S LABELS, SLOS, ON-CALL POLICIES, OWNERS AND WHO JOINS
 * ITS CHANNEL, SEARCHED AND READ THROUGH THE REAL SERVER (#10689).
 *
 * The rules and summaries pages read the project's first 10,000 labels,
 * SLOs, policies, teams and schedules by name, and its first 10,000 team
 * memberships unsorted, to offer them in a condition and name what a rule
 * holds. A record past them could not be picked and read "No longer in this
 * project" on its rule's card; a team past them was taken for a person who
 * left; a person whose memberships were all past them was named by nobody.
 *
 * Each condition's search (RecordConditionPicker: EntityDropdown with its
 * kind's query, 50 by name), an On-Call Policy Name condition's words
 * (readPoliciesNamedByWords), and the reads by id that name what the shown
 * rules hold (readHeldRuleRecords) go through the list routes as a member,
 * on migrated Postgres (PostgresListRouteHarness): the late records are
 * found and named, archived ones are never offered but are named - marked -
 * when a rule holds them, and another project's are never either.
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (see the harness).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PICKER_SEARCH_TESTS"] === "true"
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

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source is the harness's; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

const RECORDS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
const PICKER_PAGE_SIZE: number = 50;

// The tables each kind is kept in, and the columns a row of it needs.
const KINDS: Array<{
  table: string;
  path: string;
  checkOn: NotificationRuleConditionCheckOn;
  extraColumns: Record<string, unknown>;
}> = [
  {
    table: "Label",
    path: "/label",
    checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
    extraColumns: { color: "#6366f1" },
  },
  {
    table: "ServiceLevelObjective",
    path: "/service-level-objective",
    checkOn: NotificationRuleConditionCheckOn.Slos,
    extraColumns: { targetPercentage: 99.9 },
  },
  {
    table: "OnCallDutyPolicy",
    path: "/on-call-duty-policy",
    checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
    extraColumns: {},
  },
];

describePostgres(
  "a workspace rule's labels, SLOs, policies, owners and invitees, searched and read through the real server (#10689)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "workspace_rule_records",
      tables: [
        "ServiceLevelObjective",
        "OnCallDutyPolicy",
        "OnCallDutyPolicySchedule",
      ],
    });

    // The list routes, as the app registers them.
    new ArchivableValueAPI<Label, LabelServiceType>(Label, LabelService);
    new ServiceLevelObjectiveAPI();
    new OnCallDutyPolicyAPI();
    new OnCallDutyPolicyScheduleAPI();
    new BaseAPI<Team, TeamServiceType>(Team, TeamService);
    new TeamMemberAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();

    // Of each kind: the late one, another to find, an archived one.
    const lateIds: Record<string, ObjectID> = {};
    const otherLateIds: Record<string, ObjectID> = {};
    const archivedIds: Record<string, ObjectID> = {};
    const otherProjectIds: Record<string, ObjectID> = {};
    // Never inserted: a record a rule holds, deleted since.
    const deletedId: ObjectID = ObjectID.generate();

    const lateTeamId: ObjectID = ObjectID.generate();
    const lateUserId: ObjectID = ObjectID.generate();
    const goneUserId: ObjectID = ObjectID.generate();
    const lateScheduleId: ObjectID = ObjectID.generate();

    const insertNamed: (data: {
      table: string;
      id: ObjectID;
      name: string;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      extraColumns?: Record<string, unknown> | undefined;
    }) => Promise<void> = async (data: {
      table: string;
      id: ObjectID;
      name: string;
      inProject?: ObjectID | undefined;
      isArchived?: boolean | undefined;
      extraColumns?: Record<string, unknown> | undefined;
    }): Promise<void> => {
      await harness.insert(data.table, {
        _id: data.id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `${data.table.toLowerCase()}-${data.id.toString()}`,
        ...(data.isArchived === undefined
          ? {}
          : { isArchived: data.isArchived }),
        ...(data.extraColumns || {}),
      });
    };

    // More rows than the pages ever read, all named before "WB".
    const insertMany: (data: {
      table: string;
      extraColumns: Record<string, unknown>;
    }) => Promise<void> = async (data: {
      table: string;
      extraColumns: Record<string, unknown>;
    }): Promise<void> => {
      const extraNames: Array<string> = Object.keys(data.extraColumns);

      await harness.query(
        `INSERT INTO "${harness.schema}"."${data.table}" ("_id", "version", "projectId", "name", "slug"${extraNames
          .map((name: string): string => {
            return `, "${name}"`;
          })
          .join("")})
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), '${data.table.toLowerCase()}-' || gen_random_uuid()${extraNames
           .map((_name: string, index: number): string => {
             return `, $${index + 3}`;
           })
           .join("")}
         FROM generate_series(1, $2) AS i`,
        [
          projectId.toString(),
          RECORDS_BEFORE_WB,
          ...Object.values(data.extraColumns),
        ],
      );
    };

    // A search typed into a condition, as EntityDropdown sends it.
    const search: (data: {
      kind: RecordConditionKind;
      path: string;
      text: string;
    }) => Promise<ListedPage<BaseModel>> = async (data: {
      kind: RecordConditionKind;
      path: string;
      text: string;
    }): Promise<ListedPage<BaseModel>> => {
      return await harness.list<BaseModel>({
        path: data.path,
        query: withSearch(
          ArchivedValuePicker.getPickerQuery(
            data.kind.modelType,
            data.kind.query,
          ),
          "name",
          data.text,
        ),
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: PICKER_PAGE_SIZE,
        userId: memberId,
        projectId: projectId,
      });
    };

    const condition: (
      checkOn: NotificationRuleConditionCheckOn,
      ids: Array<ObjectID>,
    ) => NotificationRuleCondition = (
      checkOn: NotificationRuleConditionCheckOn,
      ids: Array<ObjectID>,
    ): NotificationRuleCondition => {
      return {
        checkOn: checkOn,
        conditionType: ConditionType.ContainsAny,
        value: ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      };
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Kiosk fleet");
      await harness.insertProject(otherProjectId, "Another project");

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });

      for (const kind of KINDS) {
        lateIds[kind.table] = ObjectID.generate();
        otherLateIds[kind.table] = ObjectID.generate();
        archivedIds[kind.table] = ObjectID.generate();
        otherProjectIds[kind.table] = ObjectID.generate();

        await insertMany({
          table: kind.table,
          extraColumns: kind.extraColumns,
        });

        await insertNamed({
          table: kind.table,
          id: lateIds[kind.table]!,
          name: "WB1500KSK02",
          isArchived: false,
          extraColumns: kind.extraColumns,
        });
        await insertNamed({
          table: kind.table,
          id: otherLateIds[kind.table]!,
          name: "WB1500KSK03",
          isArchived: false,
          extraColumns: kind.extraColumns,
        });
        await insertNamed({
          table: kind.table,
          id: archivedIds[kind.table]!,
          name: "WB1500KSK09",
          isArchived: true,
          extraColumns: kind.extraColumns,
        });
        await insertNamed({
          table: kind.table,
          id: otherProjectIds[kind.table]!,
          name: "WB1500KSK04",
          inProject: otherProjectId,
          isArchived: false,
          extraColumns: kind.extraColumns,
        });

        await harness.analyze(kind.table);
      }

      // Teams: more than the pages read, then one past them.
      await insertMany({ table: "Team", extraColumns: {} });
      await insertNamed({
        table: "Team",
        id: lateTeamId,
        name: "WB1500KSK02 Team",
      });

      // More memberships than the pages read, then the late person's.
      await harness.query(
        `INSERT INTO "${harness.schema}"."TeamMember" ("_id", "version", "projectId", "teamId", "userId", "hasAcceptedInvitation")
         SELECT gen_random_uuid(), 1, $1, $2, gen_random_uuid(), true
         FROM generate_series(1, $3) AS i`,
        [projectId.toString(), lateTeamId.toString(), RECORDS_BEFORE_WB],
      );
      await harness.insert("User", {
        _id: lateUserId,
        name: "Wanda Bell",
        email: `${lateUserId.toString()}@example.com`,
        slug: lateUserId.toString(),
        version: 1,
      });
      await harness.insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: lateTeamId,
        userId: lateUserId,
        hasAcceptedInvitation: true,
        version: 1,
      });

      await insertNamed({
        table: "OnCallDutyPolicySchedule",
        id: lateScheduleId,
        name: "WB1500KSK02 Schedule",
      });

      await harness.analyze("Team");
      await harness.analyze("TeamMember");
    }, 600000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the pages' old read never had WB1500KSK02: the first 10,000 labels by name", async () => {
      const read: ListedPage<Label> = await harness.list<Label>({
        path: "/label",
        query: { projectId: projectId },
        select: { _id: true, name: true, isArchived: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(LIMIT_PER_PROJECT);
      expect(valuesOf(read, "name")).not.toContain("WB1500KSK02");
    });

    test.each(KINDS)(
      "$table: a condition finds WB1500KSK02 past the 10,000th, never an archived one or another project's",
      async (kind: {
        table: string;
        path: string;
        checkOn: NotificationRuleConditionCheckOn;
      }) => {
        const recordKind: RecordConditionKind =
          RECORD_CONDITION_KINDS[kind.checkOn]!;

        const page: ListedPage<BaseModel> = await search({
          kind: recordKind,
          path: kind.path,
          text: "WB1500KSK0",
        });

        expect(valuesOf(page, "name")).toEqual(["WB1500KSK02", "WB1500KSK03"]);

        // With nothing typed: 50 by name, every live one counted.
        const first: ListedPage<BaseModel> = await search({
          kind: recordKind,
          path: kind.path,
          text: "",
        });

        expect(first.rows).toHaveLength(PICKER_PAGE_SIZE);
        expect(first.count).toBe(RECORDS_BEFORE_WB + 2);
      },
    );

    test("an On-Call Policy Name condition's words name the policies past the 10,000th, archived ones left out", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const policies: Array<OnCallDutyPolicy> =
        await readPoliciesNamedByWords("wb1500ksk0");

      const match: PolicyNameConditionMatch | null =
        PolicyNameConditionSwitch.getMatch({
          condition: {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
            conditionType: ConditionType.Contains,
            value: "WB1500KSK0",
          },
          policies: policies,
        });

      expect(
        (match?.policies || []).map((policy: OnCallDutyPolicy): string => {
          return policy.name || "";
        }),
      ).toEqual(["WB1500KSK02", "WB1500KSK03"]);

      // One read, of the names holding the words: never the policies whole.
      expect(reads).toHaveLength(1);
    });

    test("what the shown rules hold is named by its ids: late ones, archived ones marked, deleted ones gone, a team as a team, a person past the first 10,000 memberships", async () => {
      const reads: Array<ListRequest> = harness.routeModelAPIReads({
        userId: memberId,
        projectId: projectId,
      });

      const rules: Array<{ notificationRule: unknown }> = [
        {
          notificationRule: {
            filters: [
              condition(NotificationRuleConditionCheckOn.IncidentLabels, [
                lateIds["Label"]!,
                deletedId,
                otherProjectIds["Label"]!,
              ]),
              condition(NotificationRuleConditionCheckOn.IncidentOwners, [
                lateTeamId,
                lateUserId,
                goneUserId,
              ]),
            ],
            inviteUsersToNewChannel: [lateUserId.toString()],
            inviteOnCallSchedulesToNewChannel: [lateScheduleId.toString()],
          },
        },
        {
          notificationRule: {
            filters: [
              condition(NotificationRuleConditionCheckOn.Slos, [
                archivedIds["ServiceLevelObjective"]!,
              ]),
              condition(NotificationRuleConditionCheckOn.OnCallDutyPolicies, [
                lateIds["OnCallDutyPolicy"]!,
              ]),
            ],
          },
        },
      ];

      const cache: HeldRuleRecordCache = createHeldRuleRecordCache();

      await readHeldRuleRecords({
        projectId: projectId,
        ids: getHeldRuleIds(rules),
        cache: cache,
      });

      const held: HeldRuleRecords = getHeldRuleRecords({
        ids: getHeldRuleIds(rules),
        cache: cache,
      });

      const named: (records: Array<BaseModel> | undefined) => Array<string> = (
        records: Array<BaseModel> | undefined,
      ): Array<string> => {
        return (records || [])
          .map((record: BaseModel): string => {
            const row: { name?: unknown; isArchived?: boolean } =
              record as unknown as { name?: unknown; isArchived?: boolean };
            return `${String(row.name)}${row.isArchived ? " (archived)" : ""}`;
          })
          .sort();
      };

      // Another project's label is not the member's: it names nothing.
      expect(named(held.labels)).toEqual(["WB1500KSK02"]);
      expect(named(held.serviceLevelObjectives)).toEqual([
        "WB1500KSK09 (archived)",
      ]);
      expect(named(held.onCallDutyPolicies)).toEqual(["WB1500KSK02"]);
      expect(named(held.teams)).toEqual(["WB1500KSK02 Team"]);
      expect(
        (held.users || []).map((user: User): string => {
          return user.name?.toString() || "";
        }),
      ).toEqual(["Wanda Bell"]);
      expect(named(held.onCallSchedules)).toEqual(["WB1500KSK02 Schedule"]);

      // Each read asks only for what the rules hold.
      for (const read of reads) {
        expect(read.limit).toBeLessThanOrEqual(LIMIT_PER_PROJECT);
        expect(
          Object.keys(read.query).some((key: string): boolean => {
            return key === "_id" || key === "userId";
          }),
        ).toBe(true);
      }
    });

    test("a person whose memberships are all past the first 10,000 is read by their id", async () => {
      harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

      const users: Array<User> = await readProjectUsersByIds({
        projectId: projectId,
        userIds: [lateUserId.toString(), goneUserId.toString()],
      });

      expect(
        users.map((user: User): string => {
          return user.name?.toString() || "";
        }),
      ).toEqual(["Wanda Bell"]);
    });
  },
);
