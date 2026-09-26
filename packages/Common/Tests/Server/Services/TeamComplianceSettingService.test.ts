import TeamComplianceSettingService from "../../../Server/Services/TeamComplianceSettingService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import TeamComplianceSetting from "../../../Models/DatabaseModels/TeamComplianceSetting";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A team may hold at most one compliance setting per rule type: two rows for
 * the same rule would leave the compliance check with no defined answer. The
 * guard lives in onBeforeCreate, and these tests hold it to refusing loudly
 * (BadDataException naming the rule type), to scoping the duplicate lookup by
 * team *and* rule type -- so the same rule on another team is still allowed --
 * and to running that lookup as root, since the row that already exists may be
 * one the caller cannot see.
 */

type OnBeforeCreateFunction = (
  createBy: CreateBy<TeamComplianceSetting>,
) => Promise<OnCreate<TeamComplianceSetting>>;

const TEAM_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_TYPE: string = "RequireTwoFactorAuth";

function onBeforeCreate(
  createBy: CreateBy<TeamComplianceSetting>,
): Promise<OnCreate<TeamComplianceSetting>> {
  return (
    TeamComplianceSettingService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate(createBy);
}

function buildCreateBy(data: {
  teamId?: ObjectID;
  ruleType?: string;
}): CreateBy<TeamComplianceSetting> {
  const setting: TeamComplianceSetting = new TeamComplianceSetting();
  if (data.teamId) {
    setting.teamId = data.teamId;
  }
  if (data.ruleType) {
    (setting as unknown as Record<string, unknown>)["ruleType"] = data.ruleType;
  }
  return {
    data: setting,
    props: { isRoot: true },
  } as CreateBy<TeamComplianceSetting>;
}

function mockExisting(
  existing: TeamComplianceSetting | null,
): jest.SpyInstance {
  return jest
    .spyOn(TeamComplianceSettingService, "findOneBy")
    .mockResolvedValue(existing as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TeamComplianceSettingService onBeforeCreate", () => {
  test("allows the first setting for a team and rule type", async () => {
    mockExisting(null);

    const createBy: CreateBy<TeamComplianceSetting> = buildCreateBy({
      teamId: TEAM_ID,
      ruleType: RULE_TYPE,
    });
    const result: OnCreate<TeamComplianceSetting> =
      await onBeforeCreate(createBy);

    expect(result.createBy).toBe(createBy);
    expect(result.carryForward).toBeNull();
  });

  test("refuses a second setting for the same team and rule type", async () => {
    const existing: TeamComplianceSetting = new TeamComplianceSetting();
    existing._id = "33333333-3333-4333-8333-333333333333";
    mockExisting(existing);

    await expect(
      onBeforeCreate(buildCreateBy({ teamId: TEAM_ID, ruleType: RULE_TYPE })),
    ).rejects.toThrow(BadDataException);
  });

  test("the refusal names the rule type, so the form can point at it", async () => {
    const existing: TeamComplianceSetting = new TeamComplianceSetting();
    existing._id = "33333333-3333-4333-8333-333333333333";
    mockExisting(existing);

    await expect(
      onBeforeCreate(buildCreateBy({ teamId: TEAM_ID, ruleType: RULE_TYPE })),
    ).rejects.toThrow(
      `A compliance setting for rule type "${RULE_TYPE}" already exists for this team.`,
    );
  });

  test("the duplicate lookup is keyed on both the team and the rule type", async () => {
    const findSpy: jest.SpyInstance = mockExisting(null);

    await onBeforeCreate(
      buildCreateBy({ teamId: TEAM_ID, ruleType: RULE_TYPE }),
    );

    const findArgs: Record<string, unknown> = findSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(findArgs["query"]).toEqual({
      teamId: TEAM_ID,
      ruleType: RULE_TYPE,
    });
    // Only the id is needed to know whether one exists.
    expect(findArgs["select"]).toEqual({ _id: true });
  });

  test("the lookup runs as root: the existing row may be invisible to the caller", async () => {
    const findSpy: jest.SpyInstance = mockExisting(null);

    await onBeforeCreate(
      buildCreateBy({ teamId: TEAM_ID, ruleType: RULE_TYPE }),
    );

    const findArgs: Record<string, unknown> = findSpy.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(findArgs["props"]).toEqual({ isRoot: true });
  });

  test("the same rule type on a different team is a different row", async () => {
    const findSpy: jest.SpyInstance = jest
      .spyOn(TeamComplianceSettingService, "findOneBy")
      .mockImplementation(((
        args: Record<string, unknown>,
      ): Promise<unknown> => {
        const query: Record<string, unknown> = args["query"] as Record<
          string,
          unknown
        >;
        // Only the first team already holds this rule.
        if (query["teamId"] === TEAM_ID) {
          const existing: TeamComplianceSetting = new TeamComplianceSetting();
          existing._id = "33333333-3333-4333-8333-333333333333";
          return Promise.resolve(existing);
        }
        return Promise.resolve(null);
      }) as never);

    await expect(
      onBeforeCreate(buildCreateBy({ teamId: TEAM_ID, ruleType: RULE_TYPE })),
    ).rejects.toThrow(BadDataException);

    await expect(
      onBeforeCreate(
        buildCreateBy({ teamId: OTHER_TEAM_ID, ruleType: RULE_TYPE }),
      ),
    ).resolves.toBeDefined();

    expect(findSpy).toHaveBeenCalledTimes(2);
  });

  test("a different rule type on the same team is allowed", async () => {
    const findSpy: jest.SpyInstance = jest
      .spyOn(TeamComplianceSettingService, "findOneBy")
      .mockImplementation(((
        args: Record<string, unknown>,
      ): Promise<unknown> => {
        const query: Record<string, unknown> = args["query"] as Record<
          string,
          unknown
        >;
        if (query["ruleType"] === RULE_TYPE) {
          const existing: TeamComplianceSetting = new TeamComplianceSetting();
          existing._id = "33333333-3333-4333-8333-333333333333";
          return Promise.resolve(existing);
        }
        return Promise.resolve(null);
      }) as never);

    await expect(
      onBeforeCreate(
        buildCreateBy({ teamId: TEAM_ID, ruleType: "RequirePhoneNumber" }),
      ),
    ).resolves.toBeDefined();
    expect(findSpy).toHaveBeenCalledTimes(1);
  });
});
