import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
  MonitorOverviewLayout,
  MonitorOverviewSetupKind,
} from "../../../Utils/Monitor/MonitorOverviewFamily";
import { describe, expect, it } from "@jest/globals";

/*
 * The monitor overview decides everything type-specific through the family
 * a type belongs to. These pin the mapping against the helpers the rest of
 * the product already uses, so a type cannot quietly land in the wrong
 * family (and, say, lose its Probes card).
 */

const ALL_TYPES: Array<MonitorType> = Object.values(MonitorType);

const typesInFamily: (family: MonitorOverviewFamily) => Array<MonitorType> = (
  family: MonitorOverviewFamily,
): Array<MonitorType> => {
  return ALL_TYPES.filter((type: MonitorType) => {
    return MonitorOverviewFamilyUtil.getFamily(type) === family;
  });
};

describe("MonitorOverviewFamilyUtil.getFamily", () => {
  it.each(ALL_TYPES)("%s maps to a family", (type: MonitorType) => {
    expect(Object.values(MonitorOverviewFamily)).toContain(
      MonitorOverviewFamilyUtil.getFamily(type),
    );
  });

  it("covers all 34 monitor types", () => {
    expect(ALL_TYPES).toHaveLength(34);
  });

  it("ProbeCheck matches isProbableMonitor exactly", () => {
    const probeCheck: Array<MonitorType> = typesInFamily(
      MonitorOverviewFamily.ProbeCheck,
    );
    const probable: Array<MonitorType> = ALL_TYPES.filter(
      (type: MonitorType) => {
        return MonitorTypeHelper.isProbableMonitor(type);
      },
    );

    expect([...probeCheck].sort()).toEqual([...probable].sort());
  });

  it("TelemetrySignal plus Infrastructure match isTelemetryMonitor exactly", () => {
    const evaluated: Array<MonitorType> = [
      ...typesInFamily(MonitorOverviewFamily.TelemetrySignal),
      ...typesInFamily(MonitorOverviewFamily.Infrastructure),
    ];
    const telemetry: Array<MonitorType> = ALL_TYPES.filter(
      (type: MonitorType) => {
        return MonitorTypeHelper.isTelemetryMonitor(type);
      },
    );

    expect([...evaluated].sort()).toEqual([...telemetry].sort());
  });

  it("Manual matches isManualMonitor", () => {
    expect(typesInFamily(MonitorOverviewFamily.Manual)).toEqual(
      ALL_TYPES.filter((type: MonitorType) => {
        return MonitorTypeHelper.isManualMonitor(type);
      }),
    );
  });

  it("family sizes are 14/2/1/6/9/1/1", () => {
    expect({
      probeCheck: typesInFamily(MonitorOverviewFamily.ProbeCheck).length,
      heartbeat: typesInFamily(MonitorOverviewFamily.Heartbeat).length,
      agent: typesInFamily(MonitorOverviewFamily.Agent).length,
      telemetry: typesInFamily(MonitorOverviewFamily.TelemetrySignal).length,
      infrastructure: typesInFamily(MonitorOverviewFamily.Infrastructure)
        .length,
      networkDevice: typesInFamily(MonitorOverviewFamily.NetworkDevice).length,
      manual: typesInFamily(MonitorOverviewFamily.Manual).length,
    }).toEqual({
      probeCheck: 14,
      heartbeat: 2,
      agent: 1,
      telemetry: 6,
      infrastructure: 9,
      networkDevice: 1,
      manual: 1,
    });
  });

  it("puts the push types, the agent and network devices in their own families", () => {
    expect(typesInFamily(MonitorOverviewFamily.Heartbeat).sort()).toEqual(
      [MonitorType.IncomingEmail, MonitorType.IncomingRequest].sort(),
    );
    expect(typesInFamily(MonitorOverviewFamily.Agent)).toEqual([
      MonitorType.Server,
    ]);
    expect(typesInFamily(MonitorOverviewFamily.NetworkDevice)).toEqual([
      MonitorType.NetworkDevice,
    ]);
    expect(typesInFamily(MonitorOverviewFamily.TelemetrySignal).sort()).toEqual(
      [
        MonitorType.Logs,
        MonitorType.Metrics,
        MonitorType.Traces,
        MonitorType.Exceptions,
        MonitorType.Profiles,
        MonitorType.SecurityEvents,
      ].sort(),
    );
  });

  it("refuses a value that is not a monitor type", () => {
    expect(() => {
      MonitorOverviewFamilyUtil.getFamily("Carrier Pigeon" as MonitorType);
    }).toThrow("has no overview family");
  });
});

describe("MonitorOverviewFamilyUtil.getLayout", () => {
  it("response metric is ResponseTime for API and ExecutionTime for SyntheticMonitor and CustomJavaScriptCode and null outside ProbeCheck", () => {
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.API).responseTimeMetric,
    ).toBe(MonitorMetricType.ResponseTime);
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.Ping).responseTimeMetric,
    ).toBe(MonitorMetricType.ResponseTime);
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.SyntheticMonitor)
        .responseTimeMetric,
    ).toBe(MonitorMetricType.ExecutionTime);
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.CustomJavaScriptCode)
        .responseTimeMetric,
    ).toBe(MonitorMetricType.ExecutionTime);

    for (const type of ALL_TYPES) {
      const layout: MonitorOverviewLayout =
        MonitorOverviewFamilyUtil.getLayout(type);

      if (layout.family === MonitorOverviewFamily.ProbeCheck) {
        // Every probe check writes a response or run time series.
        expect(layout.responseTimeMetric).not.toBeNull();
      } else {
        /*
         * The Server agent and network devices write ResponseTime too, but
         * the overview's chart is for probe checks only.
         */
        expect(layout.responseTimeMetric).toBeNull();
      }
    }
  });

  it("previews only for Logs, Metrics, Traces, SecurityEvents", () => {
    const withPreview: Array<[MonitorType, string | null]> = ALL_TYPES.map(
      (type: MonitorType): [MonitorType, string | null] => {
        return [
          type,
          MonitorOverviewFamilyUtil.getLayout(type).telemetryPreview,
        ];
      },
    ).filter((entry: [MonitorType, string | null]) => {
      return entry[1] !== null;
    });

    expect(withPreview.sort()).toEqual(
      [
        [MonitorType.Logs, "Logs"],
        [MonitorType.Metrics, "Metrics"],
        [MonitorType.Traces, "Traces"],
        [MonitorType.SecurityEvents, "SecurityEvents"],
      ].sort(),
    );
  });

  it("Manual has no summary and no evaluation", () => {
    const layout: MonitorOverviewLayout = MonitorOverviewFamilyUtil.getLayout(
      MonitorType.Manual,
    );

    expect(layout.summaryDescription).toBeNull();
    expect(layout.evaluationPolicy).toBe("None");
  });

  it("evaluation policy is per probe for probe checks and latest for the rest", () => {
    for (const type of ALL_TYPES) {
      const layout: MonitorOverviewLayout =
        MonitorOverviewFamilyUtil.getLayout(type);

      if (layout.family === MonitorOverviewFamily.ProbeCheck) {
        expect(layout.evaluationPolicy).toBe("PerProbe");
      } else if (layout.family === MonitorOverviewFamily.Manual) {
        expect(layout.evaluationPolicy).toBe("None");
      } else {
        expect(layout.evaluationPolicy).toBe("Latest");
      }
    }
  });

  it("setup kind per push type", () => {
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.IncomingRequest)
        .setupKind,
    ).toBe(MonitorOverviewSetupKind.HeartbeatUrl);
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.IncomingEmail).setupKind,
    ).toBe(MonitorOverviewSetupKind.InboundEmail);
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.Server).setupKind,
    ).toBe(MonitorOverviewSetupKind.ServerAgent);

    const withSetup: Array<MonitorType> = ALL_TYPES.filter(
      (type: MonitorType) => {
        return MonitorOverviewFamilyUtil.getLayout(type).setupKind !== null;
      },
    );

    expect(withSetup).toHaveLength(3);
  });

  it("side card per family", () => {
    const expected: Record<MonitorOverviewFamily, string | null> = {
      [MonitorOverviewFamily.ProbeCheck]: "probes",
      [MonitorOverviewFamily.Heartbeat]: "connection",
      [MonitorOverviewFamily.Agent]: "connection",
      [MonitorOverviewFamily.TelemetrySignal]: null,
      [MonitorOverviewFamily.Infrastructure]: null,
      [MonitorOverviewFamily.NetworkDevice]: null,
      [MonitorOverviewFamily.Manual]: "manual",
    };

    for (const type of ALL_TYPES) {
      const layout: MonitorOverviewLayout =
        MonitorOverviewFamilyUtil.getLayout(type);

      expect(layout.sideCard).toBe(expected[layout.family]);
    }
  });

  it("summary copy per family", () => {
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.Website)
        .summaryDescription,
    ).toBe("What each probe saw on its most recent check.");
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.IncomingRequest)
        .summaryDescription,
    ).toBe("The most recent request and how the criteria judged it.");
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.IncomingEmail)
        .summaryDescription,
    ).toBe("The most recent email and how the criteria judged it.");
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.Server)
        .summaryDescription,
    ).toBe("What the agent sent in its most recent report.");
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.Logs).summaryDescription,
    ).toBe("How the criteria judged the data on the most recent evaluation.");
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.Kubernetes)
        .summaryDescription,
    ).toBe("How the criteria judged the data on the most recent evaluation.");
    expect(
      MonitorOverviewFamilyUtil.getLayout(MonitorType.NetworkDevice)
        .summaryDescription,
    ).toBe("How this monitor is evaluated.");
  });
});
