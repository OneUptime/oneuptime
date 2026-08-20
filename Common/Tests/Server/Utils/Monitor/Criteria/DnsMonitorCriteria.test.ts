import DnsMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/DnsMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import DnsMonitorResponse, {
  DnsRecordResponse,
} from "../../../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnsRecordType from "../../../../../Types/Monitor/DnsMonitor/DnsRecordType";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Build a DnsMonitorResponse with sensible defaults. Only the fields a given
 * test cares about need to be overridden; `records` is required by the type
 * so it always defaults to an empty array.
 */
function buildDnsResponse(
  overrides: Partial<DnsMonitorResponse>,
): DnsMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 42,
    failureCause: "",
    records: [],
    ...overrides,
  };
}

/*
 * Build the ProbeMonitorResponse wrapper the evaluator receives. The
 * top-level `isOnline` / `responseTimeInMs` are deliberately distinct from
 * the nested dnsResponse values so precedence can be asserted.
 */
function buildDataToProcess(input: {
  dnsResponse?: DnsMonitorResponse | undefined;
  isOnline?: boolean | undefined;
  responseTimeInMs?: number | undefined;
}): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: input.isOnline,
    responseTimeInMs: input.responseTimeInMs,
    dnsResponse: input.dnsResponse,
    monitoredAt: new Date(),
  };
}

async function evaluate(
  dataToProcess: ProbeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return DnsMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess,
    criteriaFilter,
  });
}

function record(type: DnsRecordType, value: string): DnsRecordResponse {
  return {
    type,
    value,
  };
}

describe("DnsMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  test("an unrelated CheckOn is not claimed by this evaluator", async () => {
    const result: string | null = await evaluate(
      buildDataToProcess({ dnsResponse: buildDnsResponse({}) }),
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.LessThan,
        value: 1000,
      },
    );

    expect(result).toBeNull();
  });

  describe("DnsIsOnline", () => {
    test("online + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({}),
          isOnline: true,
        }),
        {
          checkOn: CheckOn.DnsIsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("DNS Is Online");
      expect(result).toContain("true");
    });

    test("offline + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({}),
          isOnline: false,
        }),
        {
          checkOn: CheckOn.DnsIsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("offline + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({}),
          isOnline: false,
        }),
        {
          checkOn: CheckOn.DnsIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain("DNS Is Online");
      expect(result).toContain("false");
    });

    test("online + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({}),
          isOnline: true,
        }),
        {
          checkOn: CheckOn.DnsIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * The over-time block only runs when BOTH evaluateOverTime and
     * evaluateOverTimeOptions are set. With options missing the guard is
     * skipped entirely (no EvaluateOverTime call), and the current
     * top-level isOnline value is used — keeping this deterministic.
     */
    test("evaluateOverTime without options falls back to current value", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({}),
          isOnline: true,
        }),
        {
          checkOn: CheckOn.DnsIsOnline,
          filterType: FilterType.True,
          value: undefined,
          evaluateOverTime: true,
          evaluateOverTimeOptions: undefined,
        },
      );

      expect(result).toContain("DNS Is Online");
    });
  });

  describe("DnsResponseTime", () => {
    test("response time above threshold + GreaterThan → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ responseTimeInMs: 500 }),
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toContain("DNS Response Time");
      expect(result).toContain("500");
    });

    test("response time below threshold + GreaterThan → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ responseTimeInMs: 50 }),
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toBeNull();
    });

    test("response time equal to threshold + GreaterThan → not met (boundary)", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ responseTimeInMs: 100 }),
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toBeNull();
    });

    test("response time equal to threshold + GreaterThanOrEqualTo → met (boundary)", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ responseTimeInMs: 100 }),
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 100,
        },
      );

      expect(result).toContain("DNS Response Time");
    });

    test("numeric string threshold is accepted", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ responseTimeInMs: 500 }),
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: "100",
        },
      );

      expect(result).toContain("DNS Response Time");
    });

    test("undefined threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ responseTimeInMs: 500 }),
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("non-numeric threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ responseTimeInMs: 500 }),
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: "not-a-number",
        },
      );

      expect(result).toBeNull();
    });

    /*
     * The nested dnsResponse.responseTimeInMs takes precedence over the
     * top-level responseTimeInMs. Here the nested value (500) fails a
     * LessThan-100 check while the top-level value (10) would have passed —
     * a null result proves the nested value was the one compared.
     */
    test("nested dnsResponse response time takes precedence over top-level", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ responseTimeInMs: 500 }),
          responseTimeInMs: 10,
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.LessThan,
          value: 100,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * When no dnsResponse is present the evaluator falls back to the
     * top-level responseTimeInMs.
     */
    test("falls back to top-level response time when dnsResponse is absent", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: undefined,
          responseTimeInMs: 250,
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toContain("250");
    });

    test("no response time available → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: undefined,
          responseTimeInMs: undefined,
        }),
        {
          checkOn: CheckOn.DnsResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("DnsRecordExists", () => {
    test("records present + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.A, "1.1.1.1")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordExists,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe("DNS records exist for the query.");
    });

    test("no records + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ records: [] }),
        }),
        {
          checkOn: CheckOn.DnsRecordExists,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBe("No DNS records found for the query.");
    });

    test("records present + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.A, "1.1.1.1")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordExists,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("no records + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ records: [] }),
        }),
        {
          checkOn: CheckOn.DnsRecordExists,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * A neither-True-nor-False filter type is undecidable for the existence
     * check regardless of whether records are present.
     */
    test("records present + Contains (unhandled filter) → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.A, "1.1.1.1")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordExists,
          filterType: FilterType.Contains,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("DnssecIsValid", () => {
    test("valid + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ isDnssecValid: true }),
        }),
        {
          checkOn: CheckOn.DnssecIsValid,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe("DNSSEC is valid.");
    });

    test("invalid + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ isDnssecValid: false }),
        }),
        {
          checkOn: CheckOn.DnssecIsValid,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBe("DNSSEC is not valid.");
    });

    test("valid + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ isDnssecValid: true }),
        }),
        {
          checkOn: CheckOn.DnssecIsValid,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("invalid + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ isDnssecValid: false }),
        }),
        {
          checkOn: CheckOn.DnssecIsValid,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * When the DNSSEC validity is unknown (undefined) the check is
     * undecidable, even with a True filter.
     */
    test("unknown validity → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ isDnssecValid: undefined }),
        }),
        {
          checkOn: CheckOn.DnssecIsValid,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("DnsRecordValue", () => {
    test("no dnsResponse → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ dnsResponse: undefined }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.Contains,
          value: "example",
        },
      );

      expect(result).toBeNull();
    });

    test("empty records → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({ records: [] }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.Contains,
          value: "example",
        },
      );

      expect(result).toBeNull();
    });

    test("string Contains match → met with record type prefix", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [
              record(DnsRecordType.TXT, "v=spf1 include:_spf.example.com"),
            ],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.Contains,
          value: "spf1",
        },
      );

      expect(result).toContain("DNS record (TXT)");
      expect(result).toContain("contains");
    });

    test("string Contains without a match → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.TXT, "hello world")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.Contains,
          value: "missing-token",
        },
      );

      expect(result).toBeNull();
    });

    test("string EqualTo match is found across multiple records", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [
              record(DnsRecordType.NS, "ns1.example.com"),
              record(DnsRecordType.NS, "ns2.example.com"),
            ],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.EqualTo,
          value: "ns2.example.com",
        },
      );

      expect(result).toContain("DNS record (NS)");
    });

    /*
     * A numeric record value compared against a numeric threshold uses the
     * numeric branch. A TTL-like priority value of 300 is greater than 200.
     */
    test("numeric record value + GreaterThan numeric threshold → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.MX, "300")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.GreaterThan,
          value: 200,
        },
      );

      expect(result).toContain("DNS record (MX)");
      expect(result).toContain("greater than");
    });

    test("numeric record value + GreaterThan numeric threshold not exceeded → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.MX, "100")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.GreaterThan,
          value: 200,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * A non-numeric record value is skipped by the numeric branch even when
     * the threshold parses as a number, so it falls through to string
     * comparison. Here EqualTo on distinct strings does not match → null.
     */
    test("non-numeric record value with numeric threshold falls back to string compare", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.A, "192.168.1.10")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.EqualTo,
          value: "10",
        },
      );

      expect(result).toBeNull();
    });

    /*
     * A numeric record value against a numeric threshold that fails the
     * numeric comparison then falls to string comparison; LessThan is not a
     * string-handled filter type, so the overall result is undecidable.
     */
    test("numeric non-match with a string-unhandled filter → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.MX, "300")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.LessThan,
          value: 200,
        },
      );

      expect(result).toBeNull();
    });

    test("string StartsWith match → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          dnsResponse: buildDnsResponse({
            records: [record(DnsRecordType.CNAME, "target.example.net")],
          }),
        }),
        {
          checkOn: CheckOn.DnsRecordValue,
          filterType: FilterType.StartsWith,
          value: "target",
        },
      );

      expect(result).toContain("DNS record (CNAME)");
    });
  });
});
