import LogAggregationService from "../../../Server/Services/LogAggregationService";
import TraceAggregationService, {
  FacetValue as TraceFacetValue,
} from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService from "../../../Server/Services/ExceptionAggregationService";
import MetricAggregationService from "../../../Server/Services/MetricAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  RESOURCE_FACET_CATALOG,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Every resource facet the explorers offer is counted by the aggregation
 * services as `toString(primaryEntityId)` restricted to that resource's
 * `primaryEntityType`. The four services each kept a hand-copied
 * facetKey -> ServiceType map, and two resource types (Docker Swarm, IoT
 * fleet) were missing from all of them — so their facet keys fell through
 * to the ATTRIBUTE path, `attributes['dockerSwarmClusterId']`, which no row
 * ever has, and silently counted nothing.
 *
 * The maps are now derived from ResourceFacetCatalog. These tests build the
 * real (private, pure) facet statements for every catalog entry in every
 * service, so a resource type cannot again be offered in the sidebar but
 * counted as an attribute.
 */

type BuildFacetStatement = (request: JSONObject) => Statement;

interface ServiceUnderTest {
  name: string;
  build: BuildFacetStatement;
}

const projectId: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-09-01T00:00:00.000Z");
const endTime: Date = new Date("2026-09-01T01:00:00.000Z");

function builderFor(service: unknown): BuildFacetStatement {
  return (request: JSONObject): Statement => {
    return (
      service as { buildFacetStatement: BuildFacetStatement }
    ).buildFacetStatement({
      projectId,
      startTime,
      endTime,
      limit: 25,
      ...request,
    });
  };
}

const SERVICES: Array<ServiceUnderTest> = [
  { name: "LogAggregationService", build: builderFor(LogAggregationService) },
  {
    name: "ExceptionAggregationService",
    build: builderFor(ExceptionAggregationService),
  },
  {
    name: "MetricAggregationService",
    build: builderFor(MetricAggregationService),
  },
  {
    name: "TraceAggregationService",
    build: builderFor(TraceAggregationService),
  },
];

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("resource facet counting covers the whole catalog", () => {
  for (const service of SERVICES) {
    describe(service.name, () => {
      for (const definition of RESOURCE_FACET_CATALOG) {
        test(`${definition.facetKey} counts primaryEntityId rows typed ${definition.serviceType}`, () => {
          const statement: Statement = service.build({
            facetKey: definition.facetKey,
          });

          expect(statement.query).toContain(
            "SELECT toString(primaryEntityId) AS val, count() AS cnt",
          );
          expect(statement.query).toMatch(
            / AND primaryEntityType = \{p\d+:String\}/,
          );
          expect(paramValues(statement)).toContain(definition.serviceType);

          // Never the attribute path, which would silently count nothing.
          expect(statement.query).not.toContain("mapContains(attributes");
          expect(paramValues(statement)).not.toContain(definition.facetKey);
        });
      }

      test("dockerSwarmClusterId is counted under DockerSwarmCluster", () => {
        const statement: Statement = service.build({
          facetKey: "dockerSwarmClusterId",
        });

        expect(paramValues(statement)).toContain(
          ServiceType.DockerSwarmCluster,
        );
      });

      test("databaseServerId is counted under DatabaseServer — the receiver batches primary-keyed on the row", () => {
        const statement: Statement = service.build({
          facetKey: "databaseServerId",
        });

        expect(paramValues(statement)).toContain(ServiceType.DatabaseServer);
        expect(statement.query).not.toContain("mapContains(attributes");
      });

      test("iotFleetId is counted under IoTDevice — ingest stamps the fleet id with that type", () => {
        const statement: Statement = service.build({ facetKey: "iotFleetId" });

        expect(paramValues(statement)).toContain(ServiceType.IoTDevice);
        expect(paramValues(statement)).not.toContain("IoTFleet");
      });

      test("the Services facet stays restricted to Service-typed rows", () => {
        const statement: Statement = service.build({
          facetKey: "primaryEntityId",
        });

        expect(statement.query).toContain(
          " AND (primaryEntityType = '' OR primaryEntityType = ",
        );
        expect(paramValues(statement)).toContain(ServiceType.OpenTelemetry);
        for (const definition of RESOURCE_FACET_CATALOG) {
          expect(paramValues(statement)).not.toContain(definition.serviceType);
        }
      });

      test("a look-alike key that is not in the catalog is still an attribute facet", () => {
        const statement: Statement = service.build({
          facetKey: "iotDeviceId",
        });

        expect(statement.query).toContain("mapContains(attributes");
        expect(statement.query).not.toMatch(/ AND primaryEntityType = /);
      });

      test("each resource facet key counts under a different type", () => {
        const types: Array<unknown> = RESOURCE_FACET_CATALOG.map(
          (definition: ResourceFacetDefinition): unknown => {
            const statement: Statement = service.build({
              facetKey: definition.facetKey,
            });

            return paramValues(statement).find((value: unknown): boolean => {
              return (Object.values(ServiceType) as Array<unknown>).includes(
                value,
              );
            });
          },
        );

        expect(new Set(types).size).toBe(RESOURCE_FACET_CATALOG.length);
      });
    });
  }
});

describe("TraceAggregationService.getFacetValuesFromSample (resource keys)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubSpans(rows: Array<JSONObject>): Array<Statement> {
    const captured: Array<Statement> = [];

    jest.spyOn(SpanService, "executeQuery").mockImplementation(((
      statement: Statement,
    ): Promise<Results> => {
      captured.push(statement);

      return Promise.resolve({
        json: (): Promise<unknown> => {
          return Promise.resolve({ data: rows });
        },
      } as unknown as Results);
    }) as never);

    return captured;
  }

  test("counts Docker Swarm and IoT fleet rows by their primaryEntityType, not as attributes", async () => {
    const swarmId: string = ObjectID.generate().toString();
    const fleetId: string = ObjectID.generate().toString();
    const hostId: string = ObjectID.generate().toString();

    const captured: Array<Statement> = stubSpans([
      { primaryEntityId: swarmId, primaryEntityType: "DockerSwarmCluster" },
      { primaryEntityId: swarmId, primaryEntityType: "DockerSwarmCluster" },
      { primaryEntityId: fleetId, primaryEntityType: "IoTDevice" },
      { primaryEntityId: hostId, primaryEntityType: "Host" },
    ]);

    const facets: Record<
      string,
      Array<TraceFacetValue>
    > = await TraceAggregationService.getFacetValuesFromSample({
      projectId,
      startTime,
      endTime,
      facetKeys: ["dockerSwarmClusterId", "iotFleetId", "hostId"],
    });

    expect(facets["dockerSwarmClusterId"]).toEqual([
      { value: swarmId, count: 2 },
    ]);
    expect(facets["iotFleetId"]).toEqual([{ value: fleetId, count: 1 }]);
    expect(facets["hostId"]).toEqual([{ value: hostId, count: 1 }]);

    // The sample reads the typed slot, not the attribute map.
    expect(captured[0]!.query).toContain("primaryEntityType");
    expect(captured[0]!.query).not.toContain("attributes");
  });
});
