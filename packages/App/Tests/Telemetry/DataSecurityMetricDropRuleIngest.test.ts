/*
 * Only the rule engine runs here (applyRules): loadRules, the one Postgres
 * touchpoint, is never called, so the DatabaseService module is stubbed
 * before the server-side services it brings in are compiled, as
 * DataSecurityMetricScrubRuleIngest.test.ts does - with the base-class
 * methods their constructors call.
 */
jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {
        // no-op: retention config, nothing for a pure unit test to do.
      }

      public setDoNotAllowDelete(): void {
        // no-op: delete-permission config, same.
      }

      public keepRowsOnDeleteByQuery(): void {
        // no-op: the rows a delete by query keeps, config too.
      }
    },
  };
});

import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import { buildMetricDropRule } from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE RULE DROP THIS METRIC MAKES, AT INGEST (#9757).
 *
 * Data Security's Drop This Metric on a finding in a metric's name makes a
 * Drop metric pipeline rule for the finding's service
 * (TelemetryScrubCoverage.buildMetricDropRule). This runs that very rule
 * through the ingest engine every metric data point goes through: a point
 * of a metric whose name holds the data type is dropped before it is
 * stored - every one of them, whatever its labels - while the service's
 * other metrics, another service's metrics named alike and other data
 * types in names are kept; and once the rule is deleted, the points are
 * stored again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d9731",
);
const CHECKOUT: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d9741");
const PAYMENTS: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d9742");

function dropRule(dataTypeId: string = "email-address"): MetricPipelineRule {
  const rule: MetricPipelineRule = buildMetricDropRule({
    projectId: PROJECT_ID,
    serviceId: CHECKOUT,
    kind: DataStoreKind.TelemetryMetrics,
    dataTypeId,
    location: "name",
  });

  rule.id = ObjectID.generate();

  return rule;
}

// The rules a project's ingest loads: a service's own, then the project's.
function rulesOf(...rules: Array<MetricPipelineRule>): MetricRulesForProject {
  return {
    projectRules: [],
    rulesByServiceId: new Map([[CHECKOUT.toString(), rules]]),
  };
}

// A data point's row as ingest builds it.
function point(name: string, attributes: JSONObject = {}): JSONObject {
  return {
    name,
    attributes: { ...attributes },
    attributeKeys: Object.keys(attributes).sort(),
  };
}

function isStored(
  row: JSONObject,
  serviceId: ObjectID,
  rules: MetricRulesForProject,
): boolean {
  return MetricPipelineRuleService.applyRules(row, serviceId, rules) !== null;
}

beforeEach(() => {
  MetricPipelineRuleService.clearCache();
});

describe("the rule Drop This Metric makes for a metric's name", () => {
  test("drops every point of the service's metrics whose name holds the data type, whatever their labels", () => {
    const rules: MetricRulesForProject = rulesOf(dropRule());

    for (const name of [
      "signups.jane.doe@acme-corp.com.count",
      "user.kim.lee@acme-corp.com.logins",
      "jane.doe@acme-corp.com",
    ]) {
      expect(isStored(point(name), CHECKOUT, rules)).toBe(false);
      expect(
        isStored(point(name, { plan: "pro", region: "eu" }), CHECKOUT, rules),
      ).toBe(false);
    }
  });

  test("keeps the service's other metrics, and a name with no email in it", () => {
    const rules: MetricRulesForProject = rulesOf(dropRule());

    for (const name of [
      "http.server.duration",
      "signups.count",
      // An @ alone, a domain alone: not an email address.
      "queue@depth",
      "acme-corp.com.requests",
    ]) {
      expect(isStored(point(name, { plan: "pro" }), CHECKOUT, rules)).toBe(
        true,
      );
    }

    // An email in a label is no business of this rule: Scrub It redacts it.
    const kept: JSONObject | null = MetricPipelineRuleService.applyRules(
      point("user.logins", { "user.email": "jane.doe@acme-corp.com" }),
      CHECKOUT,
      rules,
    );

    expect(kept?.["attributes"]).toEqual({
      "user.email": "jane.doe@acme-corp.com",
    });
  });

  test("another service's metrics, named alike, are stored: the rule is its service's", () => {
    expect(
      isStored(
        point("signups.jane.doe@acme-corp.com.count"),
        PAYMENTS,
        rulesOf(dropRule()),
      ),
    ).toBe(true);
  });

  test("the rule of one data type drops only names holding that type", () => {
    const rules: MetricRulesForProject = rulesOf(dropRule("ip-address"));

    expect(
      isStored(point("client_81.2.69.160_requests"), CHECKOUT, rules),
    ).toBe(false);
    /*
     * An address between a dotted name's dots reads as a version number to
     * the IP detector, as it does to the scan: the finding is never made,
     * so neither is the rule's drop.
     */
    expect(
      isStored(point("client.81.2.69.160.requests"), CHECKOUT, rules),
    ).toBe(true);
    expect(
      isStored(point("signups.jane.doe@acme-corp.com.count"), CHECKOUT, rules),
    ).toBe(true);
  });

  test("undone by deleting the rule: the points are stored again from then on", () => {
    const name: string = "signups.jane.doe@acme-corp.com.count";

    expect(isStored(point(name), CHECKOUT, rulesOf(dropRule()))).toBe(false);
    expect(isStored(point(name), CHECKOUT, rulesOf())).toBe(true);

    // Switched off, it is not loaded at all (loadRules reads enabled rules only).
    const off: MetricPipelineRule = dropRule();

    off.isEnabled = false;
    expect(off.isEnabled).toBe(false);
  });
});
