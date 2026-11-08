import OnBehalfOfProps from "../../../../../Server/Utils/AuditLog/OnBehalfOfProps";
import { RuleRunWriteProps } from "../../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WriteSource from "../../../../../Types/BaseDatabase/WriteSource";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../../Types/ObjectID";
import UserType from "../../../../../Types/UserType";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PROPS A RULE'S WRITES ARE MADE WITH (issues #6300, #6323, #6324).
 *
 * A rule writes as root, whoever runs it. Run now names who ran it, so its
 * writes carry them and the audit log credits them; a rule applied as a
 * record is created names nobody, and its writes are OneUptime's own, a
 * system event. A write its service takes only in a project - an auto
 * import rule's monitors - carries the rule's project as well, and nothing
 * else of the request.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const KEY_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

// Every member a request's props can carry, with a value of its own.
const EVERY_MEMBER: Readonly<Record<string, unknown>> = {
  userId: USER_ID,
  userGlobalAccessPermission: { globalPermissions: [] },
  userTenantAccessPermission: {},
  userType: UserType.User,
  tenantId: PROJECT_ID,
  isRoot: false,
  isMultiTenantRequest: true,
  ignoreHooks: true,
  currentPlan: PlanType.Enterprise,
  isSubscriptionUnpaid: true,
  isMasterAdmin: true,
  userTeamIds: [PROJECT_ID],
  apiKeyId: KEY_ID,
  apiKeyName: "Deploy bot",
  mcpOAuthGrantId: new ObjectID("44444444-4444-4444-8444-444444444444"),
  mcpClientName: "Claude",
  workflowId: new ObjectID("55555555-5555-4555-8555-555555555555"),
  workflowName: "Nightly",
  writeSource: WriteSource.AskAi,
  isReadOnlyCredential: true,
  requestOrigin: { ipAddress: "203.0.113.7" },
};

describe("RuleRunWriteProps", () => {
  test("a rule applied as a record is created writes as OneUptime's own", () => {
    expect(RuleRunWriteProps.get(undefined)).toEqual({ isRoot: true });
    expect(RuleRunWriteProps.get()).toEqual({ isRoot: true });
  });

  test("Run now writes as root, carrying the person who ran it and nothing they may do", () => {
    expect(
      RuleRunWriteProps.get({
        tenantId: PROJECT_ID,
        userId: USER_ID,
        userType: UserType.User,
        userTenantAccessPermission: {},
        isMasterAdmin: false,
      }),
    ).toEqual({ isRoot: true, userId: USER_ID, userType: UserType.User });
  });

  test("an API key that runs a rule is the key, by id and name", () => {
    expect(
      RuleRunWriteProps.get({
        tenantId: PROJECT_ID,
        userType: UserType.API,
        apiKeyId: KEY_ID,
        apiKeyName: "Deploy bot",
      }),
    ).toEqual({
      isRoot: true,
      userType: UserType.API,
      apiKeyId: KEY_ID,
      apiKeyName: "Deploy bot",
    });
  });

  test("a run that names nobody is OneUptime's own, as root", () => {
    expect(RuleRunWriteProps.get({})).toEqual({ isRoot: true });
    expect(RuleRunWriteProps.get({ isRoot: true })).toEqual({ isRoot: true });
    expect(RuleRunWriteProps.get({ tenantId: PROJECT_ID })).toEqual({
      isRoot: true,
    });
  });

  test("never hands back what it was given, nor changes it", () => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
    };

    const written: DatabaseCommonInteractionProps =
      RuleRunWriteProps.get(props);

    expect(written).not.toBe(props);
    expect(props).toEqual({
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
    });
    expect(RuleRunWriteProps.get(undefined)).not.toBe(
      RuleRunWriteProps.get(undefined),
    );
  });

  /*
   * Whatever a run's props hold - any mix of every member they can carry -
   * its writes are root, with no project on them (a project on the write
   * would make it one made in the project, which drops the people it
   * names), with exactly the identity OnBehalfOfProps carries, and with
   * none of the props' permissions, plan or teams.
   */
  test("of 2,000 mixes of every member the props can carry, each is root and carries only who acted", () => {
    const random: SeededRandom = seededRandom(6300);
    const members: Array<string> = Object.keys(EVERY_MEMBER);
    const identity: ReadonlyArray<string> =
      OnBehalfOfProps.getIdentityKeys() as ReadonlyArray<string>;

    const problems: Array<string> = [];

    for (let draw: number = 0; draw < 2000; draw++) {
      const props: Record<string, unknown> = {};

      for (const member of members) {
        if (random(2) === 1) {
          props[member] = EVERY_MEMBER[member];
        }
      }

      const written: Record<string, unknown> = RuleRunWriteProps.get(
        props as DatabaseCommonInteractionProps,
      ) as Record<string, unknown>;

      if (written["isRoot"] !== true) {
        problems.push(`draw ${draw}: not root`);
      }

      for (const [key, value] of Object.entries(written)) {
        if (key === "isRoot") {
          continue;
        }

        if (!identity.includes(key)) {
          problems.push(`draw ${draw}: carries ${key}`);
        }

        // The very value given: an id stays the same id.
        if (value !== props[key]) {
          problems.push(`draw ${draw}: ${key} is not the value given`);
        }
      }

      for (const key of identity) {
        if (written[key] !== props[key]) {
          problems.push(`draw ${draw}: drops ${key}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("RuleRunWriteProps.getInProject", () => {
  const RULE_PROJECT_ID: ObjectID = new ObjectID(
    "66666666-6666-4666-8666-666666666666",
  );

  test("the automatic path writes as OneUptime's own, in the rule's project", () => {
    expect(RuleRunWriteProps.getInProject(undefined, RULE_PROJECT_ID)).toEqual(
      { isRoot: true, tenantId: RULE_PROJECT_ID },
    );
  });

  test("Run now writes as root in the rule's project, carrying the person and nothing they may do", () => {
    expect(
      RuleRunWriteProps.getInProject(
        {
          tenantId: PROJECT_ID,
          userId: USER_ID,
          userType: UserType.User,
          userTenantAccessPermission: {},
          isMasterAdmin: false,
          currentPlan: PlanType.Free,
        },
        RULE_PROJECT_ID,
      ),
    ).toEqual({
      isRoot: true,
      userId: USER_ID,
      userType: UserType.User,
      tenantId: RULE_PROJECT_ID,
    });
  });

  test("the project is the rule's, never the one the request names", () => {
    const written: DatabaseCommonInteractionProps =
      RuleRunWriteProps.getInProject(
        { tenantId: PROJECT_ID, userId: USER_ID, userType: UserType.User },
        RULE_PROJECT_ID,
      );

    expect(written.tenantId).toBe(RULE_PROJECT_ID);
  });

  test("an API key's run is the key's, in the rule's project", () => {
    expect(
      RuleRunWriteProps.getInProject(
        {
          tenantId: PROJECT_ID,
          userType: UserType.API,
          apiKeyId: KEY_ID,
          apiKeyName: "Deploy bot",
        },
        RULE_PROJECT_ID,
      ),
    ).toEqual({
      isRoot: true,
      userType: UserType.API,
      apiKeyId: KEY_ID,
      apiKeyName: "Deploy bot",
      tenantId: RULE_PROJECT_ID,
    });
  });

  test("never changes what it was given", () => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
    };

    RuleRunWriteProps.getInProject(props, RULE_PROJECT_ID);

    expect(props).toEqual({
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
    });
  });

  /*
   * Any mix of every member the props can carry: the write is exactly what
   * get() writes, in the rule's project - root, the identity OnBehalfOfProps
   * carries, and none of the request's permissions, plan or teams.
   */
  test("of 2,000 mixes of every member the props can carry, each is get() in the rule's project", () => {
    const random: SeededRandom = seededRandom(6323);
    const members: Array<string> = Object.keys(EVERY_MEMBER);
    const problems: Array<string> = [];

    for (let draw: number = 0; draw < 2000; draw++) {
      const props: Record<string, unknown> = {};

      for (const member of members) {
        if (random(2) === 1) {
          props[member] = EVERY_MEMBER[member];
        }
      }

      const given: DatabaseCommonInteractionProps | undefined =
        random(10) === 0 ? undefined : (props as DatabaseCommonInteractionProps);

      const written: DatabaseCommonInteractionProps =
        RuleRunWriteProps.getInProject(given, RULE_PROJECT_ID);

      const expected: DatabaseCommonInteractionProps = {
        ...RuleRunWriteProps.get(given),
        tenantId: RULE_PROJECT_ID,
      };

      try {
        expect(written).toEqual(expected);
      } catch {
        problems.push(`draw ${draw}: ${JSON.stringify(Object.keys(written))}`);
      }

      if (written.tenantId !== RULE_PROJECT_ID) {
        problems.push(`draw ${draw}: in another project`);
      }
    }

    expect(problems).toEqual([]);
  });
});
