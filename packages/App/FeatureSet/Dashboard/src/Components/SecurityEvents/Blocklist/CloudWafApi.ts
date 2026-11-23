import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafLeftKind,
  isSecurityBlockClientAddress,
  isSecurityBlockCloudWafLeftKind,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { SecurityBlockCloudWafKind } from "Common/Types/SecurityBlocklist/SecurityBlockCloudWafKind";
import {
  SecurityBlockReason,
  readSecurityBlockReason,
} from "Common/Types/SecurityBlocklist/SecurityBlockReason";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The calls the Blocklist's Cloud WAFs card makes besides its CRUD
 * (#10344, #10348, #10349, Common/Server/API/SecurityBlockCloudWafAPI): the
 * WAFs of the project's inventory that may be picked, whether a connection
 * may write an Azure WAF or Cloud Armor policy (and the lines that let it),
 * Check Again, Put It Back, and Remove - which takes OneUptime's rules out
 * of the WAF first, or leaves them, naming what stays.
 */

export const CLOUD_WAF_CANDIDATES_PATH: string =
  "/security-block-cloud-waf/candidates";

export const CLOUD_WAF_CHECK_ACCESS_PATH: string =
  "/security-block-cloud-waf/check-access";

export function getCloudWafCheckPath(id: ObjectID): string {
  return `/security-block-cloud-waf/${id.toString()}/check`;
}

export function getCloudWafPutBackPath(id: ObjectID): string {
  return `/security-block-cloud-waf/${id.toString()}/put-back`;
}

export function getCloudWafRemovePath(id: ObjectID): string {
  return `/security-block-cloud-waf/${id.toString()}/remove`;
}

// A WAF of the inventory, and whether it may be picked.
export interface CloudWafCandidate {
  cloudResourceId: string;
  cloudProvider: string;
  // Null for one OneUptime cannot read whole.
  kind: SecurityBlockCloudWafKind | null;
  name: string;
  region: string;
  accountId: string;
  isCloudFront: boolean;
  // A Cloud Armor policy's type: CLOUD_ARMOR, CLOUD_ARMOR_EDGE.
  cloudArmorPolicyType: string | null;
  // Where it can read the client's address, its default first.
  clientAddresses: Array<SecurityBlockClientAddress>;
  connectionId: string;
  connectionName: string;
  // Its connection may block addresses: its blocking setting is on.
  isBlockingOn: boolean;
  // OneUptime has read it whole, not only seen its metrics.
  isListed: boolean;
  // Why it cannot be picked, in the server's words: a network edge policy.
  refusal: string;
  // The same, as a reason worded in the reader's language (#10629).
  refusalReason: SecurityBlockReason | null;
  isPicked: boolean;
}

export interface CloudWafConnection {
  id: string;
  name: string;
  provider: string;
  isBlockingOn: boolean;
}

export interface CloudWafCandidates {
  candidates: Array<CloudWafCandidate>;
  connections: Array<CloudWafConnection>;
}

export interface CloudWafCheck {
  status: string | null;
  statusMessage: string | null;
  statusReason: SecurityBlockReason | null;
}

// Whether a connection may write a policy, and the lines that let it.
export interface CloudWafAccess {
  checks: Array<{ permission: string; isGranted: boolean }>;
  isGranted: boolean;
  command: string;
  shell: "azure" | "gcp";
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readKind(
  value: JSONValue | undefined,
): SecurityBlockCloudWafKind | null {
  return typeof value === "string" &&
    (Object.values(SecurityBlockCloudWafKind) as Array<string>).includes(value)
    ? (value as SecurityBlockCloudWafKind)
    : null;
}

async function post(path: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(path),
      headers: ModelAPI.getCommonHeaders(),
      data,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

export function readCloudWafCandidatesAnswer(
  data: JSONObject,
): CloudWafCandidates {
  const candidates: Array<CloudWafCandidate> = [];
  const connections: Array<CloudWafConnection> = [];

  for (const item of Array.isArray(data["candidates"])
    ? data["candidates"]
    : []) {
    const object: JSONObject | null = readObject(item);
    const cloudResourceId: string = readText(object?.["cloudResourceId"]);

    if (!object || !cloudResourceId) {
      continue;
    }

    candidates.push({
      cloudResourceId,
      cloudProvider: readText(object["cloudProvider"]),
      kind: readKind(object["kind"]),
      name: readText(object["name"]) || cloudResourceId,
      region: readText(object["region"]),
      accountId: readText(object["accountId"]),
      isCloudFront: object["isCloudFront"] === true,
      cloudArmorPolicyType: readText(object["cloudArmorPolicyType"]) || null,
      clientAddresses: (Array.isArray(object["clientAddresses"])
        ? (object["clientAddresses"] as Array<JSONValue>)
        : []
      ).filter(isSecurityBlockClientAddress),
      connectionId: readText(object["connectionId"]),
      connectionName: readText(object["connectionName"]),
      isBlockingOn: object["isBlockingOn"] === true,
      isListed: object["isListed"] === true,
      refusal: readText(object["refusal"]),
      refusalReason: readSecurityBlockReason(object["refusalReason"]),
      isPicked: object["isPicked"] === true,
    });
  }

  for (const item of Array.isArray(data["connections"])
    ? data["connections"]
    : []) {
    const object: JSONObject | null = readObject(item);
    const id: string = readText(object?.["_id"]);

    if (object && id) {
      connections.push({
        id,
        name: readText(object["name"]),
        provider: readText(object["provider"]),
        isBlockingOn: object["isBlockingOn"] === true,
      });
    }
  }

  return { candidates, connections };
}

// The WAFs of the project's cloud accounts, and their connections.
export async function readCloudWafCandidates(): Promise<CloudWafCandidates> {
  return readCloudWafCandidatesAnswer(
    await post(CLOUD_WAF_CANDIDATES_PATH, {}),
  );
}

export function readCloudWafAccessAnswer(data: JSONObject): CloudWafAccess {
  const checks: Array<{ permission: string; isGranted: boolean }> = [];

  for (const item of Array.isArray(data["checks"]) ? data["checks"] : []) {
    const object: JSONObject | null = readObject(item);
    const permission: string = readText(object?.["permission"]);

    if (object && permission) {
      checks.push({ permission, isGranted: object["isGranted"] === true });
    }
  }

  return {
    checks,
    isGranted:
      data["isGranted"] === true &&
      checks.every((check: { isGranted: boolean }): boolean => {
        return check.isGranted;
      }),
    command: readText(data["command"]),
    shell: readText(data["shell"]) === "gcp" ? "gcp" : "azure",
  };
}

// Whether the connection may read and write a policy, asked without writing anything.
export async function checkCloudWafAccess(
  cloudResourceId: string,
): Promise<CloudWafAccess> {
  return readCloudWafAccessAnswer(
    await post(CLOUD_WAF_CHECK_ACCESS_PATH, { cloudResourceId }),
  );
}

function readCheck(data: JSONObject): CloudWafCheck {
  const cloudWaf: JSONObject | null = readObject(data["cloudWaf"]);

  return {
    status: readText(cloudWaf?.["status"]) || null,
    statusMessage: readText(cloudWaf?.["statusMessage"]) || null,
    statusReason: readSecurityBlockReason(cloudWaf?.["statusReason"]),
  };
}

// Sets the WAF up now, and says where it stands.
export async function checkCloudWaf(id: ObjectID): Promise<CloudWafCheck> {
  return readCheck(await post(getCloudWafCheckPath(id), {}));
}

// Writes OneUptime's rules changed by hand again, and says where the policy stands.
export async function putBackCloudWaf(id: ObjectID): Promise<CloudWafCheck> {
  return readCheck(await post(getCloudWafPutBackPath(id), {}));
}

// Removes it, and names what OneUptime left in the cloud.
export async function removeCloudWaf(data: {
  id: ObjectID;
  keepInCloud: boolean;
}): Promise<Array<SecurityBlockCloudWafLeftItem>> {
  return readCloudWafLeftInCloud(
    await post(getCloudWafRemovePath(data.id), {
      keepInCloud: data.keepInCloud,
    }),
  );
}

export function readCloudWafLeftInCloud(
  data: JSONObject,
): Array<SecurityBlockCloudWafLeftItem> {
  const items: Array<SecurityBlockCloudWafLeftItem> = [];

  for (const item of Array.isArray(data["leftInCloud"])
    ? data["leftInCloud"]
    : []) {
    const object: JSONObject | null = readObject(item);
    const name: string = readText(object?.["name"]);
    const kind: JSONValue | undefined = object?.["kind"];

    if (!object || !name || !isSecurityBlockCloudWafLeftKind(kind)) {
      continue;
    }

    const priority: JSONValue | undefined = object["priority"];

    items.push({
      kind,
      name,
      ...(kind === SecurityBlockCloudWafLeftKind.Rule ||
      kind === SecurityBlockCloudWafLeftKind.PriorityRule
        ? { webAcl: readText(object["webAcl"]) }
        : {}),
      ...(kind === SecurityBlockCloudWafLeftKind.PriorityRule &&
      typeof priority === "number"
        ? { priority }
        : {}),
    });
  }

  return items;
}
