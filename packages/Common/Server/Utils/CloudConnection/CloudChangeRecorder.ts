import { createHash } from "crypto";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
} from "../../../Utils/Telemetry/ChangeEventFields";
import CloudAccountService from "../../Services/CloudAccountService";
import ChangeEventService from "../../Services/ChangeEventService";
import CloudResourceService from "../../Services/CloudResourceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import {
  DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
  MAX_CHANGE_EVENT_DESCRIPTION_LENGTH,
  MAX_CHANGE_EVENT_TITLE_LENGTH,
  ParsedChangeEventEntry,
  buildChangeEventDbRow,
} from "../Telemetry/ChangeEventRow";
import TelemetryFanInWriter from "../Telemetry/TelemetryFanInWriter";
import { CloudChange } from "./CloudConnectorTypes";

/*
 * A CLOUD'S CHANGES AND HEALTH EVENTS, KEPT AS CHANGE EVENTS.
 *
 * What a cloud account's activity log recorded, and what its provider
 * published about its health, becomes a change event like a deploy - the
 * row investigations read for "what changed just before this incident":
 *
 *   - project-wide (no telemetry service): a change names a resource, not a
 *     service, and the deploy checks that judge a service's own telemetry
 *     have nothing to judge it by;
 *   - tied to the Cloud Resource it changed (oneuptime.resource.type and
 *     .id), when the connection holds it - which is how an investigation
 *     of an incident linked to that resource counts it as linked;
 *   - tied to its Cloud Account (oneuptime.cloud_account.id), for the
 *     account's Changes page;
 *   - written once per provider event id, and never failing a read: a
 *     change that cannot be written is logged.
 *
 * The words are the provider's - an operation's name, a principal, a
 * health event's own title - clamped to the change event's limits; they
 * are data, never instructions, wherever they are read.
 */

// Change events written in one insert at most.
const WRITE_BATCH_SIZE: number = 200;

const SCALING_WORDS: ReadonlyArray<string> = [
  "setdesiredcapacity",
  "updateautoscalinggroup",
  "putscalingpolicy",
  "executepolicy",
  "scale",
  "resize",
  "setinstancehealth",
];

const DEPLOY_WORDS: ReadonlyArray<string> = [
  "updatefunctioncode",
  "publishversion",
  "createdeployment",
  "registertaskdefinition",
  "updateservice",
  "deploy",
  "/deployments/write",
  "createrevision",
  "replaceservice",
];

const ROLLBACK_WORDS: ReadonlyArray<string> = ["rollback", "revert"];

/*
 * What kind of change an operation is: a health event is the provider's;
 * scaling and deploys by their verbs; everything else a change of
 * configuration.
 */
export function classifyCloudChange(change: CloudChange): ChangeEventType {
  if (change.kind === "health") {
    return ChangeEventType.ProviderEvent;
  }

  const operation: string = change.operation.toLowerCase();

  if (
    ROLLBACK_WORDS.some((word: string): boolean => {
      return operation.includes(word);
    })
  ) {
    return ChangeEventType.Rollback;
  }

  if (
    SCALING_WORDS.some((word: string): boolean => {
      return operation.includes(word);
    })
  ) {
    return ChangeEventType.Scaling;
  }

  if (
    DEPLOY_WORDS.some((word: string): boolean => {
      return operation.includes(word);
    })
  ) {
    return ChangeEventType.Deployment;
  }

  return ChangeEventType.ConfigChange;
}

function clamp(text: string, maxLength: number): string {
  const trimmed: string = text.trim();
  return trimmed.length <= maxLength
    ? trimmed
    : `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

// What a change is about: the resource's name when held, else its id.
function subjectOf(
  change: CloudChange,
  resource: { name: string } | null,
): string {
  if (resource?.name) {
    return resource.name;
  }

  return change.resources[0]?.id || "";
}

/*
 * One change as a change event entry. `resource` is the Cloud Resource it
 * changed, when the connection holds it; `account` the Cloud Account row.
 */
export function buildCloudChangeEntry(data: {
  change: CloudChange;
  resource: { id: ObjectID; name: string } | null;
  accountRecordId: ObjectID | null;
}): ParsedChangeEventEntry {
  const { change, resource } = data;
  const subject: string = subjectOf(change, resource);
  const where: string = change.region
    ? `${change.accountId} (${change.region})`
    : change.accountId;

  const title: string =
    change.kind === "health"
      ? change.title || change.operation
      : `${change.failed ? "Failed: " : ""}${change.operation}${
          subject ? ` on ${subject}` : ""
        }`;

  const description: string =
    change.kind === "health"
      ? change.description ||
        `${change.operation}, published by the cloud provider for account ${where}.`
      : `${change.actor || "Someone"} ${
          change.failed ? "tried to run" : "ran"
        } ${change.operation} in account ${where}${
          change.resources.length > 0
            ? `, on ${change.resources
                .slice(0, 5)
                .map((entry: { id: string }): string => {
                  return entry.id;
                })
                .join(", ")}`
            : ""
        }.`;

  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.Source]:
      change.kind === "health"
        ? ChangeEventSource.CloudHealth
        : ChangeEventSource.Cloud,
    [ChangeEventAttribute.CloudProvider]: change.provider,
    [ChangeEventAttribute.CloudAccountId]: change.accountId,
    [ChangeEventAttribute.CloudOperation]: clamp(change.operation, 300),
    [ChangeEventAttribute.CloudEventId]: clamp(change.eventId, 300),
  };

  if (change.kind === "change") {
    attributes[ChangeEventAttribute.Status] = change.failed
      ? ChangeEventStatus.Failed
      : ChangeEventStatus.Succeeded;
  }

  if (change.region) {
    attributes[ChangeEventAttribute.CloudRegion] = change.region;
  }

  if (change.actor) {
    attributes[ChangeEventAttribute.CloudActor] = clamp(change.actor, 300);
  }

  if (change.resources[0]?.id) {
    attributes[ChangeEventAttribute.CloudResourceId] = clamp(
      change.resources[0].id,
      1000,
    );
  }

  if (resource) {
    attributes[ChangeEventAttribute.ResourceType] = "CloudResource";
    attributes[ChangeEventAttribute.ResourceId] = resource.id.toString();
  }

  if (data.accountRecordId) {
    attributes[ChangeEventAttribute.CloudAccountRecordId] =
      data.accountRecordId.toString();
  }

  return {
    time: change.time,
    eventType: classifyCloudChange(change),
    title: clamp(title, MAX_CHANGE_EVENT_TITLE_LENGTH),
    description: clamp(description, MAX_CHANGE_EVENT_DESCRIPTION_LENGTH),
    attributes,
  };
}

// The last segment of an ARN, an ARM id or a resource name: its own name or id.
function lastSegment(value: string): string {
  const slash: number = value.lastIndexOf("/");
  const colon: number = value.lastIndexOf(":");
  const cut: number = Math.max(slash, colon);

  return cut >= 0 && cut < value.length - 1 ? value.slice(cut + 1) : value;
}

/*
 * The Cloud Resources of one account, by every name a change may give
 * them: the provider id whole, its last segment with its type, its last
 * segment alone, and - for Google Cloud, whose audit log writes
 * "projects/p/zones/z/instances/web-1" for
 * "//compute.googleapis.com/projects/p/zones/z/instances/web-1" - the full
 * name without its service.
 */
export class CloudResourceIndex {
  private byKey: Map<string, { id: ObjectID; name: string }> = new Map();
  // Short names two resources answer to: neither is guessed.
  private ambiguous: Set<string> = new Set();

  public constructor(
    rows: Array<{
      id: ObjectID;
      name: string;
      providerResourceId: string;
      type: string;
    }>,
  ) {
    for (const row of rows) {
      const id: string = row.providerResourceId.trim().toLowerCase();

      if (!id) {
        continue;
      }

      const entry: { id: ObjectID; name: string } = {
        id: row.id,
        name: row.name,
      };
      this.add(id, entry);
      this.add(`${row.type.toLowerCase()}|${lastSegment(id)}`, entry);
      this.add(`|${lastSegment(id)}`, entry);

      if (id.startsWith("//")) {
        const serviceEnd: number = id.indexOf("/", 2);

        if (serviceEnd > 0) {
          this.add(id.slice(serviceEnd + 1), entry);
        }
      }
    }
  }

  private add(key: string, entry: { id: ObjectID; name: string }): void {
    if (this.byKey.has(key) && this.byKey.get(key)?.id !== entry.id) {
      this.ambiguous.add(key);
      return;
    }

    this.byKey.set(key, entry);
  }

  // The resource a change's resource names, or null.
  public find(resource: {
    id: string;
    type?: string | undefined;
  }): { id: ObjectID; name: string } | null {
    const id: string = resource.id.trim().toLowerCase();

    if (!id) {
      return null;
    }

    const keys: Array<string> = [
      id,
      ...(resource.type
        ? [`${resource.type.toLowerCase()}|${lastSegment(id)}`]
        : []),
      `|${lastSegment(id)}`,
    ];

    for (const key of keys) {
      if (this.ambiguous.has(key)) {
        continue;
      }

      const found: { id: ObjectID; name: string } | undefined =
        this.byKey.get(key);

      if (found) {
        return found;
      }
    }

    return null;
  }
}

/*
 * The insert's dedup token: the same changes written twice - a retried
 * insert - are dropped by ClickHouse; a batch that differs by one change is
 * a different batch.
 */
export function getCloudChangeDedupToken(
  projectId: ObjectID,
  rows: Array<JSONObject>,
): string {
  const ids: string = rows
    .map((row: JSONObject): string => {
      return String(
        (row["attributes"] as JSONObject | undefined)?.[
          ChangeEventAttribute.CloudEventId
        ] || "",
      );
    })
    .join("\n");

  return `cloud-change:${projectId.toString()}:${createHash("sha256")
    .update(ids, "utf8")
    .digest("hex")}`;
}

export default class CloudChangeRecorder {
  /*
   * Writes the changes, each tied to the resource and the account the
   * connection holds for it. Returns how many were written; never throws.
   */
  public static async record(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    changes: Array<CloudChange>;
  }): Promise<number> {
    if (data.changes.length === 0) {
      return 0;
    }

    try {
      const accountIds: Array<string> = Array.from(
        new Set(
          data.changes.map((change: CloudChange): string => {
            return change.accountId;
          }),
        ),
      );
      const rows: Array<JSONObject> = [];

      for (const accountId of accountIds) {
        const index: CloudResourceIndex = await CloudChangeRecorder.loadIndex({
          projectId: data.projectId,
          provider: data.provider,
          accountId,
        });
        const account: CloudAccount | null =
          await CloudAccountService.findAccount({
            projectId: data.projectId,
            provider: data.provider,
            accountId,
          });

        for (const change of data.changes) {
          if (change.accountId !== accountId) {
            continue;
          }

          let resource: { id: ObjectID; name: string } | null = null;

          for (const touched of change.resources) {
            resource = index.find(touched);

            if (resource) {
              break;
            }
          }

          rows.push(
            buildChangeEventDbRow({
              parsed: buildCloudChangeEntry({
                change,
                resource,
                accountRecordId: account?.id || null,
              }),
              projectId: data.projectId,
              serviceMetadata: null,
              retentionDays: DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
            }),
          );
        }
      }

      for (
        let start: number = 0;
        start < rows.length;
        start += WRITE_BATCH_SIZE
      ) {
        const batch: Array<JSONObject> = rows.slice(
          start,
          start + WRITE_BATCH_SIZE,
        );
        const submission: { flushed: Promise<void> } =
          await TelemetryFanInWriter.submit(ChangeEventService, batch, {
            dedupToken: getCloudChangeDedupToken(data.projectId, batch),
          });

        await submission.flushed;
      }

      return rows.length;
    } catch (error) {
      logger.error(
        `Cloud changes of project ${data.projectId.toString()} could not be recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return 0;
    }
  }

  private static async loadIndex(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    accountId: string;
  }): Promise<CloudResourceIndex> {
    const rows: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        cloudProvider: data.provider,
        cloudAccountId: QueryHelper.findWithSameText(data.accountId),
      },
      select: {
        _id: true,
        name: true,
        providerResourceId: true,
        cloudResourceType: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    return new CloudResourceIndex(
      rows
        .filter((row: CloudResource): boolean => {
          return Boolean(row.id && row.providerResourceId);
        })
        .map((row: CloudResource) => {
          return {
            id: row.id!,
            name: row.name || "",
            providerResourceId: row.providerResourceId || "",
            type: row.cloudResourceType || "",
          };
        }),
    );
  }
}
