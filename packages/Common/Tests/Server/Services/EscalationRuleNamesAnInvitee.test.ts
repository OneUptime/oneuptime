import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import ObjectID from "../../../Types/ObjectID";
import { readQueryValues } from "../Utils/OnCall/EscalationRuleReachWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONE RULE FOR WHO AN ESCALATION RULE MAY NAME, WHOEVER WRITES IT (#10412).
 *
 * The Dashboard's escalation rule form and guided on-call setup, the API
 * (and the CLI and Terraform on it), Ask AI and the MCP server all write a
 * rule's person through OnCallDutyPolicyEscalationRuleUserService.create,
 * as the caller - and each write is held to the same check before it is
 * made (ProjectReferencesService -> ProjectReferenceCheck): the person must
 * hold a membership of the project, an invitation still waiting included,
 * which is what the Dashboard's people picker offers. Someone invited may
 * be named, and is paged once they join (EscalationRuleReach; the hooks are
 * EscalationRuleTellsOnce's); nobody else may be, so no client can put a
 * stranger's account - and through it any address - on a rule.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10412000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "10412000-0000-4000-8000-0000000000d1",
);
const RULE_ID: ObjectID = new ObjectID("10412000-0000-4000-8000-0000000000e1");
const CALLER_ID: ObjectID = new ObjectID(
  "10412000-0000-4000-8000-0000000000c0",
);
// Invited to the project, and not joined yet.
const IVY: ObjectID = new ObjectID("10412000-0000-4000-8000-0000000000a4");
// A member.
const ANA: ObjectID = new ObjectID("10412000-0000-4000-8000-0000000000a1");
// An account that holds no membership of the project at all.
const STRANGER: ObjectID = new ObjectID("10412000-0000-4000-8000-0000000000ff");

// The project's memberships: Ana's accepted, Ivy's invitation waiting.
const MEMBERSHIPS: Array<{ userId: ObjectID; accepted: boolean }> = [
  { userId: ANA, accepted: true },
  { userId: IVY, accepted: false },
];

let membershipQueries: Array<Record<string, unknown>>;

// The project's own records, read back by id as the check reads them.
function answerIdsInProject<T extends BaseModel>(modelType: {
  new (): T;
}): void {
  jest
    .spyOn(
      ProjectScopedReferenceValidator.getLookupService(
        modelType,
      ) as DatabaseService<T>,
      "findBy",
    )
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<T>> => {
      return (readQueryValues(args.query["_id"]) || []).map((id: string): T => {
        const model: T = new modelType();
        model._id = id;
        (model as unknown as { projectId: ObjectID }).projectId = PROJECT_ID;
        return model;
      });
    }) as never);
}

beforeEach(() => {
  membershipQueries = [];

  answerIdsInProject(OnCallDutyPolicy);
  answerIdsInProject(OnCallDutyPolicyEscalationRule);

  jest
    .spyOn(
      ProjectScopedReferenceValidator.getLookupService(TeamMember),
      "findBy",
    )
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<TeamMember>> => {
      membershipQueries.push(args.query);
      const asked: Array<string> = readQueryValues(args.query["userId"]) || [];

      return MEMBERSHIPS.filter((membership: { userId: ObjectID }): boolean => {
        return asked.includes(membership.userId.toString().toLowerCase());
      }).map((membership: { userId: ObjectID; accepted: boolean }) => {
        const row: TeamMember = new TeamMember();
        row.userId = membership.userId;
        row.projectId = PROJECT_ID;
        row.hasAcceptedInvitation = membership.accepted;
        return row;
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A person named on the rule, as a client's create hands it over.
function naming(
  userId: ObjectID,
): CreateBy<OnCallDutyPolicyEscalationRuleUser> {
  const row: OnCallDutyPolicyEscalationRuleUser =
    new OnCallDutyPolicyEscalationRuleUser();
  row.projectId = PROJECT_ID;
  row.onCallDutyPolicyId = POLICY_ID;
  row.onCallDutyPolicyEscalationRuleId = RULE_ID;
  row.userId = userId;

  return {
    data: row,
    props: { tenantId: PROJECT_ID, userId: CALLER_ID },
  };
}

async function check(userId: ObjectID): Promise<void> {
  await ProjectReferenceCheck.validateCreate({
    service:
      OnCallDutyPolicyEscalationRuleUserService as unknown as DatabaseService<OnCallDutyPolicyEscalationRuleUser>,
    createBy: naming(userId),
  });
}

describe("who an escalation rule may name, for every client", () => {
  test("someone whose invitation still waits: named, to be paged once they join", async () => {
    await expect(check(IVY)).resolves.toBeUndefined();
  });

  test("a member, as ever", async () => {
    await expect(check(ANA)).resolves.toBeUndefined();
  });

  test("an account with no membership of the project is refused, before anything is written", async () => {
    await expect(check(STRANGER)).rejects.toThrow("not in this project");
  });

  test("the check reads the project's memberships, an invitation included, and no other project's", async () => {
    await check(IVY);

    expect(membershipQueries).toHaveLength(1);
    expect(String(membershipQueries[0]!["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    // Any membership row: not only an accepted one.
    expect(Object.keys(membershipQueries[0]!).sort()).toEqual([
      "projectId",
      "userId",
    ]);
  });
});
