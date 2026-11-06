import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UserOverrideAddAccessUtil, {
  USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES,
  USER_OVERRIDE_ADD_ACCESS_ROUTE,
  UserOverrideAddAccess,
} from "../../../Types/OnCallDutyPolicy/UserOverrideAddAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * The question the shortcuts that would add a global override ask the
 * server, and its answer: where the caller may add a user override
 * (Types/OnCallDutyPolicy/UserOverrideAddAccess). The server reads the
 * question strictly; the Dashboard reads the answer so that nothing it does
 * not plainly say grants anything.
 */

const POLICY_A: string = "0dd20000-0000-4000-8000-0000000000a2";
const POLICY_B: string = "0dd20000-0000-4000-8000-0000000000b2";

const ids: (list: Array<ObjectID>) => Array<string> = (
  list: Array<ObjectID>,
): Array<string> => {
  return list.map((id: ObjectID): string => {
    return id.toString();
  });
};

describe("the route", () => {
  test("is add-access, under the user override API", () => {
    expect(USER_OVERRIDE_ADD_ACCESS_ROUTE).toBe("/add-access");
  });
});

describe("parseRequest", () => {
  test("reads the policies asked about, in order", () => {
    expect(
      ids(
        UserOverrideAddAccessUtil.parseRequest(
          UserOverrideAddAccessUtil.requestToJSON([POLICY_A, POLICY_B]),
        ),
      ),
    ).toEqual([POLICY_A, POLICY_B]);
  });

  test("asks about each policy once, however it is written", () => {
    expect(
      ids(
        UserOverrideAddAccessUtil.parseRequest({
          onCallDutyPolicyIds: [
            POLICY_A,
            ` ${POLICY_A.toUpperCase()} `,
            POLICY_B,
          ],
        }),
      ),
    ).toEqual([POLICY_A, POLICY_B]);
  });

  test("no body, no list or an empty list asks about no policy", () => {
    expect(UserOverrideAddAccessUtil.parseRequest(undefined)).toEqual([]);
    expect(UserOverrideAddAccessUtil.parseRequest({})).toEqual([]);
    expect(
      UserOverrideAddAccessUtil.parseRequest({ onCallDutyPolicyIds: null }),
    ).toEqual([]);
    expect(
      UserOverrideAddAccessUtil.parseRequest({ onCallDutyPolicyIds: [] }),
    ).toEqual([]);
  });

  test.each([
    ["a list that is not one", { onCallDutyPolicyIds: POLICY_A }],
    ["an object for a list", { onCallDutyPolicyIds: { 0: POLICY_A } }],
    ["an id that is not one", { onCallDutyPolicyIds: ["policy-a"] }],
    ["an empty id", { onCallDutyPolicyIds: [""] }],
    ["an id that is not text", { onCallDutyPolicyIds: [12] }],
    ["an id as an object", { onCallDutyPolicyIds: [{ value: POLICY_A }] }],
  ])("refuses %s", (_name: string, body: unknown) => {
    expect(() => {
      return UserOverrideAddAccessUtil.parseRequest(body);
    }).toThrow(BadDataException);
  });

  test(`takes up to ${USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES} policies, and refuses one more`, () => {
    const policies: Array<string> = [];

    for (let i: number = 0; i < USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES; i++) {
      policies.push(ObjectID.generate().toString());
    }

    expect(
      UserOverrideAddAccessUtil.parseRequest({
        onCallDutyPolicyIds: policies,
      }),
    ).toHaveLength(USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES);

    // The same policy again is still one.
    expect(
      UserOverrideAddAccessUtil.parseRequest({
        onCallDutyPolicyIds: [...policies, policies[0]],
      }),
    ).toHaveLength(USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES);

    expect(() => {
      return UserOverrideAddAccessUtil.parseRequest({
        onCallDutyPolicyIds: [...policies, ObjectID.generate().toString()],
      });
    }).toThrow(BadDataException);
  });
});

describe("the answer", () => {
  test("goes out and comes back as it was", () => {
    const access: UserOverrideAddAccess = {
      global: false,
      onCallDutyPolicyIds: [POLICY_A],
    };

    expect(
      UserOverrideAddAccessUtil.resultFromJSON(
        JSON.parse(
          JSON.stringify(UserOverrideAddAccessUtil.resultToJSON(access)),
        ),
      ),
    ).toEqual(access);
  });

  test("grants nothing it does not plainly say", () => {
    expect(UserOverrideAddAccessUtil.resultFromJSON(undefined)).toEqual({
      global: false,
      onCallDutyPolicyIds: [],
    });
    expect(UserOverrideAddAccessUtil.resultFromJSON([POLICY_A])).toEqual({
      global: false,
      onCallDutyPolicyIds: [],
    });
    expect(
      UserOverrideAddAccessUtil.resultFromJSON({
        global: "true",
        onCallDutyPolicyIds: POLICY_A,
      }),
    ).toEqual({ global: false, onCallDutyPolicyIds: [] });
    expect(
      UserOverrideAddAccessUtil.resultFromJSON({
        global: 1,
        onCallDutyPolicyIds: [POLICY_A, "", 7, null, { id: POLICY_B }],
      }),
    ).toEqual({ global: false, onCallDutyPolicyIds: [POLICY_A] });
  });

  test("names a policy whatever case either side writes it in", () => {
    const access: UserOverrideAddAccess = {
      global: false,
      onCallDutyPolicyIds: [POLICY_A.toUpperCase()],
    };

    expect(UserOverrideAddAccessUtil.mayAddOn(access, POLICY_A)).toBe(true);
    expect(UserOverrideAddAccessUtil.mayAddOn(access, ` ${POLICY_A} `)).toBe(
      true,
    );
    expect(UserOverrideAddAccessUtil.mayAddOn(access, POLICY_B)).toBe(false);
  });
});
