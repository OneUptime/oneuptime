import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
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
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import GroupingRuleEpisodeOwners from "../../../Server/Utils/Rules/GroupingRuleEpisodeOwners";
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
 *     project or a user with no membership in it - on an update, only the
 *     owners the update adds, so a rule naming someone who has left can
 *     still be edited. Errors echo ids, never names.
 *
 * Every service the paths touch is stubbed at its public method, so this
 * runs without a database, with BILLING_ENABLED on or off.
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

// The ids a QueryHelper.any(...) operator asks for.
function idsIn(value: unknown): Array<string> {
  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    value as { objectLiteralParameters?: Record<string, unknown> };

  const ids: unknown = Object.values(operator.objectLiteralParameters || {})[0];

  return ((ids as Array<unknown>) || []).map((id: unknown): string => {
    return String(id);
  });
}

type TeamFindBy = (data: {
  query: Record<string, unknown>;
}) => Promise<Array<Team>>;

let teamQueries: Array<Record<string, unknown>> = [];
let memberQueries: Array<Record<string, unknown>> = [];

/*
 * The directory, answered the way the database would: a team only when it
 * is the queried project's, a membership only in the queried project.
 */
function stubDirectory(): void {
  teamQueries = [];
  memberQueries = [];

  jest.spyOn(TeamService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<Team>> => {
    teamQueries.push(data.query);

    if (String(data.query["projectId"]) !== PROJECT_ID.toString()) {
      return [];
    }

    return idsIn(data.query["_id"])
      .filter((id: string): boolean => {
        return PROJECT_TEAMS.includes(id.toLowerCase());
      })
      .map((id: string): Team => {
        // Postgres answers with its own, lower-case spelling.
        return team(id.toLowerCase());
      });
  }) as TeamFindBy as never);

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamMember>> => {
    memberQueries.push(data.query);

    if (String(data.query["projectId"]) !== PROJECT_ID.toString()) {
      return [];
    }

    return idsIn(data.query["userId"])
      .filter((id: string): boolean => {
        return MEMBERS.includes(id.toLowerCase());
      })
      .map((id: string): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.userId = new ObjectID(id.toLowerCase());
        return member;
      });
  }) as never);

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

  test("adds only the project's own teams, read once and pinned to the project", async () => {
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    const rule: IncidentGroupingRule | AlertGroupingRule = engine.newRule();
    rule.episodeOwnerTeams = [team(FOREIGN_TEAM), team(DATABASE)];

    await engine.createNewEpisode(engine.newRecord(), rule);

    expect(ownerIds(writtenTeams, "teamId")).toEqual([DATABASE]);
    expect(teamQueries).toHaveLength(1);
    expect(String(teamQueries[0]!["projectId"])).toBe(PROJECT_ID.toString());
    expect(idsIn(teamQueries[0]!["_id"])).toEqual([FOREIGN_TEAM, DATABASE]);

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
      .spyOn(TeamService, "findBy")
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

    expect(teamQueries).toEqual([]);
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
    expect(String(teamQueries[0]!["projectId"])).toBe(PROJECT_ID.toString());
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

    expect(teamQueries).toHaveLength(1);
    expect(String(teamQueries[0]!["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("never sends the database an id that is not one", async () => {
    await expect(
      GroupingRuleEpisodeOwners.getTeamIdsInProject({
        projectId: PROJECT_ID,
        teamIds: ["not-a-uuid", "' OR 1=1 --"],
      }),
    ).resolves.toEqual([]);
    await expect(
      GroupingRuleEpisodeOwners.getUserIdsInProject({
        projectId: PROJECT_ID,
        userIds: ["not-a-uuid"],
      }),
    ).resolves.toEqual([]);

    expect(teamQueries).toEqual([]);
    expect(memberQueries).toEqual([]);
  });

  test("counts a user with a membership in the project, pinned to it", async () => {
    await expect(
      GroupingRuleEpisodeOwners.getUserIdsInProject({
        projectId: PROJECT_ID,
        userIds: [EVE, BOB],
      }),
    ).resolves.toEqual([BOB]);

    expect(String(memberQueries[0]!["projectId"])).toBe(PROJECT_ID.toString());
    await expect(
      GroupingRuleEpisodeOwners.getUserIdsInProject({
        projectId: OTHER_PROJECT_ID,
        userIds: [BOB],
      }),
    ).resolves.toEqual([]);
  });
});

interface RuleServiceCase {
  label: string;
  service: DatabaseService<BaseModel>;
  subject: string;
  newRule: () => BaseModel;
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
  },
  {
    label: "AlertGroupingRuleService",
    service: AlertGroupingRuleService as unknown as DatabaseService<BaseModel>,
    subject: "alert grouping rule",
    newRule: (): BaseModel => {
      return new AlertGroupingRule();
    },
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

describe.each(RULE_SERVICES)("$label", (ruleService: RuleServiceCase) => {
  let storedRules: Array<BaseModel> = [];

  beforeEach(() => {
    stubDirectory();
    storedRules = [];

    // What the rules an update matches already hold (getHeldRelationIds).
    jest
      .spyOn(ruleService.service, "findBy")
      .mockImplementation((async (): Promise<Array<BaseModel>> => {
        return storedRules;
      }) as never);
  });

  function createBy(values: Record<string, unknown>): CreateBy<BaseModel> {
    const rule: BaseModel = ruleService.newRule();
    Object.assign(rule, values);
    return { data: rule, props: USER_PROPS } as CreateBy<BaseModel>;
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

  function storedRule(values: Record<string, unknown>): BaseModel {
    const rule: BaseModel = ruleService.newRule();
    rule.id = RULE_ID;
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

  test("saves a rule whose owners are the project's own people and teams", async () => {
    await expect(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy({
          episodeOwnerUsers: [user(ADA)],
          episodeOwnerTeams: [team(PLATFORM)],
        }),
      ),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
  });

  test("refuses another project's team, naming it by id only", async () => {
    const message: string = await refusal(
      callHook(
        ruleService.service,
        "onBeforeCreate",
        createBy({ episodeOwnerTeams: [team(FOREIGN_TEAM), team(PLATFORM)] }),
      ),
    );

    expect(message).toBe(
      `This ${ruleService.subject} names a team that is not in this project: "${FOREIGN_TEAM}". Please pick episode owners from this project and try again.`,
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

    expect(message).toBe(
      `This ${ruleService.subject} names a team that is not in this project: "${FOREIGN_TEAM}". It also names a user who is not a member of this project: "${EVE}". Please pick episode owners from this project and try again.`,
    );
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
    expect(teamQueries).toEqual([]);
  });

  test("a rule with no owners - a template's, say - asks nothing", async () => {
    await callHook(
      ruleService.service,
      "onBeforeCreate",
      createBy({ name: "Group incidents from the same monitor" }),
    );

    expect(teamQueries).toEqual([]);
    expect(memberQueries).toEqual([]);
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

    // Only the owner the update adds was looked up.
    expect(idsIn(memberQueries[0]!["userId"])).toEqual([ADA]);
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

    expect(message).toContain(`not a member of this project: "${EVE}"`);
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
    expect(String(teamQueries[0]!["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("an update that touches no owners - a drag to a new place, the old pair cleared - asks nothing", async () => {
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

    expect(teamQueries).toEqual([]);
    expect(memberQueries).toEqual([]);
  });
});
