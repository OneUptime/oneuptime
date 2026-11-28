import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import Service from "../../../../../Models/DatabaseModels/Service";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../../Server/Services/MetricPipelineRuleService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import CreateBy from "../../../../../Server/Types/Database/CreateBy";
import { buildScrubPatternForDataType } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import {
  ScrubItOutcome,
  scrubFindingWithProvenRule,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubIt";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterConditionType,
} from "../../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import ObjectID from "../../../../../Types/ObjectID";
import { SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE } from "../../../../../Types/Telemetry/ScrubRuleKeys";

/*
 * ---------------------------------------------------------------------------
 * SCRUB IT SAYS WHETHER THE RULE IT MADE HIDES WHAT THE FINDING FOUND
 * (#11502).
 *
 * Where a finding's records cannot be read to prove a rule on, Scrub It
 * makes the narrowest candidate that hides what the finding found, as Data
 * Security's coverage reads it: the type's built-in pattern type, then its
 * Custom Regex of its shapes - which keeps values found only beside their
 * words, a nine-digit ITIN beside "ITIN" - then the rule that names the
 * attribute. Where none does, a log's body, it still makes the narrowest,
 * as Scrub It always did, and says the rule keeps what was found
 * (hidesFinding), so the finding is not marked scrubbed. A rule that
 * already hid it, and a metric's rule - made from how its finding was
 * found - do.
 *
 * Postgres is spies here: the finding's row, the project's rules, its
 * service, and the rule written.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11502000-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "11502000-0000-4000-8000-000000000002",
);
const FINDING_ID: string = "11502000-0000-4000-8000-000000000003";
const RULE_ID: ObjectID = new ObjectID("11502000-0000-4000-8000-000000000004");

// The row of the finding, as the test says it was found.
let foundBy: { isFoundByContext: boolean | null; isFoundByModel: boolean };
let logRules: Array<LogScrubRule>;
let created: Array<LogScrubRule>;
let createdMetricRules: Array<MetricPipelineRule>;

beforeEach(() => {
  foundBy = { isFoundByContext: null, isFoundByModel: false };
  logRules = [];
  created = [];
  createdMetricRules = [];

  jest
    .spyOn(DataStoreFindingService, "findOneBy")
    .mockImplementation((async (findOneBy: { select: JSONObject }) => {
      // The records the rule would be proven on: none kept.
      if (findOneBy.select["sampleRecords"]) {
        return null;
      }

      const row: DataStoreFinding = new DataStoreFinding(
        new ObjectID(FINDING_ID),
      );
      row.isFoundByContext = foundBy.isFoundByContext;
      row.isFoundByModel = foundBy.isFoundByModel;

      return row;
    }) as never);
  jest.spyOn(LogScrubRuleService, "findBy").mockImplementation((async () => {
    return logRules;
  }) as never);
  jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(MetricPipelineRuleService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(ServiceService, "findOneBy").mockImplementation((async () => {
    const service: Service = new Service(SERVICE_ID);
    service.name = "checkout";
    return service;
  }) as never);
  jest
    .spyOn(LogScrubRuleService, "create")
    .mockImplementation((async (createBy: CreateBy<LogScrubRule>) => {
      createBy.data.id = RULE_ID;
      created.push(createBy.data);
      return createBy.data;
    }) as never);
  jest
    .spyOn(MetricPipelineRuleService, "create")
    .mockImplementation((async (createBy: CreateBy<MetricPipelineRule>) => {
      createBy.data.id = RULE_ID;
      createdMetricRules.push(createBy.data);
      return createBy.data;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function scrub(
  dataTypeId: string,
  location: string,
  kind: DataStoreKind = DataStoreKind.TelemetryLogs,
): Promise<ScrubItOutcome> {
  return scrubFindingWithProvenRule({
    projectId: PROJECT_ID,
    findingId: FINDING_ID,
    kind,
    dataTypeId,
    location,
    serviceId: SERVICE_ID,
  });
}

function onlyRuleMade(): LogScrubRule {
  expect(created).toHaveLength(1);
  return created[0]!;
}

describe("a rule made where nothing could be proven", () => {
  test("an ITIN in a log's body found beside its word: the Custom Regex of its shapes keeps it, and says so", async () => {
    foundBy = { isFoundByContext: true, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub("us-itin", "body");
    const rule: LogScrubRule = onlyRuleMade();

    expect(rule.patternType).toBe(LogScrubPatternType.Custom);
    expect(rule.customRegex).toBe(buildScrubPatternForDataType("us-itin"));
    expect(rule.fieldsToScrub).toBe(LogScrubField.Body);
    expect(rule.serviceId?.toString()).toBe(SERVICE_ID.toString());
    expect(outcome).toEqual({
      signal: "log",
      scrubRuleId: RULE_ID.toString(),
      scrubRuleName: rule.name,
      isProven: false,
      hidesFinding: false,
    });
  });

  test("the same finding found by its shapes alone is hidden by that rule", async () => {
    foundBy = { isFoundByContext: false, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub("us-itin", "body");

    expect(onlyRuleMade().patternType).toBe(LogScrubPatternType.Custom);
    expect(outcome.hidesFinding).toBe(true);
    expect(outcome.isProven).toBe(false);
  });

  test("a finding written before it said how it was found is taken as found so, where its type can be", async () => {
    foundBy = { isFoundByContext: null, isFoundByModel: false };

    expect((await scrub("us-itin", "body")).hidesFinding).toBe(false);
  });

  test("a finding gone from its table says nothing, and is taken so too", async () => {
    jest
      .spyOn(DataStoreFindingService, "findOneBy")
      .mockResolvedValue(null as never);

    expect((await scrub("us-itin", "body")).hidesFinding).toBe(false);
  });

  test("a type its shapes are always found by is hidden whatever its row says: an email address", async () => {
    foundBy = { isFoundByContext: null, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub("email-address", "body");

    expect(onlyRuleMade().patternType).toBe(LogScrubPatternType.Email);
    expect(outcome.hidesFinding).toBe(true);
  });

  test("a ZIP code found beside its word gets the Postal Code rule, which reads the word, and is hidden", async () => {
    foundBy = { isFoundByContext: true, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub("postal-code", "body");
    const rule: LogScrubRule = onlyRuleMade();

    expect(rule.patternType).toBe(LogScrubPatternType.PostalCode);
    expect(rule.customRegex).toBeUndefined();
    expect(outcome.hidesFinding).toBe(true);
  });

  test("a lone coordinate found under its key gets the Coordinates rule, and is hidden", async () => {
    foundBy = { isFoundByContext: true, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub(
      "geolocation",
      "attributes.location.lat",
    );

    expect(onlyRuleMade().patternType).toBe(LogScrubPatternType.Coordinates);
    expect(outcome.hidesFinding).toBe(true);
  });

  test("an ITIN found beside its word in an attribute gets the rule that names the attribute, which hides it", async () => {
    foundBy = { isFoundByContext: true, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub("us-itin", "attributes.tax.ref");
    const rule: LogScrubRule = onlyRuleMade();

    expect(rule.patternType).toBe(SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE);
    expect(rule.attributeKeys).toEqual(["tax.ref"]);
    expect(outcome.hidesFinding).toBe(true);
  });

  test("the same ITIN found by its shapes in an attribute gets the narrower Custom Regex, which hides it", async () => {
    foundBy = { isFoundByContext: false, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub("us-itin", "attributes.tax.ref");

    expect(onlyRuleMade().patternType).toBe(LogScrubPatternType.Custom);
    expect(outcome.hidesFinding).toBe(true);
  });

  test("a street address the names-and-addresses model read: the attribute's rule, since no pattern reads what it found", async () => {
    foundBy = { isFoundByContext: false, isFoundByModel: true };

    const outcome: ScrubItOutcome = await scrub(
      "postal-address",
      "attributes.shipping.address",
    );

    expect(onlyRuleMade().patternType).toBe(SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE);
    expect(outcome.hidesFinding).toBe(true);
  });
});

describe("a rule that already hid it", () => {
  test("is the one answered, none is made, and it hides the finding", async () => {
    foundBy = { isFoundByContext: true, isFoundByModel: false };

    const existing: LogScrubRule = new LogScrubRule(RULE_ID);
    existing.name = "Postal codes in logs";
    existing.patternType = LogScrubPatternType.PostalCode;
    existing.fieldsToScrub = LogScrubField.Both;
    existing.isEnabled = true;
    logRules = [existing];

    const outcome: ScrubItOutcome = await scrub("postal-code", "body");

    expect(created).toEqual([]);
    expect(outcome).toEqual({
      signal: "log",
      scrubRuleId: RULE_ID.toString(),
      scrubRuleName: "Postal codes in logs",
      isProven: false,
      hidesFinding: true,
    });
  });

  test("a Custom Regex of the type's shapes does not count for a finding found beside its word: a rule is made", async () => {
    foundBy = { isFoundByContext: true, isFoundByModel: false };

    const existing: LogScrubRule = new LogScrubRule(
      new ObjectID("11502000-0000-4000-8000-000000000009"),
    );
    existing.name = "ITINs in logs";
    existing.patternType = LogScrubPatternType.Custom;
    existing.customRegex = buildScrubPatternForDataType("us-itin")!;
    existing.fieldsToScrub = LogScrubField.Both;
    existing.isEnabled = true;
    logRules = [existing];

    const outcome: ScrubItOutcome = await scrub("us-itin", "attributes.tax.ref");

    // Not the rule that keeps it: the one that names the attribute.
    expect(outcome.scrubRuleId).toBe(RULE_ID.toString());
    expect(onlyRuleMade().patternType).toBe(SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE);
    expect(outcome.hidesFinding).toBe(true);
  });
});

describe("a metric's attribute", () => {
  function filtersOf(rule: MetricPipelineRule): Array<JSONObject> {
    return (rule.filters || []).map(
      (filter: MetricPipelineRuleFilterCondition): JSONObject => {
        return {
          conditionType: filter.conditionType,
          attributeKey: filter.attributeKey,
          value: filter.value,
        } as JSONObject;
      },
    );
  }

  test("gets its rule from how it was found, which hides it: a ZIP code by the Postal Code pattern type", async () => {
    foundBy = { isFoundByContext: true, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub(
      "postal-code",
      "attributes.address.zip",
      DataStoreKind.TelemetryMetrics,
    );

    expect(createdMetricRules).toHaveLength(1);
    expect(filtersOf(createdMetricRules[0]!)).toEqual([
      {
        conditionType: MetricPipelineRuleFilterConditionType.MatchesPatternType,
        attributeKey: "address.zip",
        value: LogScrubPatternType.PostalCode,
      },
    ]);
    expect(outcome).toMatchObject({
      signal: "metric",
      isProven: false,
      hidesFinding: true,
    });
  });

  test("an ITIN found beside its word: every value under its key, since its pattern would keep it", async () => {
    foundBy = { isFoundByContext: true, isFoundByModel: false };

    const outcome: ScrubItOutcome = await scrub(
      "us-itin",
      "attributes.tax.ref",
      DataStoreKind.TelemetryMetrics,
    );

    expect(createdMetricRules).toHaveLength(1);
    expect(filtersOf(createdMetricRules[0]!)).toEqual([]);
    expect(outcome.hidesFinding).toBe(true);
  });

  test("the same ITIN found by its shapes: only the values its pattern finds", async () => {
    foundBy = { isFoundByContext: false, isFoundByModel: false };

    await scrub("us-itin", "attributes.tax.ref", DataStoreKind.TelemetryMetrics);

    expect(filtersOf(createdMetricRules[0]!)).toEqual([
      {
        conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
        attributeKey: "tax.ref",
        value: buildScrubPatternForDataType("us-itin"),
      },
    ]);
  });
});
