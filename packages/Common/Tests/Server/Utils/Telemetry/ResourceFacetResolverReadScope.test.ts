import ResourceFacetResolver, {
  ResourceFacetEntity,
} from "../../../../Server/Utils/Telemetry/ResourceFacetResolver";
import { TelemetryReadScope } from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import ServiceService from "../../../../Server/Services/ServiceService";
import HostService from "../../../../Server/Services/HostService";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The explorers' resource facets (Service, Host, Kubernetes cluster, ...)
 * list the project's resources from Postgres, so a resource with no
 * telemetry in the window still shows. A caller whose telemetry read is
 * limited lists only the resources whose rows they may read, and a block
 * with labels takes its resources off the list too.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceA: string = ObjectID.generate().toString();
const serviceB: string = ObjectID.generate().toString();
const serviceC: string = ObjectID.generate().toString();

interface Spy {
  mock: { calls: Array<Array<unknown>> };
  mockResolvedValue: (value: unknown) => unknown;
}

let serviceFind: Spy;
let hostFind: Spy;

beforeEach(() => {
  serviceFind = jest.spyOn(
    ServiceService as never,
    "findBy" as never,
  ) as unknown as Spy;
  serviceFind.mockResolvedValue([{ _id: serviceA, name: "Checkout" }]);

  hostFind = jest.spyOn(
    HostService as never,
    "findBy" as never,
  ) as unknown as Spy;
  hostFind.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function list(
  scope: TelemetryReadScope | undefined,
  facetKey: string = "primaryEntityId",
): Promise<Array<ResourceFacetEntity>> {
  const result: Record<
    string,
    Array<ResourceFacetEntity>
  > = await ResourceFacetResolver.listEntities(projectId, [
    { facetKey, ...(scope ? { scope } : {}) },
  ]);
  return result[facetKey] || [];
}

// The _id filter of the latest listing.
function idFilter(spy: Spy): FindOperator<unknown> | undefined {
  const request: { query: Record<string, unknown> } = spy.mock.calls[
    spy.mock.calls.length - 1
  ]![0] as {
    query: Record<string, unknown>;
  };
  return request.query["_id"] as FindOperator<unknown> | undefined;
}

function boundIds(operator: FindOperator<unknown>): Array<string> {
  return Object.values(
    (operator.objectLiteralParameters || {}) as Record<string, unknown>,
  )
    .flatMap((value: unknown) => {
      return Array.isArray(value) ? value.map(String) : [String(value)];
    })
    .sort();
}

describe("resource facet listings follow the caller's read scope", () => {
  test("a project-wide caller lists every resource of the project", async () => {
    await list({ readableIds: null, blockedIds: [] });
    expect(idFilter(serviceFind)).toBeUndefined();

    // No scope at all (an internal caller) lists the same.
    await list(undefined);
    expect(idFilter(serviceFind)).toBeUndefined();
  });

  test("a limited caller lists only the resources they may read", async () => {
    const entities: Array<ResourceFacetEntity> = await list({
      readableIds: [serviceA, serviceB],
      blockedIds: [],
    });

    expect(entities).toEqual([{ id: serviceA, displayName: "Checkout" }]);
    const operator: FindOperator<unknown> = idFilter(serviceFind)!;
    expect(operator).toBeInstanceOf(FindOperator);
    expect(boundIds(operator)).toEqual([serviceA, serviceB].sort());
    // Still the caller's project only.
    const request: { query: Record<string, unknown> } = serviceFind.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect(request.query["projectId"]).toEqual(projectId);
  });

  test("a block with labels takes its resources off a limited caller's list", async () => {
    await list({ readableIds: [serviceA, serviceC], blockedIds: [serviceC] });

    expect(boundIds(idFilter(serviceFind)!)).toEqual([serviceA]);
  });

  test("a block with labels takes its resources off a project-wide caller's list", async () => {
    await list({ readableIds: null, blockedIds: [serviceC] });

    const operator: FindOperator<unknown> = idFilter(serviceFind)!;
    expect(operator.getSql?.("_id") || "").toContain("NOT IN");
    expect(boundIds(operator)).toEqual([serviceC]);
  });

  test("a caller who may read no resource lists none, and nothing is looked up", async () => {
    expect(await list({ readableIds: [], blockedIds: [] })).toEqual([]);
    expect(
      await list({ readableIds: [serviceC], blockedIds: [serviceC] }),
    ).toEqual([]);
    expect(serviceFind.mock.calls.length).toBe(0);
  });

  test("every resource type lists the same way", async () => {
    await list({ readableIds: [serviceB], blockedIds: [] }, "hostId");

    expect(boundIds(idFilter(hostFind)!)).toEqual([serviceB]);
  });
});
