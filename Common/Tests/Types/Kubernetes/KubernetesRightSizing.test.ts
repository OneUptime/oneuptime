import {
  MIN_RECOMMENDED_CPU_CORES,
  MIN_RECOMMENDED_MEMORY_BYTES,
  RightSizingObservation,
  RightSizingRecommendation,
  RightSizingVerdict,
  buildRightSizingRecommendation,
  formatCpuCores,
  formatMemoryBytes,
  getVerdictLabel,
  hasActionableRecommendation,
} from "../../../Types/Kubernetes/KubernetesRightSizing";
import { describe, expect, test } from "@jest/globals";

/*
 * Right-sizing turns cost-window aggregates into "set this request to that".
 * The dangerous failure is not an imprecise saving — it is advising a memory
 * request below what a container actually peaked at, which turns into an
 * OOMKill in production. So the tests below lean hardest on the cases where
 * the recommendation must refuse to answer.
 */

const MIB: number = 1024 * 1024;
const GIB: number = 1024 * MIB;

// A week of hourly windows for a single replica.
const WEEK_HOURS: number = 168;

function observation(
  overrides: Partial<RightSizingObservation> = {},
): RightSizingObservation {
  return {
    namespace: "prod",
    controllerKind: "Deployment",
    controllerName: "api",
    containerName: "api",
    sampleCount: WEEK_HOURS,
    cpuCoreRequestAverage: 1,
    cpuCoreUsageP95: 0.2,
    cpuCost: 10,
    ramBytesRequestAverage: GIB,
    ramBytesUsagePeak: 256 * MIB,
    ramCost: 6,
    ...overrides,
  };
}

describe("buildRightSizingRecommendation - CPU", () => {
  test("flags an over-provisioned request and sizes it from P95 plus headroom", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ cpuCoreRequestAverage: 1, cpuCoreUsageP95: 0.2 }),
      WEEK_HOURS,
    );

    expect(result.cpu.verdict).toBe(RightSizingVerdict.Overprovisioned);
    // 0.2 * 1.25 = 0.25 cores, already on a 10m boundary.
    expect(result.cpu.recommended).toBeCloseTo(0.25, 5);
    expect(result.cpu.current).toBe(1);
  });

  test("rounds the recommendation up to the next 10 millicores", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ cpuCoreUsageP95: 0.101 }),
      WEEK_HOURS,
    );

    // 0.101 * 1.25 = 0.12625 -> 0.13
    expect(result.cpu.recommended).toBeCloseTo(0.13, 5);
  });

  test("flags an under-provisioned request", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ cpuCoreRequestAverage: 0.1, cpuCoreUsageP95: 0.5 }),
      WEEK_HOURS,
    );

    expect(result.cpu.verdict).toBe(RightSizingVerdict.Underprovisioned);
    expect(result.cpu.recommended).toBeCloseTo(0.63, 5);
  });

  test("leaves a request inside the significance band alone", () => {
    // 0.8 * 1.25 = 1.0 exactly, so the request is already right.
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ cpuCoreRequestAverage: 1, cpuCoreUsageP95: 0.8 }),
      WEEK_HOURS,
    );

    expect(result.cpu.verdict).toBe(RightSizingVerdict.Optimal);
    expect(result.cpu.costDeltaInWindow).toBe(0);
  });

  test("never recommends below the CPU floor", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ cpuCoreRequestAverage: 0.5, cpuCoreUsageP95: 0.0001 }),
      WEEK_HOURS,
    );

    expect(result.cpu.recommended).toBe(MIN_RECOMMENDED_CPU_CORES);
  });

  test("reports a container with no request as a scheduling problem, not a saving", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({
        cpuCoreRequestAverage: 0,
        cpuCoreUsageP95: 0.4,
        ramBytesRequestAverage: 0,
      }),
      WEEK_HOURS,
    );

    expect(result.cpu.verdict).toBe(RightSizingVerdict.NoRequestSet);
    expect(result.cpu.current).toBeNull();
    expect(result.cpu.recommended).toBeCloseTo(0.5, 5);
    expect(result.cpu.costDeltaInWindow).toBe(0);
    expect(result.estimatedMonthlySavings).toBe(0);
  });
});

describe("buildRightSizingRecommendation - memory", () => {
  test("sizes memory from the peak, not the request", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({
        ramBytesRequestAverage: GIB,
        ramBytesUsagePeak: 256 * MIB,
      }),
      WEEK_HOURS,
    );

    expect(result.memory.verdict).toBe(RightSizingVerdict.Overprovisioned);
    // 256Mi * 1.25 = 320Mi, already a multiple of the 16Mi step.
    expect(result.memory.recommended).toBe(320 * MIB);
  });

  test("refuses to size memory when no peak was reported", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ ramBytesUsagePeak: 0 }),
      WEEK_HOURS,
    );

    expect(result.memory.verdict).toBe(RightSizingVerdict.Unavailable);
    expect(result.memory.recommended).toBeNull();
    expect(result.memory.costDeltaInWindow).toBe(0);
    expect(result.memory.unavailableReason).toContain("Prometheus");
  });

  test("a missing memory peak does not block the CPU recommendation", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ ramBytesUsagePeak: 0 }),
      WEEK_HOURS,
    );

    expect(result.cpu.verdict).toBe(RightSizingVerdict.Overprovisioned);
    expect(result.estimatedMonthlySavings).toBeGreaterThan(0);
  });

  test("rounds memory up to the next 16Mi", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ ramBytesUsagePeak: 100 * MIB }),
      WEEK_HOURS,
    );

    // 100Mi * 1.25 = 125Mi -> 128Mi
    expect(result.memory.recommended).toBe(128 * MIB);
  });

  test("never recommends below the memory floor", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ ramBytesUsagePeak: 1024 }),
      WEEK_HOURS,
    );

    expect(result.memory.recommended).toBe(MIN_RECOMMENDED_MEMORY_BYTES);
  });
});

describe("buildRightSizingRecommendation - confidence gate", () => {
  test("advises nothing when the window is shorter than a day", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ sampleCount: 4 }),
      4,
    );

    expect(result.cpu.verdict).toBe(RightSizingVerdict.Unavailable);
    expect(result.memory.verdict).toBe(RightSizingVerdict.Unavailable);
    expect(result.estimatedMonthlySavings).toBe(0);
    expect(hasActionableRecommendation(result)).toBe(false);
  });

  test("advises nothing when a long window holds only a few samples", () => {
    // A workload that existed for two hours of a week-long window.
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ sampleCount: 2 }),
      WEEK_HOURS,
    );

    expect(result.cpu.verdict).toBe(RightSizingVerdict.Unavailable);
    expect(result.cpu.unavailableReason).toContain("at least a day");
  });
});

describe("buildRightSizingRecommendation - savings", () => {
  test("scales the window saving to a month", () => {
    /*
     * CPU: request 1 core, P95 0.2 -> recommend 0.25, so 75% of $10 goes.
     * RAM: request 1Gi, peak 256Mi -> recommend 320Mi, so 68.75% of $6 goes.
     * Window saving = 7.5 + 4.125 = 11.625 over 168h; a 730h month is
     * 4.3452... times that window.
     */
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation(),
      WEEK_HOURS,
    );

    expect(result.cpu.costDeltaInWindow).toBeCloseTo(-7.5, 5);
    expect(result.memory.costDeltaInWindow).toBeCloseTo(-4.125, 5);
    expect(result.estimatedMonthlySavings).toBeCloseTo(11.625 * (730 / 168), 4);
    expect(result.estimatedMonthlyIncrease).toBe(0);
  });

  test("an under-provisioned workload reports an increase, never a saving", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({
        cpuCoreRequestAverage: 0.1,
        cpuCoreUsageP95: 0.5,
        ramBytesRequestAverage: 64 * MIB,
        ramBytesUsagePeak: 512 * MIB,
      }),
      WEEK_HOURS,
    );

    expect(result.estimatedMonthlySavings).toBe(0);
    expect(result.estimatedMonthlyIncrease).toBeGreaterThan(0);
  });

  test("prices the increase off actual usage when usage already exceeds the request", () => {
    /*
     * Request 0.1 but P95 usage 0.5: the engine already bills for 0.5, so
     * moving to a 0.63 request costs 26% more, not 530% more.
     */
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({
        cpuCoreRequestAverage: 0.1,
        cpuCoreUsageP95: 0.5,
        cpuCost: 10,
        ramBytesUsagePeak: 0,
      }),
      WEEK_HOURS,
    );

    expect(result.cpu.costDeltaInWindow).toBeCloseTo(10 * (0.63 / 0.5 - 1), 5);
  });

  test("a replica count in sampleCount does not inflate the monthly projection", () => {
    // Same window, same spend, three replicas' worth of rows.
    const single: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ sampleCount: WEEK_HOURS }),
      WEEK_HOURS,
    );
    const triple: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({ sampleCount: WEEK_HOURS * 3 }),
      WEEK_HOURS,
    );

    expect(triple.estimatedMonthlySavings).toBeCloseTo(
      single.estimatedMonthlySavings,
      5,
    );
  });
});

describe("hasActionableRecommendation", () => {
  test("is false when both resources are already right-sized", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({
        cpuCoreRequestAverage: 1,
        cpuCoreUsageP95: 0.8,
        ramBytesRequestAverage: 320 * MIB,
        ramBytesUsagePeak: 256 * MIB,
      }),
      WEEK_HOURS,
    );

    expect(result.cpu.verdict).toBe(RightSizingVerdict.Optimal);
    expect(result.memory.verdict).toBe(RightSizingVerdict.Optimal);
    expect(hasActionableRecommendation(result)).toBe(false);
  });

  test("is true when only one resource needs a change", () => {
    const result: RightSizingRecommendation = buildRightSizingRecommendation(
      observation({
        cpuCoreRequestAverage: 1,
        cpuCoreUsageP95: 0.8,
        ramBytesRequestAverage: GIB,
        ramBytesUsagePeak: 128 * MIB,
      }),
      WEEK_HOURS,
    );

    expect(hasActionableRecommendation(result)).toBe(true);
  });
});

describe("formatting", () => {
  test("writes sub-core CPU as millicores", () => {
    expect(formatCpuCores(0.25)).toBe("250m");
    expect(formatCpuCores(0.01)).toBe("10m");
  });

  test("writes whole cores as decimals", () => {
    expect(formatCpuCores(1)).toBe("1");
    expect(formatCpuCores(2.5)).toBe("2.5");
  });

  test("writes memory as Kubernetes binary quantities", () => {
    expect(formatMemoryBytes(320 * MIB)).toBe("320Mi");
    expect(formatMemoryBytes(2 * GIB)).toBe("2Gi");
    expect(formatMemoryBytes(1.5 * GIB)).toBe("1.5Gi");
  });

  test("renders unknown values as a dash", () => {
    expect(formatCpuCores(null)).toBe("-");
    expect(formatMemoryBytes(null)).toBe("-");
  });
});

/*
 * getVerdictLabel turns the internal verdict enum into the human string the
 * right-sizing UI renders. It is a switch with a default arm, so the failure it
 * invites is a new verdict added to the enum without a matching case — it would
 * silently render as "Unavailable". This block pins each label and, crucially,
 * that every enum member has an explicit, distinct, non-"Unavailable" label
 * except the one that is meant to be Unavailable.
 */
describe("getVerdictLabel", () => {
  const EXPECTED: Array<[RightSizingVerdict, string]> = [
    [RightSizingVerdict.Overprovisioned, "Over-provisioned"],
    [RightSizingVerdict.Underprovisioned, "Under-provisioned"],
    [RightSizingVerdict.Optimal, "Right-sized"],
    [RightSizingVerdict.NoRequestSet, "No request set"],
    [RightSizingVerdict.Unavailable, "Unavailable"],
  ];

  test.each(EXPECTED)(
    "maps %s to its label",
    (verdict: RightSizingVerdict, label: string) => {
      expect(getVerdictLabel(verdict)).toBe(label);
    },
  );

  test("every verdict produces a non-empty label", () => {
    for (const verdict of Object.values(RightSizingVerdict)) {
      const label: string = getVerdictLabel(verdict);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test('only the Unavailable verdict resolves to "Unavailable"', () => {
    /*
     * If a new verdict fell through to the default arm, more than one enum
     * member would carry the "Unavailable" label — catch that here.
     */
    const unavailableCount: number = Object.values(RightSizingVerdict).filter(
      (verdict: RightSizingVerdict) => {
        return getVerdictLabel(verdict) === "Unavailable";
      },
    ).length;
    expect(unavailableCount).toBe(1);
  });

  test("an unknown verdict falls back to Unavailable", () => {
    expect(getVerdictLabel("SomethingElse" as RightSizingVerdict)).toBe(
      "Unavailable",
    );
  });
});
