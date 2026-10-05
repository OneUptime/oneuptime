import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeOwnerTeamService from "../../../Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertGroupingRuleService from "../../../Server/Services/AlertGroupingRuleService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeOwnerTeamService from "../../../Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentGroupingRuleService from "../../../Server/Services/IncidentGroupingRuleService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import GroupingRuleEpisodeOwners from "../../../Server/Utils/Rules/GroupingRuleEpisodeOwners";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A grouping rule's Episode Owners (episodeOwnerUsers, episodeOwnerTeams)
 * become owners of every episode it opens - and the engines open those as
 * root. Owners a rule sets follow the rule owners set by hand follow: the
 * project's own teams, and members of the project.
 *
 *   - Both engines add the rule's people and teams to each new episode,
 *     each once, skipping a team from another project (one read pinned to
 *     the project) and a user who is no longer a member; one owner that
 *     cannot be added never stops the others, nor the episode.
 *   - The old default assignee is still copied to the episode's
 *     assignedToUser / assignedToTeam (the API's contract) and is never made
 *     an owner by the engine.
 *   - Both rule services refuse, when a rule is saved, a team from another
 *     project or a user with no membership in it - and the same for every
 *     other list a rule saves (monitors, labels, on-call policies, episode
 *     labels and roles), the old default assignee pair and the incident
 *     rule's member role assignments. On an update only the ids the update
 *     adds, so a rule naming someone who has left can still be edited.
 *     Errors echo ids, never names, and answer an id from another project
 *     like one that matches nothing.
 *
 * Every service the paths touch is stubbed at its public method, and the
 * project's directory (ProjectScopedReferenceValidator's lookups) by
 * stubProjectDirectory, so this runs without a database, with
 * BILLING_ENABLED on or off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-000000000002",
);
const RULE_ID: ObjectID = new ObjectID("0194c3a9-0000-4000-8000-0000000000b1");
const EPISODE_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000e1",
);

const ADA: string = "0000000e-0000-4000-8000-000000000001";
const BOB: string = "0000000e-0000-4000-8000-000000000002";
// Not a member of the project (any more).
const EVE: string = "0000000e-0000-4000-8000-0000000000ee";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const DATABASE: string = "0000000b-0000-4000-8000-000000000002";
// Another project's team.
const FOREIGN_TEAM: string = "0000000b-0000-4000-8000-0000000000ff";
// An on-call policy and a label of the project, and of another project.
const OWN_POLICY: string = "0000000c-0000-4000-8000-000000000001";
const FOREIGN_POLICY: string = "0000000c-0000-4000-8000-0000000000ff";
const OWN_LABEL: string = "0000000d-0000-4000-8000-000000000001";
const FOREIGN_LABEL: string = "0000000d-0000-4000-8000-0000000000ff";

const MEMBERS: Array<string> = [ADA, BOB];
const PROJECT_TEAMS: Array<string> = [PLATFORM, DATABASE];

function user(id: string): User {
  const item: User = new User();
  item._id = id;
  return item;
}

function team(id: string): Team {
  const item: Team = new Team();
  item._id = id;
  return item;
}

function onCallPolicy(id: string): OnCallDutyPolicy {
  const item: OnCallDutyPolicy = new OnCallDutyPolicy();
  item._id = id;
  return item;
}

function label(id: string): Label {
  const item: Label = new Label();
  item._id = id;
  return item;
}

function idsOf(records: Array<BaseModel> | undefined | null): Array<string> {
  return (records || []).map((record: BaseModel): string => {
    return record._id!.toString();
  });
}

// What the directory was asked: teams by the project, members by the project.
let directory: ProjectDirectoryStub;

type TeamLookup = { projectId: string; ids: Array<string> };

function teamLookups(): Array<TeamLookup> {
  return directory.recordLookups
    .filter((lookup: { model: string }): boolean => {
      return lookup.model === "Team";
    })
    .map((lookup: { projectId: string; ids: Array<string> }): TeamLookup => {
      return { projectId: lookup.projectId, ids: lookup.ids };
    });
}

/*
 * The directory, answered the way the database would: a team only when it
 * is the queried project's, a membership only in the queried project.
 */
function stubDirectory(): void {
  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      Team: PROJECT_TEAMS,
      OnCallDutyPolicy: [OWN_POLICY],
      Label: [OWN_LABEL],
    },
    members: MEMBERS,
  });

  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        userId: ObjectID;
      }): Promise<boolean> => {
        return (
          data.projectId.toString() === PROJECT_ID.toString() &&
          MEMBERS.includes(data.userId.toString().toLowerCase())
        );
      },
    );
}

afterEach(() => {
  jest.restoreAllMocks();
});

interface EngineCase {
  label: string;
  newRule: () => IncidentGroupingRule | AlertGroupingRule;
  newRecord: () => Incident | Alert;
  createNewEpisode: (
    record: Incident | Alert,
    rule: IncidentGroupingRule | AlertGroupingRule,
  ) => Promise<BaseModel | null>;
  episodeIdColumn: string;
  stubEpisodeCreate: () => ReturnType<typeof jest.spyOn>;
  stubFeed: () => void;
  ownerUserService: DatabaseService<BaseModel>;
  ownerTeamService: DatabaseService<BaseModel>;
}

interface EngineInternals {
  createNewEpisode: (
    record: unknown,
    rule: unknown,
    groupingKey: string,
  ) => Promise<BaseModel | null>;
}

const ENGINES: Array<EngineCase> = [
  {
    label: "incident grouping",
    newRule: (): IncidentGroupingRule => {
      const rule: IncidentGroupingRule = new IncidentGroupingRule();
      rule.id = RULE_ID;
      rule.name = "Payments storms";
      return rule;
    },
    newRecord: (): Incident => {
      const incident: Incident = new Incident();
      incident.id = ObjectID.generate();
      incident.projectId = PROJECT_ID;
      incident.title = "Checkout is failing";
      return incident;
    },
    createNewEpisode: (
      record: Incident | Alert,
      rule: IncidentGroupingRule | AlertGroupingRule,
    ): Promise<BaseModel | null> => {
      return (
        IncidentGroupingEngineService as unknown as EngineInternals
      ).createNewEpisode(record, rule, "default");
    },
    episodeIdColumn: "incidentEpisodeId",
    stubEpisodeCreate: (): ReturnType<typeof jest.spyOn> => {
      return jest
        .spyOn(IncidentEpisodeService, "create")
        .mockImplementation((async (data: {
          data: IncidentEpisode;
        }): Promise<IncidentEpisode> => {
          data.data.id = EPISODE_ID;
          return data.data;
        }) as never);
    },
    stubFeed: (): void => {
      jest
        .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
    },
    ownerUserService:
      IncidentEpisodeOwnerUserService as unknown as DatabaseService<BaseModel>,
    ownerTeamService:
      IncidentEpisodeOwnerTeamService as unknown as DatabaseService<BaseModel>,
  },
  {
    label: "alert grouping",
    newRule: (): AlertGroupingRule => {
      const rule: AlertGroupingRule = new AlertGroupingRule();
      rule.id = RULE_ID;
      rule.name = "Payments storms";
      return rule;
    },
    newRecord: (): Alert => {
      const alert: Alert = new Alert();
      alert.id = ObjectID.generate();
      alert.projectId = PROJECT_ID;
      alert.title = "Checkout is failing";
      return alert;
    },
    createNewEpisode: (
      record: Incident | Alert,
      rule: IncidentGroupingRule | AlertGroupingRule,
    ): Promise<BaseModel | null> => {
      return (
        AlertGroupingEngineService as unknown as EngineInternals
      ).createNewEpisode(record, rule, "default");
    },
    episodeIdColumn: "alertEpisodeId",
    stubEpisodeCreate: (): ReturnType<typeof jest.spyOn> => {
      return jest
        .spyOn(AlertEpisodeService, "create")
        .mockImplementation((async (data: {
          data: AlertEpisode;
        }): Promise<AlertEpisode> => {
          data.data.id = EPISODE_ID;
          return data.data;
        }) as never);
    },
    stubFeed: (): void => {
      jest
        .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
    },
    ownerUserService:
      AlertEpisodeOwnerUserService as unknown as DatabaseService<BaseModel>,
    ownerTeamService:
      AlertEpisodeOwnerTeamService as unknown as DatabaseService<BaseModel>,
  },
];

interface WrittenOwner {
  row: BaseModel;
  props: DatabaseCommonInteractionProps;
}

describe.each(ENGINES)("the $label engine", (engine: EngineCase) => {
  let writtenUsers: Array<WrittenOwner> = [];
  let writtenTeams: Array<WrittenOwner> = [];
  let episodeCreate: ReturnType<typeof jest.spyOn>;

  function stubOwnerWrites(): void {
    writtenUsers = [];
    writtenTeams = [];

    jest.spyOn(engine.ownerUserService, "create").mockImplementation((async (
      data: CreateBy<BaseModel>,
    ): Promise<BaseModel> => {
      writtenUsers.push({ row: data.data, props: data.props });
      return data.data;
    }) as never);

    jest.spyOn(engine.ownerTeamService, "create").mockImplementation((async (
      data: CreateBy<BaseModel>,
    ): Promise<BaseModel> => {
      writtenTeams.push({ row: data.data, props: data.props });
      return data.data;
    }) as never);
  }

  function ownerIds(
    written: Array<WrittenOwner>,
    column: string,
  ): Array<string> {
    return written.map((owner: WrittenOwner): string => {
      return String(owner.row.getColumnValue(column));
    });
  }

  beforeEach(() => {
    stubDirectory();
    stubOwnerWrites();
    engine.stubFeed();
    episodeCreate = engine.stubEpisodeCreate();
  });

  test("makes the rule's people and teams owners of the episode it opens", async () => {
    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.episodeOwnerUsers = [user(ADA), user(BOB)];
    rule.episodeOwnerTeams = [team(PLATFORM)];

    const episode: BaseModel | null = await engine.createNewEpisode(
      engine.newRecord(),
      rule,
    );

    expect(episode?.id?.toString()).toBe(EPISODE_ID.toString());
    expect(ownerIds(writtenUsers, "userId")).toEqual([ADA, BOB]);
    expect(ownerIds(writtenTeams, "teamId")).toEqual([PLATFORM]);

    for (const owner of [...writtenUsers, ...writtenTeams]) {
      expect(String(owner.row.getColumnValue("projectId"))).toBe(
        PROJECT_ID.toString(),
      );
      expect(String(owner.row.getColumnValue(engine.episodeIdColumn))).toBe(
        EPISODE_ID.toString(),
      );
      // Not yet notified: the owner-added notification job tells them.
      expect(owner.row.getColumnValue("isOwnerNotified")).toBeFalsy();
      expect(owner.props.isRoot).toBe(true);
    }
  });

  test("adds only the project's own teams, read pinned to the project", async () => {
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.episodeOwnerTeams = [team(FOREIGN_TEAM), team(DATABASE)];

    await engine.createNewEpisode(engine.newRecord(), rule);

    expect(ownerIds(writtenTeams, "teamId")).toEqual([DATABASE]);
    /*
     * One read of the rule's teams. The owner row's own service checks the
     * team it is handed again when the row is written.
     */
    expect(teamLookups()).toEqual([
      { projectId: PROJECT_ID.toString(), ids: [FOREIGN_TEAM, DATABASE] },
    ]);

    // Said in the log, by id.
    const warnings: Array<string> = warn.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );
    expect(
      warnings.some((message: string): boolean => {
        return (
          message.includes(FOREIGN_TEAM) && message.includes("Payments storms")
        );
      }),
    ).toBe(true);
  });

  test("never adds someone who is not a member of the project", async () => {
    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.episodeOwnerUsers = [user(EVE), user(ADA)];

    await engine.createNewEpisode(engine.newRecord(), rule);

    expect(ownerIds(writtenUsers, "userId")).toEqual([ADA]);
  });

  test("adds each owner once, however often - and in whatever case - the rule names them", async () => {
    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.episodeOwnerUsers = [user(ADA), user(ADA.toUpperCase())];
    rule.episodeOwnerTeams = [team(PLATFORM), team(PLATFORM)];

    await engine.createNewEpisode(engine.newRecord(), rule);

    expect(ownerIds(writtenUsers, "userId")).toEqual([ADA]);
    expect(ownerIds(writtenTeams, "teamId")).toEqual([PLATFORM]);
  });

  test("one owner that cannot be added never stops the others", async () => {
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    jest
      .spyOn(engine.ownerUserService, "create")
      .mockImplementationOnce((async (): Promise<BaseModel> => {
        throw new Error("Connection reset");
      }) as never)
      .mockImplementation((async (
        data: CreateBy<BaseModel>,
      ): Promise<BaseModel> => {
        writtenUsers.push({ row: data.data, props: data.props });
        return data.data;
      }) as never);

    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.episodeOwnerUsers = [user(ADA), user(BOB)];
    rule.episodeOwnerTeams = [team(PLATFORM)];

    const episode: BaseModel | null = await engine.createNewEpisode(
      engine.newRecord(),
      rule,
    );

    expect(episode).not.toBeNull();
    expect(ownerIds(writtenUsers, "userId")).toEqual([BOB]);
    expect(ownerIds(writtenTeams, "teamId")).toEqual([PLATFORM]);
  });

  test("a failed team lookup costs the teams only: the people are still added, and the episode opens", async () => {
    const error: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        return undefined;
      }) as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "findIdsInProject")
      .mockRejectedValue(new Error("Database is down") as never);

    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.episodeOwnerUsers = [user(ADA), user(BOB)];
    rule.episodeOwnerTeams = [team(PLATFORM)];

    const episode: BaseModel | null = await engine.createNewEpisode(
      engine.newRecord(),
      rule,
    );

    expect(episode?.id?.toString()).toBe(EPISODE_ID.toString());
    expect(ownerIds(writtenUsers, "userId")).toEqual([ADA, BOB]);
    expect(writtenTeams).toEqual([]);
    expect(
      error.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes("no team was made an owner");
      }),
    ).toBe(true);
  });

  test("a rule that names no owners asks nothing about them", async () => {
    await engine.createNewEpisode(engine.newRecord(), engine.newRule());

    expect(teamLookups()).toEqual([]);
    expect(writtenUsers).toEqual([]);
    expect(writtenTeams).toEqual([]);
  });

  test("the old default assignee is copied only while it names the project's team and a member", async () => {
    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.defaultAssignToUserId = new ObjectID(EVE);
    rule.defaultAssignToTeamId = new ObjectID(FOREIGN_TEAM);

    const episode: BaseModel | null = await engine.createNewEpisode(
      engine.newRecord(),
      rule,
    );

    const created: BaseModel = (
      episodeCreate.mock.calls[0] as Array<{ data: BaseModel }>
    )[0]!.data;

    expect(episode).not.toBeNull();
    expect(created.getColumnValue("assignedToUserId")).toBeNull();
    expect(created.getColumnValue("assignedToTeamId")).toBeNull();
    // Looked up pinned to the project, as owners are.
    expect(teamLookups()[0]!.projectId).toBe(PROJECT_ID.toString());
  });

  test("a failed check of the old default assignee leaves it off, and the episode still opens", async () => {
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockRejectedValue(new Error("Database is down") as never);

    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.defaultAssignToUserId = new ObjectID(BOB);

    const episode: BaseModel | null = await engine.createNewEpisode(
      engine.newRecord(),
      rule,
    );

    const created: BaseModel = (
      episodeCreate.mock.calls[0] as Array<{ data: BaseModel }>
    )[0]!.data;

    expect(episode?.id?.toString()).toBe(EPISODE_ID.toString());
    expect(created.getColumnValue("assignedToUserId")).toBeNull();
  });

  test("the old default assignee is still copied to the episode, and never made an owner", async () => {
    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.defaultAssignToUserId = new ObjectID(BOB);
    rule.defaultAssignToTeamId = new ObjectID(DATABASE);
    rule.episodeOwnerUsers = [user(ADA)];

    await engine.createNewEpisode(engine.newRecord(), rule);

    const created: BaseModel = (
      episodeCreate.mock.calls[0] as Array<{ data: BaseModel }>
    )[0]!.data;

    expect(String(created.getColumnValue("assignedToUserId"))).toBe(BOB);
    expect(String(created.getColumnValue("assignedToTeamId"))).toBe(DATABASE);
    expect(ownerIds(writtenUsers, "userId")).toEqual([ADA]);
    expect(writtenTeams).toEqual([]);
  });

  test("copies only the project's own on-call policies and episode labels onto the episode", async () => {
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.onCallDutyPolicies = [
      onCallPolicy(OWN_POLICY),
      onCallPolicy(FOREIGN_POLICY),
    ];
    rule.episodeLabels = [label(FOREIGN_LABEL), label(OWN_LABEL)];

    await engine.createNewEpisode(engine.newRecord(), rule);

    const created: BaseModel = (
      episodeCreate.mock.calls[0] as Array<{ data: BaseModel }>
    )[0]!.data;

    expect(
      idsOf(created.getColumnValue("onCallDutyPolicies") as Array<BaseModel>),
    ).toEqual([OWN_POLICY]);
    expect(idsOf(created.getColumnValue("labels") as Array<BaseModel>)).toEqual(
      [OWN_LABEL],
    );

    // Both read pinned to the project, and what was left out said by id.
    for (const lookup of directory.recordLookups) {
      expect(lookup.projectId).toBe(PROJECT_ID.toString());
    }
    const warnings: Array<string> = warn.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );
    expect(
      warnings.some((message: string): boolean => {
        return message.includes(`"${FOREIGN_POLICY}"`);
      }),
    ).toBe(true);
    expect(
      warnings.some((message: string): boolean => {
        return message.includes(`"${FOREIGN_LABEL}"`);
      }),
    ).toBe(true);
  });

  test("a failed check copies no policies or labels, and the episode still opens", async () => {
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "findIdsInProject")
      .mockRejectedValue(new Error("Database is down") as never);

    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.onCallDutyPolicies = [onCallPolicy(OWN_POLICY)];
    rule.episodeLabels = [label(OWN_LABEL)];

    const episode: BaseModel | null = await engine.createNewEpisode(
      engine.newRecord(),
      rule,
    );

    const created: BaseModel = (
      episodeCreate.mock.calls[0] as Array<{ data: BaseModel }>
    )[0]!.data;

    expect(episode?.id?.toString()).toBe(EPISODE_ID.toString());
    expect(created.getColumnValue("onCallDutyPolicies")).toBeFalsy();
    expect(created.getColumnValue("labels")).toBeFalsy();
  });
});

describe("GroupingRuleEpisodeOwners", () => {
  beforeEach(() => {
    stubDirectory();
  });

  test("reads a rule's teams once, pinned to the project, and keeps the order given", async () => {
    await expect(
      GroupingRuleEpisodeOwners.getTeamIdsInProject({
        projectId: PROJECT_ID,
        teamIds: [DATABASE, FOREIGN_TEAM, PLATFORM.toUpperCase()],
      }),
    ).resolves.toEqual([DATABASE, PLATFORM.toUpperCase()]);

    expect(teamLookups()).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        ids: [DATABASE, FOREIGN_TEAM, PLATFORM],
      },
    ]);
  });

  test("never sends the database an id that is not one", async () => {
    await expect(
      GroupingRuleEpisodeOwners.getTeamIdsInProject({
        projectId: PROJECT_ID,
        teamIds: ["not-a-uuid", "' OR 1=1 --"],
      }),
    ).resolves.toEqual([]);

    expect(teamLookups()).toEqual([]);
  });
});

// One record of the project and one of another project, per list model.
const OWN_RECORD: string = "0000000a-0000-4000-8000-000000000001";
const FOREIGN_RECORD: string = "0000000a-0000-4000-8000-0000000000ff";
const SECOND_FOREIGN_TEAM: string = "0000000b-0000-4000-8000-0000000000fe";
// A team id that matches nothing at all.
const UNKNOWN_TEAM: string = "0000000b-0000-4000-8000-0000000000aa";

interface RuleList {
  column: string;
  // The table its ids point at.
  model: string;
}

interface RuleServiceCase {
  label: string;
  service: DatabaseService<BaseModel>;
  subject: string;
  newRule: () => BaseModel;
  // Every list the rule saves beside its Episode Owners.
  lists: Array<RuleList>;
}

const RULE_SERVICES: Array<RuleServiceCase> = [
  {
    label: "IncidentGroupingRuleService",
    service:
      IncidentGroupingRuleService as unknown as DatabaseService<BaseModel>,
    subject: "incident grouping rule",
    newRule: (): BaseModel => {
      return new IncidentGroupingRule();
    },
    lists: [
      { column: "monitors", model: "Monitor" },
      { column: "incidentSeverities", model: "IncidentSeverity" },
      { column: "incidentLabels", model: "Label" },
      { column: "monitorLabels", model: "Label" },
      { column: "onCallDutyPolicies", model: "OnCallDutyPolicy" },
      { column: "episodeLabels", model: "Label" },
      { column: "episodeMemberRoles", model: "IncidentRole" },
    ],
  },
  {
    label: "AlertGroupingRuleService",
    service: AlertGroupingRuleService as unknown as DatabaseService<BaseModel>,
    subject: "alert grouping rule",
    newRule: (): BaseModel => {
      return new AlertGroupingRule();
    },
    lists: [
      { column: "monitors", model: "Monitor" },
      { column: "alertSeverities", model: "AlertSeverity" },
      { column: "alertLabels", model: "Label" },
      { column: "monitorLabels", model: "Label" },
      { column: "onCallDutyPolicies", model: "OnCallDutyPolicy" },
      { column: "episodeLabels", model: "Label" },
    ],
  },
];

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const hooks: Record<string, HookFunction> = service as Record<
    string,
    HookFunction
  >;
  return hooks[name]!.apply(service, args);
}

const USER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID(ADA),
};

// A stub of a list's record: the shape an API create sends.
function recordOf(id: string): BaseModel {
  const record: BaseModel = new IncidentGroupingRule();
  record._id = id;
  return record;
}

describe.each(RULE_SERVICES)("$label", (ruleService: RuleServiceCase) => {
  let storedRules: Array<BaseModel> = [];
  let storedRead: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    stubDirectory();
    // The rest of the project: one record of each list's model.
    directory = stubProjectDirectory({
      projectId: PROJECT_ID,
      records: {
        Team: PROJECT_TEAMS,
        Monitor: [OWN_RECORD],
        Label: [OWN_RECORD],
        OnCallDutyPolicy: [OWN_RECORD],
        IncidentSeverity: [OWN_RECORD],
        AlertSeverity: [OWN_RECORD],
        IncidentRole: [OWN_RECORD],
      },
      members: MEMBERS,
    });
    storedRules = [];

    // What the rules an update matches already hold.
    storedRead = jest
      .spyOn(ruleService.service, "findBy")
      .mockImplementation((async (): Promise<Array<BaseModel>> => {
        return storedRules;
      }) as never);
  });

  function titleOf(column: string): string {
    return ruleService.newRule().getTableColumnMetadata(column).title || "";
  }

  function refusalFor(described: Array<string>): string {
    return `This ${ruleService.subject} references records that are not in this project: ${described.join(", ")}. Please pick values from this project and try again.`;
  }

  function createBy(
    values: Record<string, unknown>,
    props: DatabaseCommonInteractionProps = USER_PROPS,
  ): CreateBy<BaseModel> {
    const rule: BaseModel = ruleService.newRule();
    Object.assign(rule, values);
    return { data: rule, props: props } as CreateBy<BaseModel>;
  }

  function updateBy(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps = USER_PROPS,
  ): UpdateBy<BaseModel> {
    return {
      query: { _id: RULE_ID.toString() },
      data: data,
      props: props,
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<BaseModel>;
  }

  function storedRule(
    values: Record<string, unknown>,
    id: ObjectID = RULE_ID,
  ): BaseModel {
    const rule: BaseModel = ruleService.newRule();
    rule.id = id;
    Object.assign(rule, { projectId: PROJECT_ID, ...values });
    return rule;
  }

  async function refusal(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return (error as Error).message;
    }

    throw new Error("The write was not refused.");
  }

  function everyListOf(id: string): Record<string, unknown> {
    const values: Record<string, unknown> = {};

    for (const list of ruleService.lists) {
      values[list.column] = [recordOf(id)];
    }

    return values;
  }

  test("saves a rule whose people, teams and lists are all the project's, read pinned to it", async () => {
    await expect(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy({
          episodeOwnerUsers: [user(ADA)],
          episodeOwnerTeams: [team(PLATFORM)],
          ...everyListOf(OWN_RECORD),
        }),
      ),
    ).resolves.toBeDefined();

    for (const lookup of directory.recordLookups) {
      expect(lookup.projectId).toBe(PROJECT_ID.toString());
    }
    expect(directory.memberLookups[0]!.projectId).toBe(PROJECT_ID.toString());
  });

  test("refuses another project's team, naming it by its field and id only", async () => {
    const message: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy({ episodeOwnerTeams: [team(FOREIGN_TEAM), team(PLATFORM)] }),
      ),
    );

    expect(message).toBe(
      refusalFor([`${titleOf("episodeOwnerTeams")} "${FOREIGN_TEAM}"`]),
    );
  });

  test("answers another project's team exactly like a team that matches nothing", async () => {
    const foreign: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy({ episodeOwnerTeams: [team(FOREIGN_TEAM)] }),
      ),
    );
    const unknown: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy({ episodeOwnerTeams: [team(UNKNOWN_TEAM)] }),
      ),
    );

    expect(foreign.replace(FOREIGN_TEAM, "<id>")).toBe(
      unknown.replace(UNKNOWN_TEAM, "<id>"),
    );
  });

  test("refuses a user who is not a member, and says everything wrong at once", async () => {
    const message: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy({
          episodeOwnerUsers: [user(EVE)],
          episodeOwnerTeams: [team(FOREIGN_TEAM)],
        }),
      ),
    );

    expect(message).toContain(`${titleOf("episodeOwnerUsers")} "${EVE}"`);
    expect(message).toContain(
      `${titleOf("episodeOwnerTeams")} "${FOREIGN_TEAM}"`,
    );
  });

  test.each(
    ruleService.lists.map((list: RuleList): [string, RuleList] => {
      return [list.column, list];
    }),
  )(
    "refuses another project's record in %s",
    async (_column: string, list: RuleList) => {
      const message: string = await refusal(
        callHook(
          ruleService.service,
          "onBeforeCreate",
          createBy({
            [list.column]: [recordOf(OWN_RECORD), recordOf(FOREIGN_RECORD)],
          }),
        ),
      );

      expect(message).toBe(
        refusalFor([`${titleOf(list.column)} "${FOREIGN_RECORD}"`]),
      );
      // Looked up in its own table, pinned to the project.
      expect(
        directory.recordLookups.find((lookup: { model: string }): boolean => {
          return lookup.model === list.model;
        }),
      ).toEqual({
        model: list.model,
        projectId: PROJECT_ID.toString(),
        ids: [OWN_RECORD, FOREIGN_RECORD],
      });
    },
  );

  test("refuses an old default assignee team of another project, or a user who is not a member, in either spelling", async () => {
    expect(
      await refusal(
        callHook(
          ruleService.service,
          "onBeforeCreate",
          createBy({ defaultAssignToTeamId: new ObjectID(FOREIGN_TEAM) }),
        ),
      ),
    ).toBe(refusalFor([`${titleOf("defaultAssignToTeam")} "${FOREIGN_TEAM}"`]));

    expect(
      await refusal(
        callHook(
          ruleService.service,
          "onBeforeCreate",
          createBy({ defaultAssignToTeam: { _id: FOREIGN_TEAM } }),
        ),
      ),
    ).toContain(`"${FOREIGN_TEAM}"`);

    expect(
      await refusal(
        callHook(
          ruleService.service,
          "onBeforeCreate",
          createBy({ defaultAssignToUserId: new ObjectID(EVE) }),
        ),
      ),
    ).toBe(refusalFor([`${titleOf("defaultAssignToUser")} "${EVE}"`]));
  });

  test("a root write with no project is left to the project column to refuse", async () => {
    const rule: BaseModel = ruleService.newRule();
    Object.assign(rule, { episodeOwnerTeams: [team(FOREIGN_TEAM)] });

    await expect(
      callHook(ruleService.service, "onBeforeCreate", {
        data: rule,
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();
    expect(directory.recordLookups).toEqual([]);
  });

  test("a master admin with no tenant is held to the rule's own project", async () => {
    const masterAdmin: DatabaseCommonInteractionProps = {
      isMasterAdmin: true,
      userId: new ObjectID(ADA),
    };

    await expect(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy(
          { projectId: PROJECT_ID, episodeOwnerTeams: [team(FOREIGN_TEAM)] },
          masterAdmin,
        ),
      ),
    ).rejects.toThrow(`"${FOREIGN_TEAM}"`);

    // This project's team on a rule of another project is not that project's.
    await expect(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy(
          { projectId: OTHER_PROJECT_ID, episodeOwnerTeams: [team(PLATFORM)] },
          masterAdmin,
        ),
      ),
    ).rejects.toThrow(`"${PLATFORM}"`);

    expect(directory.recordLookups[1]!.projectId).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("a rule with no references - a template's, say - asks nothing", async () => {
    await callHook(
      ruleService.service,
      "onBeforeCreate",
      createBy({ name: "Group incidents from the same monitor" }),
    );

    expect(directory.recordLookups).toEqual([]);
    expect(directory.memberLookups).toEqual([]);
  });

  test("an update that adds another project's team is refused", async () => {
    storedRules = [storedRule({ episodeOwnerTeams: [team(PLATFORM)] })];

    const message: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeUpdate",
        updateBy({
          episodeOwnerTeams: [PLATFORM, FOREIGN_TEAM],
        }),
      ),
    );

    expect(message).toContain(`"${FOREIGN_TEAM}"`);
    expect(message).not.toContain(PLATFORM);
  });

  test("an update that names only the project's own records reads nothing the rule holds", async () => {
    await expect(
      callHook(
        ruleService.service,
        "onBeforeUpdate",
        updateBy({
          episodeOwnerUsers: [ADA],
          episodeOwnerTeams: [{ _id: PLATFORM }],
          ...everyListOf(OWN_RECORD),
        }),
      ),
    ).resolves.toBeDefined();

    expect(storedRead).not.toHaveBeenCalled();
  });

  test("an update saving back an owner who has since left the project goes through", async () => {
    // The dashboard sends the whole list back on every save.
    storedRules = [storedRule({ episodeOwnerUsers: [user(EVE)] })];

    await expect(
      callHook(
        ruleService.service,
        "onBeforeUpdate",
        updateBy({
          name: "Renamed",
          episodeOwnerUsers: [EVE, ADA],
        }),
      ),
    ).resolves.toBeDefined();

    expect(storedRead).toHaveBeenCalled();
  });

  test("existing rows stay editable: another project's team a rule already holds can be saved back, but brings in no other", async () => {
    storedRules = [storedRule({ episodeOwnerTeams: [team(FOREIGN_TEAM)] })];

    await expect(
      callHook(
        ruleService.service,
        "onBeforeUpdate",
        updateBy({ episodeOwnerTeams: [FOREIGN_TEAM, PLATFORM] }),
      ),
    ).resolves.toBeDefined();

    const message: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeUpdate",
        updateBy({ episodeOwnerTeams: [FOREIGN_TEAM, SECOND_FOREIGN_TEAM] }),
      ),
    );

    expect(message).toContain(`"${SECOND_FOREIGN_TEAM}"`);
    expect(message).not.toContain(`"${FOREIGN_TEAM}"`);
  });

  test("an id counts as held only when every rule the update matches holds it", async () => {
    storedRules = [
      storedRule({ episodeOwnerTeams: [team(FOREIGN_TEAM)] }),
      storedRule(
        { episodeOwnerTeams: [] },
        new ObjectID("0194c3a9-0000-4000-8000-0000000000b2"),
      ),
    ];

    await expect(
      callHook(
        ruleService.service,
        "onBeforeUpdate",
        updateBy({ episodeOwnerTeams: [FOREIGN_TEAM] }),
      ),
    ).rejects.toThrow(`"${FOREIGN_TEAM}"`);
  });

  test("an update adding a user who is not a member is refused", async () => {
    storedRules = [storedRule({})];

    const message: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeUpdate",
        updateBy({ episodeOwnerUsers: [{ _id: EVE }] }),
      ),
    );

    expect(message).toContain(`${titleOf("episodeOwnerUsers")} "${EVE}"`);
  });

  test("a root update is checked against each matched rule's own project", async () => {
    storedRules = [storedRule({})];

    const message: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeUpdate",
        updateBy({ episodeOwnerTeams: [FOREIGN_TEAM] }, { isRoot: true }),
      ),
    );

    expect(message).toContain(FOREIGN_TEAM);
    expect(teamLookups()[0]!.projectId).toBe(PROJECT_ID.toString());
  });

  test("an update that touches no references - a drag to a new place, the old pair cleared - asks nothing", async () => {
    await callHook(
      ruleService.service,
      "onBeforeUpdate",
      updateBy({ priority: 3 }),
    );
    await callHook(
      ruleService.service,
      "onBeforeUpdate",
      updateBy({
        defaultAssignToUserId: null,
        defaultAssignToTeamId: null,
        episodeOwnerUsers: [],
      }),
    );

    expect(directory.recordLookups).toEqual([]);
    expect(directory.memberLookups).toEqual([]);
    expect(storedRead).not.toHaveBeenCalled();
  });
});

describe("IncidentGroupingRuleService member role assignments", () => {
  let storedRules: Array<BaseModel> = [];

  beforeEach(() => {
    stubDirectory();
    directory = stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { Team: PROJECT_TEAMS, IncidentRole: [OWN_RECORD] },
      members: MEMBERS,
    });
    storedRules = [];

    jest
      .spyOn(IncidentGroupingRuleService, "findBy")
      .mockImplementation((async (): Promise<Array<BaseModel>> => {
        return storedRules;
      }) as never);
  });

  function createWith(assignments: Array<Record<string, string>>): unknown {
    const rule: IncidentGroupingRule = new IncidentGroupingRule();
    rule.episodeMemberRoleAssignments = assignments as never;
    return callHook(IncidentGroupingRuleService, "onBeforeCreate", {
      data: rule,
      props: USER_PROPS,
    });
  }

  function updateWith(
    assignments: Array<Record<string, string>>,
  ): Promise<unknown> {
    return callHook(IncidentGroupingRuleService, "onBeforeUpdate", {
      query: { _id: RULE_ID.toString() },
      data: { episodeMemberRoleAssignments: assignments },
      props: USER_PROPS,
      limit: 1,
      skip: 0,
    });
  }

  test("saves pairs of the project's members and roles", async () => {
    await expect(
      createWith([{ userId: ADA, incidentRoleId: OWN_RECORD }]),
    ).resolves.toBeDefined();
  });

  test("refuses someone who is not a member, or another project's role, by id only", async () => {
    let message: string = "";

    try {
      await createWith([
        { userId: EVE, incidentRoleId: OWN_RECORD },
        { userId: ADA, incidentRoleId: FOREIGN_RECORD },
      ]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe(
      `This incident grouping rule references records that are not in this project: Episode Member Role Assignments (user) "${EVE}", Episode Member Role Assignments (role) "${FOREIGN_RECORD}". Please pick values from this project and try again.`,
    );
  });

  test("an update can save back a pair the rule already holds, but not add one", async () => {
    const stored: IncidentGroupingRule = new IncidentGroupingRule();
    stored.id = RULE_ID;
    stored.projectId = PROJECT_ID;
    stored.episodeMemberRoleAssignments = [
      { userId: EVE, incidentRoleId: FOREIGN_RECORD },
    ];
    storedRules = [stored];

    await expect(
      updateWith([{ userId: EVE, incidentRoleId: FOREIGN_RECORD }]),
    ).resolves.toBeDefined();

    await expect(
      updateWith([
        { userId: EVE, incidentRoleId: FOREIGN_RECORD },
        { userId: BOB, incidentRoleId: SECOND_FOREIGN_TEAM },
      ]),
    ).rejects.toThrow(`(role) "${SECOND_FOREIGN_TEAM}"`);
  });

  test("an update that leaves the assignments alone asks nothing", async () => {
    await callHook(IncidentGroupingRuleService, "onBeforeUpdate", {
      query: { _id: RULE_ID.toString() },
      data: { name: "Renamed" },
      props: USER_PROPS,
      limit: 1,
      skip: 0,
    });

    expect(directory.recordLookups).toEqual([]);
    expect(directory.memberLookups).toEqual([]);
  });
});
