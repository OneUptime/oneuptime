import CloudConnectionResourceSync, {
  CloudConnectionSyncResult,
  MAX_NEW_RESOURCES_PER_READ,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import {
  CloudDiscoveredResource,
  CloudKnownResource,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudMonitoredResource,
  CloudMonitoringSource,
  buildCloudMonitoredResourceIdentifier,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { HEARTBEAT_ROW_PRESENT } from "../../../../Server/Utils/Telemetry/ResourceHeartbeat";

/*
 * The resources a connection holds, kept in step with what its reads find:
 * a new one is found or created under the name the cloud gives it and
 * linked only while no other connection holds it; a resource an account
 * listed in full is seen; one that account no longer lists is archived;
 * and what the connection holds is counted from the rows themselves.
 * `jest` is the global one.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SUBSCRIPTION: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_SUBSCRIPTION: string = "aaaaaaaa-0000-4000-8000-000000000002";

let idCounter: number = 0;

function nextId(): ObjectID {
  idCounter++;
  return new ObjectID(
    `00000000-0000-4000-8000-${idCounter.toString().padStart(12, "0")}`,
  );
}

function azureVm(
  name: string,
  account: string = SUBSCRIPTION,
): CloudMonitoredResource {
  const id: string = `/subscriptions/${account}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/${name}`;

  return {
    provider: CloudProvider.Azure,
    source: CloudMonitoringSource.AzureMonitor,
    resourceType: "Microsoft.Compute/virtualMachines",
    name,
    providerResourceId: id,
    accountId: account,
    region: "westeurope",
    resourceGroup: "rg",
    identityKey: id.toLowerCase(),
    telemetryAttributes: { "azuremonitor.resource_id": id },
  };
}

function ec2(instance: string): CloudMonitoredResource {
  const arn: string = `arn:aws:ec2:us-east-1:123456789012:instance/${instance}`;

  return {
    provider: CloudProvider.AWS,
    source: CloudMonitoringSource.AwsCloudWatch,
    resourceType: "AWS::EC2::Instance",
    name: instance,
    providerResourceId: arn,
    accountId: "123456789012",
    region: "us-east-1",
    resourceGroup: "",
    identityKey: arn,
    telemetryAttributes: { "Dimensions.InstanceId": instance },
  };
}

interface Row {
  id: ObjectID;
  resourceIdentifier: string;
  providerResourceId: string;
  cloudResourceType: string;
  name: string;
  cloudRegion: string;
  cloudAccountId: string;
  cloudResourceGroup: string;
  isArchived: boolean;
  cloudTags: Record<string, string>;
  cloudInventoryFingerprint: string;
}

function rowOf(
  resource: CloudMonitoredResource,
  isArchived: boolean = false,
): Row {
  return {
    id: nextId(),
    resourceIdentifier: buildCloudMonitoredResourceIdentifier(resource),
    providerResourceId: resource.providerResourceId,
    cloudResourceType: resource.resourceType,
    name: resource.name,
    cloudRegion: resource.region,
    cloudAccountId: resource.accountId,
    cloudResourceGroup: resource.resourceGroup,
    isArchived,
    cloudTags: {},
    cloudInventoryFingerprint: "",
  };
}

function modelOf(row: Row): CloudResource {
  const model: CloudResource = new CloudResource();
  model.id = row.id;
  model.resourceIdentifier = row.resourceIdentifier;
  model.providerResourceId = row.providerResourceId;
  model.cloudResourceType = row.cloudResourceType;
  model.name = row.name;
  model.cloudRegion = row.cloudRegion;
  model.cloudAccountId = row.cloudAccountId;
  model.cloudResourceGroup = row.cloudResourceGroup;
  model.isArchived = row.isArchived;
  return model;
}

function discovered(
  resource: CloudMonitoredResource,
  displayName?: string,
): CloudDiscoveredResource {
  return displayName ? { resource, displayName } : { resource };
}

// What the connection holds when the sync counts it at the end.
let heldAfter: Array<Row>;
let created: Array<CloudMonitoredResource>;
let findBy: jest.SpiedFunction<typeof CloudResourceService.findBy>;
let findOrCreate: jest.SpiedFunction<
  typeof CloudResourceService.findOrCreateMonitoredResource
>;
let sighting: jest.SpiedFunction<
  typeof CloudResourceService.recordMonitoredResourceSighting
>;
let query: jest.Mock;

function queries(): Array<{ sql: string; parameters: Array<unknown> }> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return { sql: call[0] as string, parameters: call[1] as Array<unknown> };
  });
}

function linkQueries(): Array<{ sql: string; parameters: Array<unknown> }> {
  return queries().filter((item: { sql: string }): boolean => {
    return item.sql.includes(`SET "cloudConnectionId" = $1`);
  });
}

function archiveQueries(): Array<{ sql: string; parameters: Array<unknown> }> {
  return queries().filter((item: { sql: string }): boolean => {
    return item.sql.includes(`SET "isArchived" = true`);
  });
}

beforeEach(() => {
  idCounter = 0;
  heldAfter = [];
  created = [];

  findBy = jest
    .spyOn(CloudResourceService, "findBy")
    .mockImplementation((async () => {
      return heldAfter.map(modelOf);
    }) as never);
  findOrCreate = jest
    .spyOn(CloudResourceService, "findOrCreateMonitoredResource")
    .mockImplementation(async (data: { resource: CloudMonitoredResource }) => {
      created.push(data.resource);
      const model: CloudResource = new CloudResource();
      model.id = nextId();
      return { cloudResource: model, created: true };
    });
  sighting = jest
    .spyOn(CloudResourceService, "recordMonitoredResourceSighting")
    .mockResolvedValue(HEARTBEAT_ROW_PRESENT);
  query = jest.fn(async (_sql: string, parameters: Array<unknown>) => {
    // UPDATE ... RETURNING answers [rows, count] through TypeORM's query().
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

async function sync(data: {
  linked?: Array<Row>;
  discovered: Array<CloudDiscoveredResource>;
  completelyListedAccounts?: Array<string>;
}): Promise<CloudConnectionSyncResult> {
  return CloudConnectionResourceSync.sync({
    projectId: PROJECT,
    connectionId: CONNECTION,
    linked: data.linked || [],
    discovered: data.discovered,
    completelyListedAccounts: data.completelyListedAccounts || [],
  });
}

describe("new resources", () => {
  test("are found or created under the cloud's name for them, then linked", async () => {
    await sync({
      discovered: [
        discovered(ec2("i-0abc"), "checkout-web-1"),
        discovered(ec2("i-0def")),
      ],
    });

    expect(
      created.map((resource: CloudMonitoredResource) => {
        return resource.name;
      }),
    ).toEqual(["checkout-web-1", "i-0def"]);
    // Only the name: the identity is the ingest's.
    expect(created[0]!.identityKey).toBe(ec2("i-0abc").identityKey);
    expect(findOrCreate.mock.calls[0]![0].projectId).toBe(PROJECT);

    expect(linkQueries()).toHaveLength(1);
    const link: { sql: string; parameters: Array<unknown> } = linkQueries()[0]!;
    expect(link.parameters[0]).toBe(CONNECTION.toString());
    expect(link.parameters[1]).toBe(PROJECT.toString());
    expect(link.parameters[2]).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  test("are linked only while no other connection holds them, in this project, not deleted", async () => {
    await sync({ discovered: [discovered(ec2("i-0abc"))] });

    const sql: string = linkQueries()[0]!.sql;
    expect(sql).toContain(`"cloudConnectionId" IS NULL`);
    expect(sql).toContain(`"projectId" = $2`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
  });

  test("count what was linked, not what was asked", async () => {
    query.mockResolvedValueOnce([[{ _id: "x" }], 1]);

    const result: CloudConnectionSyncResult = await sync({
      discovered: [discovered(ec2("i-1")), discovered(ec2("i-2"))],
    });

    expect(result.newResources).toBe(1);

    query.mockResolvedValueOnce([{ _id: "x" }, { _id: "y" }]);
    expect(
      (
        await sync({
          discovered: [discovered(ec2("i-3")), discovered(ec2("i-4"))],
        })
      ).newResources,
    ).toBe(2);
  });

  test("one already held is not created again; one seen twice is created once", async () => {
    const held: Row = rowOf(ec2("i-held"));

    await sync({
      linked: [held],
      discovered: [
        discovered(ec2("i-held")),
        discovered(ec2("i-new")),
        discovered(ec2("i-new"), "the same one, again"),
      ],
    });

    expect(
      created.map((resource: CloudMonitoredResource) => {
        return resource.name;
      }),
    ).toEqual(["i-new"]);
  });

  test("one that cannot be saved does not stop the others, and is not linked", async () => {
    findOrCreate.mockRejectedValueOnce(new Error("database unavailable"));
    // The project's auto-create budget is reached: no row, nothing to link.
    findOrCreate.mockResolvedValueOnce({ cloudResource: null, created: false });

    await sync({
      discovered: [
        discovered(ec2("i-1")),
        discovered(ec2("i-2")),
        discovered(ec2("i-3")),
      ],
    });

    expect(findOrCreate).toHaveBeenCalledTimes(3);
    expect(linkQueries()[0]!.parameters[2]).toEqual([
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  test("nothing new links nothing", async () => {
    const held: Row = rowOf(ec2("i-held"));

    const result: CloudConnectionSyncResult = await sync({
      linked: [held],
      discovered: [discovered(ec2("i-held"))],
    });

    expect(linkQueries()).toHaveLength(0);
    expect(result.newResources).toBe(0);
  });

  test(`one read creates ${MAX_NEW_RESOURCES_PER_READ} at most; the next creates the rest`, async () => {
    const many: Array<CloudDiscoveredResource> = [];

    for (
      let index: number = 0;
      index < MAX_NEW_RESOURCES_PER_READ + 3;
      index++
    ) {
      many.push(discovered(ec2(`i-${index}`)));
    }

    const result: CloudConnectionSyncResult = await sync({ discovered: many });

    expect(findOrCreate).toHaveBeenCalledTimes(MAX_NEW_RESOURCES_PER_READ);
    expect(result.hasMore).toBe(true);
    expect(
      (await sync({ discovered: many.slice(0, MAX_NEW_RESOURCES_PER_READ) }))
        .hasMore,
    ).toBe(false);
  });
});

describe("listed resources are seen", () => {
  test("a held resource an account listed in full is seen; one only measured is not", async () => {
    const vm: Row = rowOf(azureVm("vm-1"));
    const instance: Row = rowOf(ec2("i-1"));

    await sync({
      linked: [vm, instance],
      discovered: [discovered(azureVm("vm-1")), discovered(ec2("i-1"))],
      completelyListedAccounts: [SUBSCRIPTION.toUpperCase()],
    });

    expect(sighting).toHaveBeenCalledTimes(1);
    expect(sighting.mock.calls[0]![0].cloudResourceId).toBe(vm.id);
    expect(sighting.mock.calls[0]![0].resource.providerResourceId).toBe(
      azureVm("vm-1").providerResourceId,
    );
  });

  test("a sighting that fails does not stop the sync", async () => {
    sighting.mockRejectedValue(new Error("redis unavailable"));
    const vm: Row = rowOf(azureVm("vm-1"));
    heldAfter = [vm];

    const result: CloudConnectionSyncResult = await sync({
      linked: [vm],
      discovered: [discovered(azureVm("vm-1"))],
      completelyListedAccounts: [SUBSCRIPTION],
    });

    expect(result.resourceCount).toBe(1);
  });
});

describe("gone resources", () => {
  test("a held resource an account listed in full no longer has is archived, the way the silence sweep archives one", async () => {
    const kept: Row = rowOf(azureVm("vm-kept"));
    const gone: Row = rowOf(azureVm("vm-gone"));
    const alreadyArchived: Row = rowOf(azureVm("vm-old"), true);
    const otherSubscription: Row = rowOf(
      azureVm("vm-other", OTHER_SUBSCRIPTION),
    );

    const result: CloudConnectionSyncResult = await sync({
      linked: [kept, gone, alreadyArchived, otherSubscription],
      discovered: [discovered(azureVm("vm-kept"))],
      completelyListedAccounts: [SUBSCRIPTION],
    });

    expect(archiveQueries()).toHaveLength(1);
    const archive: { sql: string; parameters: Array<unknown> } =
      archiveQueries()[0]!;
    expect(archive.parameters[0]).toBe(PROJECT.toString());
    // Not one of another subscription this read did not list in full.
    expect(archive.parameters[1]).toEqual([gone.id.toString()]);
    expect(archive.parameters[2]).toBeInstanceOf(Date);
    // Marked as archived by OneUptime, so it comes back if it reports again.
    expect(archive.sql).toContain(`"autoArchivedAt" = $3`);
    expect(archive.sql).toContain(`"archivedByUserId" = NULL`);
    expect(archive.sql).toContain(`"isArchived" = false`);
    expect(result.archivedResources).toBe(1);
  });

  test("resources found from their metrics are never archived here: quiet is not deleted", async () => {
    const quiet: Row = rowOf(ec2("i-quiet"));

    const result: CloudConnectionSyncResult = await sync({
      linked: [quiet],
      discovered: [],
      completelyListedAccounts: [],
    });

    expect(archiveQueries()).toHaveLength(0);
    expect(result.archivedResources).toBe(0);
  });
});

describe("what the connection holds", () => {
  test("is counted from its live rows, read back after the sync", async () => {
    heldAfter = [
      rowOf(azureVm("vm-1")),
      rowOf(azureVm("vm-2")),
      { ...rowOf(azureVm("vm-3")), cloudRegion: "eastus" },
      rowOf(azureVm("vm-archived"), true),
      {
        ...rowOf(azureVm("db-1")),
        cloudResourceType: "Microsoft.Sql/servers/databases",
      },
    ];

    const result: CloudConnectionSyncResult = await sync({ discovered: [] });

    expect(result.resourceCount).toBe(4);
    expect(result.resourceTypes).toEqual([
      { type: "Microsoft.Compute/virtualMachines", count: 3 },
      { type: "Microsoft.Sql/servers/databases", count: 1 },
    ]);
    expect(result.regions).toEqual([
      { region: "westeurope", count: 3 },
      { region: "eastus", count: 1 },
    ]);

    const request: { query: JSONObject; props: JSONObject } = findBy.mock
      .calls[0]![0] as never;
    expect(request.query).toEqual({
      projectId: PROJECT,
      cloudConnectionId: CONNECTION,
      cloudResourceKind: CloudResourceKind.Resource,
    });
    expect(request.props).toEqual({ isRoot: true });
  });

  test("the live rows are what a connector reads between two listings", () => {
    const live: Row = rowOf(azureVm("vm-1"));

    expect(
      CloudConnectionResourceSync.toKnownResources([
        live,
        rowOf(azureVm("vm-archived"), true),
        { ...rowOf(azureVm("vm-no-id")), providerResourceId: "" },
      ]),
    ).toEqual([
      {
        providerResourceId: live.providerResourceId,
        resourceType: "Microsoft.Compute/virtualMachines",
        name: "vm-1",
        region: "westeurope",
        accountId: SUBSCRIPTION,
        resourceGroup: "rg",
      },
    ] as Array<CloudKnownResource>);
  });
});
