import ExternalStatusPageMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ExternalStatusPageMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "../../../../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Build an ExternalStatusPageMonitorResponse with sensible defaults. Every
 * field the type requires is populated so a test only needs to override the
 * single value it exercises. Defaults are chosen so they do NOT accidentally
 * satisfy the criteria under test (e.g. activeIncidentCount defaults to 0).
 */
function buildExternalStatusPageResponse(
  overrides: Partial<ExternalStatusPageMonitorResponse>,
): ExternalStatusPageMonitorResponse {
  return {
    isOnline: true,
    overallStatus: "Operational",
    componentStatuses: [],
    activeIncidentCount: 0,
    responseTimeInMs: 100,
    failureCause: "",
    ...overrides,
  };
}

/*
 * Build the ProbeMonitorResponse wrapper the evaluator receives. The
 * top-level `isOnline` / `responseTimeInMs` are deliberately kept distinct
 * from the nested externalStatusPageResponse values so precedence between the
 * two can be asserted.
 */
function buildDataToProcess(input: {
  externalStatusPageResponse?: ExternalStatusPageMonitorResponse | undefined;
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
    externalStatusPageResponse: input.externalStatusPageResponse,
    monitoredAt: new Date(),
  };
}

async function evaluate(
  dataToProcess: ProbeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess,
    criteriaFilter,
  });
}

function component(
  name: string,
  status: string,
): ExternalStatusPageComponentStatus {
  return {
    name,
    status,
  };
}

describe("ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  test("an unrelated CheckOn is not claimed by this evaluator", async () => {
    const result: string | null = await evaluate(
      buildDataToProcess({
        externalStatusPageResponse: buildExternalStatusPageResponse({}),
        responseTimeInMs: 5,
      }),
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.LessThan,
        value: 1000,
      },
    );

    expect(result).toBeNull();
  });

  describe("ExternalStatusPageIsOnline", () => {
    test("online + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({}),
          isOnline: true,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageIsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBe("External Status Page Is Online is true.");
    });

    test("offline + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({}),
          isOnline: false,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBe("External Status Page Is Online is false.");
    });

    test("offline + True → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({}),
          isOnline: false,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageIsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("online + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({}),
          isOnline: true,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * The online value is read from the top-level ProbeMonitorResponse, not
     * from the nested externalStatusPageResponse. With the top-level flag
     * missing the boolean comparison receives undefined and is undecidable.
     */
    test("undefined top-level isOnline → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            isOnline: true,
          }),
          isOnline: undefined,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageIsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * compareCriteriaBoolean only understands True / False. Any other filter
     * type (here EqualTo) is undecidable for a boolean check.
     */
    test("non-boolean filter type → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({}),
          isOnline: true,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageIsOnline,
          filterType: FilterType.EqualTo,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * The over-time block only runs when BOTH evaluateOverTime and
     * evaluateOverTimeOptions are set. With options missing the guard is
     * skipped entirely (no EvaluateOverTime / database call), and the current
     * top-level isOnline value is used — keeping this deterministic.
     */
    test("evaluateOverTime without options falls back to current value", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({}),
          isOnline: true,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageIsOnline,
          filterType: FilterType.True,
          value: undefined,
          evaluateOverTime: true,
          evaluateOverTimeOptions: undefined,
        },
      );

      expect(result).toBe("External Status Page Is Online is true.");
    });
  });

  describe("ExternalStatusPageResponseTime", () => {
    test("response time above threshold + GreaterThan → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 500,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toContain("External Status Page Response Time");
      expect(result).toContain("500");
      expect(result).toContain("greater than 100");
    });

    test("response time below threshold + GreaterThan → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 50,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toBeNull();
    });

    test("response time equal to threshold + GreaterThan → not met (boundary)", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 100,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toBeNull();
    });

    test("response time equal to threshold + GreaterThanOrEqualTo → met (boundary)", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 100,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 100,
        },
      );

      expect(result).toContain("External Status Page Response Time");
      expect(result).toContain("greater than or equal to 100");
    });

    test("response time below threshold + LessThan → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 40,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.LessThan,
          value: 100,
        },
      );

      expect(result).toContain("less than 100");
    });

    test("numeric string threshold is accepted", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 500,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: "100",
        },
      );

      expect(result).toContain("greater than 100");
    });

    test("undefined threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 500,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("non-numeric threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 500,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: "not-a-number",
        },
      );

      expect(result).toBeNull();
    });

    /*
     * The nested externalStatusPageResponse.responseTimeInMs takes precedence
     * over the top-level responseTimeInMs. Here the nested value (500) fails a
     * LessThan-100 check while the top-level value (10) would have passed — a
     * null result proves the nested value was the one compared.
     */
    test("nested response time takes precedence over top-level", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 500,
          }),
          responseTimeInMs: 10,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.LessThan,
          value: 100,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * A nested response time of 0 is falsy, so the `||` chain falls through to
     * the top-level responseTimeInMs. The message must therefore reflect the
     * top-level value (250), not 0.
     */
    test("nested response time of zero falls through to top-level value", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            responseTimeInMs: 0,
          }),
          responseTimeInMs: 250,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toContain("250");
      expect(result).toContain("greater than 100");
    });

    /*
     * When no externalStatusPageResponse is present the evaluator falls back
     * to the top-level responseTimeInMs.
     */
    test("falls back to top-level response time when external response is absent", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: undefined,
          responseTimeInMs: 250,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toContain("250");
    });

    test("no response time available → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: undefined,
          responseTimeInMs: undefined,
        }),
        {
          checkOn: CheckOn.ExternalStatusPageResponseTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("ExternalStatusPageOverallStatus", () => {
    test("no external response → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ externalStatusPageResponse: undefined }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.EqualTo,
          value: "Operational",
        },
      );

      expect(result).toBeNull();
    });

    /*
     * An empty overallStatus string is falsy and short-circuits before any
     * comparison, so the check is undecidable rather than matching an empty
     * threshold.
     */
    test("empty overall status → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.EqualTo,
          value: "",
        },
      );

      expect(result).toBeNull();
    });

    test("EqualTo exact match → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "Operational",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.EqualTo,
          value: "Operational",
        },
      );

      expect(result).toBe(
        "External Status Page Overall Status is equal to Operational.",
      );
    });

    test("EqualTo mismatch → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "Operational",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.EqualTo,
          value: "Major Outage",
        },
      );

      expect(result).toBeNull();
    });

    test("Contains substring → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "Major Outage",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.Contains,
          value: "Outage",
        },
      );

      expect(result).toContain("External Status Page Overall Status");
      expect(result).toContain("contains");
    });

    test("NotContains when substring is absent → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "Operational",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.NotContains,
          value: "Outage",
        },
      );

      expect(result).toContain("does not contain");
    });

    test("StartsWith prefix → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "Degraded Performance",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.StartsWith,
          value: "Degraded",
        },
      );

      expect(result).toContain("starts with");
    });

    test("EndsWith suffix → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "Partial Outage",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.EndsWith,
          value: "Outage",
        },
      );

      expect(result).toContain("ends with");
    });

    /*
     * A numeric filter type is not handled by the string comparator, so even a
     * present overall status is undecidable under GreaterThan.
     */
    test("numeric filter type on a string status → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "Operational",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.GreaterThan,
          value: "5",
        },
      );

      expect(result).toBeNull();
    });

    /*
     * An undefined value is coerced to the literal string "undefined" via
     * String(threshold); EqualTo against a real status therefore does not
     * match and the comparison stays deterministic without throwing.
     */
    test("undefined value coerced to string does not match a real status", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            overallStatus: "Operational",
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageOverallStatus,
          filterType: FilterType.EqualTo,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("ExternalStatusPageComponentStatus", () => {
    test("no external response → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ externalStatusPageResponse: undefined }),
        {
          checkOn: CheckOn.ExternalStatusPageComponentStatus,
          filterType: FilterType.EqualTo,
          value: "Degraded",
        },
      );

      expect(result).toBeNull();
    });

    test("empty component list → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            componentStatuses: [],
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageComponentStatus,
          filterType: FilterType.EqualTo,
          value: "Degraded",
        },
      );

      expect(result).toBeNull();
    });

    test("a single matching component → met, message names the component", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            componentStatuses: [component("API Server", "Degraded")],
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageComponentStatus,
          filterType: FilterType.EqualTo,
          value: "Degraded",
        },
      );

      expect(result).toContain('Component "API Server"');
      expect(result).toContain("is equal to Degraded");
    });

    test("no component matches → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            componentStatuses: [
              component("API Server", "Operational"),
              component("Database", "Operational"),
            ],
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageComponentStatus,
          filterType: FilterType.EqualTo,
          value: "Degraded",
        },
      );

      expect(result).toBeNull();
    });

    /*
     * The match can appear anywhere in the list; a match on a later component
     * is still reported, tagged with that component's name.
     */
    test("a match on a later component is found", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            componentStatuses: [
              component("API Server", "Operational"),
              component("Database", "Major Outage"),
            ],
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageComponentStatus,
          filterType: FilterType.EqualTo,
          value: "Major Outage",
        },
      );

      expect(result).toContain('Component "Database"');
    });

    /*
     * When more than one component satisfies the filter, the FIRST matching
     * component in iteration order is the one reported.
     */
    test("first matching component wins when several match", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            componentStatuses: [
              component("Ingest", "Degraded"),
              component("Query", "Degraded"),
            ],
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageComponentStatus,
          filterType: FilterType.EqualTo,
          value: "Degraded",
        },
      );

      expect(result).toContain('Component "Ingest"');
      expect(result).not.toContain('Component "Query"');
    });

    test("Contains match on a component status → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            componentStatuses: [component("CDN", "Partial Outage")],
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageComponentStatus,
          filterType: FilterType.Contains,
          value: "Outage",
        },
      );

      expect(result).toContain('Component "CDN"');
      expect(result).toContain("contains");
    });
  });

  describe("ExternalStatusPageActiveIncidents", () => {
    test("undefined threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            activeIncidentCount: 3,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: FilterType.GreaterThan,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("non-numeric threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            activeIncidentCount: 3,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: FilterType.GreaterThan,
          value: "lots",
        },
      );

      expect(result).toBeNull();
    });

    test("incident count above threshold + GreaterThan → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            activeIncidentCount: 3,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: FilterType.GreaterThan,
          value: 2,
        },
      );

      expect(result).toContain("External Status Page Active Incidents");
      expect(result).toContain("3");
      expect(result).toContain("greater than 2");
    });

    test("incident count equal to threshold + GreaterThan → not met (boundary)", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            activeIncidentCount: 2,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: FilterType.GreaterThan,
          value: 2,
        },
      );

      expect(result).toBeNull();
    });

    test("incident count equal to threshold + GreaterThanOrEqualTo → met (boundary)", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            activeIncidentCount: 2,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 2,
        },
      );

      expect(result).toContain("greater than or equal to 2");
    });

    /*
     * A missing externalStatusPageResponse yields an incident count of 0 (the
     * `|| 0` default), which still participates in the numeric comparison.
     * Zero is less than or equal to five, so the criterion fires.
     */
    test("absent external response defaults incident count to zero", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ externalStatusPageResponse: undefined }),
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: FilterType.LessThanOrEqualTo,
          value: 5,
        },
      );

      expect(result).toContain("0");
      expect(result).toContain("less than or equal to 5");
    });

    test("zero incidents + GreaterThan zero → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            activeIncidentCount: 0,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      );

      expect(result).toBeNull();
    });

    test("numeric string threshold is accepted", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          externalStatusPageResponse: buildExternalStatusPageResponse({
            activeIncidentCount: 4,
          }),
        }),
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: FilterType.GreaterThan,
          value: "2",
        },
      );

      expect(result).toContain("greater than 2");
    });
  });
});
