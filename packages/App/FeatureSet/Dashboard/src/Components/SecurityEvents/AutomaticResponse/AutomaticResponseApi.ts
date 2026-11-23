import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import SecurityAutomaticResponsePolicy from "Common/Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityAutomaticResponseOverviewData,
  readSecurityAutomaticResponseOverview,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SecurityAutomaticResponseMatch,
  SecurityAutomaticResponseMode,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The calls the Automatic Response page makes (#10350): its read - every
 * policy with where it stands, what it would have done and did, its time
 * to block and its rules, and the destinations that enforce the blocklist
 * (Common/Server/API/SecurityAutomaticResponsePolicyAPI) - and the policy's
 * own CRUD: its mode, and a project's own policy made, changed or deleted.
 * The server stamps who turned a policy on, and refuses anybody but a
 * Security Admin, a Project Admin or a Project Owner.
 */

export const AUTOMATIC_RESPONSE_OVERVIEW_PATH: string =
  "/security-automatic-response-policy/overview";

// The page's read.
export async function readAutomaticResponseOverview(): Promise<SecurityAutomaticResponseOverviewData> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(AUTOMATIC_RESPONSE_OVERVIEW_PATH),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readSecurityAutomaticResponseOverview(
    (response.data || {}) as JSONObject,
  );
}

// Moves a policy to Off, Trial Run or On.
export async function setAutomaticResponseMode(data: {
  policyId: string;
  mode: SecurityAutomaticResponseMode;
}): Promise<void> {
  await ModelAPI.updateById<SecurityAutomaticResponsePolicy>({
    modelType: SecurityAutomaticResponsePolicy,
    id: new ObjectID(data.policyId),
    data: { mode: data.mode },
  });
}

// What a project's own policy is made or changed with.
export interface OwnPolicyValues {
  name: string;
  description: string;
  blockAction: SecurityBlockAction;
  duration: SecurityBlockDuration;
  match: SecurityAutomaticResponseMatch;
}

function toColumns(values: OwnPolicyValues): JSONObject {
  return {
    name: values.name,
    description: values.description,
    blockAction: values.blockAction,
    duration: values.duration,
    matchConditions: values.match as unknown as JSONObject,
  };
}

// Makes a project's own policy: Off, until someone turns it on.
export async function createOwnPolicy(values: OwnPolicyValues): Promise<void> {
  const policy: SecurityAutomaticResponsePolicy =
    new SecurityAutomaticResponsePolicy();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (projectId) {
    policy.projectId = projectId;
  }

  policy.name = values.name;
  policy.description = values.description;
  policy.blockAction = values.blockAction;
  policy.duration = values.duration;
  policy.matchConditions = values.match as unknown as JSONObject;
  policy.mode = SecurityAutomaticResponseMode.Off;

  await ModelAPI.create<SecurityAutomaticResponsePolicy>({
    model: policy,
    modelType: SecurityAutomaticResponsePolicy,
  });
}

export async function updateOwnPolicy(data: {
  policyId: string;
  values: OwnPolicyValues;
}): Promise<void> {
  await ModelAPI.updateById<SecurityAutomaticResponsePolicy>({
    modelType: SecurityAutomaticResponsePolicy,
    id: new ObjectID(data.policyId),
    data: toColumns(data.values),
  });
}

export async function deleteOwnPolicy(policyId: string): Promise<void> {
  await ModelAPI.deleteItem<SecurityAutomaticResponsePolicy>({
    modelType: SecurityAutomaticResponsePolicy,
    id: new ObjectID(policyId),
  });
}

export interface DetectionRuleChoice {
  id: string;
  name: string;
}

// The project's detection rules, for a policy's Detection Rules field: by name.
export async function readDetectionRuleChoices(): Promise<
  Array<DetectionRuleChoice>
> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const result: ListResult<DetectionRule> =
    await ModelAPI.getList<DetectionRule>({
      modelType: DetectionRule,
      query: { projectId },
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  return result.data
    .map((rule: DetectionRule): DetectionRuleChoice => {
      return {
        id: rule._id?.toString() || rule.id?.toString() || "",
        name: (rule.name || "").trim(),
      };
    })
    .filter((rule: DetectionRuleChoice): boolean => {
      return Boolean(rule.id && rule.name);
    });
}
