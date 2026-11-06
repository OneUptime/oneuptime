import { describe, expect, test } from "@jest/globals";
import { FINDING_FRESHNESS_IN_DAYS as WRITER_FRESHNESS_IN_DAYS } from "../../../Server/Utils/DataSecurity/DataSecurityFindingWriter";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  CheckedFinding,
  DataSecurityCheckStatus,
  DataStoreCheckInput,
  EvaluatedCheck,
  FINDING_FRESHNESS_IN_DAYS,
  MAX_DATA_TYPES_NAMED,
  MAX_NAMED_DATA_TYPE_LENGTH,
  SECRETS_IN_TELEMETRY_CHECK_ID,
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
  TELEMETRY_FINDING_CHECK_IDS,
  evaluateDataStoreChecks,
  getDataSecurityCheck,
  getDataTypeName,
  getTelemetryCheckIdOfDataType,
  isFindingCounted,
  isTelemetryFindingCheck,
  isUnscrubbedTelemetryFinding,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * WHAT A TELEMETRY ISSUE SAYS IT FOUND, AND WHICH FINDINGS IT FOUND IT IN.
 *
 * Issue #5594: "2 kind(s) of sensitive data are not scrubbed" told nobody
 * what the data was. The evidence names the data types now - the
 * catalog's names, the project's own names for its custom types - in an
 * order that does not move between evaluations, and the issue page lists
 * the findings behind it by the same rules the evaluator counts them with.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const CUSTOM_EMPLOYEE_ID: string =
  "custom:0192f1a0-0000-7000-8000-0000000c0001";
const CUSTOM_LOYALTY: string = "custom:0192f1a0-0000-7000-8000-0000000c0002";

function telemetryStore(
  overrides: Partial<DataStoreCheckInput> = {},
): DataStoreCheckInput {
  return {
    kind: DataStoreKind.TelemetryTraces,
    name: "oneuptime-app · Traces",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Restricted,
    dataTypeIds: [],
    dataCategories: [DataCategory.GovernmentId],
    posture: {},
    isPublicByDesign: false,
    hasOwner: true,
    now: NOW,
    ...overrides,
  };
}

function evidenceOf(
  input: DataStoreCheckInput,
  checkId: string,
): string | undefined {
  const result: EvaluatedCheck | undefined = evaluateDataStoreChecks(
    input,
  ).find((each: EvaluatedCheck): boolean => {
    return each.check.id === checkId;
  });

  return result?.result.status === DataSecurityCheckStatus.Fail
    ? result.result.evidence
    : undefined;
}

function finding(overrides: Partial<CheckedFinding> = {}): CheckedFinding {
  return {
    dataTypeId: "ie-ppsn",
    confidence: DataConfidence.High,
    matchCount: 12,
    isConfirmed: false,
    isAiSuggested: false,
    isScrubbed: false,
    isSuppressed: false,
    ...overrides,
  };
}

describe("the evidence of a telemetry issue", () => {
  test("names the data types the screenshot in #5594 only counted", () => {
    expect(
      evidenceOf(
        telemetryStore({ unscrubbedDataTypeIds: ["ie-ppsn", "ip-address"] }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      ),
    ).toBe(
      "2 kinds of sensitive data are not scrubbed: IP address, Ireland PPS number.",
    );
  });

  test("says one kind in the singular", () => {
    expect(
      evidenceOf(
        telemetryStore({ unscrubbedDataTypeIds: ["email-address"] }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      ),
    ).toBe("1 kind of sensitive data is not scrubbed: Email address.");
    expect(
      evidenceOf(
        telemetryStore({ unscrubbedDataTypeIds: ["github-token"] }),
        SECRETS_IN_TELEMETRY_CHECK_ID,
      ),
    ).toBe("1 kind of secret is not scrubbed: GitHub token.");
  });

  test("keeps secrets and other sensitive data apart, each in its own check", () => {
    const store: DataStoreCheckInput = telemetryStore({
      unscrubbedDataTypeIds: [
        "github-token",
        "email-address",
        "private-key",
        "ip-address",
      ],
    });

    expect(evidenceOf(store, SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID)).toBe(
      "2 kinds of sensitive data are not scrubbed: Email address, IP address.",
    );
    expect(evidenceOf(store, SECRETS_IN_TELEMETRY_CHECK_ID)).toBe(
      "2 kinds of secret are not scrubbed: GitHub token, Private key.",
    );
  });

  test("names the project's own data types by the names it gave them", () => {
    expect(
      evidenceOf(
        telemetryStore({
          unscrubbedDataTypeIds: [CUSTOM_LOYALTY, "ip-address"],
          dataTypeNames: { [CUSTOM_LOYALTY]: "  Loyalty card number " },
        }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      ),
    ).toBe(
      "2 kinds of sensitive data are not scrubbed: IP address, Loyalty card number.",
    );
  });

  test("falls back to a custom type's id when the project has no name for it", () => {
    expect(
      evidenceOf(
        telemetryStore({ unscrubbedDataTypeIds: [CUSTOM_EMPLOYEE_ID] }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      ),
    ).toBe(`1 kind of sensitive data is not scrubbed: ${CUSTOM_EMPLOYEE_ID}.`);
  });

  test(`names ${MAX_DATA_TYPES_NAMED} and counts the rest`, () => {
    const ids: Array<string> = [
      "email-address",
      "ip-address",
      "ie-ppsn",
      "us-ssn",
      "phone-number",
      "credit-card-number",
      "iban",
    ];
    const evidence: string | undefined = evidenceOf(
      telemetryStore({ unscrubbedDataTypeIds: ids }),
      SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    );

    expect(evidence).toMatch(
      /^7 kinds of sensitive data are not scrubbed: [^,]+(, [^,]+){4} and 2 more\.$/,
    );
  });

  test("counts a data type read twice once", () => {
    expect(
      evidenceOf(
        telemetryStore({
          unscrubbedDataTypeIds: ["ip-address", "ip-address", "ie-ppsn"],
        }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      ),
    ).toBe(
      "2 kinds of sensitive data are not scrubbed: IP address, Ireland PPS number.",
    );
  });

  test("reads the same whatever order the findings were read in, so an unchanged issue is not written again", () => {
    const random: SeededRandom = seededRandom(5594);
    const valueTypes: Array<string> = DATA_TYPE_CATALOG.filter(
      (info: DataTypeInfo): boolean => {
        return (
          getTelemetryCheckIdOfDataType(info.id) ===
          SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID
        );
      },
    ).map((info: DataTypeInfo): string => {
      return info.id;
    });

    for (let round: number = 0; round < 200; round++) {
      const picked: Array<string> = shuffled(valueTypes, random).slice(
        0,
        1 + random(9),
      );
      const first: string | undefined = evidenceOf(
        telemetryStore({ unscrubbedDataTypeIds: picked }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      );
      const again: string | undefined = evidenceOf(
        telemetryStore({ unscrubbedDataTypeIds: shuffled(picked, random) }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      );

      expect(again).toBe(first);
      expect(first).toBeDefined();
    }
  });

  test("stays inside the 500 characters an issue keeps, however long the project's names are", () => {
    const ids: Array<string> = [];
    const names: Record<string, string> = {};

    for (let index: number = 0; index < 9; index++) {
      const id: string = `custom:0192f1a0-0000-7000-8000-0000000c010${index}`;

      ids.push(id);
      names[id] = `${String.fromCharCode(65 + index)}${"x".repeat(400)}`;
    }

    const evidence: string = evidenceOf(
      telemetryStore({ unscrubbedDataTypeIds: ids, dataTypeNames: names }),
      SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    )!;

    expect(evidence.length).toBeLessThanOrEqual(500);
    expect(evidence).toContain("…");
    expect(evidence.endsWith(" and 4 more.")).toBe(true);
  });

  test("passes when every type is scrubbed", () => {
    expect(
      evidenceOf(
        telemetryStore({ unscrubbedDataTypeIds: [] }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      ),
    ).toBeUndefined();
    expect(
      evidenceOf(telemetryStore(), SECRETS_IN_TELEMETRY_CHECK_ID),
    ).toBeUndefined();
  });
});

describe("getDataTypeName", () => {
  test("the catalog names a built-in type, whatever the project calls an id", () => {
    expect(getDataTypeName("ie-ppsn")).toBe("Ireland PPS number");
    expect(getDataTypeName("ie-ppsn", { "ie-ppsn": "Mine" })).toBe(
      "Ireland PPS number",
    );
  });

  test("the project names its own types; an empty name is no name", () => {
    expect(
      getDataTypeName(CUSTOM_LOYALTY, { [CUSTOM_LOYALTY]: "Loyalty" }),
    ).toBe("Loyalty");
    expect(getDataTypeName(CUSTOM_LOYALTY, { [CUSTOM_LOYALTY]: "   " })).toBe(
      CUSTOM_LOYALTY,
    );
    expect(getDataTypeName(CUSTOM_LOYALTY)).toBe(CUSTOM_LOYALTY);
  });

  test(`a name longer than ${MAX_NAMED_DATA_TYPE_LENGTH} characters is cut in the evidence only`, () => {
    const long: string = "L".repeat(MAX_NAMED_DATA_TYPE_LENGTH + 20);

    expect(getDataTypeName(CUSTOM_LOYALTY, { [CUSTOM_LOYALTY]: long })).toBe(
      long,
    );
    expect(
      evidenceOf(
        telemetryStore({
          unscrubbedDataTypeIds: [CUSTOM_LOYALTY],
          dataTypeNames: { [CUSTOM_LOYALTY]: long },
        }),
        SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      ),
    ).toBe(
      `1 kind of sensitive data is not scrubbed: ${"L".repeat(MAX_NAMED_DATA_TYPE_LENGTH - 1)}….`,
    );
  });
});

describe("the findings behind a telemetry issue", () => {
  test("a finding counts once a value matched it or a person confirmed it", () => {
    expect(isFindingCounted(finding())).toBe(true);
    expect(isFindingCounted(finding({ matchCount: 0 }))).toBe(false);
    expect(isFindingCounted(finding({ matchCount: null }))).toBe(false);
    expect(
      isFindingCounted(finding({ matchCount: 0, isConfirmed: true })),
    ).toBe(true);
  });

  test("OneUptime AI's suggestion counts only once a person confirms it", () => {
    expect(
      isFindingCounted(finding({ isAiSuggested: true, matchCount: 0 })),
    ).toBe(false);
    expect(
      isFindingCounted(finding({ isAiSuggested: true, matchCount: 5 })),
    ).toBe(false);
    expect(
      isFindingCounted(
        finding({ isAiSuggested: true, matchCount: 0, isConfirmed: true }),
      ),
    ).toBe(true);
  });

  test("a finding marked not sensitive, or of no type, counts toward nothing", () => {
    expect(isFindingCounted(finding({ isSuppressed: true }))).toBe(false);
    expect(isFindingCounted(finding({ dataTypeId: "" }))).toBe(false);
    expect(isFindingCounted(finding({ dataTypeId: undefined }))).toBe(false);
  });

  test("a counted finding keeps a telemetry issue open while it is unscrubbed and at least Medium sure", () => {
    expect(isUnscrubbedTelemetryFinding(finding())).toBe(true);
    expect(
      isUnscrubbedTelemetryFinding(
        finding({ confidence: DataConfidence.Medium }),
      ),
    ).toBe(true);
    expect(
      isUnscrubbedTelemetryFinding(finding({ confidence: DataConfidence.Low })),
    ).toBe(false);
    expect(isUnscrubbedTelemetryFinding(finding({ isScrubbed: true }))).toBe(
      false,
    );
    expect(isUnscrubbedTelemetryFinding(finding({ matchCount: 0 }))).toBe(
      false,
    );
    expect(isUnscrubbedTelemetryFinding(finding({ isSuppressed: true }))).toBe(
      false,
    );
    // As the evaluator always read it: no confidence recorded is not Low.
    expect(isUnscrubbedTelemetryFinding(finding({ confidence: null }))).toBe(
      true,
    );
  });

  test("a secret belongs to the secrets check and everything else to the sensitive data check", () => {
    expect(getTelemetryCheckIdOfDataType("github-token")).toBe(
      SECRETS_IN_TELEMETRY_CHECK_ID,
    );
    expect(getTelemetryCheckIdOfDataType("private-key")).toBe(
      SECRETS_IN_TELEMETRY_CHECK_ID,
    );
    expect(getTelemetryCheckIdOfDataType("ie-ppsn")).toBe(
      SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    );
    expect(getTelemetryCheckIdOfDataType(CUSTOM_LOYALTY)).toBe(
      SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    );
  });

  test("each type's check is the one whose evidence names it", () => {
    for (const info of DATA_TYPE_CATALOG) {
      const checkId: string = getTelemetryCheckIdOfDataType(info.id);
      const otherId: string =
        checkId === SECRETS_IN_TELEMETRY_CHECK_ID
          ? SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID
          : SECRETS_IN_TELEMETRY_CHECK_ID;
      const store: DataStoreCheckInput = telemetryStore({
        unscrubbedDataTypeIds: [info.id],
      });

      expect([info.id, evidenceOf(store, checkId)]).toEqual([
        info.id,
        expect.stringContaining(info.name),
      ]);
      expect([info.id, evidenceOf(store, otherId)]).toEqual([
        info.id,
        undefined,
      ]);
    }
  });

  test("the telemetry checks are the catalog's own, and no other check is one", () => {
    for (const checkId of TELEMETRY_FINDING_CHECK_IDS) {
      expect(getDataSecurityCheck(checkId)?.id).toBe(checkId);
      expect(isTelemetryFindingCheck(checkId)).toBe(true);
    }

    expect(isTelemetryFindingCheck("public-read")).toBe(false);
    expect(isTelemetryFindingCheck(undefined)).toBe(false);
    expect(isTelemetryFindingCheck("")).toBe(false);
  });

  test("the page and the evaluator count findings for the same number of days", () => {
    expect(FINDING_FRESHNESS_IN_DAYS).toBe(30);
    expect(WRITER_FRESHNESS_IN_DAYS).toBe(FINDING_FRESHNESS_IN_DAYS);
  });
});
