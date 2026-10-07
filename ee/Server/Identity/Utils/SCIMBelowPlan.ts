import { generateSCIMErrorResponse } from "./SCIMUtils";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
  OneUptimeResponse,
} from "Common/Server/Utils/Express";
import { getScimStoppedMessage } from "Common/Types/Billing/PlanCutoffCredentials";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject } from "Common/Types/JSON";

/*
 * What a SCIM connection still does while its project is below the plan
 * SCIM needs (Scale; Common/Types/Billing/PlanCutoffCredentials).
 *
 * Below their plan, SCIM connections stop working until the project
 * upgrades (#4481). Taking access away is the exception, the way switching
 * a feature off and deleting it are allowed on every plan (#4407, #4441): a
 * person removed in the identity provider must not keep their access to
 * OneUptime because the project's plan went down. So below the plan:
 *
 *   - lookups are answered - every GET. Identity providers look a person
 *     or a group up before they deactivate or remove them (Microsoft Entra
 *     ID matches each user with a userName filter before it sends its
 *     PATCH), so without lookups no removal would ever arrive. A lookup
 *     never creates anyone below the plan: a userName filter for someone
 *     OneUptime does not know answers "no such user" instead of
 *     provisioning them.
 *   - requests that only take access away are answered:
 *       DELETE of a user, or of a group (team);
 *       PUT or PATCH of a user that deactivates them (active false) and
 *         changes nothing else OneUptime keeps;
 *       PATCH of a group whose operations remove members - Entra ID's
 *         {"op":"Remove","path":"members","value":[{"value":"<id>"}]} and
 *         Okta's {"op":"remove","path":"members[value eq \"<id>\"]"} alike
 *         - or replace its members with some of the ones it has;
 *       PUT of a group that lists some of the members it has, under the
 *         name it has;
 *       a Bulk request whose every operation is a DELETE.
 *   - everything that gives or changes access is refused, with 402 and the
 *     reason in the SCIM error format: creating a user or a group, a user
 *     update that reactivates them (active true) or changes their email or
 *     name, a group update that adds a member or renames the group, and any
 *     other Bulk request. A request that would do any of that is refused
 *     whole - nothing of it is applied - whatever else it asks.
 *
 * A request is judged by what its handler would do with it: the same parsed
 * user update (extractUserUpdateFromSCIM), the same planned group
 * operations (planScimGroupPatch), compared with what is stored. So an
 * attribute OneUptime does not keep - a title, a department, a manager -
 * changes nothing and does not count, and a value sent as it already is
 * (the same email, the same group name) is no change.
 *
 * The SCIM middleware (SCIMAuthorization) decides what it can from the
 * route alone, before any handler runs: it refuses creates and every other
 * Bulk request at the door, and marks the rest as below the plan
 * (setScimMissingPlan) for their handlers, which check what they would
 * change before they change anything. Billing off - self-hosted - has no
 * plans: none of this applies.
 */

// The HTTP status of a refusal below the plan: see SCIMAuthorization.
export const SCIM_BELOW_PLAN_STATUS: number = 402;

// What a refusal below the plan carries: the reason, in the SCIM error format.
export const getScimBelowPlanResponse: (planName: string) => JSONObject = (
  planName: string,
): JSONObject => {
  return generateSCIMErrorResponse(
    SCIM_BELOW_PLAN_STATUS,
    getScimStoppedMessage(planName),
  );
};

/*
 * Answers a request with the refusal, in the SCIM error format, so the
 * identity provider shows its administrators the reason.
 */
export const sendScimBelowPlanRefusal: (data: {
  res: ExpressResponse;
  missingPlan: PlanType;
}) => void = (data: { res: ExpressResponse; missingPlan: PlanType }): void => {
  const body: JSONObject = getScimBelowPlanResponse(data.missingPlan);

  (data.res as OneUptimeResponse).logBody = body;
  data.res.status(SCIM_BELOW_PLAN_STATUS).send(body);
};

// Where the middleware leaves the plan a request's project is missing.
const MISSING_PLAN_KEY: string = "missingPlan";

const PLAN_TYPES: ReadonlyArray<string> = Object.values(PlanType);

/*
 * Marks an authenticated SCIM request as one from a project below the plan
 * SCIM needs: its handler takes access away only. Called by the SCIM
 * middleware, once it has put the connection on the request.
 */
export const setScimMissingPlan: (
  req: ExpressRequest,
  missingPlan: PlanType,
) => void = (req: ExpressRequest, missingPlan: PlanType): void => {
  const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
  const bearerData: JSONObject =
    (oneuptimeRequest.bearerTokenData as JSONObject | undefined) || {};

  bearerData[MISSING_PLAN_KEY] = missingPlan;
  oneuptimeRequest.bearerTokenData = bearerData;
};

/*
 * The plan a SCIM request's project is missing - so its handler may only
 * take access away - or null when the project is on the plan, or billing is
 * off.
 */
export const getScimMissingPlan: (req: ExpressRequest) => PlanType | null = (
  req: ExpressRequest,
): PlanType | null => {
  const bearerData: unknown = (req as OneUptimeRequest).bearerTokenData;

  if (!bearerData || typeof bearerData !== "object") {
    return null;
  }

  const missingPlan: unknown = (bearerData as JSONObject)[MISSING_PLAN_KEY];

  return typeof missingPlan === "string" && PLAN_TYPES.includes(missingPlan)
    ? (missingPlan as PlanType)
    : null;
};

/*
 * ---------------------------------------------------------------------------
 * At the door: what the route alone decides.
 * ---------------------------------------------------------------------------
 */

export enum ScimRequestBelowPlan {
  // Reaches its handler, which answers lookups and takes access away only.
  Answered = "Answered",
  // Refused before any handler runs.
  Refused = "Refused",
}

/*
 * The SCIM resources, as the routes name them after the connection's id
 * (/scim/v2/:projectScimId/<resource>[/:id], and the same under
 * /status-page-scim/v2/:statusPageScimId).
 */
const DISCOVERY_RESOURCES: ReadonlyArray<string> = [
  "ServiceProviderConfig",
  "Schemas",
  "ResourceTypes",
];

const RECORD_RESOURCES: ReadonlyArray<string> = ["Users", "Groups"];

// The path segments after the connection's id, or null for another route.
const getResourceSegments: (routePath: string) => Array<string> | null = (
  routePath: string,
): Array<string> | null => {
  const segments: Array<string> = routePath.split("/").filter(Boolean);
  const idIndex: number = segments.findIndex((segment: string): boolean => {
    return segment === ":projectScimId" || segment === ":statusPageScimId";
  });

  if (idIndex < 0) {
    return null;
  }

  return segments.slice(idIndex + 1);
};

// Whether a Bulk request's body holds operations, and every one is a DELETE.
export const isBulkOfDeletesOnly: (body: unknown) => boolean = (
  body: unknown,
): boolean => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const operations: unknown = (body as JSONObject)["Operations"];

  if (!Array.isArray(operations) || operations.length === 0) {
    return false;
  }

  return operations.every((operation: unknown): boolean => {
    return (
      Boolean(operation) &&
      typeof operation === "object" &&
      typeof (operation as JSONObject)["method"] === "string" &&
      ((operation as JSONObject)["method"] as string).trim().toUpperCase() ===
        "DELETE"
    );
  });
};

/*
 * What happens to a SCIM request below the plan, decided from its method,
 * the route it matched (req.route.path) and - for Bulk - its operations'
 * methods. A route this does not know is refused: a SCIM route added later
 * stays closed below the plan until it is listed here.
 */
export const getScimRequestBelowPlan: (data: {
  method: string;
  routePath: string | undefined;
  body: unknown;
}) => ScimRequestBelowPlan = (data: {
  method: string;
  routePath: string | undefined;
  body: unknown;
}): ScimRequestBelowPlan => {
  const segments: Array<string> | null = data.routePath
    ? getResourceSegments(data.routePath)
    : null;

  if (!segments || segments.length === 0) {
    return ScimRequestBelowPlan.Refused;
  }

  const method: string = data.method.toUpperCase();
  const resource: string = segments[0]!;

  // The discovery documents say nothing about the project.
  if (segments.length === 1 && DISCOVERY_RESOURCES.includes(resource)) {
    return method === "GET"
      ? ScimRequestBelowPlan.Answered
      : ScimRequestBelowPlan.Refused;
  }

  if (segments.length === 1 && resource === "Bulk") {
    return method === "POST" && isBulkOfDeletesOnly(data.body)
      ? ScimRequestBelowPlan.Answered
      : ScimRequestBelowPlan.Refused;
  }

  if (!RECORD_RESOURCES.includes(resource)) {
    return ScimRequestBelowPlan.Refused;
  }

  // A list or a filtered lookup. Creating (POST) is refused.
  if (segments.length === 1) {
    return method === "GET"
      ? ScimRequestBelowPlan.Answered
      : ScimRequestBelowPlan.Refused;
  }

  /*
   * One user or group: reading it, deleting it, and the updates whose
   * handlers check what they would change (isScimUserUpdateOnlyARemoval,
   * isScimGroupPatchOnlyARemoval, isScimGroupReplaceOnlyARemoval).
   */
  if (
    segments.length === 2 &&
    ["GET", "DELETE", "PUT", "PATCH"].includes(method)
  ) {
    return ScimRequestBelowPlan.Answered;
  }

  return ScimRequestBelowPlan.Refused;
};

/*
 * ---------------------------------------------------------------------------
 * In the handlers: what an update would change.
 * ---------------------------------------------------------------------------
 */

/*
 * Whether a user update (PUT or PATCH, for a project's or a status page's
 * connection) only takes access away: it does not reactivate the person
 * (active true), and does not change their email or their name. A
 * deactivation (active false) removes them; an update with no active value
 * that changes nothing OneUptime keeps changes nothing at all.
 */
export const isScimUserUpdateOnlyARemoval: (data: {
  active: boolean | undefined;
  isEmailChanging: boolean;
  isNameChanging: boolean;
}) => boolean = (data: {
  active: boolean | undefined;
  isEmailChanging: boolean;
  isNameChanging: boolean;
}): boolean => {
  return (
    data.active !== true && !data.isEmailChanging && !data.isNameChanging
  );
};

// A group member, as SCIM names one: { value: <user id>, display, $ref }.
export type ScimGroupMember = JSONObject;

/*
 * What one operation of a group PATCH asks, as the group handlers apply it:
 *
 *   removeMembers   op "remove" on "members", with the members as its value
 *                   (Entra ID), or on "members[value eq \"<id>\"]" (Okta;
 *                   RFC 7644, section 3.5.2.2);
 *   addMembers      op "add" on "members";
 *   replaceMembers  op "replace" on "members": the members become exactly
 *                   the ones listed;
 *   rename          op "replace" on "displayName";
 *   ignored         anything else - another attribute, another op, a
 *                   filter it cannot read - which the handlers leave alone
 *                   on every plan, as they always have.
 */
export type ScimGroupPatchAction =
  | { kind: "removeMembers"; userIds: Array<string> }
  | { kind: "addMembers"; members: Array<ScimGroupMember> }
  | { kind: "replaceMembers"; members: Array<ScimGroupMember> }
  | { kind: "rename"; displayName: string }
  | { kind: "ignored"; op: string; path: string };

// A member list as SCIM sends it: an array of members, one member, or none.
const toMemberList: (value: unknown) => Array<ScimGroupMember> = (
  value: unknown,
): Array<ScimGroupMember> => {
  const values: Array<unknown> = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];

  return values.filter((member: unknown): member is ScimGroupMember => {
    return Boolean(member) && typeof member === "object";
  });
};

// The user id a SCIM member names, or null when it names none.
export const getScimMemberUserId: (member: ScimGroupMember) => string | null = (
  member: ScimGroupMember,
): string | null => {
  const value: unknown = member["value"];

  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const MEMBERS_FILTER_PATH: RegExp = /^members\s*\[(.*)\]$/i;
const MEMBER_VALUE_CONDITION: RegExp = /^value\s+eq\s+"([^"]+)"$/i;
const OR_SEPARATOR: RegExp = /\s+or\s+/i;

/*
 * The user ids a filtered members path names - members[value eq "<id>"],
 * or several joined with "or" - or null for any other path or filter.
 */
export const getMemberIdsFromMemberFilter: (
  path: string,
) => Array<string> | null = (path: string): Array<string> | null => {
  const filter: RegExpMatchArray | null = path.trim().match(MEMBERS_FILTER_PATH);

  if (!filter) {
    return null;
  }

  const ids: Array<string> = [];

  for (const condition of filter[1]!.trim().split(OR_SEPARATOR)) {
    const match: RegExpMatchArray | null = condition
      .trim()
      .match(MEMBER_VALUE_CONDITION);

    if (!match) {
      return null;
    }

    ids.push(match[1]!.trim());
  }

  return ids.length > 0 ? ids : null;
};

// What a group PATCH's operations ask, in order (see ScimGroupPatchAction).
export const planScimGroupPatch: (
  operations: unknown,
) => Array<ScimGroupPatchAction> = (
  operations: unknown,
): Array<ScimGroupPatchAction> => {
  if (!Array.isArray(operations)) {
    return [];
  }

  return operations.map((operation: unknown): ScimGroupPatchAction => {
    const fields: JSONObject =
      operation && typeof operation === "object"
        ? (operation as JSONObject)
        : {};
    const op: string =
      typeof fields["op"] === "string" ? fields["op"].toLowerCase() : "";
    const path: string =
      typeof fields["path"] === "string" ? fields["path"].trim() : "";
    const value: unknown = fields["value"];
    const lowerPath: string = path.toLowerCase();

    if (lowerPath === "members") {
      if (op === "remove") {
        return {
          kind: "removeMembers",
          userIds: toMemberList(value)
            .map(getScimMemberUserId)
            .filter((id: string | null): id is string => {
              return Boolean(id);
            }),
        };
      }

      if (op === "add") {
        return { kind: "addMembers", members: toMemberList(value) };
      }

      if (op === "replace") {
        return { kind: "replaceMembers", members: toMemberList(value) };
      }
    }

    if (op === "remove") {
      const filteredIds: Array<string> | null =
        getMemberIdsFromMemberFilter(path);

      if (filteredIds) {
        return { kind: "removeMembers", userIds: filteredIds };
      }
    }

    if (lowerPath === "displayname" && op === "replace") {
      if (typeof value === "string" && value) {
        return { kind: "rename", displayName: value };
      }
    }

    return { kind: "ignored", op, path };
  });
};

// A user id as the group handlers compare them: an IdP may echo one back in another case.
export const toComparableUserId: (userId: string) => string = (
  userId: string,
): string => {
  return userId.trim().toLowerCase();
};

/*
 * Whether a group PATCH only takes access away, played through in order
 * against the group's members and name: removals are; adding someone,
 * replacing the members with a list that names anyone the group does not
 * have at that point, and renaming the group to another name are not.
 * Operations the handlers ignore change nothing. `getCurrentMemberIds`
 * reads the group's members, and is only called for a replace.
 */
export const isScimGroupPatchOnlyARemoval: (data: {
  actions: Array<ScimGroupPatchAction>;
  currentName: string | undefined;
  getCurrentMemberIds: () => Promise<Array<string>>;
}) => Promise<boolean> = async (data: {
  actions: Array<ScimGroupPatchAction>;
  currentName: string | undefined;
  getCurrentMemberIds: () => Promise<Array<string>>;
}): Promise<boolean> => {
  // The members as the operations so far leave them, once they are read.
  let members: Set<string> | null = null;
  // Who the operations so far removed, for a replace read after them.
  const removed: Set<string> = new Set<string>();

  for (const action of data.actions) {
    if (action.kind === "removeMembers") {
      for (const userId of action.userIds) {
        const id: string = toComparableUserId(userId);
        removed.add(id);
        members?.delete(id);
      }

      continue;
    }

    if (action.kind === "addMembers") {
      if (action.members.some(getScimMemberUserId)) {
        return false;
      }

      continue;
    }

    if (action.kind === "replaceMembers") {
      if (!members) {
        members = new Set<string>(
          (await data.getCurrentMemberIds())
            .map(toComparableUserId)
            .filter((id: string): boolean => {
              return !removed.has(id);
            }),
        );
      }

      const listed: Array<string> = action.members
        .map(getScimMemberUserId)
        .filter((id: string | null): id is string => {
          return Boolean(id);
        })
        .map(toComparableUserId);

      const current: Set<string> = members;

      if (
        listed.some((id: string): boolean => {
          return !current.has(id);
        })
      ) {
        return false;
      }

      members = new Set<string>(listed);
      continue;
    }

    if (action.kind === "rename") {
      if (action.displayName !== data.currentName) {
        return false;
      }

      continue;
    }
  }

  return true;
};

/*
 * Whether a group PUT - a full replace of its name and members - only takes
 * access away: the name it sends, if any, is the group's own, and every
 * member it lists is already in the group.
 */
export const isScimGroupReplaceOnlyARemoval: (data: {
  displayName: unknown;
  currentName: string | undefined;
  listedMembers: unknown;
  currentMemberIds: Array<string>;
}) => boolean = (data: {
  displayName: unknown;
  currentName: string | undefined;
  listedMembers: unknown;
  currentMemberIds: Array<string>;
}): boolean => {
  if (
    typeof data.displayName === "string" &&
    data.displayName &&
    data.displayName !== data.currentName
  ) {
    return false;
  }

  const current: Set<string> = new Set<string>(
    data.currentMemberIds.map(toComparableUserId),
  );

  return toMemberList(data.listedMembers)
    .map(getScimMemberUserId)
    .filter((id: string | null): id is string => {
      return Boolean(id);
    })
    .every((id: string): boolean => {
      return current.has(toComparableUserId(id));
    });
};
