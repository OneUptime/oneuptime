import DatabaseServerDiscoverySource, {
  DATABASE_SERVER_DISCOVERY_SOURCES,
  getDatabaseServerDiscoverySourceLabel,
} from "../../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import { describe, expect, test } from "@jest/globals";

/*
 * The stored `discoverySource` values are persisted and filtered on, so the
 * wire values are pinned; the labels are what the list page shows.
 */

describe("DatabaseServerDiscoverySource", () => {
  test("wire values are stable strings", () => {
    expect(DatabaseServerDiscoverySource.Collector).toBe("collector");
    expect(DatabaseServerDiscoverySource.ClientSpans).toBe("client-spans");
    expect(DatabaseServerDiscoverySource.Kubernetes).toBe("kubernetes");
    expect(DatabaseServerDiscoverySource.Docker).toBe("docker");
    expect(DatabaseServerDiscoverySource.Podman).toBe("podman");
    expect(DatabaseServerDiscoverySource.Manual).toBe("manual");
  });

  test("the ordered list covers every value exactly once", () => {
    expect([...DATABASE_SERVER_DISCOVERY_SOURCES].sort()).toEqual(
      Object.values(DatabaseServerDiscoverySource).sort(),
    );
    expect(new Set(DATABASE_SERVER_DISCOVERY_SOURCES).size).toBe(
      DATABASE_SERVER_DISCOVERY_SOURCES.length,
    );
  });
});

describe("getDatabaseServerDiscoverySourceLabel", () => {
  test.each([
    [DatabaseServerDiscoverySource.Collector, "OpenTelemetry Collector"],
    [DatabaseServerDiscoverySource.ClientSpans, "Application traces"],
    [DatabaseServerDiscoverySource.Kubernetes, "Kubernetes"],
    [DatabaseServerDiscoverySource.Docker, "Docker"],
    [DatabaseServerDiscoverySource.Podman, "Podman"],
    [DatabaseServerDiscoverySource.Manual, "Added manually"],
  ])("%s reads as %s", (source: string, label: string) => {
    expect(getDatabaseServerDiscoverySourceLabel(source)).toBe(label);
  });

  test("tolerates casing and padding from the column", () => {
    expect(getDatabaseServerDiscoverySourceLabel("  Client-Spans ")).toBe(
      "Application traces",
    );
  });

  test("anything unknown reads Unknown, never the raw value", () => {
    expect(getDatabaseServerDiscoverySourceLabel(null)).toBe("Unknown");
    expect(getDatabaseServerDiscoverySourceLabel(undefined)).toBe("Unknown");
    expect(getDatabaseServerDiscoverySourceLabel("")).toBe("Unknown");
    expect(getDatabaseServerDiscoverySourceLabel("prometheus")).toBe("Unknown");
  });

  test("Object.prototype members are not labels", () => {
    expect(getDatabaseServerDiscoverySourceLabel("constructor")).toBe(
      "Unknown",
    );
    expect(getDatabaseServerDiscoverySourceLabel("toString")).toBe("Unknown");
    expect(getDatabaseServerDiscoverySourceLabel("__proto__")).toBe("Unknown");
  });
});
