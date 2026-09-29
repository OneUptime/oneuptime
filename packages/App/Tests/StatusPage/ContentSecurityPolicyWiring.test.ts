/**
 * Both status-page HTML renderers must apply the fallback-only CSP before
 * doing the status-page lookup. Applying it afterwards would leave the
 * generic fallback document unprotected whenever that lookup throws.
 *
 * Importing either renderer starts a server, so this follows the established
 * source-wiring convention used by SearchEngineIndexingWiring.test.ts.
 */
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

const FEATURE_SET: string = path.join(__dirname, "..", "..", "FeatureSet");

function readCode(...relativeParts: Array<string>): string {
  return fs
    .readFileSync(path.join(FEATURE_SET, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const INDEX_RENDERERS: Array<[string, string]> = [
  ["standalone status-page container", readCode("StatusPage", "Serve.ts")],
  ["combined App container", readCode("Frontend", "Index.ts")],
];

describe.each(INDEX_RENDERERS)(
  "status-page CSP wiring in the %s",
  (_name: string, code: string) => {
    it("imports the shared policy utility", () => {
      expect(code).toContain(
        'import applyStatusPageContentSecurityPolicy from "Common/Server/Utils/StatusPageContentSecurityPolicy"',
      );
    });

    it("applies the policy while preparing the index document", () => {
      expect(code).toContain("applyStatusPageContentSecurityPolicy(req, res)");
    });

    it("applies the policy before the status-page lookup can fail", () => {
      const policyCall: number = code.indexOf(
        "applyStatusPageContentSecurityPolicy(req, res)",
      );
      const dataLookup: number = code.indexOf("await getStatusPageData(req)");

      expect(policyCall).toBeGreaterThan(-1);
      expect(dataLookup).toBeGreaterThan(-1);
      expect(policyCall).toBeLessThan(dataLookup);
    });
  },
);
