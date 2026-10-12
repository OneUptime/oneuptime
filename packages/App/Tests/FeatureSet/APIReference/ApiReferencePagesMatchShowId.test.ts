import { describe, expect, test } from "@jest/globals";
import ResourceUtil, {
  ModelDocumentation,
} from "../../../FeatureSet/APIReference/Utils/Resources";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { getApiReferencePagePath } from "Common/Utils/ApiReferencePage";
import fs from "fs";
import path from "path";

/*
 * The Show ID dialog's "Go to API Docs" button and the API Reference read one
 * rule (Common/Utils/ApiReferencePage.ts): the button goes to
 * /reference/<page> only for a model the API Reference serves a page for.
 * The dialog used to offer the button for every model, and for a model the
 * API Reference did not document - a profile, an Enterprise license, a
 * project or a user in SaaS - it led to "Page not found".
 *
 * So the pages the API Reference serves must be exactly the pages the dialog
 * links to, in whichever build this runs (CI runs App Test with billing on,
 * a local run has it off).
 */

const RESOURCES_FILE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "APIReference",
  "Utils",
  "Resources.ts",
);

// Each of the two lists (database, analytics) filters with the shared rule.
const RULE_CALL: RegExp = /isInApiReference\(new model\(\), \{/g;

function sorted(values: Array<string>): Array<string> {
  return [...values].sort();
}

describe("the API Reference serves a page for exactly the models Show ID links to", () => {
  const served: Array<string> = ResourceUtil.getResources().map(
    (resource: ModelDocumentation): string => {
      return resource.path;
    },
  );

  const linked: Array<string> = [
    ...DatabaseModels.map((modelType: { new (): DatabaseBaseModel }) => {
      return getApiReferencePagePath(new modelType(), {
        isBillingEnabled: IsBillingEnabled,
      });
    }),
    ...AnalyticsModels.map((modelType: { new (): AnalyticsBaseModel }) => {
      return getApiReferencePagePath(new modelType(), {
        isBillingEnabled: IsBillingEnabled,
      });
    }),
  ].filter((page: string | null): page is string => {
    return page !== null;
  });

  test("the same pages, no more and no fewer", () => {
    expect(sorted(served)).toEqual(sorted(linked));
  });

  test("a good few of them, so the check is not vacuous", () => {
    expect(served.length).toBeGreaterThan(100);
  });

  test("the telemetry tables with Show ID: spans and exceptions have pages, profiles do not", () => {
    expect(served).toEqual(expect.arrayContaining(["span", "exceptions"]));
    expect(served).not.toContain("profile");
  });

  test("the API Reference reads the shared rule rather than a copy of it", () => {
    const source: string = fs.readFileSync(RESOURCES_FILE, "utf8");

    expect(source).toContain(
      'import { isInApiReference } from "Common/Utils/ApiReferencePage";',
    );
    expect(source.match(RULE_CALL) || []).toHaveLength(2);
    // The rule's pieces live there now, not here.
    expect(source).not.toContain("modelInstance.enableDocumentation");
    expect(source).not.toContain("modelInstance.isMasterAdminApiDocs");
  });
});
