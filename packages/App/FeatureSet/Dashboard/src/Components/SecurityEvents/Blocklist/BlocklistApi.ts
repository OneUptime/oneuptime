import SecurityBlockEnforcement from "Common/Models/DatabaseModels/SecurityBlockEnforcement";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Includes from "Common/Types/BaseDatabase/Includes";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
  isSecurityBlockAction,
  isSecurityBlockIndicatorType,
  isSecurityBlockReach,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockHolder } from "Common/Types/SecurityBlocklist/SecurityBlockHolders";
import {
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
} from "Common/Types/SecurityBlocklist/SecurityProtectedAddress";
import {
  ResponseBlock,
  ResponseBlocklist,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The calls the Blocklist page and Protected Entities make besides their
 * CRUD (#10338): what a block of a value would meet, asked before it is
 * made (Common/Server/API/SecurityBlockAPI); where the blocklist is
 * enforced; each listed block's enforcement rows; and what OneUptime
 * protects by itself (SecurityProtectedEntityAPI).
 */

export const SECURITY_BLOCK_CHECK_PATH: string = "/security-block/check";
export const SECURITY_BLOCK_DESTINATIONS_PATH: string =
  "/security-block/destinations";
export const SECURITY_BLOCK_FOR_VALUES_PATH: string =
  "/security-block/for-values";
export const AUTOMATIC_PROTECTIONS_PATH: string =
  "/security-protected-entity/automatic";

// What a block of a value would meet.
export interface BlockValueCheck {
  value: string | null;
  isWiderThanLargestRange: boolean;
  coveredBy: { id: string | null; value: string } | null;
  protection: SecurityAddressProtection | null;
  // What would protect it could not be read: the block would be refused.
  cannotTell: boolean;
  // The value holds the address the person is using right now.
  isYourAddress: boolean;
  yourAddress: string | null;
}

export interface BlocklistDestination {
  key: string;
  name: string;
  provider: string;
  /*
   * It enforces on every machine (#10346): Microsoft Defender, CrowdStrike
   * Falcon. Such a destination holds only what is blocked everywhere, never
   * an address blocked at the edge alone.
   */
  enforcesOnEveryMachine?: boolean | undefined;
}

export interface BlocklistDestinations {
  destinations: Array<BlocklistDestination>;
  cannotTell: boolean;
}

export interface AutomaticProtectionGroup {
  source: SecurityProtectedAddressSource;
  protections: Array<SecurityAddressProtection>;
  hasMore: boolean;
  isRead: boolean;
}

function readText(value: JSONValue | undefined): string | null {
  return typeof value === "string" && value ? value : null;
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readProtection(
  value: JSONValue | undefined,
  source?: SecurityProtectedAddressSource | undefined,
): SecurityAddressProtection | null {
  const object: JSONObject | null = readObject(value);
  const protectedValue: string | null = readText(object?.["protectedValue"]);
  const readSource: string | null =
    readText(object?.["source"]) || source || null;

  if (!object || !protectedValue || !readSource) {
    return null;
  }

  const name: string | null = readText(object["name"]);
  const kind: string | null = readText(object["kind"]);
  const where: string | null = readText(object["where"]);

  return {
    source: readSource as SecurityProtectedAddressSource,
    protectedValue,
    ...(name ? { name } : {}),
    ...(kind ? { kind } : {}),
    ...(where ? { where } : {}),
  };
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

/*
 * What a block of `value` would meet, as the server answers it: covered by
 * a block that already does what it would, where it would be enforced.
 */
export async function checkBlockValue(
  value: string,
  reach?: SecurityBlockReach | undefined,
): Promise<BlockValueCheck> {
  return readBlockValueCheck(
    await post(SECURITY_BLOCK_CHECK_PATH, {
      value,
      ...(reach ? { reach } : {}),
    }),
  );
}

export function readBlockValueCheck(data: JSONObject): BlockValueCheck {
  const coveredBy: JSONObject | null = readObject(data["coveredBy"]);
  const coveredValue: string | null = readText(coveredBy?.["value"]);

  return {
    value: readText(data["value"]),
    isWiderThanLargestRange: data["isWiderThanLargestRange"] === true,
    coveredBy: coveredValue
      ? { id: readText(coveredBy?.["_id"]), value: coveredValue }
      : null,
    protection: readProtection(data["protection"]),
    cannotTell: data["cannotTell"] === true,
    isYourAddress: data["isYourAddress"] === true,
    yourAddress: readText(data["yourAddress"]),
  };
}

// Where the project's blocklist is enforced.
export async function readBlocklistDestinations(): Promise<BlocklistDestinations> {
  const data: JSONObject = await post(SECURITY_BLOCK_DESTINATIONS_PATH, {});
  const destinations: Array<BlocklistDestination> = [];

  for (const item of Array.isArray(data["destinations"])
    ? data["destinations"]
    : []) {
    const object: JSONObject | null = readObject(item);
    const key: string | null = readText(object?.["key"]);
    const name: string | null = readText(object?.["name"]);

    if (key && name) {
      destinations.push({
        key,
        name,
        provider: readText(object?.["provider"]) || "",
        enforcesOnEveryMachine: object?.["enforcesOnEveryMachine"] === true,
      });
    }
  }

  return { destinations, cannotTell: data["cannotTell"] === true };
}

// The enforcement rows of the listed blocks, by block.
export async function readBlockEnforcements(
  blockIds: Array<ObjectID>,
): Promise<Map<string, Array<SecurityBlockEnforcement>>> {
  const byBlock: Map<string, Array<SecurityBlockEnforcement>> = new Map();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (blockIds.length === 0 || !projectId) {
    return byBlock;
  }

  const result: ListResult<SecurityBlockEnforcement> =
    await ModelAPI.getList<SecurityBlockEnforcement>({
      modelType: SecurityBlockEnforcement,
      query: {
        projectId,
        securityBlockId: new Includes(blockIds),
      },
      select: {
        _id: true,
        securityBlockId: true,
        destinationKey: true,
        destinationName: true,
        provider: true,
        state: true,
        appliedAt: true,
        lastConfirmedAt: true,
        error: true,
      },
      limit: 1000,
      skip: 0,
      sort: {},
    });

  for (const row of result.data) {
    const blockId: string = row.securityBlockId?.toString() || "";

    if (!blockId) {
      continue;
    }

    const rows: Array<SecurityBlockEnforcement> = byBlock.get(blockId) || [];
    rows.push(row);
    byBlock.set(blockId, rows);
  }

  return byBlock;
}

/*
 * What a case's Response Plan reads of the blocklist (#10346): what the
 * project's destinations can hold, and the blocks in force on the values
 * the case names, with where each holds now.
 */
export async function readCaseBlocklist(
  values: Array<string>,
): Promise<ResponseBlocklist> {
  return readResponseBlocklist(
    await post(SECURITY_BLOCK_FOR_VALUES_PATH, { values }),
  );
}

export function readResponseBlocklist(data: JSONObject): ResponseBlocklist {
  const holders: Array<SecurityBlockHolder> = [];
  const blocks: Array<ResponseBlock> = [];

  for (const item of Array.isArray(data["holders"]) ? data["holders"] : []) {
    const object: JSONObject | null = readObject(item);
    const name: string | null = readText(object?.["name"]);

    if (!object || !name) {
      continue;
    }

    holders.push({
      name,
      provider: readText(object["provider"]) || "",
      enforcesOnEveryMachine: object["enforcesOnEveryMachine"] === true,
      blocks: (Array.isArray(object["blocks"]) ? object["blocks"] : []).filter(
        (type: JSONValue): type is SecurityBlockIndicatorType => {
          return isSecurityBlockIndicatorType(type);
        },
      ),
      quarantinesFiles: object["quarantinesFiles"] === true,
    });
  }

  for (const item of Array.isArray(data["blocks"]) ? data["blocks"] : []) {
    const object: JSONObject | null = readObject(item);
    const value: string | null = readText(object?.["value"]);

    if (!object || !value) {
      continue;
    }

    blocks.push({
      value,
      reach: isSecurityBlockReach(object["reach"])
        ? object["reach"]
        : SecurityBlockReach.Edge,
      action: isSecurityBlockAction(object["action"])
        ? object["action"]
        : SecurityBlockAction.Block,
      enforcedAt: (Array.isArray(object["enforcedAt"])
        ? object["enforcedAt"]
        : []
      ).filter((name: JSONValue): name is string => {
        return typeof name === "string" && name.length > 0;
      }),
    });
  }

  return { holders, blocks };
}

// What OneUptime protects of the project by itself, source by source.
export async function readAutomaticProtections(): Promise<
  Array<AutomaticProtectionGroup>
> {
  const data: JSONObject = await post(AUTOMATIC_PROTECTIONS_PATH, {});
  const groups: Array<AutomaticProtectionGroup> = [];

  for (const item of Array.isArray(data["groups"]) ? data["groups"] : []) {
    const object: JSONObject | null = readObject(item);
    const source: string | null = readText(object?.["source"]);

    if (!object || !source) {
      continue;
    }

    const protections: Array<SecurityAddressProtection> = [];

    for (const entry of Array.isArray(object["protections"])
      ? object["protections"]
      : []) {
      const protection: SecurityAddressProtection | null = readProtection(
        entry,
        source as SecurityProtectedAddressSource,
      );

      if (protection) {
        protections.push(protection);
      }
    }

    groups.push({
      source: source as SecurityProtectedAddressSource,
      protections,
      hasMore: object["hasMore"] === true,
      isRead: object["isRead"] !== false,
    });
  }

  return groups;
}
