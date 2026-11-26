import { CloudProvider } from "./CloudPlatform";

/*
 * WHO CREATED A CLOUD RESOURCE, FROM ITS ACCOUNT'S CHANGE LOG (#11012).
 *
 * The cloud connection keeps every change its account's activity log
 * records (CloudChangeRecorder: CloudTrail, the Azure Activity Log, Google
 * Cloud's Admin Activity log), with the operation and who made it. A new
 * resource's creator is the caller of the first create call that names it:
 *
 *   - AWS: an operation whose action starts with Create, Run, Allocate or
 *     Launch ("ec2:RunInstances", "rds:CreateDBInstance",
 *     "ec2:AllocateAddress");
 *   - Azure: a write ("Microsoft.Compute/virtualMachines/write"), which is
 *     a create the first time - the earliest is taken;
 *   - Google Cloud: a method that inserts or creates
 *     ("v1.compute.instances.insert", "storage.buckets.create",
 *     "google.container.v1.ClusterManager.CreateCluster").
 *
 * A person is told only when the caller is one of the project's members:
 * matched by the email address the caller carries (an SSO session's name,
 * an Azure user's UPN, a Google principal), never by a name, which anyone
 * can give a role session. A service account's address is no person's.
 *
 * Pure: the watcher reads the change events, this reads what they say.
 */

const AWS_CREATE_ACTION: RegExp = /^(create|run|allocate|launch)/i;
/*
 * Tagging a resource is no creation of it, though AWS names it as one
 * ("ec2:CreateTags", "autoscaling:CreateOrUpdateTags"): whoever tags a
 * resource is never taken for who created it.
 */
const AWS_TAGGING_ACTION: RegExp = /tags$/i;
const AZURE_TAGGING_OPERATION: string = "microsoft.resources/tags/write";
const GCP_CREATE_METHOD: RegExp = /^(insert|create)/i;

// Whether an operation, as the change log names it, creates a resource.
export function isCloudCreateOperation(
  provider: string | null | undefined,
  operation: string | null | undefined,
): boolean {
  const op: string = (operation || "").trim();

  if (!op) {
    return false;
  }

  switch ((provider || "").toLowerCase()) {
    case CloudProvider.AWS: {
      const action: string = op.includes(":") ? op.split(":").pop() || "" : op;
      return AWS_CREATE_ACTION.test(action) && !AWS_TAGGING_ACTION.test(action);
    }
    case CloudProvider.Azure: {
      const lowered: string = op.toLowerCase();
      return (
        lowered.endsWith("/write") && !lowered.endsWith(AZURE_TAGGING_OPERATION)
      );
    }
    case CloudProvider.GCP: {
      const method: string = op.split(".").pop() || "";
      return GCP_CREATE_METHOD.test(method);
    }
    default:
      return false;
  }
}

const EMAIL: RegExp = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// The domains of machine identities: never a person's address.
const MACHINE_DOMAINS: ReadonlyArray<string> = [
  "gserviceaccount.com",
  "cloudservices.gserviceaccount.com",
  "developer.gserviceaccount.com",
];

/*
 * The email address a caller carries, in lower case, or null: the last
 * one in it ("AWSReservedSSO_Admin_0abc/alice@example.com" is
 * alice@example.com), never a service account's.
 */
export function getCloudActorEmail(
  actor: string | null | undefined,
): string | null {
  const matches: Array<string> = (actor || "").match(EMAIL) || [];
  const email: string | undefined = matches[matches.length - 1];

  if (!email) {
    return null;
  }

  const lowered: string = email.toLowerCase();
  const domain: string = lowered.split("@")[1] || "";

  if (
    MACHINE_DOMAINS.some((machine: string): boolean => {
      return domain === machine || domain.endsWith(`.${machine}`);
    })
  ) {
    return null;
  }

  return lowered;
}

// A change as the watcher reads it from the change events.
export interface CloudCreateCall {
  time: Date;
  provider: string;
  operation: string;
  actor: string;
  // The resources it names, in lower case.
  resourceIds: Array<string>;
  // The Cloud Resource it was tied to when written, when it was.
  resourceRowId: string | null;
  failed: boolean;
}

/*
 * The call that created a resource: the earliest create call that names
 * it, by its row or by any of its ids, and did not fail. Null when the log
 * holds none.
 */
export function findCloudCreateCall(data: {
  calls: ReadonlyArray<CloudCreateCall>;
  resourceRowId: string;
  // Each name the cloud may give it: its id whole, its last segment.
  resourceIds: ReadonlyArray<string>;
}): CloudCreateCall | null {
  const ids: Set<string> = new Set(
    data.resourceIds
      .map((id: string): string => {
        return id.trim().toLowerCase();
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      }),
  );
  let found: CloudCreateCall | null = null;

  for (const call of data.calls) {
    if (call.failed || !isCloudCreateOperation(call.provider, call.operation)) {
      continue;
    }

    const names: boolean =
      call.resourceRowId === data.resourceRowId ||
      call.resourceIds.some((id: string): boolean => {
        return ids.has(id.trim().toLowerCase());
      });

    if (names && (!found || call.time.getTime() < found.time.getTime())) {
      found = call;
    }
  }

  return found;
}

/*
 * The names a cloud's log may give a resource, in lower case: its id
 * whole; on AWS its ARN's last segment too, which is how CloudTrail names
 * an instance or a bucket ("i-0abc", "my-bucket"); on Google Cloud its full
 * name without its service ("projects/p/zones/z/instances/web-1"). Azure's
 * log names a resource by its whole ARM id: a name alone ("web-1") is a
 * network interface's as well as its VM's, and is never matched.
 */
export function getCloudResourceLogIds(
  provider: string | null | undefined,
  providerResourceId: string,
): Array<string> {
  const id: string = providerResourceId.trim().toLowerCase();

  if (!id) {
    return [];
  }

  const ids: Array<string> = [id];

  switch ((provider || "").toLowerCase()) {
    case CloudProvider.AWS: {
      const cut: number = Math.max(id.lastIndexOf("/"), id.lastIndexOf(":"));

      if (cut >= 0 && cut < id.length - 1) {
        ids.push(id.slice(cut + 1));
      }
      break;
    }
    case CloudProvider.GCP: {
      if (id.startsWith("//")) {
        const serviceEnd: number = id.indexOf("/", 2);

        if (serviceEnd > 0) {
          ids.push(id.slice(serviceEnd + 1));
        }
      }
      break;
    }
    default:
      break;
  }

  return Array.from(new Set(ids));
}
