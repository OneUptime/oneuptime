import CloudConnectionResourceSync, {
  CloudConnectionSyncResult,
  MAX_NEW_RESOURCES_PER_READ,
  getInventoryFingerprint,
  isGoneFromListing,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import CloudResourceLabelRuleEngineService from "../../../../Server/Services/CloudResourceLabelRuleEngineService";
import CloudResourceOwnerRuleEngineService from "../../../../Server/Services/CloudResourceOwnerRuleEngineService";
import {
  CloudCompleteListing,
  CloudInventoryItem,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudMonitoredResource,
  CloudMonitoringSource,
  buildCloudMonitoredResourceIdentifier,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What an inventory listed, kept on the connection's resources: a listed
 * resource it holds gets what the listing knows of it; one it does not is
 * created with its tags already on it and linked; and one of a type listed
 * in full for its account, which the listing lacks, is archived - while a
 * type listed only in part, or another account's resource, is left alone.
 * `jest` is the global one.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ACCOUNT: string = "123456789012";
const LISTED_AT: Date = new Date("2026-10-26T10:00:00.000Z");
const HEX_64: RegExp = /^[0-9a-f]{64}$/;

let idCounter: number = 0;

function nextId(): ObjectID {
  idCounter++;
  return new ObjectID(
    `00000000-0000-4000-8000-${idCounter.toString().padStart(12, "0")}`,
  );
}

function resourceOf(
  type: string,
  id: string,
  account: string = ACCOUNT,
  region: string = "us-east-1",
): CloudMonitoredResource {
  const arn: string = `arn:aws:x:${region}:${account}:${id}`;

  return {
    provider: CloudProvider.AWS,
    source: CloudMonitoringSource.AwsCloudWatch,
    resourceType: type,
    name: id,
    providerResourceId: arn,
    accountId: account,
    region,
    resourceGroup: "",
    identityKey: `aws|${account}|${region}|${type}|id=${id}`.toLowerCase(),
    telemetryAttributes: {},
  };
}

function itemOf(
  resource: CloudMonitoredResource,
  extra: Partial<CloudInventoryItem> = {},
): CloudInventoryItem {
  return {
    resource,
    tags: { team: "payments" },
    properties: { InstanceType: "m5.large" },
    relationships: [{ kind: CloudRelationshipKind.RunsIn, target: "subnet-1" }],
    endpoints: ["web.example.com"],
    ...extra,
  };
}

interface Held {
  id: ObjectID;
  resource: CloudMonitoredResource;
  isArchived: boolean;
  tags?: Record<string, string> | undefined;
  fingerprint?: string | undefined;
}

function held(
  resource: CloudMonitoredResource,
  isArchived: boolean = false,
  tags?: Record<string, string>,
  fingerprint?: string,
): Held {
  return { id: nextId(), resource, isArchived, tags, fingerprint };
}

function modelOf(row: Held): CloudResource {
  const model: CloudResource = new CloudResource();
  model.id = row.id;
  model.resourceIdentifier = buildCloudMonitoredResourceIdentifier(
    row.resource,
  );
  model.providerResourceId = row.resource.providerResourceId;
  model.cloudResourceType = row.resource.resourceType;
  model.name = row.resource.name;
  model.cloudRegion = row.resource.region;
  model.cloudAccountId = row.resource.accountId;
  model.cloudResourceGroup = "";
  model.isArchived = row.isArchived;
  if (row.tags) {
    model.cloudTags = row.tags;
  }
  if (row.fingerprint) {
    model.cloudInventoryFingerprint = row.fingerprint;
  }
  return model;
}

function markedListedIds(): Array<string> {
  return query.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return String(call[0]).includes(`SET "inventoriedAt" = $3`);
    })
    .flatMap((call: Array<unknown>): Array<string> => {
      return ((call[1] as Array<unknown>)[1] as Array<string>) || [];
    });
}

let holding: Array<Held>;
let createdCalls: Array<{
  resource: CloudMonitoredResource;
  inventory: unknown;
}>;
let listingCalls: Array<{ cloudResourceId: ObjectID; inventory: unknown }>;
let createdAnswer: boolean;
let ruleRuns: Array<string>;
let query: jest.Mock;

function archivedIds(): Array<string> {
  return query.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return String(call[0]).includes(`SET "isArchived" = true`);
    })
    .flatMap((call: Array<unknown>): Array<string> => {
      return ((call[1] as Array<unknown>)[1] as Array<string>) || [];
    });
}

function linkedIds(): Array<string> {
  return query.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return String(call[0]).includes(`SET "cloudConnectionId" = $1`);
    })
    .flatMap((call: Array<unknown>): Array<string> => {
      return ((call[1] as Array<unknown>)[2] as Array<string>) || [];
    });
}

beforeEach(() => {
  idCounter = 100;
  holding = [];
  createdCalls = [];
  listingCalls = [];
  createdAnswer = true;

  jest.spyOn(CloudResourceService, "findBy").mockImplementation((async () => {
    return holding.map(modelOf);
  }) as never);
  jest
    .spyOn(CloudResourceService, "findOrCreateMonitoredResource")
    .mockImplementation(
      async (data: {
        resource: CloudMonitoredResource;
        inventory?: unknown;
      }) => {
        createdCalls.push({
          resource: data.resource,
          inventory: data.inventory,
        });
        const model: CloudResource = new CloudResource();
        model.id = nextId();
        return { cloudResource: model, created: createdAnswer };
      },
    );
  ruleRuns = [];
  jest
    .spyOn(CloudResourceLabelRuleEngineService, "applyRulesToCloudResource")
    .mockImplementation(async (resource: CloudResource) => {
      ruleRuns.push(`label:${resource.id!.toString()}`);
    });
  jest
    .spyOn(CloudResourceOwnerRuleEngineService, "applyRulesToCloudResource")
    .mockImplementation(async (resource: CloudResource) => {
      ruleRuns.push(`owner:${resource.id!.toString()}`);
    });
  jest
    .spyOn(CloudResourceService, "recordInventoryListing")
    .mockImplementation(
      async (data: { cloudResourceId: ObjectID; inventory: unknown }) => {
        listingCalls.push({
          cloudResourceId: data.cloudResourceId,
          inventory: data.inventory,
        });
      },
    );
  query = jest.fn(async (_sql: string, parameters: Array<unknown>) => {
    const ids: Array<string> = (parameters.find(Array.isArray) ||
      []) as Array<string>;
    return [
      ids.map((id: string) => {
        return { _id: id };
      }),
      ids.length,
    ];
  });
  jest
    .spyOn(CloudResourceService, "getRepository")
    .mockReturnValue({ manager: { query } } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function syncInventory(data: {
  items: Array<CloudInventoryItem>;
  completelyListed?: Array<CloudCompleteListing>;
}): Promise<CloudConnectionSyncResult> {
  return CloudConnectionResourceSync.syncInventory({
    projectId: PROJECT,
    connectionId: CONNECTION,
    items: data.items,
    completelyListed: data.completelyListed || [],
    listedAt: LISTED_AT,
  });
}

describe("a listed resource the connection holds", () => {
  test("gets what the listing knows of it, and is not created again", async () => {
    const instance: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-1",
    );
    const row: Held = held(instance);
    holding = [row];

    await syncInventory({ items: [itemOf(instance)] });

    expect(createdCalls).toHaveLength(0);
    expect(listingCalls).toEqual([
      {
        cloudResourceId: row.id,
        inventory: {
          cloudTags: { team: "payments" },
          cloudProperties: { InstanceType: "m5.large" },
          cloudRelationships: [
            { kind: CloudRelationshipKind.RunsIn, target: "subnet-1" },
          ],
          cloudEndpoints: ["web.example.com"],
          cloudInventoryFingerprint: getInventoryFingerprint(itemOf(instance)),
        },
      },
    ]);
    expect(markedListedIds()).toEqual([]);
  });

  test("that the listing says the same of as last time is only marked listed, with the others, in one statement", async () => {
    const same: Array<Held> = [1, 2, 3].map((index: number): Held => {
      const resource: CloudMonitoredResource = resourceOf(
        "AWS::EC2::Instance",
        `i-${index}`,
      );
      return held(
        resource,
        false,
        { team: "payments" },
        getInventoryFingerprint(itemOf(resource)),
      );
    });
    const changedResource: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-changed",
    );
    const changed: Held = held(
      changedResource,
      false,
      { team: "payments" },
      getInventoryFingerprint(
        itemOf(changedResource, { properties: { InstanceType: "t3.small" } }),
      ),
    );
    holding = [...same, changed];

    await syncInventory({
      items: [...same, changed].map((row: Held): CloudInventoryItem => {
        return itemOf(row.resource);
      }),
    });

    // Only the one that changed is written in full.
    expect(
      listingCalls.map((call: { cloudResourceId: ObjectID }): string => {
        return call.cloudResourceId.toString();
      }),
    ).toEqual([changed.id.toString()]);
    expect(markedListedIds()).toEqual(
      same.map((row: Held): string => {
        return row.id.toString();
      }),
    );

    const mark: Array<unknown> = query.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return String(call[0]).includes(`SET "inventoriedAt" = $3`);
      },
    )!;
    // Pinned to the project, and listed at the listing's time.
    expect((mark[1] as Array<unknown>)[0]).toBe(PROJECT.toString());
    expect((mark[1] as Array<unknown>)[2]).toEqual(LISTED_AT);
    expect(String(mark[0])).toContain(`"projectId" = $1`);
    // A listing never moves lastSeenAt back.
    expect(String(mark[0])).toContain("GREATEST");
  });

  test("a thousand rows a statement: a big account is a few statements, not thousands", async () => {
    const rows: Array<Held> = [];

    for (let index: number = 0; index < 2500; index++) {
      const resource: CloudMonitoredResource = resourceOf(
        "AWS::SQS::Queue",
        `q-${index}`,
      );
      rows.push(
        held(
          resource,
          false,
          { team: "payments" },
          getInventoryFingerprint(itemOf(resource)),
        ),
      );
    }

    holding = rows;

    await syncInventory({
      items: rows.map((row: Held): CloudInventoryItem => {
        return itemOf(row.resource);
      }),
    });

    expect(listingCalls).toEqual([]);
    expect(
      query.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).includes(`SET "inventoriedAt" = $3`);
      }),
    ).toHaveLength(3);
    expect(markedListedIds()).toHaveLength(2500);
  });

  test("listed twice in one listing is written once", async () => {
    const instance: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-1",
    );
    holding = [held(instance)];

    await syncInventory({ items: [itemOf(instance), itemOf(instance)] });

    expect(listingCalls).toHaveLength(1);
  });
});

describe("label and owner rules", () => {
  test("run on a held resource whose listing brings tags it did not have", async () => {
    const instance: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-1",
    );
    const row: Held = held(instance);
    holding = [row];

    await syncInventory({ items: [itemOf(instance)] });

    expect(ruleRuns).toEqual([
      `label:${row.id.toString()}`,
      `owner:${row.id.toString()}`,
    ]);
  });

  test("run when a tag's value changed, not when the tags are the same in another order", async () => {
    const changed: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-1",
    );
    const same: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-2",
    );
    const changedRow: Held = held(changed, false, { team: "search" });
    holding = [
      changedRow,
      held(same, false, { env: "prod", team: "payments" }),
    ];

    await syncInventory({
      items: [
        itemOf(changed),
        itemOf(same, { tags: { team: "payments", env: "prod" } }),
      ],
    });

    expect(ruleRuns).toEqual([
      `label:${changedRow.id.toString()}`,
      `owner:${changedRow.id.toString()}`,
    ]);
  });

  test("do not run for a resource listed without tags", async () => {
    const instance: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-1",
    );
    holding = [held(instance)];

    await syncInventory({ items: [itemOf(instance, { tags: {} })] });

    expect(ruleRuns).toEqual([]);
  });
});

describe("a listed resource the connection does not hold", () => {
  test("is created with its tags already on it - so label and owner rules see them - under its cloud name, then linked", async () => {
    const instance: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-2",
    );

    const result: CloudConnectionSyncResult = await syncInventory({
      items: [itemOf(instance, { displayName: "web-2" })],
    });

    expect(createdCalls).toHaveLength(1);
    expect(createdCalls[0]!.resource.name).toBe("web-2");
    expect(createdCalls[0]!.resource.identityKey).toBe(instance.identityKey);
    expect(createdCalls[0]!.inventory).toEqual(
      expect.objectContaining({ cloudTags: { team: "payments" } }),
    );
    expect(linkedIds()).toEqual(["00000000-0000-4000-8000-000000000101"]);
    expect(result.newResources).toBe(1);
    // A row it created carries the listing already: written once.
    expect(listingCalls).toHaveLength(0);
  });

  test("that already had a row (another connection's, or ingest's) gets the listing too", async () => {
    createdAnswer = false;

    await syncInventory({
      items: [itemOf(resourceOf("AWS::EC2::Instance", "i-3"))],
    });

    expect(listingCalls).toHaveLength(1);
  });

  test("past MAX_NEW_RESOURCES_PER_READ waits for the next listing", async () => {
    const items: Array<CloudInventoryItem> = [];

    for (
      let index: number = 0;
      index < MAX_NEW_RESOURCES_PER_READ + 3;
      index++
    ) {
      items.push(itemOf(resourceOf("AWS::SQS::Queue", `q-${index}`)));
    }

    const result: CloudConnectionSyncResult = await syncInventory({ items });

    expect(createdCalls).toHaveLength(MAX_NEW_RESOURCES_PER_READ);
    expect(result.hasMore).toBe(true);
  });
});

describe("a held resource the listing lacks", () => {
  test("is archived only in a Region its type was listed in full in", async () => {
    const goneHere: Held = held(
      resourceOf("AWS::EC2::Instance", "i-gone", ACCOUNT, "eu-west-1"),
    );
    // A stopped instance in a Region the listing did not read this time.
    const elsewhere: Held = held(
      resourceOf("AWS::EC2::Instance", "i-stopped", ACCOUNT, "ap-south-1"),
    );
    holding = [goneHere, elsewhere];

    await syncInventory({
      items: [],
      completelyListed: [
        {
          accountId: ACCOUNT,
          regions: ["eu-west-1"],
          resourceTypes: ["AWS::EC2::Instance"],
        },
      ],
    });

    expect(archivedIds()).toEqual([goneHere.id.toString()]);
  });

  test("is gone by account, type and Region alike, in any case", () => {
    const row: {
      cloudAccountId: string;
      cloudResourceType: string;
      cloudRegion: string;
    } = {
      cloudAccountId: ACCOUNT,
      cloudResourceType: "AWS::EC2::Instance",
      cloudRegion: "EU-West-1",
    };

    expect(
      isGoneFromListing({
        row,
        completelyListed: [
          {
            accountId: ACCOUNT,
            regions: ["eu-west-1"],
            resourceTypes: ["aws::ec2::instance"],
          },
        ],
      }),
    ).toBe(true);
    // No Regions named: every Region (an Azure subscription, listed whole).
    expect(
      isGoneFromListing({
        row,
        completelyListed: [
          { accountId: ACCOUNT, resourceTypes: ["AWS::EC2::Instance"] },
        ],
      }),
    ).toBe(true);
    expect(
      isGoneFromListing({
        row,
        completelyListed: [
          {
            accountId: ACCOUNT,
            regions: ["us-east-1"],
            resourceTypes: ["AWS::EC2::Instance"],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isGoneFromListing({
        row,
        completelyListed: [
          {
            accountId: "999999999999",
            resourceTypes: ["AWS::EC2::Instance"],
          },
        ],
      }),
    ).toBe(false);
    expect(isGoneFromListing({ row, completelyListed: [] })).toBe(false);
  });

  test("is archived when its type was listed in full for its account", async () => {
    const gone: Held = held(resourceOf("AWS::EC2::Instance", "i-gone"));
    holding = [gone];

    const result: CloudConnectionSyncResult = await syncInventory({
      items: [],
      completelyListed: [
        { accountId: ACCOUNT, resourceTypes: ["AWS::EC2::Instance"] },
      ],
    });

    expect(archivedIds()).toEqual([gone.id.toString()]);
    expect(result.archivedResources).toBe(1);
  });

  test("matches the account and the type whatever their case", async () => {
    const gone: Held = held(resourceOf("AWS::EC2::Instance", "i-gone"));
    holding = [gone];

    await syncInventory({
      items: [],
      completelyListed: [
        {
          accountId: ACCOUNT.toUpperCase(),
          resourceTypes: ["aws::ec2::instance"],
        },
      ],
    });

    expect(archivedIds()).toEqual([gone.id.toString()]);
  });

  test("stays when its type was listed only in part, or not at all", async () => {
    holding = [
      held(resourceOf("AWS::Lambda::Function", "fn-1")),
      held(resourceOf("AWS::Logs::LogGroup", "group-1")),
    ];

    await syncInventory({
      items: [],
      completelyListed: [
        { accountId: ACCOUNT, resourceTypes: ["AWS::EC2::Instance"] },
      ],
    });

    expect(archivedIds()).toEqual([]);
  });

  test("of another account, or already archived, stays as it is", async () => {
    holding = [
      held(resourceOf("AWS::EC2::Instance", "i-other", "999999999999")),
      held(resourceOf("AWS::EC2::Instance", "i-archived"), true),
    ];

    await syncInventory({
      items: [],
      completelyListed: [
        { accountId: ACCOUNT, resourceTypes: ["AWS::EC2::Instance"] },
      ],
    });

    expect(archivedIds()).toEqual([]);
  });

  test("a listed one of the same type is not archived", async () => {
    const kept: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-1",
    );
    const gone: Held = held(resourceOf("AWS::EC2::Instance", "i-2"));
    holding = [held(kept), gone];

    await syncInventory({
      items: [itemOf(kept)],
      completelyListed: [
        { accountId: ACCOUNT, resourceTypes: ["AWS::EC2::Instance"] },
      ],
    });

    expect(archivedIds()).toEqual([gone.id.toString()]);
  });
});

describe("what a listing says of a resource, hashed", () => {
  test("is the same for the same listing, whatever the order of its tags, lists and endpoints", () => {
    const resource: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-1",
    );

    expect(
      getInventoryFingerprint(
        itemOf(resource, {
          tags: { team: "payments", env: "prod" },
          relationships: [
            { kind: CloudRelationshipKind.RunsIn, target: "subnet-1" },
            { kind: CloudRelationshipKind.ProtectedBy, target: "sg-1" },
          ],
          endpoints: ["a.example.com", "b.example.com"],
          properties: { b: 2, a: 1 },
        }),
      ),
    ).toBe(
      getInventoryFingerprint(
        itemOf(resource, {
          tags: { env: "prod", team: "payments" },
          relationships: [
            { kind: CloudRelationshipKind.ProtectedBy, target: "sg-1" },
            { kind: CloudRelationshipKind.RunsIn, target: "subnet-1" },
          ],
          endpoints: ["b.example.com", "a.example.com"],
          properties: { a: 1, b: 2 },
        }),
      ),
    );
  });

  test("changes with a tag, a property, a relationship, an endpoint or where it lives", () => {
    const resource: CloudMonitoredResource = resourceOf(
      "AWS::EC2::Instance",
      "i-1",
    );
    const base: string = getInventoryFingerprint(itemOf(resource));

    for (const changed of [
      itemOf(resource, { tags: { team: "search" } }),
      itemOf(resource, { properties: { InstanceType: "m5.xlarge" } }),
      itemOf(resource, {
        relationships: [
          { kind: CloudRelationshipKind.RunsIn, target: "subnet-2" },
        ],
      }),
      itemOf(resource, { endpoints: ["api.example.com"] }),
      itemOf({ ...resource, region: "eu-west-1" }),
    ]) {
      expect(getInventoryFingerprint(changed)).not.toBe(base);
    }
  });

  test("is a 64-character hex string, short enough for its column", () => {
    expect(
      getInventoryFingerprint(itemOf(resourceOf("AWS::EC2::Instance", "i-1"))),
    ).toMatch(HEX_64);
  });
});

describe("what it reports", () => {
  test("counts what the connection holds from the rows, by type and region", async () => {
    holding = [
      held(resourceOf("AWS::EC2::Instance", "i-1")),
      held(resourceOf("AWS::EC2::Instance", "i-2")),
      held(resourceOf("AWS::SQS::Queue", "q-1")),
      held(resourceOf("AWS::SQS::Queue", "q-old"), true),
    ];

    const result: CloudConnectionSyncResult = await syncInventory({
      items: [],
    });

    expect(result.resourceCount).toBe(3);
    expect(result.resourceTypes).toEqual([
      { type: "AWS::EC2::Instance", count: 2 },
      { type: "AWS::SQS::Queue", count: 1 },
    ]);
    expect(result.regions).toEqual([{ region: "us-east-1", count: 3 }]);
  });
});
