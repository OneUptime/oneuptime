import MetricCatalog from "../../FeatureSet/Telemetry/Utils/MetricCatalog";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

function addMetric(
  catalog: MetricCatalog,
  serviceId: ObjectID,
  data: {
    name?: string;
    description?: string;
    unit?: string;
    primaryEntityType?: ServiceType;
  } = {},
): void {
  catalog.addMetric({
    name: data.name ?? "requests.total",
    description: data.description,
    unit: data.unit,
    serviceMetadata: {
      primaryEntityId: serviceId,
      primaryEntityType: data.primaryEntityType ?? ServiceType.OpenTelemetry,
    },
  });
}

function serviceIds(catalog: MetricCatalog, name: string): Array<string> {
  return catalog.metricNameServiceNameMap[name]!.services!.map(
    (service: Service) => {
      return service.id!.toString();
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("request-scoped metric catalog", () => {
  test("retains the first description, unit and service encounter order", () => {
    const catalog: MetricCatalog = new MetricCatalog();
    const firstId: ObjectID = ObjectID.generate();
    const secondId: ObjectID = ObjectID.generate();

    addMetric(catalog, firstId, { description: "First", unit: "requests" });
    const firstMetric: MetricType =
      catalog.metricNameServiceNameMap["requests.total"]!;
    const firstServices: Array<Service> = firstMetric.services!;
    addMetric(catalog, secondId, { description: "Second", unit: "1" });
    addMetric(catalog, firstId, { description: "Third", unit: "bytes" });

    expect(catalog.metricNameServiceNameMap["requests.total"]).toBe(
      firstMetric,
    );
    expect(firstMetric.services).toBe(firstServices);
    expect(firstMetric).toBeInstanceOf(MetricType);
    expect(firstMetric.name).toBe("requests.total");
    expect(firstMetric.description).toBe("First");
    expect(firstMetric.unit).toBe("requests");
    expect(
      firstServices.every((service: Service) => {
        return service instanceof Service;
      }),
    ).toBe(true);
    expect(serviceIds(catalog, "requests.total")).toEqual([
      firstId.toString(),
      secondId.toString(),
    ]);
  });

  test("deduplicates distinct ObjectID instances with the same value", () => {
    const catalog: MetricCatalog = new MetricCatalog();
    const serviceId: ObjectID = ObjectID.generate();

    for (let index: number = 0; index < 100; index++) {
      addMetric(catalog, new ObjectID(serviceId.toString()));
    }

    expect(serviceIds(catalog, "requests.total")).toEqual([
      serviceId.toString(),
    ]);
  });

  test("tracks service membership independently for each metric", () => {
    const catalog: MetricCatalog = new MetricCatalog();
    const firstId: ObjectID = ObjectID.generate();
    const secondId: ObjectID = ObjectID.generate();

    addMetric(catalog, firstId, { name: "requests.total" });
    addMetric(catalog, secondId, { name: "requests.total" });
    addMetric(catalog, secondId, { name: "request.duration" });
    addMetric(catalog, firstId, { name: "request.duration" });
    addMetric(catalog, firstId, { name: "requests.total" });

    expect(Object.keys(catalog.metricNameServiceNameMap)).toEqual([
      "requests.total",
      "request.duration",
    ]);
    expect(serviceIds(catalog, "requests.total")).toEqual([
      firstId.toString(),
      secondId.toString(),
    ]);
    expect(serviceIds(catalog, "request.duration")).toEqual([
      secondId.toString(),
      firstId.toString(),
    ]);
  });

  test.each(
    Object.values(ServiceType).filter((type: ServiceType) => {
      return type !== ServiceType.OpenTelemetry;
    }),
  )(
    "catalogs %s metrics without adding a Service foreign key",
    (type: ServiceType) => {
      const catalog: MetricCatalog = new MetricCatalog();
      const entityId: ObjectID = ObjectID.generate();
      const stringify: jest.SpyInstance = jest.spyOn(entityId, "toString");

      addMetric(catalog, entityId, {
        primaryEntityType: type,
        description: "Infrastructure metric",
        unit: "1",
      });

      expect(stringify).not.toHaveBeenCalled();
      expect(serviceIds(catalog, "requests.total")).toEqual([]);
      expect(
        catalog.metricNameServiceNameMap["requests.total"]!.description,
      ).toBe("Infrastructure metric");
    },
  );

  test("can add a real service after an infrastructure-only observation", () => {
    const catalog: MetricCatalog = new MetricCatalog();
    const sharedId: ObjectID = ObjectID.generate();

    addMetric(catalog, sharedId, {
      primaryEntityType: ServiceType.Host,
      description: "Host metric",
    });
    addMetric(catalog, sharedId, { description: "Service metric" });
    addMetric(catalog, ObjectID.generate(), {
      primaryEntityType: ServiceType.KubernetesCluster,
    });

    expect(serviceIds(catalog, "requests.total")).toEqual([
      sharedId.toString(),
    ]);
    expect(
      catalog.metricNameServiceNameMap["requests.total"]!.description,
    ).toBe("Host metric");
  });

  test("keeps originally absent metadata and ignores unnamed metrics", () => {
    const catalog: MetricCatalog = new MetricCatalog();
    const serviceId: ObjectID = ObjectID.generate();

    addMetric(catalog, serviceId, { name: "" });
    expect(catalog.metricNameServiceNameMap).toEqual({});
    addMetric(catalog, serviceId);
    addMetric(catalog, serviceId, { description: "Later", unit: "1" });

    expect(
      catalog.metricNameServiceNameMap["requests.total"]!.description,
    ).toBeUndefined();
    expect(
      catalog.metricNameServiceNameMap["requests.total"]!.unit,
    ).toBeUndefined();
  });

  test("does not share membership or mutable model objects across requests", () => {
    const first: MetricCatalog = new MetricCatalog();
    const second: MetricCatalog = new MetricCatalog();
    const serviceId: ObjectID = ObjectID.generate();

    addMetric(first, serviceId, { description: "First request" });
    addMetric(second, serviceId, { description: "Second request" });

    expect(serviceIds(first, "requests.total")).toEqual([serviceId.toString()]);
    expect(serviceIds(second, "requests.total")).toEqual([
      serviceId.toString(),
    ]);
    expect(first.metricNameServiceNameMap["requests.total"]).not.toBe(
      second.metricNameServiceNameMap["requests.total"],
    );
    expect(
      first.metricNameServiceNameMap["requests.total"]!.services![0],
    ).not.toBe(second.metricNameServiceNameMap["requests.total"]!.services![0]);
    expect(second.metricNameServiceNameMap["requests.total"]!.description).toBe(
      "Second request",
    );
  });

  test("catalogs 4,000 services repeatedly without reading existing Service IDs", () => {
    const catalog: MetricCatalog = new MetricCatalog();
    const ids: Array<ObjectID> = Array.from({ length: 4_000 }, () => {
      return ObjectID.generate();
    });

    for (const id of ids) {
      addMetric(catalog, id);
    }

    /*
     * Accessing existing links during another insertion would reintroduce
     * the growing-array scan. Throwing getters enforce this without a
     * machine-speed-dependent timeout or a benchmark threshold in CI.
     */
    for (const service of catalog.metricNameServiceNameMap["requests.total"]!
      .services!) {
      Object.defineProperty(service, "id", {
        get: () => {
          throw new Error("A previous Service link was scanned");
        },
      });
    }

    for (let round: number = 0; round < 3; round++) {
      for (const id of ids) {
        addMetric(catalog, new ObjectID(id.toString()));
      }
    }
    addMetric(catalog, ObjectID.generate());

    expect(
      catalog.metricNameServiceNameMap["requests.total"]!.services,
    ).toHaveLength(4_001);
  });

  test("performs a linear number of ObjectID conversions for a large export", () => {
    const count: number = 2_000;
    const ids: Array<ObjectID> = Array.from({ length: count }, () => {
      return ObjectID.generate();
    });
    const stringify: jest.SpyInstance = jest.spyOn(
      ObjectID.prototype,
      "toString",
    );
    const catalog: MetricCatalog = new MetricCatalog();

    for (let round: number = 0; round < 3; round++) {
      for (const id of ids) {
        addMetric(catalog, id);
      }
    }

    /*
     * One membership-key conversion per observation plus one conversion
     * in Service.id's setter per unique link. The old filter path also
     * converted both IDs on every comparison, growing quadratically.
     */
    expect(stringify).toHaveBeenCalledTimes(count * 4);
    expect(
      catalog.metricNameServiceNameMap["requests.total"]!.services,
    ).toHaveLength(count);
  });
});
