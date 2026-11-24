import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityRepeatOffenderSummary,
  readSecurityRepeatOffenderSummary,
} from "Common/Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityAttackCampaignGrouping,
  SecurityAttackNetwork,
  SecurityAttackNetworksResult,
  readSecurityAttackNetwork,
} from "Common/Types/SecurityEvent/SecurityAttackNetwork";
import {
  SecurityCampaignAddressCheck,
  SecurityCampaignAddressesCheck,
  SecurityCampaignOfCaseAddress,
  SecurityNetworkChallengeCheck,
  readSecurityCampaignAddressCheck,
  readSecurityCampaignAddressesCheck,
  readSecurityCampaignOfCaseAddress,
  readSecurityNetworkChallengeCheck,
} from "Common/Types/SecurityEvent/SecurityCampaignContainment";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT CAMPAIGNS' ACTIONS CALL (#10354), beside the page's own read
 * (Common/Server/API/SecurityAttackCampaignAPI): the campaigns grouped by
 * network; Block Addresses' check and block; Challenge This Network's
 * check and challenge; a case's Block the Whole Campaign - the campaign of
 * its address, and the one run that blocks it
 * (SecurityPlaybookRunAPI's block-campaign); and a case's repeat offenders
 * (SecurityBlockAPI's repeat-offenders).
 */

export const CAMPAIGNS_PATH: string = "/security-event/attack-campaigns";
export const CAMPAIGNS_BLOCK_CHECK_PATH: string = `${CAMPAIGNS_PATH}/block-check`;
export const CAMPAIGNS_BLOCK_PATH: string = `${CAMPAIGNS_PATH}/block`;
export const CAMPAIGNS_NETWORK_CHECK_PATH: string = `${CAMPAIGNS_PATH}/network-check`;
export const CAMPAIGNS_NETWORK_CHALLENGE_PATH: string = `${CAMPAIGNS_PATH}/network-challenge`;
export const CAMPAIGNS_OF_CASE_ADDRESS_PATH: string = `${CAMPAIGNS_PATH}/of-case-address`;
export const BLOCK_CAMPAIGN_FROM_CASE_PATH: string =
  "/security-playbook-run/block-campaign";
export const REPEAT_OFFENDERS_PATH: string = "/security-block/repeat-offenders";

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

// The window a read covers, as the page asks for it.
export interface CampaignWindowRange {
  startTime: Date;
  endTime: Date;
}

// The window's campaigns, one row per network they came from.
export async function getAttackNetworks(
  window: CampaignWindowRange,
): Promise<SecurityAttackNetworksResult> {
  const body: JSONObject = await post(CAMPAIGNS_PATH, {
    startTime: window.startTime.toISOString(),
    endTime: window.endTime.toISOString(),
    groupBy: SecurityAttackCampaignGrouping.Network,
  });
  const networks: JSONValue | undefined = body["networks"];

  return {
    networks: Array.isArray(networks)
      ? networks
          .filter((row: JSONValue): boolean => {
            return Boolean(row) && typeof row === "object";
          })
          .map((row: JSONValue): SecurityAttackNetwork => {
            return readSecurityAttackNetwork(row as JSONObject);
          })
      : [],
    startTime: String(body["startTime"] || window.startTime.toISOString()),
    endTime: String(body["endTime"] || window.endTime.toISOString()),
    isTruncated: body["isTruncated"] === true,
  };
}

// Block Addresses' check: what a block of each address would meet.
export async function checkCampaignAddresses(
  values: Array<string>,
): Promise<SecurityCampaignAddressesCheck> {
  return readSecurityCampaignAddressesCheck(
    await post(CAMPAIGNS_BLOCK_CHECK_PATH, { values }),
  );
}

// Block Addresses: every address blocked in one go, or said why not.
export async function blockCampaignAddresses(request: {
  values: Array<string>;
  action: SecurityBlockAction;
  duration: SecurityBlockDuration;
  reason?: string | undefined;
}): Promise<SecurityCampaignAddressesCheck> {
  return readSecurityCampaignAddressesCheck(
    await post(CAMPAIGNS_BLOCK_PATH, {
      values: request.values,
      action: request.action,
      duration: request.duration,
      ...(request.reason ? { reason: request.reason } : {}),
    }),
  );
}

/*
 * Challenge This Network's check, over the window the page read: what
 * OneUptime knows of an ASN's addresses.
 */
export async function checkNetworkChallenge(data: {
  value: string;
  window: CampaignWindowRange;
}): Promise<SecurityNetworkChallengeCheck> {
  const check: SecurityNetworkChallengeCheck | null =
    readSecurityNetworkChallengeCheck(
      await post(CAMPAIGNS_NETWORK_CHECK_PATH, {
        value: data.value,
        startTime: data.window.startTime.toISOString(),
        endTime: data.window.endTime.toISOString(),
      }),
    );

  if (!check) {
    throw new Error("The network could not be checked. Try again.");
  }

  return check;
}

export interface NetworkChallenged {
  value: string;
  expiresAt: Date | null;
  holders: Array<string>;
}

export async function challengeNetwork(data: {
  value: string;
  duration: SecurityBlockDuration;
  reason?: string | undefined;
  acknowledgesUnchecked: boolean;
  window: CampaignWindowRange;
}): Promise<NetworkChallenged> {
  const body: JSONObject = await post(CAMPAIGNS_NETWORK_CHALLENGE_PATH, {
    value: data.value,
    duration: data.duration,
    ...(data.reason ? { reason: data.reason } : {}),
    acknowledgesUnchecked: data.acknowledgesUnchecked,
    startTime: data.window.startTime.toISOString(),
    endTime: data.window.endTime.toISOString(),
  });
  const expiresAt: Date | null =
    typeof body["expiresAt"] === "string" ? new Date(body["expiresAt"]) : null;

  return {
    value: typeof body["value"] === "string" ? body["value"] : data.value,
    expiresAt:
      expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
    holders: (Array.isArray(body["holders"]) ? body["holders"] : []).filter(
      (name: JSONValue): name is string => {
        return typeof name === "string" && Boolean(name.trim());
      },
    ),
  };
}

// The campaign of one of a case's addresses: what Block the Whole Campaign offers.
export async function readCampaignOfCaseAddress(data: {
  securityCaseId: ObjectID;
  address: string;
}): Promise<SecurityCampaignOfCaseAddress | null> {
  return readSecurityCampaignOfCaseAddress(
    await post(CAMPAIGNS_OF_CASE_ADDRESS_PATH, {
      securityCaseId: data.securityCaseId.toString(),
      address: data.address,
    }),
  );
}

export interface WholeCampaignBlockStarted {
  runId: string;
  // The block waits for someone else's approval before it is made.
  needsApproval: boolean;
  blocking: Array<string>;
  leftOut: Array<SecurityCampaignAddressCheck>;
}

/*
 * Block the Whole Campaign: one run of the engine - one approval - for the
 * case's address and the campaign's addresses the person kept.
 */
export async function blockWholeCampaign(data: {
  securityCaseId: ObjectID;
  address: string;
  values: Array<string>;
  blockAction: SecurityBlockAction;
  duration: SecurityBlockDuration;
}): Promise<WholeCampaignBlockStarted> {
  const body: JSONObject = await post(BLOCK_CAMPAIGN_FROM_CASE_PATH, {
    securityCaseId: data.securityCaseId.toString(),
    value: data.address,
    values: data.values,
    blockAction: data.blockAction,
    duration: data.duration,
  });
  const leftOut: Array<SecurityCampaignAddressCheck> = [];

  for (const item of Array.isArray(body["leftOut"]) ? body["leftOut"] : []) {
    const check: SecurityCampaignAddressCheck | null =
      readSecurityCampaignAddressCheck(item as JSONValue);

    if (check) {
      leftOut.push(check);
    }
  }

  return {
    runId: typeof body["runId"] === "string" ? body["runId"] : "",
    needsApproval: body["needsApproval"] === true,
    blocking: (Array.isArray(body["blocking"]) ? body["blocking"] : []).filter(
      (value: JSONValue): value is string => {
        return typeof value === "string";
      },
    ),
    leftOut,
  };
}

/*
 * The case's addresses blocked before it opened, by address: none for an
 * address never blocked before.
 */
export async function readRepeatOffenders(data: {
  securityCaseId: ObjectID;
  addresses: Array<string>;
}): Promise<Map<string, SecurityRepeatOffenderSummary>> {
  const offenders: Map<string, SecurityRepeatOffenderSummary> = new Map();

  if (data.addresses.length === 0) {
    return offenders;
  }

  const body: JSONObject = await post(REPEAT_OFFENDERS_PATH, {
    values: data.addresses,
    securityCaseId: data.securityCaseId.toString(),
  });

  for (const item of Array.isArray(body["offenders"])
    ? body["offenders"]
    : []) {
    const summary: SecurityRepeatOffenderSummary | null =
      readSecurityRepeatOffenderSummary(item as JSONValue);

    if (summary) {
      offenders.set(summary.value, summary);
    }
  }

  return offenders;
}
