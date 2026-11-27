import { JSONArray, JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";

/*
 * The recordings #10995 made of one Xen Orchestra serving a two-pool lab
 * (packages/Common/Tests/Server/Utils/Telemetry/Fixtures/XcpNg, whose
 * README says how they were made): what Xen Orchestra's OpenMetrics plugin
 * served at two scrapes, a minute apart, and what the XCP-ng Agent's real
 * collector (otel-collector-contrib 0.165.0, with the shipped config) sent
 * OneUptime for each. The probe is held to those: what it sends for the
 * same scrape is what the agent sent.
 */

export const XCP_NG_FIXTURES_DIR: string = path.resolve(
  __dirname,
  "../../../../../Common/Tests/Server/Utils/Telemetry/Fixtures/XcpNg",
);

// The second Xen Orchestra served each scrape at (the fixtures' nowSeconds).
export const SCRAPE_SECONDS: Record<1 | 2, number> = {
  1: 1795000000,
  2: 1795000060,
};

// The address the stand-in Xen Orchestra was scraped at.
export const RECORDED_XO_HOST: string = "xo.example.test";

export const POOL_PRODUCTION: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
export const POOL_UNNAMED: string = "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1";

export function readScrapeText(scrape: 1 | 2): string {
  return fs.readFileSync(
    path.join(XCP_NG_FIXTURES_DIR, `XenOrchestraScrape${scrape}.txt`),
    "utf8",
  );
}

export function readAgentOtlp(scrape: 1 | 2): { resourceMetrics: JSONArray } {
  return JSON.parse(
    fs.readFileSync(
      path.join(XCP_NG_FIXTURES_DIR, `AgentOtlpScrape${scrape}.json`),
      "utf8",
    ),
  ) as { resourceMetrics: JSONArray };
}

/*
 * The agent's export as the probe sends it: without what the agent stamps
 * and the probe never does (oneuptime.agent.version, and xen_orchestra.name,
 * which the server stamps for a probe), and with the probe's scope in
 * place of the receiver's - nothing downstream reads the scope.
 */
export function asTheProbeSendsIt(
  resourceMetrics: JSONArray,
  scope: { name: string; version: string },
): JSONArray {
  return (JSON.parse(JSON.stringify(resourceMetrics)) as JSONArray).map(
    (entry: unknown): JSONObject => {
      const resource: JSONObject = entry as JSONObject;
      const attributes: JSONArray = (
        (resource["resource"] as JSONObject)["attributes"] as JSONArray
      ).filter((attribute: unknown): boolean => {
        const key: unknown = (attribute as JSONObject)["key"];
        return (
          key !== "oneuptime.agent.version" && key !== "xen_orchestra.name"
        );
      });

      return {
        resource: { attributes: attributes },
        scopeMetrics: (resource["scopeMetrics"] as JSONArray).map(
          (scopeMetrics: unknown): JSONObject => {
            return {
              ...(scopeMetrics as JSONObject),
              scope: scope,
            };
          },
        ),
      };
    },
  );
}
