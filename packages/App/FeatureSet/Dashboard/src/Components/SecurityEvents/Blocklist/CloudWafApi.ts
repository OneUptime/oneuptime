import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafLeftKind,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The calls the Blocklist's Cloud WAFs card makes besides its CRUD
 * (#10344, Common/Server/API/SecurityBlockCloudWafAPI): the web ACLs of the
 * project's AWS inventory that may be picked, Check Again, and Remove -
 * which takes OneUptime's rule and IP sets out of AWS WAF first, or leaves
 * them, naming what stays.
 */

export const CLOUD_WAF_CANDIDATES_PATH: string =
  "/security-block-cloud-waf/candidates";

export function getCloudWafCheckPath(id: ObjectID): string {
  return `/security-block-cloud-waf/${id.toString()}/check`;
}

export function getCloudWafRemovePath(id: ObjectID): string {
  return `/security-block-cloud-waf/${id.toString()}/remove`;
}

// A web ACL of the inventory, and whether it may be picked.
export interface CloudWafCandidate {
  cloudResourceId: string;
  name: string;
  region: string;
  accountId: string;
  isCloudFront: boolean;
  connectionId: string;
  connectionName: string;
  // Its connection may write AWS WAF: Block addresses in AWS WAF is on.
  isBlockingOn: boolean;
  // OneUptime has read it whole (its ARN), not only seen its metrics.
  isListed: boolean;
  isPicked: boolean;
}

export interface CloudWafConnection {
  id: string;
  name: string;
  isBlockingOn: boolean;
}

export interface CloudWafCandidates {
  candidates: Array<CloudWafCandidate>;
  connections: Array<CloudWafConnection>;
}

export interface CloudWafCheck {
  status: string | null;
  statusMessage: string | null;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
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
      name: readText(object["name"]) || cloudResourceId,
      region: readText(object["region"]),
      accountId: readText(object["accountId"]),
      isCloudFront: object["isCloudFront"] === true,
      connectionId: readText(object["connectionId"]),
      connectionName: readText(object["connectionName"]),
      isBlockingOn: object["isBlockingOn"] === true,
      isListed: object["isListed"] === true,
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
        isBlockingOn: object["isBlockingOn"] === true,
      });
    }
  }

  return { candidates, connections };
}

// The web ACLs of the project's AWS accounts, and their connections.
export async function readCloudWafCandidates(): Promise<CloudWafCandidates> {
  return readCloudWafCandidatesAnswer(
    await post(CLOUD_WAF_CANDIDATES_PATH, {}),
  );
}

// Sets the web ACL up now, and says where it stands.
export async function checkCloudWaf(id: ObjectID): Promise<CloudWafCheck> {
  const data: JSONObject = await post(getCloudWafCheckPath(id), {});
  const cloudWaf: JSONObject | null = readObject(data["cloudWaf"]);

  return {
    status: readText(cloudWaf?.["status"]) || null,
    statusMessage: readText(cloudWaf?.["statusMessage"]) || null,
  };
}

// Removes it, and names what OneUptime left in AWS WAF.
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
    const kind: string = readText(object?.["kind"]);

    if (!object || !name) {
      continue;
    }

    if (kind === SecurityBlockCloudWafLeftKind.Rule) {
      items.push({
        kind: SecurityBlockCloudWafLeftKind.Rule,
        name,
        webAcl: readText(object["webAcl"]),
      });
    } else if (kind === SecurityBlockCloudWafLeftKind.IpSet) {
      items.push({ kind: SecurityBlockCloudWafLeftKind.IpSet, name });
    }
  }

  return items;
}
