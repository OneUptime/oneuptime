import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { MaterializedShiftJson } from "Common/Types/OnCallDutyPolicy/MaterializedShift";
import UserOverrideAddAccessUtil, {
  UserOverrideAddAccess,
} from "Common/Types/OnCallDutyPolicy/UserOverrideAddAccess";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * THE POLICIES A SHORTCUT OFFERS WHERE A GLOBAL OVERRIDE IS REFUSED.
 *
 * "Skip until..." on a person in a schedule layer and "Get cover" on an
 * upcoming shift add a global override - one on every on-call policy. For a
 * reader whose permission to add overrides covers only some policies
 * (GlobalUserOverrideLock), they offer instead the policies the server says
 * the reader may cover (Types/OnCallDutyPolicy/UserOverrideAddAccess), of
 * the ones the shortcut would reach: the policies that page through the
 * schedule, or through the shift. One override is added on each.
 *
 * Only the server weighs which policies a permission limited to labels or
 * to owned policies reaches, so nothing here guesses: a policy is offered
 * when the server's answer names it, and on no other.
 */

// An on-call policy a shortcut may offer, as the reader sees it named.
export interface UserOverridePolicy {
  id: string;
  name: string;
}

const sameId: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

/*
 * Where the reader may add a user override in `projectId`: on which of
 * `onCallDutyPolicyIds`, and whether a global one
 * (POST /on-call-duty-policy-user-override/add-access). Asked in the
 * project the policies belong to, which for Get cover is the shift's own -
 * the Upcoming shifts card lists every project's shifts. Throws what the
 * server answered when it refused.
 */
export const fetchUserOverrideAddAccess: (data: {
  projectId: string;
  onCallDutyPolicyIds: Array<string>;
}) => Promise<UserOverrideAddAccess> = async (data: {
  projectId: string;
  onCallDutyPolicyIds: Array<string>;
}): Promise<UserOverrideAddAccess> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/on-call-duty-policy-user-override/add-access",
      ),
      data: UserOverrideAddAccessUtil.requestToJSON(data.onCallDutyPolicyIds),
      headers: { ...ModelAPI.getCommonHeaders(), tenantid: data.projectId },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return UserOverrideAddAccessUtil.resultFromJSON(response.data);
};

// The policies, each once, in the order first named: a shift or a schedule can name one twice.
export const getDistinctPolicies: (
  policies: Array<UserOverridePolicy>,
) => Array<UserOverridePolicy> = (
  policies: Array<UserOverridePolicy>,
): Array<UserOverridePolicy> => {
  const distinct: Array<UserOverridePolicy> = [];

  for (const policy of policies) {
    if (
      policy.id &&
      !distinct.some((seen: UserOverridePolicy): boolean => {
        return sameId(seen.id, policy.id);
      })
    ) {
      distinct.push(policy);
    }
  }

  return distinct;
};

/*
 * The policies that page through a schedule: each policy with an escalation
 * rule that names it, once - a policy can name a schedule in several rules.
 */
export const fetchSchedulePolicies: (
  onCallDutyPolicyScheduleId: ObjectID,
) => Promise<Array<UserOverridePolicy>> = async (
  onCallDutyPolicyScheduleId: ObjectID,
): Promise<Array<UserOverridePolicy>> => {
  const result: ListResult<OnCallDutyPolicyEscalationRuleSchedule> =
    await ModelAPI.getList<OnCallDutyPolicyEscalationRuleSchedule>({
      modelType: OnCallDutyPolicyEscalationRuleSchedule,
      query: {
        onCallDutyPolicyScheduleId: onCallDutyPolicyScheduleId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        onCallDutyPolicyId: true,
        onCallDutyPolicy: {
          _id: true,
          name: true,
        },
      },
      sort: {},
    });

  return getDistinctPolicies(
    result.data.map(
      (rule: OnCallDutyPolicyEscalationRuleSchedule): UserOverridePolicy => {
        const id: string =
          rule.onCallDutyPolicyId?.toString() ||
          rule.onCallDutyPolicy?.id?.toString() ||
          "";

        return {
          id: id,
          name: rule.onCallDutyPolicy?.name?.toString() || id,
        };
      },
    ),
  );
};

// The policies that page through shifts, as the server sent them with each.
export const getShiftPolicies: (
  shifts: Array<MaterializedShiftJson>,
) => Array<UserOverridePolicy> = (
  shifts: Array<MaterializedShiftJson>,
): Array<UserOverridePolicy> => {
  const policies: Array<UserOverridePolicy> = [];

  for (const shift of shifts) {
    for (const policy of shift.policies || []) {
      policies.push({
        id: policy.policyId,
        name: policy.policyName || policy.policyId,
      });
    }
  }

  return getDistinctPolicies(policies);
};

// Of `policies`, in their order and each once, those the server's answer lets the reader cover.
export const getPoliciesToOffer: (data: {
  policies: Array<UserOverridePolicy>;
  access: UserOverrideAddAccess;
}) => Array<UserOverridePolicy> = (data: {
  policies: Array<UserOverridePolicy>;
  access: UserOverrideAddAccess;
}): Array<UserOverridePolicy> => {
  return getDistinctPolicies(data.policies).filter(
    (policy: UserOverridePolicy): boolean => {
      return UserOverrideAddAccessUtil.mayAddOn(data.access, policy.id);
    },
  );
};

/*
 * Adds `override` on each of `onCallDutyPolicyIds`, a copy on each, one
 * after another. A policy `saved` already holds is passed over, and each
 * one added is put in it: a save that failed part way is tried again
 * without adding an override twice.
 */
export const addUserOverrideOnPolicies: (data: {
  override: OnCallDutyPolicyUserOverride;
  onCallDutyPolicyIds: Array<string>;
  saved: Set<string>;
}) => Promise<void> = async (data: {
  override: OnCallDutyPolicyUserOverride;
  onCallDutyPolicyIds: Array<string>;
  saved: Set<string>;
}): Promise<void> => {
  for (const onCallDutyPolicyId of data.onCallDutyPolicyIds) {
    const savedKey: string = onCallDutyPolicyId.trim().toLowerCase();

    if (data.saved.has(savedKey)) {
      continue;
    }

    const copy: OnCallDutyPolicyUserOverride =
      OnCallDutyPolicyUserOverride.fromJSON(
        OnCallDutyPolicyUserOverride.toJSON(
          data.override,
          OnCallDutyPolicyUserOverride,
        ),
        OnCallDutyPolicyUserOverride,
      ) as OnCallDutyPolicyUserOverride;

    copy.onCallDutyPolicyId = new ObjectID(onCallDutyPolicyId);

    await ModelAPI.create<OnCallDutyPolicyUserOverride>({
      model: copy,
      modelType: OnCallDutyPolicyUserOverride,
    });

    data.saved.add(savedKey);
  }
};
