import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  ParsedCloudCommand,
  ParsedCloudResource,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";

/*
 * WHAT A CLOUD'S LIVE READER IS GIVEN, AND HOW IT SAYS IT FAILED.
 *
 * CloudLiveRead checks the command, the account and its connection, then
 * hands one reader per cloud (AwsLiveRead, AzureLiveRead, GcpLiveRead) the
 * parsed command, the account's id, the resource's inventory row when the
 * account's inventory lists it, and a context: the transport (the
 * SSRF-guarded fetch in production, a fake cloud in tests), the read's
 * clock and its budget. A reader answers with the text the model reads,
 * or throws:
 *
 *   - a CloudLiveReadError: refused (the read does not apply here), a
 *     permission the connection lacks (named, so the person knows what to
 *     add), or a resource the cloud does not have;
 *   - an LlmProviderError the cloud's client threw (a refused credential,
 *     a throttled or failed call);
 *   - CloudReadBudgetSpent, when the read's budget ran out.
 */

// The resource as the account's inventory last listed it.
export interface CloudLiveReadInventoryRow {
  name: string;
  // The provider's type: AWS::ECS::Service, Microsoft.Web/sites, cloud_run_revision.
  resourceType: string;
  region: string;
  // The properties the inventory keeps (never anything that can hold a secret).
  properties: JSONObject;
  tags: Dictionary<string>;
  // When the inventory last listed it; null for a resource found from its metrics.
  inventoriedAt: Date | null;
}

// What one read reads.
export interface CloudLiveReadTarget {
  command: ParsedCloudCommand;
  resource: ParsedCloudResource;
  /*
   * The account as OneUptime holds it: the AWS account id, the Azure
   * subscription id or the Google Cloud project id.
   */
  accountId: string;
  inventory: CloudLiveReadInventoryRow | null;
}

// How a reader reaches its cloud.
export interface CloudLiveReadContext {
  transport: CloudConnectorTransport;
  /*
   * The read's clock: the time the read says it read at, the end of every
   * window it reads (the last N hours, the last N minutes), and each AWS
   * request's signature.
   */
  now: () => Date;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget: CloudReadBudget;
  requestTimeoutInMs?: number | undefined;
}

export type CloudLiveReadFailureReason =
  // The read does not apply to this resource (what it does apply to is said).
  | "refused"
  // The connection may not make a call the read needs.
  | "permission"
  // The cloud has no such resource.
  | "not-found";

export class CloudLiveReadError extends Error {
  public reason: CloudLiveReadFailureReason;
  // The permission the refused call needs: "ecs:DescribeServices".
  public permission: string | undefined;

  public constructor(data: {
    reason: CloudLiveReadFailureReason;
    message: string;
    permission?: string | undefined;
  }) {
    super(data.message);
    this.name = "CloudLiveReadError";
    this.reason = data.reason;
    this.permission = data.permission;
  }
}

/*
 * One call of a read, made: a refused permission becomes a
 * CloudLiveReadError that names the permission the call needs, and a
 * failure `notFound` recognises (it returns the sentence to say) becomes
 * a not-found one. Everything else - a spent budget included - is thrown
 * as it is.
 */
export async function callCloud<T>(
  data: {
    permission: string;
    notFound?: ((error: LlmProviderError) => string | null) | undefined;
  },
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof LlmProviderError)) {
      throw error;
    }

    if (error.kind === CloudConnectionFailureKind.Permission) {
      throw new CloudLiveReadError({
        reason: "permission",
        permission: data.permission,
        message: error.message,
      });
    }

    const missing: string | null = data.notFound ? data.notFound(error) : null;

    if (missing) {
      throw new CloudLiveReadError({ reason: "not-found", message: missing });
    }

    throw error;
  }
}

/*
 * A part of a read the rest does not depend on (an EC2 instance's status
 * checks next to its state): its value, or - when the connection may not
 * make the call, the budget ran out or the cloud failed - null and a note
 * saying why, so the read still answers with what it could read.
 */
export async function readOptionalPart<T>(data: {
  what: string;
  notes: Array<string>;
  call: () => Promise<T>;
  // How the cloud's connection setup is named in the note.
  setupHint: string;
}): Promise<T | null> {
  try {
    return await data.call();
  } catch (error) {
    if (error instanceof CloudReadBudgetSpent) {
      data.notes.push(
        `${data.what} not read: the read reached its request limit first.`,
      );
      return null;
    }

    if (error instanceof CloudLiveReadError && error.reason === "permission") {
      data.notes.push(
        `${data.what} not read: the connection may not call ${
          error.permission || "the API it needs"
        }. ${data.setupHint}`,
      );
      return null;
    }

    if (error instanceof LlmProviderError) {
      data.notes.push(`${data.what} not read: ${error.message}`);
      return null;
    }

    throw error;
  }
}
