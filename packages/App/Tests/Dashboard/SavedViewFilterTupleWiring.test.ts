import JSONFunctions from "Common/Types/JSONFunctions";
import TelemetrySavedViewState from "Common/Types/Telemetry/TelemetrySavedViewState";
import { JSONObject } from "Common/Types/JSON";
import { readSavedViewFilters } from "Common/Utils/Telemetry/SavedViewFilters";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A saved telemetry view stores its facet filters as [facetKey, value] tuples
 * in a JSON column. JSONFunctions.serializeValue had no Array.isArray branch,
 * so those tuples were walked by key on the way out and came back as
 * { "0": facetKey, "1": value }. The explorers destructured them, and Traces
 * white-screened for anyone with a default saved view:
 *
 *   TypeError: (destructured parameter) is not iterable
 *
 * Two things keep it fixed, and this file pins both:
 *   - the serializer preserves nested arrays, so nothing new is corrupted;
 *   - every explorer reads filters through readSavedViewFilters, so the rows
 *     already written in the broken shape still load.
 *
 * The App suite has no renderer, so the wiring is checked by reading the
 * sources — the same approach as SavedViewRollingTimeWiring.test.ts. The last
 * describe walks the components tree rather than naming files, so a fifth
 * explorer mounting the saved-views control later fails here until it reads
 * its filters defensively too.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMPONENTS_DIR: string = path.join(DASHBOARD_SRC, "Components");

const METRICS_VIEWER: Array<string> = [
  "Components",
  "Metrics",
  "MetricsViewer.tsx",
];
const TRACES_VIEWER: Array<string> = [
  "Components",
  "Traces",
  "TracesViewer.tsx",
];
const LOGS_VIEWER: Array<string> = ["Components", "Logs", "LogsViewer.tsx"];

const SHARED_FILTER_READER_IMPORT: string =
  'from "Common/Utils/Telemetry/SavedViewFilters"';

/*
 * The exact expression that crashed: destructuring straight out of saved
 * state, with no tolerance for the shape the database actually holds.
 */
const RAW_DESTRUCTURE: string = "(state.filters || []).map( ([";

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

function readCode(...relativeParts: Array<string>): string {
  return readCodeAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

const METRICS_CODE: string = readCode(...METRICS_VIEWER);
const TRACES_CODE: string = readCode(...TRACES_VIEWER);
const LOGS_CODE: string = readCode(...LOGS_VIEWER);

describe("the traces explorer reads saved filters defensively", () => {
  test("it imports the shared filter reader", () => {
    expect(TRACES_CODE).toContain(SHARED_FILTER_READER_IMPORT);
    expect(TRACES_CODE).toContain("readSavedViewFilters");
  });

  test("applying a view routes filters through the reader", () => {
    expect(TRACES_CODE).toContain(
      squash("setActiveFilters( readSavedViewFilters(state.filters).map("),
    );
  });

  test("it never destructures saved filters directly", () => {
    expect(TRACES_CODE).not.toContain(RAW_DESTRUCTURE);
  });
});

describe("the metrics list explorer reads saved filters defensively", () => {
  test("it imports the shared filter reader", () => {
    expect(METRICS_CODE).toContain(SHARED_FILTER_READER_IMPORT);
    expect(METRICS_CODE).toContain("readSavedViewFilters");
  });

  test("applying a view routes filters through the reader", () => {
    expect(METRICS_CODE).toContain(
      squash("setActiveFilters( readSavedViewFilters(state.filters).map("),
    );
  });

  test("it never destructures saved filters directly", () => {
    expect(METRICS_CODE).not.toContain(RAW_DESTRUCTURE);
  });
});

/*
 * The same serializer bug hit the logs explorer through a different door.
 * LocalStorage.setItem serializes the value it is given rather than a wrapper
 * object, so the FLAT Array<string> of selected columns was stored as
 * { "0": "time", ... }. loadSelectedColumns guarded with Array.isArray, which
 * was false, so it silently returned the defaults — and the effect mirroring
 * state back to storage then overwrote the user's real selection. No crash,
 * no console warning, just a column picker that never remembered anything.
 */
describe("the logs explorer reads its stored columns defensively", () => {
  test("it imports the shared legacy-array reader", () => {
    expect(LOGS_CODE).toContain('from "Common/Utils/LegacySerializedArray"');
  });

  test("loading columns goes through the reader", () => {
    expect(LOGS_CODE).toContain("readLegacySerializedArray(savedValue)");
  });

  test("it no longer discards stored columns behind a bare Array.isArray guard", () => {
    expect(LOGS_CODE).not.toContain("if (Array.isArray(savedValue)) {");
  });
});

describe("the serializer that writes saved views preserves filter tuples", () => {
  test("a captured view round-trips through storage unchanged", () => {
    const captured: TelemetrySavedViewState = {
      search: "status:error",
      filters: [
        ["primaryEntityId", "6512f1a0a1b2c3d4e5f60718"],
        ["attributes.http.method", "GET"],
      ],
      timeRange: { range: "Past one hour" },
      pageSize: 50,
      rootOnly: false,
    };

    /*
     * Serialize -> JSON (the wire and the JSONB column) -> deserialize is the
     * full path a saved view takes between Save and Apply.
     */
    const restored: JSONObject = JSONFunctions.deserialize(
      JSON.parse(
        JSON.stringify(JSONFunctions.serialize(captured as JSONObject)),
      ),
    );

    expect(restored["filters"]).toEqual(captured.filters);
    expect(readSavedViewFilters(restored["filters"])).toEqual(captured.filters);
  });

  test("every restored filter is still an iterable tuple", () => {
    const restored: JSONObject = JSONFunctions.serialize({
      filters: [["service", "api"]],
    });

    const filters: Array<unknown> = restored["filters"] as Array<unknown>;

    expect(Array.isArray(filters[0])).toBe(true);
  });
});

describe("every saved-views host reads its filters defensively", () => {
  function findFilesMounting(control: string): Array<string> {
    const matches: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }

        if (!entry.name.endsWith(".tsx")) {
          continue;
        }

        if (readCodeAt(fullPath).includes(`<${control}`)) {
          matches.push(fullPath);
        }
      }
    };

    walk(COMPONENTS_DIR);

    return matches;
  }

  /*
   * MetricExplorer mounts the control too but stores a chart-builder config
   * instead of filter tuples, so it has nothing to read here. It is listed so
   * that a new host shows up as a failure rather than passing silently.
   */
  test("the known hosts are the ones this file pins", () => {
    const hosts: Array<string> = findFilesMounting(
      "TelemetrySavedViewsControl",
    ).map((file: string): string => {
      return path.basename(file);
    });

    expect(hosts.sort()).toEqual([
      "MetricExplorer.tsx",
      "MetricsViewer.tsx",
      "TracesViewer.tsx",
    ]);
  });

  test("no host destructures saved filters straight out of stored state", () => {
    for (const file of findFilesMounting("TelemetrySavedViewsControl")) {
      expect(readCodeAt(file)).not.toContain(RAW_DESTRUCTURE);
    }
  });

  test("a host that reads state.filters uses the shared reader", () => {
    for (const file of findFilesMounting("TelemetrySavedViewsControl")) {
      const code: string = readCodeAt(file);

      if (!code.includes("state.filters")) {
        continue;
      }

      expect(code).toContain("readSavedViewFilters(state.filters)");
    }
  });
});
