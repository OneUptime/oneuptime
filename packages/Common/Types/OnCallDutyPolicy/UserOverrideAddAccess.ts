import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * WHERE THE CALLER MAY ADD A USER OVERRIDE.
 *
 * Adding a global user override - one that names no on-call policy - takes
 * a permission to add user overrides held over the whole project
 * (GlobalUserOverrideAccess, issue #5617). A member whose permission is
 * limited to their team's label, or to the policies their team owns, still
 * adds overrides on those policies. Which policies those are is the
 * server's to say: a permission limited to labels reaches a policy carrying
 * one of them, one limited to owned policies a policy their team owns, and
 * a team's block with labels takes some away again (CreateScopePermission,
 * OwnedScopePermission). The policies a member can read are no guide: with
 * Viewer over the whole project they read every one.
 *
 * So the shortcuts that would add a global override - Skip until... on a
 * person in a schedule layer, Get cover on an upcoming shift, and the
 * mobile app's cover sheet - ask the server where the caller may add one,
 * for the policies they would reach:
 *
 *   POST /on-call-duty-policy-user-override/add-access
 *   { "onCallDutyPolicyIds": ["<id>", ...] }
 *   -> { "global": false, "onCallDutyPolicyIds": ["<id>"] }
 *
 * `global` says whether they may add a global override, and the ids are the
 * policies asked about that they may add an override on. The server runs a
 * create's own checks on an override it would add on each policy, and on a
 * global one, and adds none (OnCallDutyPolicyUserOverrideService
 * .getAddAccess). Where the global override is refused, the shortcuts offer
 * those policies instead, one override on each.
 *
 * Read by the server and the Dashboard, so it imports nothing that needs a
 * server or React. The mobile app, built without Common's runtime code,
 * reads the answer itself (MobileApp/src/api/onCallOverrides).
 */

// The route, under the user override API's own path.
export const USER_OVERRIDE_ADD_ACCESS_ROUTE: string = "/add-access";

// The most policies one request asks about: more than a schedule or a shift names.
export const USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES: number = 100;

export interface UserOverrideAddAccess {
  // Whether the caller may add a global override, one on every policy.
  global: boolean;
  // Of the policies asked about, those the caller may add an override on.
  onCallDutyPolicyIds: Array<string>;
}

const sameId: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

export default class UserOverrideAddAccessUtil {
  public static requestToJSON(onCallDutyPolicyIds: Array<string>): JSONObject {
    return { onCallDutyPolicyIds: [...onCallDutyPolicyIds] };
  }

  /*
   * The policies a request asks about, each once, as the server reads them.
   * Refuses a body whose list is not one of ids, or that names more than
   * USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES policies. No list asks about none:
   * the answer is then whether a global override may be added.
   */
  public static parseRequest(body: unknown): Array<ObjectID> {
    const record: Record<string, unknown> =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const asked: unknown = record["onCallDutyPolicyIds"];

    if (asked === undefined || asked === null) {
      return [];
    }

    if (!Array.isArray(asked)) {
      throw new BadDataException(
        "onCallDutyPolicyIds must be a list of on-call policy IDs.",
      );
    }

    const ids: Array<ObjectID> = [];

    for (const value of asked) {
      if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
        throw new BadDataException(
          "onCallDutyPolicyIds must be a list of on-call policy IDs.",
        );
      }

      if (
        ids.some((id: ObjectID): boolean => {
          return sameId(id.toString(), value);
        })
      ) {
        continue;
      }

      ids.push(new ObjectID(value.trim()));
    }

    if (ids.length > USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES) {
      throw new BadDataException(
        `Ask about at most ${USER_OVERRIDE_ADD_ACCESS_MAX_POLICIES} on-call policies at a time.`,
      );
    }

    return ids;
  }

  public static resultToJSON(access: UserOverrideAddAccess): JSONObject {
    return {
      global: access.global,
      onCallDutyPolicyIds: [...access.onCallDutyPolicyIds],
    };
  }

  /*
   * The answer as the Dashboard reads it. Read strictly in what it grants:
   * anything but `true` adds no global override, and anything but an id
   * names no policy.
   */
  public static resultFromJSON(json: unknown): UserOverrideAddAccess {
    const record: Record<string, unknown> =
      json && typeof json === "object" && !Array.isArray(json)
        ? (json as Record<string, unknown>)
        : {};
    const ids: unknown = record["onCallDutyPolicyIds"];

    return {
      global: record["global"] === true,
      onCallDutyPolicyIds: Array.isArray(ids)
        ? ids.filter((id: unknown): id is string => {
            return typeof id === "string" && id.trim().length > 0;
          })
        : [],
    };
  }

  // Whether the answer lets the caller add an override on `onCallDutyPolicyId`.
  public static mayAddOn(
    access: UserOverrideAddAccess,
    onCallDutyPolicyId: string,
  ): boolean {
    return access.onCallDutyPolicyIds.some((id: string): boolean => {
      return sameId(id, onCallDutyPolicyId);
    });
  }
}
