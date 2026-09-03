import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
  MonitorTypeProps,
} from "../../../Types/Monitor/MonitorType";

describe("MonitorTypeHelper", () => {
  describe("getMonitorTypeCategories", () => {
    test("returns a non-empty list of categories with labels and types", () => {
      const categories: Array<MonitorTypeCategory> =
        MonitorTypeHelper.getMonitorTypeCategories();

      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);

      for (const category of categories) {
        expect(typeof category.label).toBe("string");
        expect(category.label.length).toBeGreaterThan(0);
        expect(Array.isArray(category.monitorTypes)).toBe(true);
        expect(category.monitorTypes.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getAllMonitorTypeProps", () => {
    test("returns props with a unique monitorType, title and description each", () => {
      const props: Array<MonitorTypeProps> =
        MonitorTypeHelper.getAllMonitorTypeProps();

      expect(props.length).toBeGreaterThan(0);

      const seen: Set<MonitorType> = new Set<MonitorType>();
      for (const prop of props) {
        expect(typeof prop.title).toBe("string");
        expect(prop.title.length).toBeGreaterThan(0);
        expect(typeof prop.description).toBe("string");
        expect(prop.description.length).toBeGreaterThan(0);
        expect(seen.has(prop.monitorType)).toBe(false);
        seen.add(prop.monitorType);
      }
    });
  });

  describe("isTelemetryMonitor", () => {
    test.each([
      MonitorType.Logs,
      MonitorType.Metrics,
      MonitorType.Traces,
      MonitorType.Exceptions,
      MonitorType.Profiles,
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Host,
      MonitorType.Podman,
      MonitorType.DockerSwarm,
      MonitorType.Proxmox,
      MonitorType.Ceph,
    ])("returns true for %s", (monitorType: MonitorType) => {
      expect(MonitorTypeHelper.isTelemetryMonitor(monitorType)).toBe(true);
    });

    test.each([MonitorType.Manual, MonitorType.Website, MonitorType.API])(
      "returns false for %s",
      (monitorType: MonitorType) => {
        expect(MonitorTypeHelper.isTelemetryMonitor(monitorType)).toBe(false);
      },
    );
  });

  describe("isManualMonitor", () => {
    test("returns true only for Manual", () => {
      expect(MonitorTypeHelper.isManualMonitor(MonitorType.Manual)).toBe(true);
      expect(MonitorTypeHelper.isManualMonitor(MonitorType.Website)).toBe(
        false,
      );
      expect(MonitorTypeHelper.isManualMonitor(MonitorType.API)).toBe(false);
    });
  });

  describe("getTitle", () => {
    test("returns the configured title", () => {
      expect(MonitorTypeHelper.getTitle(MonitorType.API)).toBe("API");
      expect(MonitorTypeHelper.getTitle(MonitorType.Docker)).toBe(
        "Docker Container",
      );
      expect(MonitorTypeHelper.getTitle(MonitorType.Server)).toBe(
        "Server / VM",
      );
    });

    test("throws BadDataException for a type without props", () => {
      expect(() => {
        MonitorTypeHelper.getTitle("NonExistent" as MonitorType);
      }).toThrowError(BadDataException);
    });
  });

  describe("getDescription", () => {
    test("returns a non-empty description for a known type", () => {
      expect(
        MonitorTypeHelper.getDescription(MonitorType.Ping).length,
      ).toBeGreaterThan(0);
    });

    test("throws BadDataException for a type without props", () => {
      expect(() => {
        MonitorTypeHelper.getDescription("NonExistent" as MonitorType);
      }).toThrowError(BadDataException);
    });
  });

  describe("isProbableMonitor", () => {
    test.each([
      MonitorType.API,
      MonitorType.Website,
      MonitorType.IP,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.SSLCertificate,
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
      MonitorType.DNS,
      MonitorType.DNSSEC,
      MonitorType.Domain,
      MonitorType.ExternalStatusPage,
      MonitorType.Database,
    ])("returns true for %s", (monitorType: MonitorType) => {
      expect(MonitorTypeHelper.isProbableMonitor(monitorType)).toBe(true);
    });

    test.each([
      MonitorType.Manual,
      MonitorType.Logs,
      MonitorType.Server,
      MonitorType.IncomingRequest,
      // Device-owned polling: the NetworkDevice resource polls itself.
      MonitorType.NetworkDevice,
    ])("returns false for %s", (monitorType: MonitorType) => {
      expect(MonitorTypeHelper.isProbableMonitor(monitorType)).toBe(false);
    });
  });

  describe("doesMonitorTypeHaveInterval", () => {
    test("mirrors isProbableMonitor", () => {
      const types: Array<MonitorType> = [
        MonitorType.API,
        MonitorType.Manual,
        MonitorType.Logs,
        MonitorType.DNS,
      ];

      for (const monitorType of types) {
        expect(MonitorTypeHelper.doesMonitorTypeHaveInterval(monitorType)).toBe(
          MonitorTypeHelper.isProbableMonitor(monitorType),
        );
      }
    });
  });

  describe("getActiveMonitorTypes", () => {
    test("includes Server and excludes Manual", () => {
      const active: Array<MonitorType> =
        MonitorTypeHelper.getActiveMonitorTypes();

      expect(active).toContain(MonitorType.Server);
      expect(active).not.toContain(MonitorType.Manual);
    });
  });

  describe("doesMonitorTypeHaveDocumentation", () => {
    test.each([
      MonitorType.IncomingRequest,
      MonitorType.IncomingEmail,
      MonitorType.Server,
    ])("returns true for %s", (monitorType: MonitorType) => {
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveDocumentation(monitorType),
      ).toBe(true);
    });

    test("returns false for other types", () => {
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveDocumentation(MonitorType.API),
      ).toBe(false);
    });
  });

  describe("doesMonitorTypeHaveCriteria", () => {
    test("returns false only for Manual", () => {
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveCriteria(MonitorType.Manual),
      ).toBe(false);
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveCriteria(MonitorType.API),
      ).toBe(true);
    });
  });

  /*
   * NetworkDevice is a pure alerting layer under device-owned polling: the
   * NetworkDevice resource's assigned probe walks it on the device's own
   * schedule, and the monitor is evaluated server-side against each walk.
   * It must therefore never appear probeable (no MonitorProbe rows, no
   * interval) while keeping its full monitor surface: criteria, graphs,
   * documentation, creatability, and its place in the Network category.
   */
  describe("NetworkDevice under device-owned polling", () => {
    test("is not probeable and has no interval", () => {
      expect(
        MonitorTypeHelper.isProbableMonitor(MonitorType.NetworkDevice),
      ).toBe(false);
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveInterval(
          MonitorType.NetworkDevice,
        ),
      ).toBe(false);
    });

    test("still has criteria, graphs, and documentation", () => {
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveCriteria(
          MonitorType.NetworkDevice,
        ),
      ).toBe(true);
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveGraphs(MonitorType.NetworkDevice),
      ).toBe(true);
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveDocumentation(
          MonitorType.NetworkDevice,
        ),
      ).toBe(true);
    });

    test("is still an active (creatable) monitor type", () => {
      expect(MonitorTypeHelper.getActiveMonitorTypes()).toContain(
        MonitorType.NetworkDevice,
      );
    });

    test("is still listed under the Network category", () => {
      const networkCategory: MonitorTypeCategory | undefined =
        MonitorTypeHelper.getMonitorTypeCategories().find(
          (category: MonitorTypeCategory) => {
            return category.label === "Network";
          },
        );

      expect(networkCategory).toBeDefined();
      expect(networkCategory?.monitorTypes).toContain(
        MonitorType.NetworkDevice,
      );
    });
  });

  /*
   * The dashboard tells Free plan users which monitors cost money before they
   * create one, and gates the create button on acknowledging it. That warning
   * is only honest while this predicate agrees with what the server actually
   * meters - ActiveMonitoringMeteredPlan counts every monitor whose type is
   * not Manual.
   */
  describe("isBilledAsActiveMonitor", () => {
    test("Manual monitors are free", () => {
      expect(
        MonitorTypeHelper.isBilledAsActiveMonitor(MonitorType.Manual),
      ).toBe(false);
    });

    test("every other monitor type is billed", () => {
      const billed: Array<MonitorType> = Object.values(MonitorType).filter(
        (monitorType: MonitorType) => {
          return monitorType !== MonitorType.Manual;
        },
      );

      expect(billed.length).toBeGreaterThan(0);

      for (const monitorType of billed) {
        expect(MonitorTypeHelper.isBilledAsActiveMonitor(monitorType)).toBe(
          true,
        );
      }
    });

    test("telemetry monitors are billed as active monitors too, on top of their ingest", () => {
      expect(MonitorTypeHelper.isBilledAsActiveMonitor(MonitorType.Logs)).toBe(
        true,
      );
      expect(
        MonitorTypeHelper.isBilledAsActiveMonitor(MonitorType.Metrics),
      ).toBe(true);
      expect(
        MonitorTypeHelper.isBilledAsActiveMonitor(MonitorType.Traces),
      ).toBe(true);
    });

    test("agrees exactly with getActiveMonitorTypes", () => {
      const active: Array<MonitorType> =
        MonitorTypeHelper.getActiveMonitorTypes();

      for (const monitorType of Object.values(MonitorType)) {
        expect(MonitorTypeHelper.isBilledAsActiveMonitor(monitorType)).toBe(
          active.includes(monitorType),
        );
      }
    });

    test("is the exact inverse of isManualMonitor", () => {
      for (const monitorType of Object.values(MonitorType)) {
        expect(MonitorTypeHelper.isBilledAsActiveMonitor(monitorType)).toBe(
          !MonitorTypeHelper.isManualMonitor(monitorType),
        );
      }
    });
  });

  describe("doesMonitorTypeHaveGraphs", () => {
    test("returns true for graphable types and false otherwise", () => {
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveGraphs(MonitorType.Website),
      ).toBe(true);
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveGraphs(MonitorType.Server),
      ).toBe(true);
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveGraphs(MonitorType.Manual),
      ).toBe(false);
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveGraphs(MonitorType.Logs),
      ).toBe(false);
    });
  });
});
