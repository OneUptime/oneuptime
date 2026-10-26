import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import { Settled, mapWithConcurrency } from "../CloudConcurrency";
import {
  CloudConnectorCallOptions,
  CloudInventoryItem,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import {
  AwsCredentials,
  AwsPartition,
  awsErrorCodeOf,
  getAwsPartition,
  readXmlTag,
  sendAwsRequest,
} from "./AwsApi";
import {
  AwsCloudControlListing,
  AwsListedResource,
  listCloudControlResources,
} from "./AwsCloudControl";
import {
  AWS_INVENTORY_TYPES,
  AwsInventoryContext,
  AwsInventoryType,
  addAwsLoadBalancerEdges,
  buildAwsInventoryItem,
} from "./AwsInventoryCatalog";

/*
 * ONE AWS ACCOUNT'S INVENTORY: every resource of AwsInventoryCatalog's
 * types in the Regions the account uses, listed through Cloud Control.
 *
 *   - Regional types are listed in each Region; global ones (CloudFront)
 *     once, in us-east-1, where their metrics are too.
 *   - A type listed inside another (an ECS service inside its cluster) is
 *     listed in each parent the Region has, up to MAX_PARENTS_PER_REGION.
 *   - Load balancers learn what they send to from the Region's target
 *     groups (addAwsLoadBalancerEdges).
 *
 * A type is "listed in full" for the account only when every Region (and
 * every parent) it was asked for answered to its last page: only then may a
 * resource of that type the connection holds, and the listing lacks, be
 * taken for gone. A type the role may not list is reported once, with what
 * to do, and the rest of the inventory goes on.
 */

const PROVIDER_TITLE: string = "AWS";
// Regions listed at once; each lists its types one after another.
const REGION_CONCURRENCY: number = 4;
export const AWS_INVENTORY_MAX_PARENTS_PER_REGION: number = 30;
// The Region global types are listed in.
const GLOBAL_REGION: string = "us-east-1";

// Answers that mean "this type has nothing to list here", not a failure.
const NOTHING_TO_LIST_CODES: Array<string> = [
  "UnsupportedActionException",
  "TypeNotFoundException",
];

export interface AwsInventoryOutcome {
  items: Array<CloudInventoryItem>;
  completelyListedTypes: Array<string>;
  warnings: Array<string>;
  complete: boolean;
}

interface RegionOutcome {
  items: Array<CloudInventoryItem>;
  // Types this Region listed to their last page.
  listedTypes: Array<string>;
  refusedTypes: Array<string>;
  failedTypes: Array<{ type: string; message: string }>;
  budgetSpent: boolean;
}

function isRefused(error: unknown): boolean {
  if (!(error instanceof LlmProviderError)) {
    return false;
  }

  if (error.kind === CloudConnectionFailureKind.Permission) {
    return true;
  }

  // Cloud Control passes the service's own refusal on in its message.
  const body: string = (error.responseBody || "").toLowerCase();

  return (
    body.includes("not authorized") ||
    body.includes("accessdenied") ||
    body.includes("unauthorizedoperation")
  );
}

function isNothingToList(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    NOTHING_TO_LIST_CODES.includes(awsErrorCodeOf(error.responseBody || ""))
  );
}

function typesFor(region: string): Array<AwsInventoryType> {
  return AWS_INVENTORY_TYPES.filter((type: AwsInventoryType): boolean => {
    return type.isGlobal ? region === GLOBAL_REGION : true;
  });
}

async function listRegion(data: {
  region: string;
  accountId: string;
  credentials: AwsCredentials;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}): Promise<RegionOutcome> {
  const context: AwsInventoryContext = {
    accountId: data.accountId,
    region: data.region,
  };
  const outcome: RegionOutcome = {
    items: [],
    listedTypes: [],
    refusedTypes: [],
    failedTypes: [],
    budgetSpent: false,
  };
  const listedByType: Map<string, Array<AwsListedResource>> = new Map();
  const listedByItem: Map<CloudInventoryItem, AwsListedResource> = new Map();

  const list: (
    typeName: string,
    model?: Record<string, unknown> | undefined,
  ) => Promise<AwsCloudControlListing> = async (
    typeName: string,
    model?: Record<string, unknown> | undefined,
  ): Promise<AwsCloudControlListing> => {
    return await listCloudControlResources(
      {
        transport: data.options.transport,
        credentials: data.credentials,
        region: data.region,
        now: data.options.now,
        timeoutInMs: data.options.requestTimeoutInMs,
        sleep: data.options.sleep,
        budget: data.budget,
      },
      { typeName, resourceModel: model as never },
    );
  };

  for (const type of typesFor(data.region)) {
    if (outcome.budgetSpent) {
      break;
    }

    try {
      let listed: Array<AwsListedResource> = [];
      let complete: boolean = true;

      if (type.parent) {
        const parents: Array<AwsListedResource> =
          listedByType.get(type.parent.type) || [];

        // A parent type not listed in full leaves its children unknown.
        if (!outcome.listedTypes.includes(type.parent.type)) {
          complete = false;
        }

        if (parents.length > AWS_INVENTORY_MAX_PARENTS_PER_REGION) {
          complete = false;
        }

        for (const parent of parents.slice(
          0,
          AWS_INVENTORY_MAX_PARENTS_PER_REGION,
        )) {
          const model: Record<string, unknown> | null =
            type.parent.model(parent);

          if (!model) {
            complete = false;
            continue;
          }

          const listing: AwsCloudControlListing = await list(type.type, model);
          listed.push(...listing.resources);
          complete = complete && listing.complete;
        }
      } else {
        const listing: AwsCloudControlListing = await list(type.type);
        listed = listing.resources;
        complete = listing.complete;
      }

      listedByType.set(type.type, listed);

      if (complete) {
        outcome.listedTypes.push(type.type);
      }

      for (const resource of listed) {
        const item: CloudInventoryItem | null = buildAwsInventoryItem(
          type,
          resource,
          context,
        );

        if (item) {
          outcome.items.push(item);
          listedByItem.set(item, resource);
        }
      }
    } catch (error) {
      if (error instanceof CloudReadBudgetSpent) {
        outcome.budgetSpent = true;
        break;
      }

      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      if (isNothingToList(error)) {
        listedByType.set(type.type, []);
        outcome.listedTypes.push(type.type);
        continue;
      }

      if (isRefused(error)) {
        outcome.refusedTypes.push(type.type);
        continue;
      }

      outcome.failedTypes.push({
        type: type.type,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  addAwsLoadBalancerEdges({
    items: outcome.items,
    targetGroups:
      listedByType.get("AWS::ElasticLoadBalancingV2::TargetGroup") || [],
    listedByItem,
    context,
  });

  return outcome;
}

/*
 * Every resource of the account in the Regions given (the ones its metrics
 * live in, or the ones the connection names), and us-east-1 for the global
 * types.
 */
export async function readAwsInventory(data: {
  accountId: string;
  regions: Array<string>;
  credentials: AwsCredentials;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}): Promise<AwsInventoryOutcome> {
  const regions: Array<string> = Array.from(
    new Set(
      [...data.regions, GLOBAL_REGION]
        .map((region: string): string => {
          return region.trim().toLowerCase();
        })
        .filter((region: string): boolean => {
          return region.length > 0;
        }),
    ),
  );

  const settled: Array<Settled<RegionOutcome>> = await mapWithConcurrency(
    regions,
    REGION_CONCURRENCY,
    async (region: string): Promise<RegionOutcome> => {
      return await listRegion({
        region,
        accountId: data.accountId,
        credentials: data.credentials,
        options: data.options,
        budget: data.budget,
      });
    },
  );

  const items: Array<CloudInventoryItem> = [];
  const warnings: Array<string> = [];
  const refused: Set<string> = new Set<string>();
  // Per type, whether every Region asked for it listed it in full.
  const fullyListed: Map<string, boolean> = new Map();
  let complete: boolean = true;

  settled.forEach((result: Settled<RegionOutcome>, index: number) => {
    const region: string = regions[index]!;
    const asked: Array<AwsInventoryType> = typesFor(region);

    if (!result.ok) {
      if (
        result.error instanceof LlmProviderError &&
        result.error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw result.error;
      }

      warnings.push(
        `Could not list the resources in ${region}: ${
          result.error instanceof Error
            ? result.error.message
            : String(result.error)
        }`,
      );

      for (const type of asked) {
        fullyListed.set(type.type, false);
      }

      complete = false;
      return;
    }

    items.push(...result.value.items);

    for (const type of result.value.refusedTypes) {
      refused.add(type);
    }

    for (const failure of result.value.failedTypes) {
      warnings.push(
        `Could not list ${failure.type} in ${region}: ${failure.message}`,
      );
    }

    if (result.value.budgetSpent) {
      complete = false;
    }

    for (const type of asked) {
      const listedHere: boolean = result.value.listedTypes.includes(type.type);
      fullyListed.set(type.type, (fullyListed.get(type.type) ?? true) && listedHere);
    }
  });

  if (refused.size > 0) {
    warnings.push(
      `The role may not list ${Array.from(refused).sort().join(", ")}. Run the setup command again to allow it.`,
    );
  }

  return {
    items,
    completelyListedTypes: Array.from(fullyListed.entries())
      .filter(([type, listed]: [string, boolean]): boolean => {
        return (
          listed &&
          !AWS_INVENTORY_TYPES.find((candidate: AwsInventoryType): boolean => {
            return candidate.type === type;
          })?.isPlumbing
        );
      })
      .map(([type]: [string, boolean]): string => {
        return type;
      }),
    warnings,
    complete,
  };
}

// IAM's one global endpoint per partition, and the Region it is signed for.
function getIamEndpoint(partition: AwsPartition): {
  host: string;
  region: string;
} {
  if (partition === "aws-us-gov") {
    return { host: "iam.us-gov.amazonaws.com", region: "us-gov-west-1" };
  }

  if (partition === "aws-cn") {
    return { host: "iam.cn-north-1.amazonaws.com.cn", region: "cn-north-1" };
  }

  return { host: "iam.amazonaws.com", region: "us-east-1" };
}

/*
 * The account's alias - what people call it in the console's sign-in URL -
 * or "" when it has none or the role may not read it (iam:ListAccountAliases).
 */
export async function getAwsAccountAlias(data: {
  credentials: AwsCredentials;
  region: string;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}): Promise<string> {
  const endpoint: { host: string; region: string } = getIamEndpoint(
    getAwsPartition(data.region),
  );

  try {
    const answer: { text: string } = await sendAwsRequest({
      transport: data.options.transport,
      credentials: data.credentials,
      service: "iam",
      region: endpoint.region,
      host: endpoint.host,
      body: { Action: "ListAccountAliases", Version: "2010-05-08" },
      step: "account alias request",
      providerTitle: PROVIDER_TITLE,
      now: data.options.now,
      timeoutInMs: data.options.requestTimeoutInMs,
      sleep: data.options.sleep,
      budget: data.budget,
    });

    return readXmlTag(answer.text, "member");
  } catch (error) {
    if (
      error instanceof CloudReadBudgetSpent ||
      (error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication)
    ) {
      throw error;
    }

    return "";
  }
}
