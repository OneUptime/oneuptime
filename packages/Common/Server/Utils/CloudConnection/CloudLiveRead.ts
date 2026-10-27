import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  CLOUD_OPERATIONS,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudOperationSpec,
  getCloudCatalogProvider,
  parseCloudCommand,
} from "../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { tokenizeResourceCommand } from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * LIVE READS OF A CLOUD ACCOUNT, ON THE SERVER.
 *
 * The cloud catalog's reads (describe, recent-events, target-health,
 * quota-usage, read-logs) run here, through the account's existing
 * read-only cloud connection and its signed clients, so an investigation
 * reads the cloud as it is now - not only OneUptime's copy from up to ten
 * minutes ago - without the Cloud AI agent.
 */

// What one live read returned.
export interface CloudLiveReadOutcome {
  ok: boolean;
  // The command as read (the catalog's canonical form).
  displayCommand: string;
  // The answer, for the model; "" when the read failed.
  output: string;
  // Why it failed, in words an operator can act on (a missing permission is named).
  errorMessage?: string | undefined;
  redactionCount: number;
  isTruncated: boolean;
}

// The catalog operations that run here, on the server.
export function getCloudServerReadNames(): Array<string> {
  return CLOUD_OPERATIONS.filter((operation: CloudOperationSpec): boolean => {
    return operation.runsOn === "server";
  }).map((operation: CloudOperationSpec): string => {
    return operation.name;
  });
}

// Whether a command for a cloud account is one of the reads that run here.
export function isCloudServerRead(data: {
  resourceType: AiResourceType;
  command: string;
}): boolean {
  const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
    data.resourceType,
  );
  const argv: Array<string> | undefined = tokenizeResourceCommand(
    data.command,
  ).argv;

  if (!provider || !argv) {
    return false;
  }

  const parse: CloudCommandParse = parseCloudCommand(provider, argv);

  return parse.ok && parse.command.operation.runsOn === "server";
}

export default class CloudLiveRead {
  /*
   * One live read of the account. Never throws: every failure is an
   * outcome with ok false and a reason.
   */
  public static async run(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    // The CloudAccount row's id.
    cloudAccountId: ObjectID;
    command: string;
  }): Promise<CloudLiveReadOutcome> {
    return {
      ok: false,
      displayCommand: data.command,
      output: "",
      errorMessage: "Live reads are not available yet.",
      redactionCount: 0,
      isTruncated: false,
    };
  }
}
