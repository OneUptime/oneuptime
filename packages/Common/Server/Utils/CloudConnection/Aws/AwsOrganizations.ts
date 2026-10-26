import { JSONObject } from "../../../../Types/JSON";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorTransport,
  CloudReadBudget,
} from "../CloudConnectorTypes";
import {
  AwsCredentials,
  AwsPartition,
  getAwsPartition,
  sendAwsRequest,
} from "./AwsApi";

/*
 * AWS Organizations' ListAccounts (AWS JSON 1.1, target
 * AWSOrganizationsV20161128.ListAccounts), called from the organization's
 * management account (or its delegated administrator): every account of
 * the organization, read with the role a StackSet put in each.
 *
 *   { NextToken } -> { Accounts: [{ Id, Name, State, Status }], NextToken }
 *
 * An account's lifecycle is its State (ACTIVE, SUSPENDED, PENDING_CLOSURE,
 * CLOSED, PENDING_ACTIVATION); AWS retired the older Status on 9 September
 * 2026, so State is read first and Status only when State is absent. Only
 * an ACTIVE account is read: any other has no role to sign in to.
 *
 * The accounts' email addresses are in the answer and are not kept.
 */

const ORGANIZATIONS_SERVICE: string = "organizations";
const TARGET: string = "AWSOrganizationsV20161128.ListAccounts";
const PROVIDER_TITLE: string = "AWS Organizations";
const MAX_PAGES: number = 50;

export interface AwsOrganizationAccount {
  id: string;
  name: string;
}

/*
 * Whether an account of the organization is in use: its State, or - from
 * an answer older than State - its Status, says ACTIVE. An account that
 * says neither is taken as active: AWS lists every account it can.
 */
export function isAwsOrganizationAccountActive(account: JSONObject): boolean {
  const state: string = (
    readText(account["State"]) || readText(account["Status"])
  ).toUpperCase();

  return !state || state === "ACTIVE";
}

// The Region Organizations answers in, per partition.
export function getAwsOrganizationsRegion(region: string): string {
  const partition: AwsPartition = getAwsPartition(region);

  if (partition === "aws-us-gov") {
    return "us-gov-west-1";
  }

  if (partition === "aws-cn") {
    return "cn-northwest-1";
  }

  return "us-east-1";
}

// The organization's active accounts, in the order AWS lists them.
export async function listAwsOrganizationAccounts(options: {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  region: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}): Promise<Array<AwsOrganizationAccount>> {
  const accounts: Array<AwsOrganizationAccount> = [];
  let token: string = "";

  for (let page: number = 0; page < MAX_PAGES; page++) {
    const payload: JSONObject = {};

    if (token) {
      payload["NextToken"] = token;
    }

    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: options.transport,
      credentials: options.credentials,
      service: ORGANIZATIONS_SERVICE,
      region: getAwsOrganizationsRegion(options.region),
      target: TARGET,
      jsonVersion: "1.1",
      body: payload,
      step: "organization accounts request",
      providerTitle: PROVIDER_TITLE,
      now: options.now,
      timeoutInMs: options.timeoutInMs,
      sleep: options.sleep,
      budget: options.budget,
    });

    for (const raw of readArray(answer.json["Accounts"])) {
      const account: JSONObject = readObject(raw);
      const id: string = readText(account["Id"]);

      if (id && isAwsOrganizationAccountActive(account)) {
        accounts.push({ id, name: readText(account["Name"]) });
      }
    }

    const next: string = readText(answer.json["NextToken"]);

    if (!next || next === token) {
      break;
    }

    token = next;
  }

  return accounts;
}
