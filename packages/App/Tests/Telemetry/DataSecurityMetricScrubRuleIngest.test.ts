/*
 * Only the rule engine runs here (applyRules): loadRules, the one Postgres
 * touchpoint, is never called, so the DatabaseService module is stubbed
 * before the server-side services it brings in are compiled, as
 * MetricPipelineRegexCompile.test.ts does - with the base-class methods
 * their constructors call.
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
import {
  buildMetricScrubRule,
  getScrubTarget,
  METRIC_REDACT_REPLACEMENT,
  ScrubTarget,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import MetricPipelineEngine from "Common/Server/Utils/Telemetry/MetricPipelineEngine";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE RULE SCRUB IT MAKES FOR A METRIC'S ATTRIBUTE, AT INGEST (#9604).
 *
 * Data Security's Scrub It on a metric attribute finding makes a Redact
 * Attribute metric pipeline rule for the finding's service
 * (TelemetryScrubCoverage.buildMetricScrubRule). This runs that very rule
 * through the ingest engine every metric data point goes through: the
 * finding's data is replaced with [REDACTED] before the point is stored,
 * the attribute's other values are kept where the type's pattern tells
 * them apart, a label that is the data by its name is redacted whole, and
 * another service's metrics are untouched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d8001",
);
const CHECKOUT: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d8101");
const PAYMENTS: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d8102");

function scrubRule(location: string, dataTypeId: string): MetricPipelineRule {
  const target: ScrubTarget | null = getScrubTarget(
    DataStoreKind.TelemetryMetrics,
    location,
  );

  expect(target).not.toBeNull();

  const rule: MetricPipelineRule = buildMetricScrubRule({
    projectId: PROJECT_ID,
    serviceId: CHECKOUT,
    kind: DataStoreKind.TelemetryMetrics,
    dataTypeId,
    location,
    target: target!,
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

// A data point's row as ingest builds it: resource attributes prefixed.
function point(attributes: JSONObject): JSONObject {
  return {
    name: "user.logins",
    attributes: { ...attributes },
    attributeKeys: Object.keys(attributes).sort(),
  };
}

function attributesAfter(
  row: JSONObject,
  serviceId: ObjectID,
  rules: MetricRulesForProject,
): JSONObject {
  const kept: JSONObject | null = MetricPipelineRuleService.applyRules(
    row,
    serviceId,
    rules,
  );

  expect(kept).not.toBeNull();

  return kept!["attributes"] as JSONObject;
}

beforeEach(() => {
  MetricPipelineRuleService.clearCache();
});

describe("the rule Scrub It makes for a metric's attribute", () => {
  test("redacts the finding's data in the service's new points, and keeps the label's other values", () => {
    const rules: MetricRulesForProject = rulesOf(
      scrubRule("attributes.http.route", "email-address"),
    );

    expect(
      attributesAfter(
        point({
          "http.route": "/users/jane.doe@acme-corp.com/orders",
          "http.method": "GET",
        }),
        CHECKOUT,
        rules,
      ),
    ).toEqual({
      "http.route": METRIC_REDACT_REPLACEMENT,
      "http.method": "GET",
    });
    // A route with no email in it is the label it always was.
    expect(
      attributesAfter(
        point({ "http.route": "/orders/:id", "http.method": "GET" }),
        CHECKOUT,
        rules,
      ),
    ).toEqual({ "http.route": "/orders/:id", "http.method": "GET" });
  });

  test("a resource's attribute, by its key as the point holds it", () => {
    const rules: MetricRulesForProject = rulesOf(
      scrubRule("attributes.resource.client.ip", "ip-address"),
    );

    expect(
      attributesAfter(
        point({ "resource.client.ip": "81.2.69.160", region: "eu" }),
        CHECKOUT,
        rules,
      ),
    ).toEqual({
      "resource.client.ip": METRIC_REDACT_REPLACEMENT,
      region: "eu",
    });
  });

  test("a label that is the data by its name: every value of it", () => {
    const rules: MetricRulesForProject = rulesOf(
      scrubRule("attributes.customer.full_name", "person-name"),
    );

    expect(
      attributesAfter(
        point({ "customer.full_name": "Jane Doe", plan: "pro" }),
        CHECKOUT,
        rules,
      ),
    ).toEqual({ "customer.full_name": METRIC_REDACT_REPLACEMENT, plan: "pro" });
  });

  test("another service's metrics, and a point without the label, are untouched", () => {
    const rules: MetricRulesForProject = rulesOf(
      scrubRule("attributes.user.email", "email-address"),
    );

    expect(
      attributesAfter(
        point({ "user.email": "jane.doe@acme-corp.com" }),
        PAYMENTS,
        rules,
      ),
    ).toEqual({ "user.email": "jane.doe@acme-corp.com" });
    expect(attributesAfter(point({ region: "eu" }), CHECKOUT, rules)).toEqual({
      region: "eu",
    });
  });
});

/*
 * #10753: Data Security proves a metric attribute's rule on the finding's
 * data points before OneUptime AI may make it on its own
 * (TelemetryScrubProof.proveMetricScrubRule). It runs the rule through the
 * engine ingest runs every metric pipeline rule with
 * (Common/Server/Utils/Telemetry/MetricPipelineEngine), so what was proven
 * is what ingest does.
 */
describe("the rule proven is the rule ingest runs", () => {
  test("ingest hands each point to the one engine: the service's rules, then the project's", () => {
    const serviceRule: MetricPipelineRule = scrubRule(
      "attributes.user.email",
      "email-address",
    );
    const projectRule: MetricPipelineRule = scrubRule(
      "attributes.http.route",
      "email-address",
    );
    const engine: ReturnType<typeof jest.spyOn> = jest.spyOn(
      MetricPipelineEngine,
      "applyRules",
    );
    const row: JSONObject = point({ "user.email": "jane.doe@acme-corp.com" });

    MetricPipelineRuleService.applyRules(row, CHECKOUT, {
      projectRules: [projectRule],
      rulesByServiceId: new Map([[CHECKOUT.toString(), [serviceRule]]]),
    });

    expect(engine).toHaveBeenCalledWith(row, [serviceRule], [projectRule]);
    engine.mockRestore();
  });

  test("a point left by the engine, as the proof runs it, is the point ingest stores", () => {
    const rule: MetricPipelineRule = scrubRule(
      "attributes.http.route",
      "email-address",
    );

    for (const route of [
      "/users/jane.doe@acme-corp.com/orders",
      "/orders/:id",
      "/users/max.mustermann@acme-corp.com",
    ]) {
      const byEngine: JSONObject | null = MetricPipelineEngine.applyRules(
        point({ "http.route": route, "http.method": "GET" }),
        [rule],
        [],
      );

      expect(byEngine).not.toBeNull();
      expect(byEngine!["attributes"]).toEqual(
        attributesAfter(
          point({ "http.route": route, "http.method": "GET" }),
          CHECKOUT,
          rulesOf(rule),
        ),
      );
    }
  });
});
