import "../../TestingUtils/Init";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ResourceFacetResolver from "../../../../Server/Utils/Telemetry/ResourceFacetResolver";
import {
  ErasedInventorySource,
  INVENTORY_SOURCES,
  InventoryRowProjection,
} from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
import {
  AIResourceTelemetryScope,
  buildAIResourceTelemetryScope,
} from "../../../../Server/Utils/AI/Toolbox/ResourceTools";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import HostService from "../../../../Server/Services/HostService";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import {
  CloudResourceKind,
  isCloudResourceKindResource,
} from "../../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The places outside the Cloud product that read CloudResource rows, now
 * that the table holds two kinds (CloudResourceKind): environments, keyed
 * by cloud.platform + account + region, and the IaaS / PaaS resources
 * discovered from cloud monitoring, keyed by their provider's identity.
 *
 *   - the explorers' Cloud Resource facet lists environments only: a facet
 *     value matches telemetry by its primaryEntityId, which only an
 *     environment ever is;
 *   - the inventory mirror describes a resource by its provider id and type,
 *     an environment by its key, as before;
 *   - the AI agent scopes a resource's telemetry by the exact metric
 *     attributes ingest recorded for it - never by cloud.* attributes its
 *     whole account shares - and refuses to scope one without them.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const ARM_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-1`;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CloudResourceKind", () => {
  test("only the resource value is a resource; a missing or unknown kind is an environment", () => {
    expect(isCloudResourceKindResource(CloudResourceKind.Resource)).toBe(true);
    expect(isCloudResourceKindResource(CloudResourceKind.Environment)).toBe(
      false,
    );
    expect(isCloudResourceKindResource(undefined)).toBe(false);
    expect(isCloudResourceKindResource(null)).toBe(false);
    expect(isCloudResourceKindResource("Resource")).toBe(false);
    expect(isCloudResourceKindResource("")).toBe(false);
  });

  test("the column defaults to an environment, and no person can set it", () => {
    const model: CloudResource = new CloudResource();
    const column: any = model.getTableColumnMetadata("cloudResourceKind");

    expect(column.defaultValue).toBe(CloudResourceKind.Environment);
    expect(column.isDefaultValueColumn).toBe(true);
    expect(
      model.getColumnAccessControlFor("cloudResourceKind")?.create,
    ).toEqual([]);
    expect(
      model.getColumnAccessControlFor("cloudResourceKind")?.update,
    ).toEqual([]);
  });

  test.each([
    "cloudResourceType",
    "providerResourceId",
    "cloudResourceGroup",
    "telemetryAttributes",
    "autoArchivedAt",
  ])(
    "%s is ingest's alone: readable, never set by a person",
    (column: string) => {
      const model: CloudResource = new CloudResource();
      const access: any = model.getColumnAccessControlFor(column);

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read.length).toBeGreaterThan(0);
    },
  );
});

describe("the explorers' Cloud Resource facet", () => {
  test("lists environments only", async () => {
    const findBy: any = jest
      .spyOn(CloudResourceService, "findBy")
      .mockResolvedValue([] as never);

    await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "cloudResourceId" },
    ]);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0][0].query).toEqual({
      cloudResourceKind: CloudResourceKind.Environment,
      projectId: PROJECT_ID,
    });
  });

  test("a search narrows within environments, and the project always wins", async () => {
    const findBy: any = jest
      .spyOn(CloudResourceService, "findBy")
      .mockResolvedValue([] as never);

    await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "cloudResourceId", searchText: "ecs" },
    ]);

    const query: Record<string, unknown> = findBy.mock.calls[0][0].query;
    expect(query["cloudResourceKind"]).toBe(CloudResourceKind.Environment);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["name"]).toBeDefined();
  });

  test("other facets are not narrowed", async () => {
    const findBy: any = jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([] as never);

    await ResourceFacetResolver.listEntities(PROJECT_ID, [
      { facetKey: "hostId" },
    ]);

    expect(findBy.mock.calls[0][0].query).toEqual({ projectId: PROJECT_ID });
  });
});

describe("the inventory mirror of a Cloud Resource", () => {
  function cloudSource(): ErasedInventorySource {
    const source: ErasedInventorySource | undefined = INVENTORY_SOURCES.find(
      (candidate: ErasedInventorySource) => {
        return candidate.resourceType === "CloudResource";
      },
    );
    expect(source).toBeDefined();
    return source!;
  }

  async function mirror(row: CloudResource): Promise<InventoryRowProjection> {
    jest
      .spyOn(CloudResourceService, "findBy")
      .mockResolvedValue([row] as never);
    const page: Array<InventoryRowProjection> = await cloudSource().fetchPage({
      skip: 0,
      limit: 10,
    });
    expect(page).toHaveLength(1);
    return page[0]!;
  }

  function cloudRow(overrides: Partial<CloudResource>): CloudResource {
    const row: CloudResource = new CloudResource(ObjectID.generate());
    row.projectId = PROJECT_ID;
    row.name = "row";
    Object.assign(row, overrides);
    return row;
  }

  test("a resource is described by its provider id and type", async () => {
    const projection: InventoryRowProjection = await mirror(
      cloudRow({
        cloudResourceKind: CloudResourceKind.Resource,
        resourceIdentifier: "azure:0123456789abcdef0123456789abcdef01234567",
        providerResourceId: ARM_ID,
        cloudResourceType: "Microsoft.Compute/virtualMachines",
        cloudProvider: "azure",
        cloudRegion: "westeurope",
        cloudAccountId: SUBSCRIPTION,
      }),
    );

    expect(projection.descriptiveAttributes).toEqual({
      "cloud.resource.id": ARM_ID,
      "cloud.resource.type": "Microsoft.Compute/virtualMachines",
      "cloud.provider": "azure",
      "cloud.region": "westeurope",
      "cloud.account.id": SUBSCRIPTION,
    });
  });

  test("an environment is described by its key, as before", async () => {
    const projection: InventoryRowProjection = await mirror(
      cloudRow({
        cloudResourceKind: CloudResourceKind.Environment,
        resourceIdentifier: "aws_ecs|123456789012|us-east-1",
        cloudProvider: "aws",
        cloudRegion: "us-east-1",
        cloudAccountId: "123456789012",
      }),
    );

    expect(projection.descriptiveAttributes).toEqual({
      "cloud.resource.id": "aws_ecs|123456789012|us-east-1",
      "cloud.provider": "aws",
      "cloud.region": "us-east-1",
      "cloud.account.id": "123456789012",
    });
  });

  test("a row read without its kind is an environment", async () => {
    const projection: InventoryRowProjection = await mirror(
      cloudRow({ resourceIdentifier: "gcp_cloud_run|acme|us-central1" }),
    );

    expect(projection.descriptiveAttributes["cloud.resource.id"]).toBe(
      "gcp_cloud_run|acme|us-central1",
    );
  });
});

describe("the AI agent's telemetry scope for a Cloud Resource", () => {
  const resourceId: ObjectID = ObjectID.generate();

  function scope(resource: Record<string, unknown>): AIResourceTelemetryScope {
    return buildAIResourceTelemetryScope({
      type: AIResourceType.CloudResource,
      id: resourceId,
      projectId: PROJECT_ID,
      signal: "metrics",
      resource: resource as never,
    });
  }

  test("a resource is scoped by the exact attributes ingest recorded for it", () => {
    const result: AIResourceTelemetryScope = scope({
      cloudResourceKind: CloudResourceKind.Resource,
      cloudProvider: "aws",
      cloudAccountId: "123456789012",
      cloudRegion: "us-east-1",
      telemetryAttributes: {
        Namespace: "AWS/EC2",
        "Dimensions.InstanceId": "i-0abc",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
      },
    });

    expect(result.attributes).toEqual({
      Namespace: "AWS/EC2",
      "Dimensions.InstanceId": "i-0abc",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
    });
    expect(result.resourceScopes).toBeUndefined();
    expect(result.note).toContain("no logs or traces of its own");
  });

  test("never by the cloud.* attributes its whole account shares", () => {
    const result: AIResourceTelemetryScope = scope({
      cloudResourceKind: CloudResourceKind.Resource,
      cloudPlatform: "aws_ecs",
      telemetryAttributes: { "azuremonitor.resource_id": ARM_ID },
    });

    expect(result.attributes).toEqual({ "azuremonitor.resource_id": ARM_ID });
  });

  test("only string values are kept", () => {
    const result: AIResourceTelemetryScope = scope({
      cloudResourceKind: CloudResourceKind.Resource,
      telemetryAttributes: {
        "azuremonitor.resource_id": ARM_ID,
        empty: "",
        number: 3,
        nested: { a: "b" },
      },
    });

    expect(result.attributes).toEqual({ "azuremonitor.resource_id": ARM_ID });
  });

  test.each([
    [undefined],
    [null],
    [{}],
    [["azuremonitor.resource_id"]],
    ["azuremonitor.resource_id"],
    [{ empty: "" }],
  ])(
    "a resource without usable attributes (%p) is refused, never left unfiltered",
    (telemetryAttributes: unknown) => {
      expect(() => {
        return scope({
          cloudResourceKind: CloudResourceKind.Resource,
          telemetryAttributes: telemetryAttributes,
        });
      }).toThrow("no recorded metric attributes");
    },
  );

  test("an environment is still scoped by its cloud.* resource attributes", () => {
    const result: AIResourceTelemetryScope = scope({
      cloudResourceKind: CloudResourceKind.Environment,
      cloudPlatform: "aws_ecs",
      cloudAccountId: "123456789012",
      cloudRegion: "us-east-1",
      telemetryAttributes: { ignored: "yes" },
    });

    expect(result.attributes).toEqual({
      "resource.cloud.platform": "aws_ecs",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
    });
  });
});
