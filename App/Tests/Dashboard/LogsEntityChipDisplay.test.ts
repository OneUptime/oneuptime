/*
 * The logs viewer's chips that name a telemetry entity by id.
 *
 * Reported as: "In real user monitoring, when I click on metrics / logs, why
 * does it show service id as locked filters?" A RUM application's logs tab
 * passes its RumApplication id as `serviceIds`, and the viewer labelled that
 * chip "Service" and looked the id up in the Service table only — so it read
 * "Service: 84858d6c-…". These helpers decide what such a chip shows; the
 * tests pin that the id never leaks while the filter stays the id.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ActiveFilter,
  FacetValue,
} from "Common/UI/Components/LogsViewer/types";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import {
  LOGS_ENTITY_FACET_KEYS,
  LogsEntityChipDisplay,
  applyLogsEntityChipDisplay,
  buildFacetDisplayNames,
  buildLogsEntityTypeHints,
  buildLogsScopeEntityChips,
  collectLogsEntityIds,
  describeLogsEntityChip,
  isLogsEntityFacetKey,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsEntityChipDisplay";

const RUM_APP_ID: string = "84858d6c-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const UNRESOLVED_ID: string = "44444444-4444-4444-8444-444444444444";

const NAME_MAP: TelemetryEntityNameMap = {
  [RUM_APP_ID]: {
    id: RUM_APP_ID,
    name: "checkout-web",
    entityType: ServiceType.RealUserMonitor,
    typeLabel: "RUM Application",
  },
  [SERVICE_ID]: {
    id: SERVICE_ID,
    name: "payments-api",
    entityType: ServiceType.OpenTelemetry,
    typeLabel: "Service",
  },
  [HOST_ID]: {
    id: HOST_ID,
    name: "web-01",
    entityType: ServiceType.Host,
    typeLabel: "Host",
  },
};

type UserChipFunction = (facetKey: string, value: string) => ActiveFilter;

const userChip: UserChipFunction = (
  facetKey: string,
  value: string,
): ActiveFilter => {
  return {
    facetKey,
    value,
    displayKey: facetKey === "primaryEntityId" ? "Service" : facetKey,
    displayValue: value,
  };
};

describe("isLogsEntityFacetKey", () => {
  test("primaryEntityId and the legacy serviceId alias are entity chips", () => {
    expect(LOGS_ENTITY_FACET_KEYS).toEqual(["primaryEntityId", "serviceId"]);
    expect(isLogsEntityFacetKey("primaryEntityId")).toBe(true);
    expect(isLogsEntityFacetKey("serviceId")).toBe(true);
  });

  test.each(["severityText", "traceId", "spanId", "body", "hostId", ""])(
    "%p is not an entity chip",
    (facetKey: string) => {
      expect(isLogsEntityFacetKey(facetKey)).toBe(false);
    },
  );
});

describe("collectLogsEntityIds", () => {
  test("nothing to collect", () => {
    expect(collectLogsEntityIds({})).toEqual([]);
    expect(
      collectLogsEntityIds({ scopeIds: [], appliedFacetFilters: new Map() }),
    ).toEqual([]);
  });

  test("scope ids (ObjectID or string) and entity chip values, de-duplicated", () => {
    const applied: Map<string, Set<string>> = new Map<string, Set<string>>([
      ["primaryEntityId", new Set([SERVICE_ID, RUM_APP_ID])],
      ["serviceId", new Set([HOST_ID])],
      ["severityText", new Set(["Error"])],
      ["traceId", new Set(["abc"])],
    ]);

    expect(
      collectLogsEntityIds({
        scopeIds: [new ObjectID(RUM_APP_ID), ` ${SERVICE_ID} `],
        appliedFacetFilters: applied,
      }),
    ).toEqual([RUM_APP_ID, SERVICE_ID, HOST_ID].sort());
  });

  test("non-entity chip values are never sent to the resolver", () => {
    const ids: Array<string> = collectLogsEntityIds({
      appliedFacetFilters: new Map<string, Set<string>>([
        ["severityText", new Set(["Error"])],
        ["attributes.resource.host.name", new Set(["web-01"])],
      ]),
    });

    expect(ids).toEqual([]);
  });

  test("a typed service name that matched no Service is not sent to the resolver", () => {
    /*
     * `service:checkout` with no matching Service stays a name in the chip;
     * asking every entity table for a non-UUID `_id` would only fail.
     */
    expect(
      collectLogsEntityIds({
        appliedFacetFilters: new Map<string, Set<string>>([
          ["primaryEntityId", new Set(["checkout", HOST_ID])],
          ["serviceId", new Set(["not-a-uuid"])],
        ]),
      }),
    ).toEqual([HOST_ID]);
  });

  test("the facet keys match the query side's Service facet keys", () => {
    for (const facetKey of LOGS_ENTITY_FACET_KEYS) {
      expect(isLogsEntityFacetKey(facetKey)).toBe(true);
    }
    expect(isLogsEntityFacetKey("hostId")).toBe(false);
  });

  test("blank values are dropped", () => {
    expect(
      collectLogsEntityIds({
        scopeIds: ["", "  "],
        appliedFacetFilters: new Map([["primaryEntityId", new Set([""])]]),
      }),
    ).toEqual([]);
  });

  test("the result is order-independent so the hook does not refetch", () => {
    const first: Array<string> = collectLogsEntityIds({
      scopeIds: [HOST_ID, RUM_APP_ID],
    });
    const second: Array<string> = collectLogsEntityIds({
      scopeIds: [RUM_APP_ID, HOST_ID],
    });

    expect(first).toEqual(second);
  });
});

describe("buildLogsEntityTypeHints", () => {
  test("no type or no ids means no hints", () => {
    expect(buildLogsEntityTypeHints([RUM_APP_ID], undefined)).toBeUndefined();
    expect(
      buildLogsEntityTypeHints(undefined, ServiceType.RealUserMonitor),
    ).toBeUndefined();
    expect(
      buildLogsEntityTypeHints([], ServiceType.RealUserMonitor),
    ).toBeUndefined();
    expect(
      buildLogsEntityTypeHints([""], ServiceType.RealUserMonitor),
    ).toBeUndefined();
  });

  test("every scope id is hinted to the page's entity type", () => {
    expect(
      buildLogsEntityTypeHints(
        [new ObjectID(RUM_APP_ID), SERVICE_ID],
        ServiceType.RealUserMonitor,
      ),
    ).toEqual({
      [RUM_APP_ID]: ServiceType.RealUserMonitor,
      [SERVICE_ID]: ServiceType.RealUserMonitor,
    });
  });
});

describe("buildFacetDisplayNames", () => {
  test("keeps real names and drops echoes of the id", () => {
    const facetValues: Array<FacetValue> = [
      { value: SERVICE_ID, count: 3, displayName: "payments-api" },
      { value: RUM_APP_ID, count: 2, displayName: RUM_APP_ID },
      { value: HOST_ID, count: 1 },
      { value: UNRESOLVED_ID, count: 1, displayName: "   " },
    ];

    expect(buildFacetDisplayNames(facetValues)).toEqual({
      [SERVICE_ID]: "payments-api",
    });
  });

  test("no facet response", () => {
    expect(buildFacetDisplayNames(undefined)).toEqual({});
    expect(buildFacetDisplayNames([])).toEqual({});
  });
});

describe("describeLogsEntityChip", () => {
  test("the regression: a RUM application id reads as its name, not 'Service: <uuid>'", () => {
    const display: LogsEntityChipDisplay = describeLogsEntityChip({
      id: RUM_APP_ID,
      nameMap: NAME_MAP,
      entityType: ServiceType.RealUserMonitor,
    });

    expect(display).toEqual({
      displayKey: "RUM Application",
      displayValue: "checkout-web",
    });
    expect(display.displayValue).not.toContain(RUM_APP_ID);
    expect(display.displayKey).not.toBe("Service");
  });

  test("with a known page type the key is right before the name resolves", () => {
    expect(
      describeLogsEntityChip({
        id: RUM_APP_ID,
        nameMap: {},
        entityType: ServiceType.RealUserMonitor,
      }),
    ).toEqual({ displayKey: "RUM Application", displayValue: RUM_APP_ID });
  });

  test.each([
    [ServiceType.Host, "Host"],
    [ServiceType.DockerHost, "Docker Host"],
    [ServiceType.PodmanHost, "Podman Host"],
    [ServiceType.KubernetesCluster, "Kubernetes Cluster"],
    [ServiceType.ServerlessFunction, "Serverless Function"],
    [ServiceType.CloudResource, "Cloud Resource"],
    [ServiceType.NetworkDevice, "Network Device"],
    [ServiceType.IoTDevice, "IoT Fleet"],
    [ServiceType.VMwareVCenter, "vCenter"],
    [ServiceType.OpenTelemetry, "Service"],
  ])("a %p scope reads %p", (entityType: ServiceType, label: string) => {
    expect(
      describeLogsEntityChip({ id: UNRESOLVED_ID, nameMap: {}, entityType })
        .displayKey,
    ).toBe(label);
  });

  test("without a page type the key is the resolved type", () => {
    expect(describeLogsEntityChip({ id: HOST_ID, nameMap: NAME_MAP })).toEqual({
      displayKey: "Host",
      displayValue: "web-01",
    });
  });

  test("a Service page keeps the 'Service' key", () => {
    expect(
      describeLogsEntityChip({ id: SERVICE_ID, nameMap: NAME_MAP }),
    ).toEqual({ displayKey: "Service", displayValue: "payments-api" });
  });

  test("unresolved and untyped falls back to 'Service' and the id", () => {
    expect(
      describeLogsEntityChip({ id: UNRESOLVED_ID, nameMap: undefined }),
    ).toEqual({ displayKey: "Service", displayValue: UNRESOLVED_ID });
  });

  test("a name the viewer already had wins over the resolver", () => {
    expect(
      describeLogsEntityChip({
        id: SERVICE_ID,
        nameMap: NAME_MAP,
        knownName: "payments-api (facet)",
      }).displayValue,
    ).toBe("payments-api (facet)");
  });

  test("a blank known name does not shadow the resolver", () => {
    expect(
      describeLogsEntityChip({
        id: SERVICE_ID,
        nameMap: NAME_MAP,
        knownName: "  ",
      }).displayValue,
    ).toBe("payments-api");
  });

  test("a known name still names an entity nobody resolved", () => {
    expect(
      describeLogsEntityChip({
        id: UNRESOLVED_ID,
        nameMap: {},
        knownName: "legacy-service",
      }),
    ).toEqual({ displayKey: "Service", displayValue: "legacy-service" });
  });
});

describe("buildLogsScopeEntityChips", () => {
  test("no scope, no chips", () => {
    expect(
      buildLogsScopeEntityChips({ scopeIds: undefined, nameMap: NAME_MAP }),
    ).toEqual([]);
    expect(buildLogsScopeEntityChips({ scopeIds: [], nameMap: {} })).toEqual(
      [],
    );
  });

  test("a RUM application page's locked chip names the application", () => {
    expect(
      buildLogsScopeEntityChips({
        scopeIds: [new ObjectID(RUM_APP_ID)],
        nameMap: NAME_MAP,
        scopeEntityType: ServiceType.RealUserMonitor,
      }),
    ).toEqual([
      {
        facetKey: "primaryEntityId",
        value: RUM_APP_ID,
        displayKey: "RUM Application",
        displayValue: "checkout-web",
        readOnly: true,
      },
    ]);
  });

  test("filtering is untouched: the chip value stays the id", () => {
    const [chip] = buildLogsScopeEntityChips({
      scopeIds: [new ObjectID(HOST_ID)],
      nameMap: NAME_MAP,
      scopeEntityType: ServiceType.Host,
    });

    expect(chip!.facetKey).toBe("primaryEntityId");
    expect(chip!.value).toBe(HOST_ID);
    expect(chip!.displayValue).toBe("web-01");
  });

  test("a Service page without scopeEntityType is unchanged: 'Service: <name>'", () => {
    expect(
      buildLogsScopeEntityChips({
        scopeIds: [new ObjectID(SERVICE_ID)],
        nameMap: NAME_MAP,
      }),
    ).toEqual([
      {
        facetKey: "primaryEntityId",
        value: SERVICE_ID,
        displayKey: "Service",
        displayValue: "payments-api",
        readOnly: true,
      },
    ]);
  });

  test("before the lookup lands: typed key, id value; untyped: 'Service'", () => {
    expect(
      buildLogsScopeEntityChips({
        scopeIds: [RUM_APP_ID],
        nameMap: {},
        scopeEntityType: ServiceType.RealUserMonitor,
      })[0],
    ).toMatchObject({
      displayKey: "RUM Application",
      displayValue: RUM_APP_ID,
    });

    expect(
      buildLogsScopeEntityChips({ scopeIds: [RUM_APP_ID], nameMap: {} })[0],
    ).toMatchObject({ displayKey: "Service", displayValue: RUM_APP_ID });
  });

  test("without a page type, a resolved RUM application still reads as one", () => {
    expect(
      buildLogsScopeEntityChips({
        scopeIds: [RUM_APP_ID],
        nameMap: NAME_MAP,
      })[0],
    ).toMatchObject({
      displayKey: "RUM Application",
      displayValue: "checkout-web",
    });
  });

  test("one chip per scope id, blanks skipped, all read-only", () => {
    const chips: Array<ActiveFilter> = buildLogsScopeEntityChips({
      scopeIds: [SERVICE_ID, "", HOST_ID],
      nameMap: NAME_MAP,
    });

    expect(
      chips.map((chip: ActiveFilter): string => {
        return `${chip.displayKey}: ${chip.displayValue}`;
      }),
    ).toEqual(["Service: payments-api", "Host: web-01"]);

    for (const chip of chips) {
      expect(chip.readOnly).toBe(true);
    }
  });
});

describe("applyLogsEntityChipDisplay", () => {
  test("user / URL / saved-view entity chips get the entity's name and type", () => {
    const filters: Array<ActiveFilter> = [
      userChip("primaryEntityId", RUM_APP_ID),
      userChip("primaryEntityId", HOST_ID),
      userChip("serviceId", SERVICE_ID),
    ];

    const result: Array<ActiveFilter> = applyLogsEntityChipDisplay(filters, {
      nameMap: NAME_MAP,
    });

    expect(
      result.map((chip: ActiveFilter): string => {
        return `${chip.displayKey}: ${chip.displayValue}`;
      }),
    ).toEqual([
      "RUM Application: checkout-web",
      "Host: web-01",
      "Service: payments-api",
    ]);
  });

  test("only display fields change — facetKey, value, openRoute and readOnly survive", () => {
    const filter: ActiveFilter = {
      ...userChip("primaryEntityId", RUM_APP_ID),
      readOnly: false,
    };

    const [result] = applyLogsEntityChipDisplay([filter], {
      nameMap: NAME_MAP,
    });

    expect(result).toEqual({
      facetKey: "primaryEntityId",
      value: RUM_APP_ID,
      displayKey: "RUM Application",
      displayValue: "checkout-web",
      readOnly: false,
    });
  });

  test("non-entity chips pass through as the same object", () => {
    const severity: ActiveFilter = userChip("severityText", "Error");
    const trace: ActiveFilter = userChip("traceId", RUM_APP_ID);
    const attribute: ActiveFilter = userChip(
      "attributes.resource.host.name",
      HOST_ID,
    );

    const result: Array<ActiveFilter> = applyLogsEntityChipDisplay(
      [severity, trace, attribute],
      { nameMap: NAME_MAP },
    );

    expect(result[0]).toBe(severity);
    expect(result[1]).toBe(trace);
    expect(result[2]).toBe(attribute);
  });

  test("a chip for the page's own scope id takes the page's type before resolution", () => {
    const [result] = applyLogsEntityChipDisplay(
      [userChip("primaryEntityId", RUM_APP_ID)],
      {
        nameMap: {},
        scopeIds: [new ObjectID(RUM_APP_ID)],
        scopeEntityType: ServiceType.RealUserMonitor,
      },
    );

    expect(result).toMatchObject({
      displayKey: "RUM Application",
      displayValue: RUM_APP_ID,
    });
  });

  test("a chip for a different id is not given the page's type", () => {
    const [result] = applyLogsEntityChipDisplay(
      [userChip("primaryEntityId", HOST_ID)],
      {
        nameMap: NAME_MAP,
        scopeIds: [RUM_APP_ID],
        scopeEntityType: ServiceType.RealUserMonitor,
      },
    );

    expect(result).toMatchObject({
      displayKey: "Host",
      displayValue: "web-01",
    });
  });

  test("server facet names keep precedence over the resolver", () => {
    const [result] = applyLogsEntityChipDisplay(
      [userChip("primaryEntityId", SERVICE_ID)],
      {
        nameMap: NAME_MAP,
        knownNames: { [SERVICE_ID]: "payments-api (server)" },
      },
    );

    expect(result!.displayValue).toBe("payments-api (server)");
  });

  test("an unresolved entity chip keeps the id and the 'Service' key", () => {
    const [result] = applyLogsEntityChipDisplay(
      [userChip("serviceId", UNRESOLVED_ID)],
      { nameMap: NAME_MAP },
    );

    expect(result).toMatchObject({
      facetKey: "serviceId",
      value: UNRESOLVED_ID,
      displayKey: "Service",
      displayValue: UNRESOLVED_ID,
    });
  });

  test("a typed name chip that matched nothing keeps its text under the 'Service' key", () => {
    const [result] = applyLogsEntityChipDisplay(
      [userChip("primaryEntityId", "checkout")],
      { nameMap: NAME_MAP },
    );

    expect(result).toMatchObject({
      facetKey: "primaryEntityId",
      value: "checkout",
      displayKey: "Service",
      displayValue: "checkout",
    });
  });

  test("the RUM regression end to end: collect, hint, build, relabel", () => {
    const scopeIds: Array<ObjectID> = [new ObjectID(RUM_APP_ID)];
    const applied: Map<string, Set<string>> = new Map<string, Set<string>>([
      ["primaryEntityId", new Set([HOST_ID])],
    ]);

    expect(
      collectLogsEntityIds({ scopeIds, appliedFacetFilters: applied }),
    ).toEqual([RUM_APP_ID, HOST_ID].sort());
    expect(
      buildLogsEntityTypeHints(scopeIds, ServiceType.RealUserMonitor),
    ).toEqual({ [RUM_APP_ID]: ServiceType.RealUserMonitor });

    const chips: Array<ActiveFilter> = [
      ...buildLogsScopeEntityChips({
        scopeIds,
        nameMap: NAME_MAP,
        scopeEntityType: ServiceType.RealUserMonitor,
      }),
      ...applyLogsEntityChipDisplay([userChip("primaryEntityId", HOST_ID)], {
        nameMap: NAME_MAP,
        scopeIds,
        scopeEntityType: ServiceType.RealUserMonitor,
      }),
    ];

    const text: string = chips
      .map((chip: ActiveFilter): string => {
        return `${chip.displayKey}: ${chip.displayValue}`;
      })
      .join(" | ");

    expect(text).toBe("RUM Application: checkout-web | Host: web-01");
    expect(text).not.toContain(RUM_APP_ID);
    expect(text).not.toContain(HOST_ID);
    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.value;
      }),
    ).toEqual([RUM_APP_ID, HOST_ID]);
  });

  test("a blank entity chip value passes through untouched", () => {
    const blank: ActiveFilter = userChip("primaryEntityId", "");

    expect(applyLogsEntityChipDisplay([blank], { nameMap: NAME_MAP })[0]).toBe(
      blank,
    );
  });

  test("empty filter list", () => {
    expect(applyLogsEntityChipDisplay([], { nameMap: NAME_MAP })).toEqual([]);
  });
});
