import {
  POOL_PRODUCTION,
  POOL_UNNAMED,
  SCRAPE_SECONDS,
  readScrapeText,
} from "./Helpers/XcpNgFixtures";
import { XapiLab, buildXapiLab, toSnapshot } from "./Helpers/XapiLab";
import {
  OpenMetricsSample,
  parseOpenMetricsText,
} from "../../../Utils/XcpNg/OpenMetricsText";
import {
  buildXapiFormattedMetrics,
  toOpenMetricsSamples,
} from "../../../Utils/XcpNg/XapiOpenMetrics";
import XcpNgOtlpBuilder, {
  XcpNgOtlpBuildResult,
} from "../../../Utils/XcpNg/XcpNgOtlpBuilder";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * THE PARITY #10999 ASKS FOR: "sends the same series and inventory #10995
 * defines, so the pages, monitors and templates are the same."
 *
 * The same lab - the Production pool's three hosts, its VMs, storage
 * repositories and virtual disks - read through XAPI, as a probe reads a
 * pool with no Xen Orchestra, and turned into OTLP, is held equal to what
 * the probe (and the XCP-ng Agent: XcpNgAgentParity) sends for the scrape
 * Xen Orchestra served for it. Datapoint for datapoint, label for label,
 * value for value, at the same times.
 *
 * Two things differ, by design, and are taken out before comparing:
 *   - the estimated VM power (xcp_vm_power_consumption_watts): Xen
 *     Orchestra draws it from the host's IPMI reading, which it reads
 *     through a host plugin call a read-only account cannot make;
 *   - where it was read from (server.address, server.port): the master,
 *     not Xen Orchestra.
 */

const NOT_PORTED: ReadonlyArray<string> = ["xcp_vm_power_consumption_watts"];
const READ_FROM: ReadonlyArray<string> = ["server.address", "server.port"];

function buildOtlp(
  samples: Array<OpenMetricsSample>,
  seconds: number,
): JSONArray {
  const built: XcpNgOtlpBuildResult = XcpNgOtlpBuilder.build({
    samples: samples,
    scrapeTimeMs: seconds * 1000,
    target: { host: "read-from.example.test", port: 443 },
    scopeVersion: "test",
  });

  return built.resourceMetrics;
}

function comparable(resourceMetrics: JSONArray, poolId: string): JSONObject {
  const resource: JSONObject | undefined = (
    resourceMetrics as Array<JSONObject>
  ).find((entry: JSONObject): boolean => {
    return (
      (
        (
          (entry["resource"] as JSONObject)["attributes"] as Array<JSONObject>
        ).find((attribute: JSONObject) => {
          return attribute["key"] === "xcp_ng.pool.id";
        })?.["value"] as JSONObject | undefined
      )?.["stringValue"] === poolId
    );
  });

  expect(resource).toBeDefined();

  const copy: JSONObject = JSON.parse(JSON.stringify(resource)) as JSONObject;
  (copy["resource"] as JSONObject)["attributes"] = (
    (copy["resource"] as JSONObject)["attributes"] as Array<JSONObject>
  ).filter((attribute: JSONObject): boolean => {
    return !READ_FROM.includes(String(attribute["key"]));
  });

  const scope: JSONObject = (copy["scopeMetrics"] as Array<JSONObject>)[0]!;
  scope["metrics"] = (scope["metrics"] as Array<JSONObject>).filter(
    (metric: JSONObject): boolean => {
      return !NOT_PORTED.includes(String(metric["name"]));
    },
  );

  return copy;
}

function xenOrchestraSamples(scrape: 1 | 2): Array<OpenMetricsSample> {
  return parseOpenMetricsText(readScrapeText(scrape)).samples;
}

function xapiSamples(lab: XapiLab): Array<OpenMetricsSample> {
  return toOpenMetricsSamples(buildXapiFormattedMetrics(toSnapshot(lab)));
}

describe("XCP-ng through XAPI: the same series Xen Orchestra serves", () => {
  for (const scrape of [1, 2] as const) {
    it(`scrape ${scrape}: the Production pool read through XAPI equals what Xen Orchestra served for it`, () => {
      const lab: XapiLab = buildXapiLab({
        pool: "production",
        scrape: scrape,
        nowSeconds: SCRAPE_SECONDS[scrape],
      });

      const throughXapi: JSONObject = comparable(
        buildOtlp(xapiSamples(lab), SCRAPE_SECONDS[scrape]),
        POOL_PRODUCTION,
      );
      const throughXenOrchestra: JSONObject = comparable(
        buildOtlp(xenOrchestraSamples(scrape), SCRAPE_SECONDS[scrape]),
        POOL_PRODUCTION,
      );

      expect(throughXapi).toEqual(throughXenOrchestra);
    });
  }

  it("the unnamed pool matches too, but for its name: xo-server names a pool XAPI names nothing after its master", () => {
    const lab: XapiLab = buildXapiLab({
      pool: "unnamed",
      scrape: 1,
      nowSeconds: SCRAPE_SECONDS[1],
    });

    const throughXapi: JSONObject = comparable(
      buildOtlp(xapiSamples(lab), SCRAPE_SECONDS[1]),
      POOL_UNNAMED,
    );
    const throughXenOrchestra: JSONObject = comparable(
      buildOtlp(xenOrchestraSamples(1), SCRAPE_SECONDS[1]),
      POOL_UNNAMED,
    );

    // The Xen Orchestra recording leaves the unnamed pool without a name...
    const names: (resource: JSONObject) => Array<unknown> = (
      resource: JSONObject,
    ): Array<unknown> => {
      return (
        (resource["resource"] as JSONObject)["attributes"] as Array<JSONObject>
      )
        .filter((attribute: JSONObject) => {
          return attribute["key"] === "xcp_ng.pool.name";
        })
        .map((attribute: JSONObject) => {
          return (attribute["value"] as JSONObject)["stringValue"];
        });
    };

    expect(names(throughXenOrchestra)).toEqual([]);
    // ...where xo-server gives it its master's name, as XAPI reads do here.
    expect(names(throughXapi)).toEqual(["xcp-lab-01"]);

    // Everything else is the same.
    const withoutName: (resource: JSONObject) => JSONObject = (
      resource: JSONObject,
    ): JSONObject => {
      const copy: JSONObject = JSON.parse(JSON.stringify(resource));
      (copy["resource"] as JSONObject)["attributes"] = (
        (copy["resource"] as JSONObject)["attributes"] as Array<JSONObject>
      ).filter((attribute: JSONObject) => {
        return attribute["key"] !== "xcp_ng.pool.name";
      });
      return copy;
    };

    // The pool's name is a label on every series of a named pool, too.
    const stripPoolName: (resource: JSONObject) => string = (
      resource: JSONObject,
    ): string => {
      return JSON.stringify(withoutName(resource));
    };

    expect(stripPoolName(throughXapi)).toEqual(
      stripPoolName(throughXenOrchestra),
    );
  });

  it("leaves out what xo-server leaves out: templates, VM snapshots and VDI snapshots", () => {
    const lab: XapiLab = buildXapiLab({
      pool: "production",
      scrape: 1,
      nowSeconds: SCRAPE_SECONDS[1],
    });
    const labels: Array<string> = xapiSamples(lab).map(
      (sample: OpenMetricsSample): string => {
        return JSON.stringify(sample.labels);
      },
    );

    for (const name of [
      "Debian Bookworm 12",
      "before upgrade",
      "before upgrade disk",
    ]) {
      expect(
        labels.some((text: string) => {
          return text.includes(name);
        }),
      ).toBe(false);
    }
  });

  it("reads the last row of rrd_updates, as the plugin does, at the recorded minute", () => {
    const lab: XapiLab = buildXapiLab({
      pool: "production",
      scrape: 1,
      nowSeconds: SCRAPE_SECONDS[1],
    });
    const cpu: OpenMetricsSample | undefined = xapiSamples(lab).find(
      (sample: OpenMetricsSample) => {
        return (
          sample.name === "xcp_host_cpu_average" &&
          sample.labels.some(([key, value]: [string, string]) => {
            return key === "host_name" && value === "xcp-prod-01";
          })
        );
      },
    );

    expect(cpu?.value).toBe(0.62);
    expect(cpu?.timestampSeconds).toBe(1794999900);
  });
});
