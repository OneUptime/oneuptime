import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  ServiceMapEntry,
  ServiceMapModel,
  ServiceMapVisibility,
  SERVICE_TRAFFIC_LABELS,
  buildServiceMapModel,
  resolveServiceMapVisibility,
  serviceIsolatedPosition,
} from "../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";
import { ServiceOperationalStatus } from "../../FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay";

function service(key: string, name: string = key): InventoryItem {
  return {
    entityKey: key,
    displayName: name,
    entityType: EntityType.Service,
  } as InventoryItem;
}

function dependency(
  from: string,
  to: string,
  calls?: number,
  errors?: number,
): InventoryItemRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    callCount: calls,
    errorCount: errors,
    relationshipType: EntityRelationshipType.DependsOn,
  } as InventoryItemRelationship;
}

function status(incidents: number, alerts: number): ServiceOperationalStatus {
  return {
    serviceId: "service-id",
    activeIncidentCount: incidents,
    worstIncidentSeverityColor: "#ff0000",
    worstIncidentSeverityName: null,
    incidents: [],
    activeAlertCount: alerts,
    worstAlertSeverityColor: "#ffaa00",
    worstAlertSeverityName: null,
    alerts: [],
  };
}

function visible(
  model: ServiceMapModel,
  options: {
    search?: string;
    focusKey?: string | null;
    attentionOnly?: boolean;
  } = {},
): ServiceMapVisibility {
  return resolveServiceMapVisibility({
    model,
    search: options.search || "",
    focusKey: options.focusKey || null,
    attentionOnly: options.attentionOnly || false,
  });
}

describe("service directory model", () => {
  test("keeps only keyed services and deduplicates inventory rows", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [
        service("api"),
        service("api"),
        service("worker"),
        service(""),
        { entityKey: "host", entityType: EntityType.Host } as InventoryItem,
      ],
      [],
    );
    expect(
      model.entries.map((entry: ServiceMapEntry) => {
        return entry.key;
      }),
    ).toEqual(["api", "worker"]);
  });

  test("does not invent services for stale or infrastructure links", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [service("api"), service("db")],
      [
        dependency("api", "db", 100),
        dependency("ghost", "api", 100),
        dependency("api", "ghost", 100),
        {
          ...dependency("api", "db", 100),
          relationshipType: EntityRelationshipType.RunsOn,
        } as InventoryItemRelationship,
      ],
    );
    expect(model.relationships).toHaveLength(1);
    expect(model.entryByKey.get("db")?.calls).toBe(100);
  });

  test("aggregates incoming traffic weighted by calls, not mean error percentages", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [service("web"), service("api"), service("worker")],
      [dependency("web", "api", 900, 0), dependency("worker", "api", 100, 10)],
    );
    expect(model.entryByKey.get("api")).toMatchObject({
      calls: 1000,
      errors: 10,
      health: "degraded",
      callers: 2,
      dependencies: 0,
    });
    expect(model.entryByKey.get("web")).toMatchObject({
      calls: 0,
      health: "unknown",
      callers: 0,
      dependencies: 1,
    });
  });

  test("missing metrics remain unknown and do not become a healthy verdict", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [service("api"), service("db")],
      [dependency("api", "db")],
    );
    expect(model.entryByKey.get("db")).toMatchObject({
      calls: 0,
      errors: 0,
      health: "unknown",
      needsAttention: false,
    });
    expect(SERVICE_TRAFFIC_LABELS.unknown).toBe("No incoming calls");
  });

  test("zero and negative call counts do not contribute error-only health", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [service("api"), service("db")],
      [dependency("api", "db", 0, 2), dependency("api", "db", -1, 5)],
    );
    expect(model.entryByKey.get("db")).toMatchObject({
      calls: 0,
      errors: 0,
      health: "unknown",
    });
  });

  test.each([
    [100, 0, "healthy", false],
    [100, 1, "degraded", true],
    [100, 5, "critical", true],
  ])(
    "%s calls and %s errors classify as %s",
    (
      calls: number | string | boolean,
      errors: number | string | boolean,
      health: number | string | boolean,
      needsAttention: number | string | boolean,
    ) => {
      const model: ServiceMapModel = buildServiceMapModel(
        [service("api"), service("db")],
        [dependency("api", "db", calls as number, errors as number)],
      );
      expect(model.entryByKey.get("db")).toMatchObject({
        health,
        needsAttention,
      });
    },
  );

  test("incidents and alerts mark attention even without incoming calls", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [service("api", "API"), service("worker")],
      [],
      new Map<string, ServiceOperationalStatus>([
        ["api", status(2, 0)],
        ["worker", status(0, 3)],
      ]),
    );
    expect(model.entryByKey.get("api")).toMatchObject({
      needsAttention: true,
      incidentCount: 2,
      incidentColor: "#ff0000",
      health: "unknown",
    });
    expect(model.entryByKey.get("worker")).toMatchObject({
      needsAttention: true,
      alertCount: 3,
    });
  });

  test("sorts attention first, then service name, independently of input order", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [service("worker"), service("db"), service("api")],
      [dependency("api", "worker", 100, 10)],
    );
    expect(
      model.entries.map((entry: ServiceMapEntry) => {
        return entry.key;
      }),
    ).toEqual(["worker", "api", "db"]);
  });

  test("active incidents and critical errors come before lower-priority services regardless of their names", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [
        service("api"),
        service("payments"),
        service("incident"),
        service("alert"),
        service("web"),
      ],
      [dependency("web", "api", 100, 1), dependency("web", "payments", 100, 8)],
      new Map<string, ServiceOperationalStatus>([
        ["incident", status(1, 0)],
        ["alert", status(0, 1)],
      ]),
    );
    expect(
      model.entries.map((entry: ServiceMapEntry) => {
        return entry.key;
      }),
    ).toEqual(["incident", "payments", "alert", "api", "web"]);
  });

  test("services with the same attention priority retain a stable alphabetical order", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [service("z-critical"), service("a-critical"), service("web")],
      [
        dependency("web", "z-critical", 100, 10),
        dependency("web", "a-critical", 100, 5),
      ],
    );
    expect(
      model.entries.map((entry: ServiceMapEntry) => {
        return entry.key;
      }),
    ).toEqual(["a-critical", "z-critical", "web"]);
  });

  test("unnamed services have a readable fallback", () => {
    expect(
      buildServiceMapModel([service("api", "")], []).entries[0]?.label,
    ).toBe("Unnamed service");
  });

  test("empty inventories produce a complete empty model", () => {
    expect(buildServiceMapModel([], [])).toEqual({
      entries: [],
      entryByKey: new Map(),
      relationships: [],
    });
  });
});

describe("service directory and map filtering", () => {
  const model: ServiceMapModel = buildServiceMapModel(
    [
      service("web", "Web frontend"),
      service("api", "Checkout API"),
      service("db", "Orders database"),
      service("archive", "Archive"),
      service("isolated", "Isolated worker"),
    ],
    [
      dependency("web", "api", 100, 6),
      dependency("api", "db", 100, 0),
      dependency("db", "archive", 100, 0),
    ],
  );

  test("an unfiltered directory includes disconnected services", () => {
    const result: ServiceMapVisibility = visible(model);
    expect(result.matchedKeys.size).toBe(5);
    expect(result.visibleKeys.has("isolated")).toBe(true);
    expect(result.contextKeys.size).toBe(0);
  });

  test("search matches trimmed names without case sensitivity", () => {
    const result: ServiceMapVisibility = visible(model, {
      search: "  CHECKOUT ",
    });
    expect(Array.from(result.matchedKeys)).toEqual(["api"]);
    expect(result.contextKeys).toEqual(new Set(["web", "db"]));
    expect(result.visibleKeys.has("archive")).toBe(false);
    expect(result.visibleKeys.has("isolated")).toBe(false);
  });

  test("search can find a service by entity key", () => {
    expect(visible(model, { search: "db" }).matchedKeys).toEqual(
      new Set(["db"]),
    );
  });

  test("a focus shows direct callers and dependencies instead of the entire component", () => {
    const result: ServiceMapVisibility = visible(model, { focusKey: "api" });
    expect(result.matchedKeys).toEqual(new Set(["api", "web", "db"]));
    expect(result.visibleKeys.has("archive")).toBe(false);
  });

  test("a stale focus key does not blank the service directory", () => {
    const result: ServiceMapVisibility = visible(model, {
      focusKey: "old-service",
    });
    expect(result.effectiveFocusKey).toBeNull();
    expect(result.matchedKeys.size).toBe(5);
  });

  test("an isolated service stays visible when focused", () => {
    expect(visible(model, { focusKey: "isolated" }).visibleKeys).toEqual(
      new Set(["isolated"]),
    );
  });

  test("attention filters directory rows, retaining immediate map context", () => {
    const result: ServiceMapVisibility = visible(model, {
      attentionOnly: true,
    });
    expect(result.matchedKeys).toEqual(new Set(["api"]));
    expect(result.visibleKeys).toEqual(new Set(["api", "web", "db"]));
  });

  test("search and attention combine, and a miss has no ghost context", () => {
    const result: ServiceMapVisibility = visible(model, {
      attentionOnly: true,
      search: "database",
    });
    expect(result.matchedKeys.size).toBe(0);
    expect(result.visibleKeys.size).toBe(0);
  });

  test("search context never escapes the focused neighborhood", () => {
    const result: ServiceMapVisibility = visible(model, {
      focusKey: "api",
      search: "database",
    });
    expect(result.matchedKeys).toEqual(new Set(["db"]));
    expect(result.visibleKeys).toEqual(new Set(["api", "db"]));
  });

  test("filtering does not recompute incoming health from only visible connections", () => {
    const entry: ServiceMapEntry | undefined = model.entryByKey.get("api");
    visible(model, { focusKey: "db", search: "Checkout" });
    expect(entry).toMatchObject({ calls: 100, errors: 6, health: "critical" });
  });

  test("cycles and self links do not recurse or duplicate matches", () => {
    const cyclic: ServiceMapModel = buildServiceMapModel(
      [service("a"), service("b")],
      [dependency("a", "b"), dependency("b", "a"), dependency("a", "a")],
    );
    expect(visible(cyclic, { focusKey: "a", search: "a" }).visibleKeys).toEqual(
      new Set(["a", "b"]),
    );
  });
});

describe("isolated services stay readable on the map", () => {
  test("the first isolated service starts at the requested row", () => {
    expect(
      serviceIsolatedPosition({
        index: 0,
        count: 1,
        xGap: 260,
        yGap: 180,
        startY: 400,
      }),
    ).toEqual({ x: 0, y: 400 });
  });

  test("large inventories wrap after four columns", () => {
    expect(
      serviceIsolatedPosition({
        index: 4,
        count: 100,
        xGap: 260,
        yGap: 180,
        startY: 0,
      }),
    ).toEqual({ x: 0, y: 180 });
    expect(
      serviceIsolatedPosition({
        index: 99,
        count: 100,
        xGap: 260,
        yGap: 180,
        startY: 0,
      }).x,
    ).toBeLessThanOrEqual(780);
  });

  test("small inventories use a compact square grid", () => {
    expect(
      serviceIsolatedPosition({
        index: 2,
        count: 3,
        xGap: 260,
        yGap: 180,
        startY: 0,
      }),
    ).toEqual({ x: 0, y: 180 });
  });

  test("grid positions never overlap", () => {
    const positions: Set<string> = new Set<string>();
    for (let index: number = 0; index < 100; index++) {
      positions.add(
        JSON.stringify(
          serviceIsolatedPosition({
            index,
            count: 100,
            xGap: 260,
            yGap: 180,
            startY: 0,
          }),
        ),
      );
    }
    expect(positions.size).toBe(100);
  });
});
