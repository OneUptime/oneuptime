import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyChildService from "../../../Server/Services/OnCallDutyPolicyChildService";
import OnCallDutyPolicyEscalationRuleResponderService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleResponderService";
import EscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import EscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import EscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  ESCALATION_RULE_SCHEDULE_INDEX,
  ESCALATION_RULE_TEAM_INDEX,
  ESCALATION_RULE_USER_INDEX,
  getPersonOnRuleAlreadyRefusal,
  getScheduleOnRuleAlreadyRefusal,
  getTeamOnRuleAlreadyRefusal,
} from "../../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RESPONDER IS ON AN ESCALATION RULE ONCE (#10411).
 *
 * The people, teams and schedules an escalation rule pages are rows of their
 * own, and nothing stopped a second row for the same one: the API, Terraform,
 * a workflow and two adds at the same moment wrote it, and each told the
 * person again that they were added. Now each service refuses a second row
 * before it is written - in words that name the responder, the rule and its
 * policy - and words an add that loses a race to the table's unique index
 * the same way. Both refusals are tagged as a unique violation of that
 * index, so Ask AI tells them from any other refusal with one check.
 *
 * No database here: the reads are stubbed, and the create pipeline around
 * the services' own code. EscalationRuleRespondersOncePostgres runs the real
 * pipeline, the index and two adds at the same moment on Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10411000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "10411000-0000-4000-8000-0000000000d1",
);
const RULE_ID: ObjectID = new ObjectID("10411000-0000-4000-8000-0000000000e1");
const ANA_ID: ObjectID = new ObjectID("10411000-0000-4000-8000-0000000000a1");
const TEAM_ID: ObjectID = new ObjectID("10411000-0000-4000-8000-0000000000b1");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "10411000-0000-4000-8000-0000000000c1",
);
const OTHER_ID: ObjectID = new ObjectID("10411000-0000-4000-8000-0000000000f1");

const RULE_WORDS: string =
  'The escalation rule "Level 1" of the on-call policy "Payments on-call"';

type ResponderModel =
  | OnCallDutyPolicyEscalationRuleUser
  | OnCallDutyPolicyEscalationRuleTeam
  | OnCallDutyPolicyEscalationRuleSchedule;

// The protected parts of a responder service the tests call.
interface ResponderServiceParts {
  readResponder: (data: BaseModel) => {
    ruleId: ObjectID;
    columns: Record<string, ObjectID | boolean>;
  } | null;
  onBeforeCreateUniqueCheck: (createBy: CreateBy<BaseModel>) => Promise<void>;
  getResponderIndexName: () => string;
}

interface Kind {
  name: string;
  service: DatabaseService<ResponderModel>;
  model: { new (): ResponderModel };
  index: string;
  // The responder's id column, and the relation of the same column.
  column: string;
  relation: string;
  responderId: ObjectID;
  // The columns the index and the check read, beside the rule's.
  columns: Record<string, ObjectID | boolean>;
  refusal: string;
}

const KINDS: Array<Kind> = [
  {
    name: "a person",
    service:
      EscalationRuleUserService as unknown as DatabaseService<ResponderModel>,
    model: OnCallDutyPolicyEscalationRuleUser,
    index: ESCALATION_RULE_USER_INDEX,
    column: "userId",
    relation: "user",
    responderId: ANA_ID,
    columns: { userId: ANA_ID },
    refusal: `${RULE_WORDS} pages Ana Lopez already, so they were not added again.`,
  },
  {
    name: "a team",
    service:
      EscalationRuleTeamService as unknown as DatabaseService<ResponderModel>,
    model: OnCallDutyPolicyEscalationRuleTeam,
    index: ESCALATION_RULE_TEAM_INDEX,
    column: "teamId",
    relation: "team",
    responderId: TEAM_ID,
    columns: { teamId: TEAM_ID },
    refusal: `${RULE_WORDS} pages the team "Platform" already, so it was not added again.`,
  },
  {
    name: "a schedule",
    service:
      EscalationRuleScheduleService as unknown as DatabaseService<ResponderModel>,
    model: OnCallDutyPolicyEscalationRuleSchedule,
    index: ESCALATION_RULE_SCHEDULE_INDEX,
    column: "onCallDutyPolicyScheduleId",
    relation: "onCallDutyPolicySchedule",
    responderId: SCHEDULE_ID,
    columns: {
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      pageNextInRotation: false,
    },
    refusal: `${RULE_WORDS} pages whoever is on call in the on-call schedule "Primary" already, so the schedule was not added again.`,
  },
];

function parts(
  service: DatabaseService<ResponderModel>,
): ResponderServiceParts {
  return service as unknown as ResponderServiceParts;
}

// The row a create names: the rule, and the responder by its id column.
function row(kind: Kind, fields: Record<string, unknown> = {}): ResponderModel {
  const data: ResponderModel = new kind.model();

  data.setColumnValue("projectId", PROJECT_ID);
  data.setColumnValue("onCallDutyPolicyId", POLICY_ID);
  data.setColumnValue("onCallDutyPolicyEscalationRuleId", RULE_ID);
  data.setColumnValue(kind.column, kind.responderId);

  for (const [column, value] of Object.entries(fields)) {
    data.setColumnValue(column, value as never);
  }

  return data;
}

function asPerson(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: OTHER_ID,
    userType: UserType.User,
  };
}

function asApiKey(): DatabaseCommonInteractionProps {
  return { tenantId: PROJECT_ID, userType: UserType.API };
}

/*
 * What Postgres answers an INSERT the table's unique index refused, as the
 * driver hands it to TypeORM.
 */
function uniqueViolation(constraint: string, table: string): Error {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    {
      code: "23505",
      constraint: constraint,
      table: table,
      detail: `Key ("onCallDutyPolicyEscalationRuleId", "x")=(a, b) already exists.`,
    },
  );
}

let countBy: jest.SpiedFunction<
  (this: DatabaseService<BaseModel>, data: unknown) => Promise<PositiveNumber>
>;
let ruleReads: number;

beforeEach(() => {
  ruleReads = 0;

  // How many rows of the responder the rule has: none, unless a test says.
  countBy = jest
    .spyOn(DatabaseService.prototype, "countBy")
    .mockResolvedValue(new PositiveNumber(0)) as never;

  // The rule a refusal names, and its policy.
  jest
    .spyOn(DatabaseService.prototype, "findOneBy")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      request: FindOneBy<BaseModel>,
    ): Promise<BaseModel | null> {
      if (this.modelType !== OnCallDutyPolicyEscalationRule) {
        throw new Error(`${this.modelType.name} is not read in these tests.`);
      }

      ruleReads++;

      expect(request.props.isRoot).toBe(true);

      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.id = RULE_ID;
      rule.projectId = PROJECT_ID;
      rule.name = "Level 1";
      rule.order = 1;
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.name = "Payments on-call";
      rule.onCallDutyPolicy = policy;

      return rule;
    });

  // The responders by name, as OneUptime reads them for the project.
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.id = ANA_ID;
    user.name = new Name("Ana Lopez");
    user.email = new Email("ana@acme.example");
    return user;
  }) as never);
  jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockResolvedValue(new Map<string, WithheldProfile>());
  jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
    const team: Team = new Team();
    team.id = TEAM_ID;
    team.name = "Platform";
    return team;
  }) as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
    .mockImplementation((async () => {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule.id = SCHEDULE_ID;
      schedule.name = "Primary";
      return schedule;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the words that refuse a second row", () => {
  const rule: { ruleName: string; policyName: string } = {
    ruleName: "Level 1",
    policyName: "Payments on-call",
  };

  test("name the responder, the rule and its policy, and say nothing was added", () => {
    expect(getPersonOnRuleAlreadyRefusal({ rule, person: "Ana Lopez" })).toBe(
      `${RULE_WORDS} pages Ana Lopez already, so they were not added again.`,
    );
    expect(getTeamOnRuleAlreadyRefusal({ rule, team: "Platform" })).toBe(
      `${RULE_WORDS} pages the team "Platform" already, so it was not added again.`,
    );
    expect(
      getScheduleOnRuleAlreadyRefusal({
        rule,
        schedule: "Primary",
        pagesNextInRotation: false,
      }),
    ).toBe(
      `${RULE_WORDS} pages whoever is on call in the on-call schedule "Primary" already, so the schedule was not added again.`,
    );
    expect(
      getScheduleOnRuleAlreadyRefusal({
        rule,
        schedule: "Primary",
        pagesNextInRotation: true,
      }),
    ).toBe(
      `${RULE_WORDS} pages the next person in the rotation of the on-call schedule "Primary" already, so the schedule was not added again.`,
    );
  });

  test("a rule that could not be read, and a name that is blank, are still a sentence", () => {
    expect(
      getPersonOnRuleAlreadyRefusal({ rule: null, person: "ana@acme.example" }),
    ).toBe(
      "This escalation rule pages ana@acme.example already, so they were not added again.",
    );
    expect(
      getPersonOnRuleAlreadyRefusal({
        rule: { ruleName: "Level 1", policyName: " " },
        person: "  ",
      }),
    ).toBe(
      "This escalation rule pages this person already, so they were not added again.",
    );
    expect(getTeamOnRuleAlreadyRefusal({ rule: null, team: "" })).toBe(
      "This escalation rule pages this team already, so it was not added again.",
    );
    expect(
      getScheduleOnRuleAlreadyRefusal({
        rule: null,
        schedule: "",
        pagesNextInRotation: false,
      }),
    ).toBe(
      "This escalation rule pages whoever is on call in this on-call schedule already, so the schedule was not added again.",
    );
  });
});

describe("each responder service", () => {
  test("is a responder service, so an on-call child service still", () => {
    for (const kind of KINDS) {
      expect(kind.service).toBeInstanceOf(
        OnCallDutyPolicyEscalationRuleResponderService,
      );
      expect(kind.service).toBeInstanceOf(OnCallDutyPolicyChildService);
      expect(parts(kind.service).getResponderIndexName()).toBe(kind.index);
    }
  });
});

describe.each(KINDS)("$name the rule pages already", (kind: Kind) => {
  test("is read from the row under either name of each reference", () => {
    const responder: ReturnType<ResponderServiceParts["readResponder"]> = parts(
      kind.service,
    ).readResponder(row(kind));

    expect(responder?.ruleId.toString()).toBe(RULE_ID.toString());
    expect(responder?.columns).toEqual(kind.columns);

    // Named by the relations only.
    const byRelation: ResponderModel = new kind.model();
    byRelation.setColumnValue("onCallDutyPolicyEscalationRule", {
      _id: RULE_ID.toString(),
    } as never);
    byRelation.setColumnValue(kind.relation, {
      _id: kind.responderId.toString(),
    } as never);

    expect(
      parts(kind.service)
        .readResponder(byRelation)
        ?.columns[kind.column]?.toString(),
    ).toBe(kind.responderId.toString());

    // Two names of one reference that disagree are refused, not guessed.
    const disagreeing: ResponderModel = row(kind);
    disagreeing.setColumnValue(kind.relation, {
      _id: OTHER_ID.toString(),
    } as never);

    expect(() => {
      parts(kind.service).readResponder(disagreeing);
    }).toThrow(BadDataException);
  });

  test("a row that names no responder, or no rule, is left to the create's own checks", async () => {
    const noResponder: ResponderModel = row(kind);
    noResponder.setColumnValue(kind.column, undefined as never);
    const noRule: ResponderModel = row(kind);
    noRule.setColumnValue(
      "onCallDutyPolicyEscalationRuleId",
      undefined as never,
    );

    expect(parts(kind.service).readResponder(noResponder)).toBeNull();
    expect(parts(kind.service).readResponder(noRule)).toBeNull();

    await parts(kind.service).onBeforeCreateUniqueCheck({
      data: noResponder,
      props: asPerson(),
    } as CreateBy<BaseModel>);

    expect(countBy).not.toHaveBeenCalled();
  });

  test.each([
    ["the person", asPerson],
    ["an API key", asApiKey],
  ])(
    "a second create, as %s, is refused before it is written, in words naming the responder and the rule",
    async (_caller: string, props: () => DatabaseCommonInteractionProps) => {
      countBy.mockResolvedValue(new PositiveNumber(1));

      const refused: unknown = await parts(kind.service)
        .onBeforeCreateUniqueCheck({
          data: row(kind),
          props: props(),
        } as CreateBy<BaseModel>)
        .catch((error: unknown) => {
          return error;
        });

      expect(refused).toBeInstanceOf(BadDataException);
      expect((refused as Error).message).toBe(kind.refusal);
      // Tagged as the index's own refusal, whichever layer refused it.
      expect(PostgresErrorTranslator.isUniqueViolation(refused)).toBe(true);
      expect(
        PostgresErrorTranslator.isUniqueViolationOf(refused, kind.index),
      ).toBe(true);

      // The rows the index holds: the rule's, of the responder, not deleted.
      expect(countBy).toHaveBeenCalledTimes(1);
      const count: { query: Record<string, unknown>; props: unknown } = countBy
        .mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: unknown;
      };
      expect(count.query).toEqual({
        onCallDutyPolicyEscalationRuleId: RULE_ID,
        ...kind.columns,
      });
      expect(count.props).toEqual({ isRoot: true });
    },
  );

  test("a responder the rule does not have yet passes the check", async () => {
    await expect(
      parts(kind.service).onBeforeCreateUniqueCheck({
        data: row(kind),
        props: asPerson(),
      } as CreateBy<BaseModel>),
    ).resolves.toBeUndefined();
    expect(ruleReads).toBe(0);
  });

  test("an add that lost a race to the index is refused in the same words", async () => {
    // The INSERT the index refused, as the create pipeline translates it.
    jest
      .spyOn(OnCallDutyPolicyChildService.prototype, "create")
      .mockRejectedValue(
        PostgresErrorTranslator.translate(
          uniqueViolation(kind.index, kind.service.getModel().tableName!),
        ) as never,
      );

    const refused: unknown = await kind.service
      .create({ data: row(kind), props: asApiKey() })
      .catch((error: unknown) => {
        return error;
      });

    expect(refused).toBeInstanceOf(BadDataException);
    expect((refused as Error).message).toBe(kind.refusal);
    expect(
      PostgresErrorTranslator.isUniqueViolationOf(refused, kind.index),
    ).toBe(true);
  });

  test("the driver's own error, not yet translated, is worded the same way", async () => {
    jest
      .spyOn(OnCallDutyPolicyChildService.prototype, "create")
      .mockRejectedValue(
        uniqueViolation(
          kind.index,
          kind.service.getModel().tableName!,
        ) as never,
      );

    await expect(
      kind.service.create({ data: row(kind), props: asPerson() }),
    ).rejects.toThrow(kind.refusal);
  });

  test("the check's own refusal is thrown as it is, not worded again", async () => {
    const own: BadDataException =
      PostgresErrorTranslator.createUniqueViolationException(
        kind.refusal,
        kind.index,
      );

    jest
      .spyOn(OnCallDutyPolicyChildService.prototype, "create")
      .mockImplementation(async function (
        this: DatabaseService<BaseModel>,
      ): Promise<BaseModel> {
        // As onBeforeCreateUniqueCheck refuses inside the pipeline.
        countBy.mockResolvedValue(new PositiveNumber(1));
        await parts(
          this as unknown as DatabaseService<ResponderModel>,
        ).onBeforeCreateUniqueCheck({
          data: row(kind),
          props: asPerson(),
        } as CreateBy<BaseModel>);
        throw own;
      });

    const refused: unknown = await kind.service
      .create({ data: row(kind), props: asPerson() })
      .catch((error: unknown) => {
        return error;
      });

    expect((refused as Error).message).toBe(kind.refusal);
    // Read once, by the check: create() added no read of its own.
    expect(ruleReads).toBe(1);
  });

  test("any other failure is thrown as it came", async () => {
    const otherIndex: Error = PostgresErrorTranslator.translate(
      uniqueViolation("IDX_some_other_index", "Somewhere"),
    ) as Error;
    const notUnique: Error = new BadDataException(
      "An on-call policy is required.",
    );

    for (const failure of [otherIndex, notUnique]) {
      jest
        .spyOn(OnCallDutyPolicyChildService.prototype, "create")
        .mockRejectedValue(failure as never);

      await expect(
        kind.service.create({ data: row(kind), props: asPerson() }),
      ).rejects.toBe(failure);
    }

    expect(ruleReads).toBe(0);
  });
});

describe("a schedule is a responder once for each way the rule pages it", () => {
  test("whoever is on call and the next in its rotation are two responders", () => {
    const schedule: Kind = KINDS[2]!;

    expect(
      parts(schedule.service).readResponder(row(schedule))?.columns,
    ).toEqual({
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      pageNextInRotation: false,
    });
    expect(
      parts(schedule.service).readResponder(
        row(schedule, { pageNextInRotation: true }),
      )?.columns,
    ).toEqual({
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      pageNextInRotation: true,
    });
  });

  test("the next in its rotation, there already, is refused in its own words", async () => {
    countBy.mockResolvedValue(new PositiveNumber(1));

    await expect(
      parts(KINDS[2]!.service).onBeforeCreateUniqueCheck({
        data: row(KINDS[2]!, { pageNextInRotation: true }),
        props: asPerson(),
      } as CreateBy<BaseModel>),
    ).rejects.toThrow(
      `${RULE_WORDS} pages the next person in the rotation of the on-call schedule "Primary" already, so the schedule was not added again.`,
    );
  });
});

describe("a rule created with a responder twice in its lists", () => {
  test("adds each once: the second would be refused after the rule is written", async () => {
    const written: Array<string> = [];
    const record: (
      kind: string,
    ) => (createBy: { data: BaseModel }) => Promise<BaseModel> = (
      kind: string,
    ) => {
      return async (createBy: { data: BaseModel }): Promise<BaseModel> => {
        const data: Record<string, unknown> =
          createBy.data as unknown as Record<string, unknown>;
        written.push(
          `${kind} ${String(data["userId"] || data["teamId"] || data["onCallDutyPolicyScheduleId"])}${data["pageNextInRotation"] ? " next" : ""}`,
        );
        return createBy.data;
      };
    };

    jest
      .spyOn(EscalationRuleUserService, "create")
      .mockImplementation(record("user") as never);
    jest
      .spyOn(EscalationRuleTeamService, "create")
      .mockImplementation(record("team") as never);
    jest
      .spyOn(EscalationRuleScheduleService, "create")
      .mockImplementation(record("schedule") as never);

    // As a request's miscDataProps hand them over: ids and strings alike.
    await EscalationRuleService.addUsersTeamsAndSchedules(
      PROJECT_ID,
      RULE_ID,
      POLICY_ID,
      [
        ANA_ID,
        ANA_ID.toString().toUpperCase() as unknown as ObjectID,
        OTHER_ID,
      ],
      [TEAM_ID, new ObjectID(TEAM_ID.toString())],
      [SCHEDULE_ID, SCHEDULE_ID],
      asPerson(),
      [SCHEDULE_ID, ` ${SCHEDULE_ID.toString()} ` as unknown as ObjectID],
    );

    expect(written).toEqual([
      `user ${ANA_ID.toString()}`,
      `user ${OTHER_ID.toString()}`,
      `team ${TEAM_ID.toString()}`,
      // Whoever is on call, and the next in the rotation: two responders.
      `schedule ${SCHEDULE_ID.toString()}`,
      `schedule ${SCHEDULE_ID.toString()} next`,
    ]);
  });
});

describe("a person is named as the project knows them", () => {
  test("someone only invited, by the name typed for them (#9823)", async () => {
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockResolvedValue(
        new Map<string, WithheldProfile>([
          [
            ANA_ID.toString(),
            {
              inviteeName: "Ana from Payments",
              inviteeEmail: "ana@acme.example",
            } as unknown as WithheldProfile,
          ],
        ]),
      );
    countBy.mockResolvedValue(new PositiveNumber(1));

    await expect(
      parts(KINDS[0]!.service).onBeforeCreateUniqueCheck({
        data: row(KINDS[0]!),
        props: asPerson(),
      } as CreateBy<BaseModel>),
    ).rejects.toThrow(
      `${RULE_WORDS} pages Ana from Payments already, so they were not added again.`,
    );
    expect(
      (
        PendingInviteeProfiles.readWithheldProfilesInProject as unknown as jest.Mock
      ).mock.calls[0]![0],
    ).toEqual({ userIds: [ANA_ID.toString()], projectId: PROJECT_ID });
  });
});
