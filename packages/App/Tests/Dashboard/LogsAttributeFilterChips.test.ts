import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Dictionary from "Common/Types/Dictionary";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import {
  ATTRIBUTE_DISPLAY_NAMES,
  buildAttributeFilterChips,
  getAttributeDisplayName,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips";

/*
 * The chips the logs viewer pins for `logQuery.attributes`. The log monitor's
 * criteria form writes those attributes, and everything except the implicit
 * `=` operator is stored as an operator object — so this is the seam where a
 * filter stops being a query value and becomes text on screen. Getting it
 * wrong is what threw "Objects are not valid as a React child (found: object
 * with keys {_values})" inside the Edit Monitor modal.
 */

function chipsFor(
  attributes: Dictionary<DictionaryEntryValue>,
): Array<ActiveFilter> {
  return buildAttributeFilterChips(attributes);
}

function onlyChip(attributes: Dictionary<DictionaryEntryValue>): ActiveFilter {
  const chips: Array<ActiveFilter> = chipsFor(attributes);

  expect(chips).toHaveLength(1);

  return chips[0]!;
}

describe("buildAttributeFilterChips", () => {
  test("no attributes means no chips", () => {
    expect(buildAttributeFilterChips(undefined)).toEqual([]);
    expect(buildAttributeFilterChips({})).toEqual([]);
  });

  test("a plain equality filter reads as key: value", () => {
    const chip: ActiveFilter = onlyChip({ logtype: "web" });

    expect(chip).toEqual({
      facetKey: "attributes.logtype",
      value: "web",
      displayKey: "logtype",
      displayValue: "web",
      readOnly: true,
    });
  });

  test("the operator filter from the bug report becomes text", () => {
    const chip: ActiveFilter = onlyChip({ logtype: new Includes(["web"]) });

    expect(chip.displayValue).toBe("is any of web");
    expect(typeof chip.displayValue).toBe("string");
    expect(typeof chip.value).toBe("string");
  });

  test.each([
    ["is none of web, api", new IncludesNone(["web", "api"])],
    ["contains web", new Search<string>("web")],
    ["starts with web", new StartsWith<string>("web")],
    ["ends with web", new EndsWith<string>("web")],
    ["does not equal web", new NotEqual<string>("web")],
    ["greater than 5", new GreaterThan<number>(5)],
    ["is empty", new IsNull()],
    ["is not empty", new NotNull()],
  ])("renders %p", (expected: string, value: DictionaryEntryValue) => {
    expect(onlyChip({ logtype: value }).displayValue).toBe(expected);
  });

  test("every chip carries a string value, whatever the operator", () => {
    /*
     * `ActiveFilter.value` is not only shown — it is the React key and the
     * argument the remove handler is called with. An object there is a broken
     * key and a broken removal, on top of the render throw.
     */
    const chips: Array<ActiveFilter> = chipsFor({
      a: "plain",
      b: new Includes(["web"]),
      c: new Search<string>("api"),
      d: new IsNull(),
      e: 42,
      f: true,
    });

    expect(chips).toHaveLength(6);

    for (const chip of chips) {
      expect(typeof chip.value).toBe("string");
      expect(typeof chip.displayValue).toBe("string");
      expect(chip.displayValue).not.toContain("[object Object]");
    }
  });

  test("values read back from a saved monitor render too", () => {
    /*
     * A saved monitor comes back as the `{_type, value}` JSON shape rather
     * than a hydrated instance, so opening an existing monitor takes this
     * path — which is how someone hits the crash without touching the
     * dropdown at all.
     */
    const chip: ActiveFilter = onlyChip({
      logtype: { _type: "Includes", value: ["web", "api"] } as never,
    });

    expect(chip.displayValue).toBe("is any of web, api");
  });

  test("known resource keys get their friendly label", () => {
    expect(
      onlyChip({ "resource.k8s.cluster.name": "eks-non-prod" }).displayKey,
    ).toBe("Cluster");
    expect(onlyChip({ "resource.k8s.pod.name": "api-0" }).displayKey).toBe(
      "Pod",
    );
  });

  test("an unknown key keeps its own name", () => {
    expect(onlyChip({ "http.method": "GET" }).displayKey).toBe("http.method");
  });

  /*
   * The resource keys the resource pages actually pin in `logQuery.attributes`
   * (Pages/<Resource>/View/Logs.tsx, the container detail pages,
   * KubernetesLogsTab, CloudResourceTelemetryScope). Each chip used to read
   * as the raw OTel key — "resource.host.name: web-01".
   */
  test.each([
    ["resource.k8s.cluster.name", "Cluster"],
    ["resource.k8s.pod.name", "Pod"],
    ["resource.k8s.container.name", "Container"],
    ["resource.k8s.namespace.name", "Namespace"],
    ["resource.k8s.node.name", "Node"],
    ["resource.k8s.deployment.name", "Deployment"],
    ["resource.k8s.statefulset.name", "StatefulSet"],
    ["resource.k8s.daemonset.name", "DaemonSet"],
    ["resource.k8s.job.name", "Job"],
    ["resource.k8s.cronjob.name", "CronJob"],
    ["resource.host.name", "Host"],
    ["resource.service.name", "Service"],
    ["resource.faas.name", "Function"],
    ["resource.container.id", "Container"],
    ["resource.container.name", "Container"],
    ["resource.container.runtime", "Runtime"],
    ["resource.container.image.name", "Image"],
    ["resource.cloud.platform", "Platform"],
    ["resource.cloud.account.id", "Account"],
    ["resource.cloud.region", "Region"],
    ["resource.ceph.cluster.name", "Cluster"],
    ["resource.proxmox.cluster.name", "Cluster"],
    ["resource.docker.swarm.cluster.name", "Cluster"],
    ["resource.vmware.vcenter.name", "vCenter"],
    ["resource.iot.fleet.name", "Fleet"],
    ["resource.oneuptime.database.server.id", "Database"],
    ["resource.oneuptime.database.server.name", "Database"],
    ["resource.db.system.name", "Engine"],
    ["resource.db.system", "Engine"],
    ["networkDevice.id", "Network Device"],
  ])("%p reads as %p", (attributeKey: string, label: string) => {
    expect(getAttributeDisplayName(attributeKey)).toBe(label);
    expect(onlyChip({ [attributeKey]: "x" }).displayKey).toBe(label);
  });

  test("every friendly label is a non-empty human label, never an OTel key", () => {
    for (const [attributeKey, label] of Object.entries(
      ATTRIBUTE_DISPLAY_NAMES,
    )) {
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).not.toBe(attributeKey);
      expect(label).not.toContain("resource.");
    }
  });

  test("inherited object keys are not mistaken for friendly labels", () => {
    expect(getAttributeDisplayName("constructor")).toBe("constructor");
    expect(getAttributeDisplayName("toString")).toBe("toString");
    expect(onlyChip({ constructor: "x" } as never).displayKey).toBe(
      "constructor",
    );
  });

  test("chips are always facet-scoped under attributes.", () => {
    const chips: Array<ActiveFilter> = chipsFor({
      logtype: new Search<string>("web"),
      "resource.k8s.pod.name": "api-0",
    });

    expect(
      chips.map((chip: ActiveFilter) => {
        return chip.facetKey;
      }),
    ).toEqual(["attributes.logtype", "attributes.resource.k8s.pod.name"]);
  });

  test("every chip is read-only — these come from the host page, not the user", () => {
    for (const chip of chipsFor({ a: "x", b: new Includes(["y"]) })) {
      expect(chip.readOnly).toBe(true);
    }
  });
});

describe("buildAttributeFilterChips display overrides", () => {
  test("a resource page shows the friendly name while filtering on the identifier", () => {
    /*
     * Host logs scope by `hostIdentifier` (what the telemetry carries) but
     * the page has the Host's name loaded.
     */
    const chip: ActiveFilter = buildAttributeFilterChips(
      { "resource.host.name": "ip-10-0-0-12.ec2.internal" },
      { displayValues: { "resource.host.name": "web-01" } },
    )[0]!;

    expect(chip).toEqual({
      facetKey: "attributes.resource.host.name",
      value: "ip-10-0-0-12.ec2.internal",
      displayKey: "Host",
      displayValue: "web-01",
      readOnly: true,
    });
  });

  test("the network device page's UUID never reaches the chip", () => {
    const deviceId: string = "9a1f0b8e-4d1c-4a55-9d6c-2d7e2b6f1a11";
    const chip: ActiveFilter = buildAttributeFilterChips(
      { "networkDevice.id": deviceId },
      { displayValues: { "networkDevice.id": "core-switch-1" } },
    )[0]!;

    expect(chip.displayKey).toBe("Network Device");
    expect(chip.displayValue).toBe("core-switch-1");
    expect(`${chip.displayKey}: ${chip.displayValue}`).not.toContain(deviceId);
    // The filter itself is still the id.
    expect(chip.value).toBe(deviceId);
    expect(chip.facetKey).toBe("attributes.networkDevice.id");
  });

  test("a display key override wins over the built-in label and the raw key", () => {
    const chips: Array<ActiveFilter> = buildAttributeFilterChips(
      { "resource.k8s.cluster.name": "eks-prod", "custom.key": "v" },
      {
        displayKeys: {
          "resource.k8s.cluster.name": "Kubernetes Cluster",
          "custom.key": "Custom",
        },
      },
    );

    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.displayKey;
      }),
    ).toEqual(["Kubernetes Cluster", "Custom"]);
  });

  test("overrides only touch the keys they name", () => {
    const chips: Array<ActiveFilter> = buildAttributeFilterChips(
      {
        "resource.host.name": "ip-10-0-0-12",
        "resource.container.runtime": "docker",
      },
      { displayValues: { "resource.host.name": "web-01" } },
    );

    expect(
      chips.map((chip: ActiveFilter): string => {
        return `${chip.displayKey}: ${chip.displayValue}`;
      }),
    ).toEqual(["Host: web-01", "Runtime: docker"]);
  });

  test("a blank override (resource not loaded yet) keeps the real value and label", () => {
    const chip: ActiveFilter = buildAttributeFilterChips(
      { "resource.faas.name": "checkout-fn-prod" },
      {
        displayKeys: { "resource.faas.name": "   " },
        displayValues: { "resource.faas.name": "" },
      },
    )[0]!;

    expect(chip.displayKey).toBe("Function");
    expect(chip.displayValue).toBe("checkout-fn-prod");
  });

  test("an override for a key that is not pinned adds no chip", () => {
    expect(
      buildAttributeFilterChips(
        { logtype: "web" },
        {
          displayKeys: { "resource.host.name": "Host" },
          displayValues: { "resource.host.name": "web-01" },
        },
      ),
    ).toHaveLength(1);
    expect(
      buildAttributeFilterChips(undefined, {
        displayValues: { "resource.host.name": "web-01" },
      }),
    ).toEqual([]);
  });

  test("inherited object keys on the overrides are ignored", () => {
    const chip: ActiveFilter = buildAttributeFilterChips(
      { toString: "x" } as never,
      { displayKeys: {}, displayValues: {} },
    )[0]!;

    expect(chip.displayKey).toBe("toString");
    expect(chip.displayValue).toBe("x");
  });

  test("an operator value keeps its string filter value under a display override", () => {
    const chip: ActiveFilter = buildAttributeFilterChips(
      { "resource.host.name": new Includes(["a", "b"]) },
      { displayValues: { "resource.host.name": "web-01, web-02" } },
    )[0]!;

    expect(chip.value).toBe("is any of a, b");
    expect(chip.displayValue).toBe("web-01, web-02");
    expect(typeof chip.value).toBe("string");
  });

  test("no options behaves exactly like before", () => {
    const attributes: Dictionary<DictionaryEntryValue> = {
      "resource.k8s.pod.name": "api-0",
      logtype: new Search<string>("web"),
    };

    expect(buildAttributeFilterChips(attributes, undefined)).toEqual(
      buildAttributeFilterChips(attributes),
    );
    expect(buildAttributeFilterChips(attributes, {})).toEqual(
      buildAttributeFilterChips(attributes),
    );
  });
});

describe("resource pages' pinned log attributes", () => {
  /*
   * Every OTel resource key a resource page's Logs tab (or the shared scope
   * helpers it uses) pins in `logQuery.attributes` must read as a label, not
   * as "resource.host.name". Scanning the sources means a new resource page
   * that pins a new key fails here until the key is given a label.
   */
  const DASHBOARD_SRC: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  type ListLogsScopeSourcesFunction = () => Array<string>;

  const listLogsScopeSources: ListLogsScopeSourcesFunction =
    (): Array<string> => {
      const pagesDir: string = path.join(DASHBOARD_SRC, "Pages");
      const files: Array<string> = [];

      for (const entry of fs.readdirSync(pagesDir)) {
        const logsPage: string = path.join(pagesDir, entry, "View", "Logs.tsx");

        if (fs.existsSync(logsPage)) {
          files.push(logsPage);
        }
      }

      files.push(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "Cloud",
          "Utils",
          "CloudResourceTelemetryScope.ts",
        ),
        path.join(
          DASHBOARD_SRC,
          "Components",
          "Kubernetes",
          "KubernetesLogsScope.ts",
        ),
      );

      return files.filter((file: string): boolean => {
        return fs.existsSync(file);
      });
    };

  const sources: Array<string> = listLogsScopeSources();

  const pinnedKeys: Array<string> = Array.from(
    new Set(
      sources.flatMap((file: string): Array<string> => {
        const source: string = fs.readFileSync(file, "utf8");
        return (
          source.match(/"(resource\.[a-z0-9_.]+|networkDevice\.[A-Za-z]+)"/g) ||
          []
        ).map((literal: string): string => {
          return literal.slice(1, -1);
        });
      }),
    ),
  ).sort();

  test("the scan found the resource pages and their keys", () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(pinnedKeys).toEqual(
      expect.arrayContaining([
        "resource.host.name",
        "resource.k8s.cluster.name",
        "resource.faas.name",
        "networkDevice.id",
      ]),
    );
  });

  test("every pinned key has a friendly chip label", () => {
    const unlabelled: Array<string> = pinnedKeys.filter(
      (attributeKey: string): boolean => {
        return getAttributeDisplayName(attributeKey) === attributeKey;
      },
    );

    expect(unlabelled).toEqual([]);
  });
});
