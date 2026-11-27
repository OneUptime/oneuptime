import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudCostState,
} from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentKind } from "../../../../Types/Cloud/CloudCommitments";
import {
  CloudCommitmentPaymentOption,
  CloudCommitmentScope,
  CloudCommitmentState,
  readCloudCommitmentTermMonths,
} from "../../../../Types/Cloud/CloudCommitmentInventory";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudCommitmentInventoryRead,
  CloudCommitmentRecord,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";

/*
 * EVERY COMPUTE ENGINE COMMITMENT OF A CONNECTION'S PROJECTS (#11011).
 *
 *   Cloud Asset Inventory (GET cloudasset.googleapis.com/v1/projects/
 *   {project}/assets?assetTypes=compute.googleapis.com/Commitment&
 *   contentType=RESOURCE)
 *     -> { assets: [{ resource: { data: { id, name, selfLink, region,
 *          status: NOT_YET_ACTIVE | ACTIVE | EXPIRED, plan: TWELVE_MONTH |
 *          THIRTY_SIX_MONTH, startTimestamp, endTimestamp, type:
 *          GENERAL_PURPOSE_E2 | ..., category: MACHINE | LICENSE,
 *          resources: [{ type: VCPU | MEMORY | LOCAL_SSD | ACCELERATOR,
 *          amount, acceleratorType }], licenseResource, autoRenew } } }],
 *          nextPageToken }
 *
 * Each asset's data is the commitment as Compute Engine writes it
 * (regionCommitments). Free, read with the Cloud Asset Viewer role the
 * connection already holds for its inventory: no role is added. A
 * commitment's fee is charged monthly, as it runs: there is no upfront
 * payment. Google Cloud does not say how much of one commitment was used,
 * nor what it cost on its own, so neither is kept; spend-based commitments
 * (Cloud SQL, Cloud Run, flexible) have no list to read, and show in
 * coverage only.
 */

// Cloud Asset Inventory's type of a Compute Engine commitment.
export const GCP_COMMITMENT_ASSET_TYPE: string =
  "compute.googleapis.com/Commitment";

// What a resource of a commitment is, as people read it: "96 vCPU", "384 GB memory".
export function describeGcpCommitmentResources(commitment: JSONObject): string {
  const parts: Array<string> = [];

  for (const raw of readArray(commitment["resources"])) {
    const resource: JSONObject = readObject(raw);
    const type: string = readText(resource["type"]).toUpperCase();
    const amount: number = Number(readText(resource["amount"]));

    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    // A commitment's page draws these: each number held to its unit.
    if (type === "VCPU") {
      parts.push(`${amount}${NO_BREAK_SPACE}vCPU`);
    } else if (type === "MEMORY") {
      // Memory is in MB.
      parts.push(
        `${Math.round((amount / 1024) * 10) / 10}${NO_BREAK_SPACE}GB memory`,
      );
    } else if (type === "LOCAL_SSD") {
      parts.push(`${amount}${NO_BREAK_SPACE}GB local SSD`);
    } else if (type === "ACCELERATOR") {
      parts.push(
        `${amount} × ${readText(resource["acceleratorType"]).split("/").pop() || "GPU"}`,
      );
    }
  }

  const license: JSONObject = readObject(commitment["licenseResource"]);

  if (readText(license["license"])) {
    parts.push(
      `${readText(license["amount"]) || "1"} × ${readText(license["license"]).split("/").pop()}`,
    );
  }

  return parts.join(", ");
}

// A commitment's status as OneUptime's state.
export function readGcpCommitmentState(status: string): CloudCommitmentState {
  switch (status.trim().toUpperCase()) {
    case "ACTIVE":
      return CloudCommitmentState.Active;
    case "NOT_YET_ACTIVE":
      return CloudCommitmentState.Queued;
    case "EXPIRED":
      return CloudCommitmentState.Expired;
    default:
      return CloudCommitmentState.Retired;
  }
}

// The vCPUs a commitment holds: its quantity.
function readVcpus(commitment: JSONObject): number | null {
  for (const raw of readArray(commitment["resources"])) {
    const resource: JSONObject = readObject(raw);

    if (readText(resource["type"]).toUpperCase() === "VCPU") {
      const amount: number = Number(readText(resource["amount"]));
      return Number.isFinite(amount) ? amount : null;
    }
  }

  return null;
}

function readDate(value: unknown): Date | null {
  const time: number = Date.parse(readText(value));
  return Number.isFinite(time) ? new Date(time) : null;
}

// One commitment as OneUptime keeps it; null without an id to keep it by.
export function readGcpCommitment(data: {
  commitment: JSONObject;
  project: string;
}): CloudCommitmentRecord | null {
  const commitment: JSONObject = data.commitment;
  const name: string = readText(commitment["name"]);
  const region: string = readText(commitment["region"]).split("/").pop() || "";
  const commitmentId: string =
    readText(commitment["selfLink"]) ||
    (name
      ? `projects/${data.project}/regions/${region}/commitments/${name}`
      : "");

  if (!commitmentId) {
    return null;
  }

  return {
    accountId: data.project,
    commitmentId,
    kind: CloudCommitmentKind.CommittedUseDiscounts,
    name: name || readText(commitment["id"]),
    commitmentType:
      readText(commitment["type"]) || readText(commitment["category"]),
    covers: describeGcpCommitmentResources(commitment),
    region,
    scope: CloudCommitmentScope.Account,
    appliesTo: "",
    termMonths: readCloudCommitmentTermMonths(readText(commitment["plan"])),
    // Google charges a commitment monthly, as it runs.
    paymentOption: CloudCommitmentPaymentOption.NoUpfront,
    startsAt: readDate(commitment["startTimestamp"]),
    endsAt: readDate(commitment["endTimestamp"]),
    state: readGcpCommitmentState(readText(commitment["status"])),
    isAutoRenew: commitment["autoRenew"] === true,
    hourlyCommitment: null,
    quantity: readVcpus(commitment),
    upfrontCost: null,
    recurringHourlyCost: null,
    currency: CLOUD_COST_DEFAULT_CURRENCY,
    utilizationPercent: null,
    weekUtilizationPercent: null,
    figures: null,
  };
}

/*
 * Every project's commitments. A project whose list is refused says so -
 * its service account needs compute.commitments.list - and the others are
 * read. A refused credential is thrown, as every read throws it.
 */
export async function readGcpCommitmentInventory(data: {
  listCommitments: (
    project: string,
  ) => Promise<{ commitments: Array<JSONObject>; complete: boolean }>;
  projects: Array<string>;
}): Promise<CloudCommitmentInventoryRead> {
  const records: Array<CloudCommitmentRecord> = [];
  const refused: Array<string> = [];
  let complete: boolean = true;
  let failure: string = "";

  for (const project of data.projects) {
    try {
      const listed: { commitments: Array<JSONObject>; complete: boolean } =
        await data.listCommitments(project);

      complete = complete && listed.complete;

      for (const commitment of listed.commitments) {
        const record: CloudCommitmentRecord | null = readGcpCommitment({
          commitment,
          project,
        });

        if (record) {
          records.push(record);
        }
      }
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      complete = false;

      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Permission
      ) {
        refused.push(project);
        continue;
      }

      failure =
        error instanceof CloudReadBudgetSpent
          ? "The read reached its limit before every commitment was listed: they are listed again tomorrow."
          : (error instanceof Error ? error.message : String(error)).slice(
              0,
              500,
            );
      break;
    }
  }

  const refusedMessage: string =
    refused.length > 0
      ? `The service account may not list Compute Engine commitments in ${refused.join(
          ", ",
        )}: it needs Cloud Asset Viewer there (roles/cloudasset.viewer). Run the setup command again to allow it.`
      : "";

  if (refused.length > 0 && refused.length === data.projects.length) {
    return {
      records,
      complete: false,
      state: CloudCostState.NotAllowed,
      message: refusedMessage,
    };
  }

  if (failure) {
    return {
      records,
      complete: false,
      state: CloudCostState.Failed,
      message: failure,
    };
  }

  return {
    records,
    complete,
    state: CloudCostState.Reading,
    ...(refusedMessage ? { message: refusedMessage } : {}),
  };
}
