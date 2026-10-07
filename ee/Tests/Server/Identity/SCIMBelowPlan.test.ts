import { describe, expect, test } from "@jest/globals";
import {
  getMemberIdsFromMemberFilter,
  getScimBelowPlanResponse,
  getScimMemberUserId,
  getScimMissingPlan,
  getScimRequestBelowPlan,
  isBulkOfDeletesOnly,
  isScimGroupPatchOnlyARemoval,
  isScimGroupReplaceOnlyARemoval,
  isScimUserUpdateOnlyARemoval,
  planScimGroupPatch,
  SCIM_BELOW_PLAN_STATUS,
  ScimGroupPatchAction,
  ScimRequestBelowPlan,
  sendScimBelowPlanRefusal,
  setScimMissingPlan,
} from "../../../Server/Identity/Utils/SCIMBelowPlan";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
  OneUptimeResponse,
} from "Common/Server/Utils/Express";
import { getScimStoppedMessage } from "Common/Types/Billing/PlanCutoffCredentials";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * What a SCIM connection still does below the plan SCIM needs, as plain
 * rules (Utils/SCIMBelowPlan): what the middleware decides from the route,
 * and what the handlers decide from what a request would change. The HTTP
 * behaviour, Okta's and Entra ID's requests end to end, is
 * SCIMBelowPlanRequests.test.ts; the door, route by route,
 * SCIMPlanCutoff.test.ts.
 */

const PROJECT_USERS: string = "/scim/v2/:projectScimId/Users";
const PROJECT_USER: string = "/scim/v2/:projectScimId/Users/:userId";
const PROJECT_GROUPS: string = "/scim/v2/:projectScimId/Groups";
const PROJECT_GROUP: string = "/scim/v2/:projectScimId/Groups/:groupId";
const PROJECT_BULK: string = "/scim/v2/:projectScimId/Bulk";
const STATUS_PAGE_USER: string =
  "/status-page-scim/v2/:statusPageScimId/Users/:userId";

const ALICE: string = "aa000000-0000-4000-8000-0000000000a1";
const BOB: string = "aa000000-0000-4000-8000-0000000000b0";
const CAROL: string = "aa000000-0000-4000-8000-0000000000c0";

const below: (
  method: string,
  routePath: string | undefined,
  body?: unknown,
) => ScimRequestBelowPlan = (
  method: string,
  routePath: string | undefined,
  body: unknown = {},
): ScimRequestBelowPlan => {
  return getScimRequestBelowPlan({ method, routePath, body });
};

describe("at the door: what the route alone decides", () => {
  test.each([
    ["GET", "/scim/v2/:projectScimId/ServiceProviderConfig"],
    ["GET", "/scim/v2/:projectScimId/Schemas"],
    ["GET", "/scim/v2/:projectScimId/ResourceTypes"],
    ["GET", PROJECT_USERS],
    ["GET", PROJECT_USER],
    ["GET", PROJECT_GROUPS],
    ["GET", PROJECT_GROUP],
    ["DELETE", PROJECT_USER],
    ["DELETE", PROJECT_GROUP],
    ["PUT", PROJECT_USER],
    ["PATCH", PROJECT_USER],
    ["PUT", PROJECT_GROUP],
    ["PATCH", PROJECT_GROUP],
    ["GET", "/status-page-scim/v2/:statusPageScimId/Users"],
    ["DELETE", STATUS_PAGE_USER],
    ["PATCH", STATUS_PAGE_USER],
    ["patch", STATUS_PAGE_USER],
  ])("%s %s reaches its handler", (method: string, routePath: string) => {
    expect(below(method, routePath)).toBe(ScimRequestBelowPlan.Answered);
  });

  test.each([
    ["POST", PROJECT_USERS, "creating a user"],
    ["POST", PROJECT_GROUPS, "creating a group"],
    ["POST", "/status-page-scim/v2/:statusPageScimId/Users", "creating one"],
    ["DELETE", PROJECT_USERS, "a method the route does not serve"],
    ["POST", PROJECT_USER, "a POST on one user"],
    ["POST", "/scim/v2/:projectScimId/Schemas", "a write to discovery"],
    ["GET", "/scim/v2/:projectScimId/Users/:userId/Extra", "a deeper path"],
    ["GET", "/scim/v2/:projectScimId/Me", "a resource not listed"],
    ["GET", "/scim/v2/:projectScimId", "no resource at all"],
    ["GET", "/some/other/route", "a route without a connection id"],
  ])(
    "%s %s is refused (%s)",
    (method: string, routePath: string, _label: string) => {
      expect(below(method, routePath)).toBe(ScimRequestBelowPlan.Refused);
    },
  );

  test("a request whose route is not known - no req.route - is refused", () => {
    expect(below("GET", undefined)).toBe(ScimRequestBelowPlan.Refused);
    expect(below("GET", "")).toBe(ScimRequestBelowPlan.Refused);
  });

  describe("Bulk", () => {
    test.each([
      [
        "every operation a DELETE",
        { Operations: [{ method: "DELETE" }, { method: "DELETE" }] },
      ],
      ["any spelling of DELETE", { Operations: [{ method: " delete " }] }],
    ])("passes with %s", (_label: string, body: JSONObject) => {
      expect(isBulkOfDeletesOnly(body)).toBe(true);
      expect(below("POST", PROJECT_BULK, body)).toBe(
        ScimRequestBelowPlan.Answered,
      );
    });

    test.each([
      ["a create among the deletes", { Operations: [{ method: "DELETE" }, { method: "POST" }] }],
      ["an update", { Operations: [{ method: "PATCH" }] }],
      ["a replace", { Operations: [{ method: "PUT" }] }],
      ["no operations", { Operations: [] }],
      ["no Operations key", {}],
      ["Operations that are not a list", { Operations: { method: "DELETE" } }],
      ["an operation without a method", { Operations: [{}] }],
      ["an operation that is not an object", { Operations: ["DELETE"] }],
      ["a method that is not a string", { Operations: [{ method: 1 }] }],
    ])("is refused with %s", (_label: string, body: JSONObject) => {
      expect(isBulkOfDeletesOnly(body)).toBe(false);
      expect(below("POST", PROJECT_BULK, body)).toBe(
        ScimRequestBelowPlan.Refused,
      );
    });

    test.each([[null], [undefined], ["DELETE"], [[{ method: "DELETE" }]]])(
      "is refused with a body of %j",
      (body: unknown) => {
        expect(isBulkOfDeletesOnly(body)).toBe(false);
      },
    );

    test("only as a POST", () => {
      expect(
        below("GET", PROJECT_BULK, { Operations: [{ method: "DELETE" }] }),
      ).toBe(ScimRequestBelowPlan.Refused);
    });
  });
});

describe("a user update", () => {
  test.each([
    [{ active: false, isEmailChanging: false, isNameChanging: false }, true],
    [{ active: undefined, isEmailChanging: false, isNameChanging: false }, true],
    [{ active: true, isEmailChanging: false, isNameChanging: false }, false],
    [{ active: false, isEmailChanging: true, isNameChanging: false }, false],
    [{ active: false, isEmailChanging: false, isNameChanging: true }, false],
    [{ active: undefined, isEmailChanging: true, isNameChanging: false }, false],
    [{ active: true, isEmailChanging: true, isNameChanging: true }, false],
  ])(
    "%j only takes access away: %s",
    (
      update: {
        active: boolean | undefined;
        isEmailChanging: boolean;
        isNameChanging: boolean;
      },
      expected: boolean,
    ) => {
      expect(isScimUserUpdateOnlyARemoval(update)).toBe(expected);
    },
  );
});

describe("a filtered members path", () => {
  test.each([
    [`members[value eq "${ALICE}"]`, [ALICE]],
    [`members[ value eq "${ALICE}" ]`, [ALICE]],
    [`Members[Value EQ "${ALICE}"]`, [ALICE]],
    [`  members[value eq "${ALICE}"]  `, [ALICE]],
    [`members [value eq "${ALICE}"]`, [ALICE]],
    [`members[value eq "${ALICE}" or value eq "${BOB}"]`, [ALICE, BOB]],
    [`members[value eq "${ALICE}" OR value eq "${BOB}"]`, [ALICE, BOB]],
  ])("%s names %j", (path: string, expected: Array<string>) => {
    expect(getMemberIdsFromMemberFilter(path)).toEqual(expected);
  });

  test.each([
    ["members"],
    ["displayName"],
    [`members[display eq "alice@acme.example"]`],
    [`members[value ne "${ALICE}"]`],
    [`members[value eq ${ALICE}]`],
    [`members[value eq "${ALICE}" and value eq "${BOB}"]`],
    [`members[value eq "${ALICE}" or display eq "bob"]`],
    ["members[]"],
    [`members[value eq ""]`],
    [`emails[value eq "${ALICE}"]`],
    [`members[value eq "${ALICE}"].display`],
  ])("%s names no member it can act on", (path: string) => {
    expect(getMemberIdsFromMemberFilter(path)).toBeNull();
  });
});

describe("a group PATCH, read as its handler applies it", () => {
  test("Entra ID's Remove, with the members as its value", () => {
    expect(
      planScimGroupPatch([
        {
          op: "Remove",
          path: "members",
          value: [{ value: ALICE }, { value: BOB }],
        },
      ]),
    ).toEqual([{ kind: "removeMembers", userIds: [ALICE, BOB] }]);
  });

  test("Okta's remove on members[value eq ...], with no value", () => {
    expect(
      planScimGroupPatch([
        { op: "remove", path: `members[value eq "${ALICE}"]` },
      ]),
    ).toEqual([{ kind: "removeMembers", userIds: [ALICE] }]);
  });

  test("Okta's add on members, and Entra ID's Add", () => {
    const members: Array<JSONObject> = [
      { value: ALICE, display: "alice@acme.example" },
    ];

    expect(
      planScimGroupPatch([
        { op: "add", path: "members", value: members },
        { op: "Add", path: "members", value: [{ value: BOB }] },
      ]),
    ).toEqual([
      { kind: "addMembers", members },
      { kind: "addMembers", members: [{ value: BOB }] },
    ]);
  });

  test("a replace of the members, and of the name", () => {
    expect(
      planScimGroupPatch([
        { op: "replace", path: "members", value: [{ value: CAROL }] },
        { op: "Replace", path: "displayName", value: "Platform" },
      ]),
    ).toEqual([
      { kind: "replaceMembers", members: [{ value: CAROL }] },
      { kind: "rename", displayName: "Platform" },
    ]);
  });

  test("ops and paths in any case, and a path with spaces around it", () => {
    expect(
      planScimGroupPatch([
        { op: "REMOVE", path: " MEMBERS ", value: [{ value: ALICE }] },
        { op: "replace", path: "DisplayName", value: "Platform" },
      ]),
    ).toEqual([
      { kind: "removeMembers", userIds: [ALICE] },
      { kind: "rename", displayName: "Platform" },
    ]);
  });

  test("one member sent as an object rather than a list", () => {
    expect(
      planScimGroupPatch([
        { op: "remove", path: "members", value: { value: ALICE } },
      ]),
    ).toEqual([{ kind: "removeMembers", userIds: [ALICE] }]);
  });

  test("members without an id are left out of a removal", () => {
    expect(
      planScimGroupPatch([
        {
          op: "remove",
          path: "members",
          value: [{ display: "no id" }, { value: "" }, { value: ALICE }, 7],
        },
      ]),
    ).toEqual([{ kind: "removeMembers", userIds: [ALICE] }]);
  });

  test("a removal of members with no value removes no one, as it always did", () => {
    expect(planScimGroupPatch([{ op: "remove", path: "members" }])).toEqual([
      { kind: "removeMembers", userIds: [] },
    ]);
  });

  test.each([
    [{ op: "replace", value: { id: "x", displayName: "Okta rename" } }],
    [{ op: "replace", path: "externalId", value: "x" }],
    [{ op: "move", path: "members", value: [] }],
    [{ op: "replace", path: "displayName", value: "" }],
    [{ op: "replace", path: "displayName", value: 7 }],
    [{ op: "add", path: `members[value eq "${ALICE}"]` }],
    [{ op: "remove", path: `members[display eq "alice"]` }],
    [{ path: "members", value: [{ value: ALICE }] }],
    [null],
    ["remove"],
  ])("%j is left alone, as it always was", (operation: unknown) => {
    const actions: Array<ScimGroupPatchAction> = planScimGroupPatch([
      operation,
    ]);

    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("ignored");
  });

  test.each([[undefined], [null], [{}], ["Operations"]])(
    "Operations of %j plan nothing",
    (operations: unknown) => {
      expect(planScimGroupPatch(operations)).toEqual([]);
    },
  );
});

describe("whether a group PATCH only takes access away", () => {
  const onlyRemoves: (
    operations: Array<JSONObject>,
    current?: Array<string>,
    currentName?: string,
  ) => Promise<{ result: boolean; reads: number }> = async (
    operations: Array<JSONObject>,
    current: Array<string> = [ALICE, BOB],
    currentName: string = "Engineering",
  ): Promise<{ result: boolean; reads: number }> => {
    let reads: number = 0;

    const result: boolean = await isScimGroupPatchOnlyARemoval({
      actions: planScimGroupPatch(operations),
      currentName,
      getCurrentMemberIds: async (): Promise<Array<string>> => {
        reads += 1;
        return current;
      },
    });

    return { result, reads };
  };

  test("removals do, and read no members", async () => {
    expect(
      await onlyRemoves([
        { op: "remove", path: `members[value eq "${ALICE}"]` },
        { op: "Remove", path: "members", value: [{ value: BOB }] },
      ]),
    ).toEqual({ result: true, reads: 0 });
  });

  test("an addition does not", async () => {
    expect(
      (
        await onlyRemoves([
          { op: "add", path: "members", value: [{ value: CAROL }] },
        ])
      ).result,
    ).toBe(false);
  });

  test("an addition of someone already in the group does not either: adding is never checked against the members", async () => {
    expect(
      await onlyRemoves([
        { op: "add", path: "members", value: [{ value: ALICE }] },
      ]),
    ).toEqual({ result: false, reads: 0 });
  });

  test("an addition that names no member adds no one", async () => {
    expect(
      (
        await onlyRemoves([
          { op: "add", path: "members", value: [] },
          { op: "add", path: "members", value: [{ display: "no id" }] },
        ])
      ).result,
    ).toBe(true);
  });

  test("a replace with some of the members does, reading them once", async () => {
    expect(
      await onlyRemoves([
        { op: "replace", path: "members", value: [{ value: ALICE }] },
        { op: "replace", path: "members", value: [{ value: ALICE }] },
      ]),
    ).toEqual({ result: true, reads: 1 });
  });

  test("a replace with no members at all does: it removes everyone", async () => {
    expect(
      (await onlyRemoves([{ op: "replace", path: "members", value: [] }]))
        .result,
    ).toBe(true);
  });

  test("a replace that names someone new does not", async () => {
    expect(
      (
        await onlyRemoves([
          {
            op: "replace",
            path: "members",
            value: [{ value: ALICE }, { value: CAROL }],
          },
        ])
      ).result,
    ).toBe(false);
  });

  test("ids compare in any case", async () => {
    expect(
      (
        await onlyRemoves(
          [
            {
              op: "replace",
              path: "members",
              value: [{ value: ALICE.toUpperCase() }],
            },
          ],
          [ALICE],
        )
      ).result,
    ).toBe(true);
  });

  test("a removal followed by a replace that puts the person back does not", async () => {
    expect(
      (
        await onlyRemoves([
          { op: "remove", path: `members[value eq "${ALICE}"]` },
          {
            op: "replace",
            path: "members",
            value: [{ value: ALICE }, { value: BOB }],
          },
        ])
      ).result,
    ).toBe(false);
  });

  test("a replace followed by a replace naming someone the first dropped does not", async () => {
    expect(
      (
        await onlyRemoves([
          { op: "replace", path: "members", value: [{ value: ALICE }] },
          { op: "replace", path: "members", value: [{ value: BOB }] },
        ])
      ).result,
    ).toBe(false);
  });

  test("the group's own name, sent as it is, changes nothing", async () => {
    expect(
      (
        await onlyRemoves([
          { op: "replace", path: "displayName", value: "Engineering" },
        ])
      ).result,
    ).toBe(true);
  });

  test("another name does not", async () => {
    expect(
      (
        await onlyRemoves([
          { op: "replace", path: "displayName", value: "Platform" },
        ])
      ).result,
    ).toBe(false);
  });

  test("an addition after a removal makes the whole PATCH not a removal", async () => {
    expect(
      (
        await onlyRemoves([
          { op: "remove", path: `members[value eq "${ALICE}"]` },
          { op: "add", path: "members", value: [{ value: CAROL }] },
        ])
      ).result,
    ).toBe(false);
  });

  test("operations its handler leaves alone change nothing", async () => {
    expect(
      await onlyRemoves([
        { op: "replace", path: "externalId", value: "x" },
        { op: "replace", value: { displayName: "Okta rename" } },
      ]),
    ).toEqual({ result: true, reads: 0 });
  });
});

describe("whether a group PUT only takes access away", () => {
  test.each([
    ["its own name and some of its members", "Engineering", [{ value: ALICE }], true],
    ["no name, some of its members", undefined, [{ value: BOB }], true],
    ["an empty name, as no name", "", [{ value: BOB }], true],
    ["its own name and no members: everyone goes", "Engineering", [], true],
    ["no members key: everyone goes", "Engineering", undefined, true],
    ["one member as an object", "Engineering", { value: ALICE }, true],
    ["ids in another case", "Engineering", [{ value: ALICE.toUpperCase() }], true],
    ["members without ids are ignored", "Engineering", [{ display: "x" }], true],
    ["a new member", "Engineering", [{ value: ALICE }, { value: CAROL }], false],
    ["another name", "Platform", [{ value: ALICE }], false],
  ])(
    "%s: %s",
    (
      _label: string,
      displayName: unknown,
      listedMembers: unknown,
      expected: boolean,
    ) => {
      expect(
        isScimGroupReplaceOnlyARemoval({
          displayName,
          currentName: "Engineering",
          listedMembers,
          currentMemberIds: [ALICE, BOB],
        }),
      ).toBe(expected);
    },
  );
});

describe("a member's user id", () => {
  test.each([
    [{ value: ALICE }, ALICE],
    [{ value: ` ${ALICE} ` }, ALICE],
    [{ value: "" }, null],
    [{ value: "   " }, null],
    [{ value: 7 }, null],
    [{ display: "x" }, null],
  ])("%j is %j", (member: JSONObject, expected: string | null) => {
    expect(getScimMemberUserId(member)).toBe(expected);
  });
});

describe("the mark the middleware leaves on a request", () => {
  test("carries the plan to the handler, alongside the connection", () => {
    const req: OneUptimeRequest = {
      bearerTokenData: { projectId: new ObjectID(ALICE), type: "project-scim" },
    } as unknown as OneUptimeRequest;

    expect(getScimMissingPlan(req as ExpressRequest)).toBeNull();

    setScimMissingPlan(req as ExpressRequest, PlanType.Scale);

    expect(getScimMissingPlan(req as ExpressRequest)).toBe(PlanType.Scale);
    expect((req.bearerTokenData as JSONObject)["type"]).toBe("project-scim");
  });

  test("is read only as a plan", () => {
    for (const value of ["Gold", 7, true, null, ""]) {
      const req: OneUptimeRequest = {
        bearerTokenData: { missingPlan: value },
      } as unknown as OneUptimeRequest;

      expect([value, getScimMissingPlan(req as ExpressRequest)]).toEqual([
        value,
        null,
      ]);
    }
  });

  test("a request with no connection on it has no plan missing", () => {
    expect(getScimMissingPlan({} as ExpressRequest)).toBeNull();
    expect(
      getScimMissingPlan({
        bearerTokenData: "a string",
      } as unknown as ExpressRequest),
    ).toBeNull();
  });
});

describe("the refusal", () => {
  test("is 402 with the reason in the SCIM error format", () => {
    let status: number = 0;
    let sent: unknown = undefined;
    const res: OneUptimeResponse = {
      status: (code: number): OneUptimeResponse => {
        status = code;
        return res;
      },
      send: (body: unknown): OneUptimeResponse => {
        sent = body;
        return res;
      },
    } as unknown as OneUptimeResponse;

    sendScimBelowPlanRefusal({
      res: res as ExpressResponse,
      missingPlan: PlanType.Scale,
    });

    expect(status).toBe(SCIM_BELOW_PLAN_STATUS);
    expect(sent).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "402",
      detail: getScimStoppedMessage(PlanType.Scale),
    });
    expect(res.logBody).toEqual(sent);
    expect(getScimBelowPlanResponse(PlanType.Scale)).toEqual(sent);
  });
});
