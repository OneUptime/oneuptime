import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  buildMonitorMetricQueryConfig,
  resolveSeriesTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorMetricQueryConfig";
import Probe from "../../../Models/DatabaseModels/Probe";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MONITOR_STEP_ID_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepSeries";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import MonitorMetricTypeUtil from "../../../Utils/Monitor/MonitorMetricType";

/*
 * The query behind every chart of a monitor's own metrics. It was moved out
 * of MonitorMetrics.tsx so the overview's response-time card builds exactly
 * the query the Metrics tab does; these pin that the move changed nothing
 * and that each series is still named after its probe, disk or interface.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const LONDON_ID: string = "33333333-3333-4333-8333-333333333333";
const OHIO_ID: string = "44444444-4444-4444-8444-444444444444";

const probe: (id: string, name: string) => Probe = (
  id: string,
  name: string,
): Probe => {
  const model: Probe = new Probe();
  model._id = id;
  model.name = name;
  return model;
};

const PROBES: Array<Probe> = [
  probe(LONDON_ID, "London"),
  probe(OHIO_ID, "Ohio"),
];

const aggregateWith: (attributes: unknown) => AggregateModel = (
  attributes: unknown,
): AggregateModel => {
  return { attributes: attributes } as unknown as AggregateModel;
};

// A monitor's steps: two URLs, or one.
const stepsOf: (count: number) => {
  monitorSteps: MonitorSteps;
  steps: Array<MonitorStep>;
} = (
  count: number,
): { monitorSteps: MonitorSteps; steps: Array<MonitorStep> } => {
  const steps: Array<MonitorStep> = [];

  for (let index: number = 0; index < count; index++) {
    steps.push(new MonitorStep());
  }

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };

  return { monitorSteps, steps };
};

// A reader of German, or of Persian, whose line takes a bullet between facts.
const readerOf: (language: string) => Translator = (
  language: string,
): Translator => {
  const words: Record<string, string> = {
    "Step {{number}}": language === "de" ? "Schritt {{number}}" : "گام {{number}}",
  };

  return {
    language: language,
    translateText: (text: string | undefined): string | undefined => {
      return text ? words[text] || text : text;
    },
    hasTranslation: (text: string): boolean => {
      return Boolean(words[text]);
    },
    translateTemplate: (
      template: string,
      values?: Record<string, unknown>,
    ): string => {
      return (words[template] || template).replace(
        "{{number}}",
        String(values?.["number"]),
      );
    },
    translatePlural: (): string => {
      return "";
    },
    translateTerm: (text: string | undefined): string => {
      return text || "";
    },
    formatNumber: (value: number): string => {
      return String(value);
    },
  } as unknown as Translator;
};

describe("buildMonitorMetricQueryConfig", () => {
  test("builds the same config MonitorMetrics used", () => {
    const config: MetricQueryConfigData = buildMonitorMetricQueryConfig({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorType: MonitorType.API,
      metric: MonitorMetricType.ResponseTime,
      probes: PROBES,
    });

    const metric: MonitorMetricType = MonitorMetricType.ResponseTime;

    expect(config.metricAliasData).toEqual({
      metricVariable: metric,
      title: MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        metric,
        MonitorType.API,
      ),
      description: MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        metric,
        MonitorType.API,
      ),
      legend: MonitorMetricTypeUtil.getLegendByMonitorMetricType(
        metric,
        MonitorType.API,
      ),
      legendUnit:
        MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(metric),
    });

    expect(config.metricQueryData).toEqual({
      filterData: {
        metricName: metric,
        attributes: {
          monitorId: MONITOR_ID.toString(),
          projectId: PROJECT_ID.toString(),
        },
        aggegationType:
          MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(metric),
      },
      groupBy: {
        attributes: true,
      },
    });

    expect(typeof config.getSeries).toBe("function");
  });

  test("with no current project the project filter is empty, as before", () => {
    const config: MetricQueryConfigData = buildMonitorMetricQueryConfig({
      monitorId: MONITOR_ID,
      projectId: null,
      monitorType: MonitorType.Server,
      metric: MonitorMetricType.CPUUsagePercent,
      probes: [],
    });

    expect(
      (
        config.metricQueryData.filterData.attributes as unknown as Record<
          string,
          string
        >
      )["projectId"],
    ).toBe("");
  });

  test("its series resolver names each probe's series", () => {
    const config: MetricQueryConfigData = buildMonitorMetricQueryConfig({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorType: MonitorType.Website,
      metric: MonitorMetricType.ResponseTime,
      probes: PROBES,
    });

    expect(config.getSeries!(aggregateWith({ probeId: LONDON_ID })).title).toBe(
      "London",
    );
  });

  test("on a monitor with several steps, its series resolver names each step's line", () => {
    const { monitorSteps, steps } = stepsOf(2);

    const config: MetricQueryConfigData = buildMonitorMetricQueryConfig({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorType: MonitorType.Website,
      metric: MonitorMetricType.ResponseTime,
      probes: PROBES,
      monitorSteps: monitorSteps,
    });

    expect(
      config.getSeries!(
        aggregateWith({
          probeId: LONDON_ID,
          [MONITOR_STEP_ID_ATTRIBUTE]: steps[1]!.id.toString(),
        }),
      ).title,
    ).toBe("London \u00B7 Step 2");
  });

  test("MonitorMetrics and the overview's card hand the builder the monitor's steps", () => {
    const read: (...segments: Array<string>) => string = (
      ...segments: Array<string>
    ): string => {
      return fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "App",
          "FeatureSet",
          "Dashboard",
          "src",
          ...segments,
        ),
        "utf8",
      );
    };

    expect(read("Components", "Monitor", "MonitorMetrics.tsx")).toContain(
      "monitorSteps: monitorSteps,",
    );
    expect(
      read("Components", "Monitor", "Overview", "MonitorResponseTimeCard.tsx"),
    ).toContain("monitorSteps: props.monitorSteps,");
    expect(read("Pages", "Monitor", "View", "Index.tsx")).toContain(
      "monitorSteps={monitor.monitorSteps}\n              responseTime=",
    );
  });

  test("MonitorMetrics builds its charts through this builder", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "Monitor",
        "MonitorMetrics.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      'import { buildMonitorMetricQueryConfig } from "./MonitorMetricQueryConfig";',
    );
    expect(source).toContain("return buildMonitorMetricQueryConfig({");
    // The copy it replaced must not drift back in.
    expect(source).not.toContain("function resolveSeriesTitle");
  });
});

describe("resolveSeriesTitle", () => {
  const fallbackTitle: string =
    MonitorMetricTypeUtil.getTitleByMonitorMetricType(
      MonitorMetricType.ResponseTime,
      MonitorType.API,
    );

  test("a probe-run monitor's series is named after its probe", () => {
    expect(
      resolveSeriesTitle({
        data: aggregateWith({ probeId: OHIO_ID }),
        monitorType: MonitorType.API,
        monitorMetricType: MonitorMetricType.ResponseTime,
        probes: PROBES,
      }).title,
    ).toBe("Ohio");
  });

  test("attributes stored as a JSON string are read too", () => {
    expect(
      resolveSeriesTitle({
        data: aggregateWith(JSON.stringify({ probeId: LONDON_ID })),
        monitorType: MonitorType.API,
        monitorMetricType: MonitorMetricType.ResponseTime,
        probes: PROBES,
      }).title,
    ).toBe("London");
  });

  test("an unknown probe, no probe id or no attributes fall back to the metric title", () => {
    for (const attributes of [
      { probeId: "55555555-5555-4555-8555-555555555555" },
      {},
      undefined,
      "not json",
    ]) {
      expect(
        resolveSeriesTitle({
          data: aggregateWith(attributes),
          monitorType: MonitorType.API,
          monitorMetricType: MonitorMetricType.ResponseTime,
          probes: PROBES,
        }).title,
      ).toBe(fallbackTitle);
    }
  });

  test("a server's series are named after the disk or the interface", () => {
    expect(
      resolveSeriesTitle({
        data: aggregateWith({ diskPath: "/var/lib/data" }),
        monitorType: MonitorType.Server,
        monitorMetricType: MonitorMetricType.DiskUsagePercent,
        probes: [],
      }).title,
    ).toBe("/var/lib/data");

    expect(
      resolveSeriesTitle({
        data: aggregateWith({ interfaceName: "eth0" }),
        monitorType: MonitorType.Server,
        monitorMetricType: MonitorMetricType.DiskUsagePercent,
        probes: [],
      }).title,
    ).toBe("eth0");
  });

  describe("a monitor with several steps (#10906)", () => {
    test("each step's line of a probe is named by its step, counted from 1", () => {
      const { monitorSteps, steps } = stepsOf(3);

      steps.forEach((step: MonitorStep, index: number) => {
        expect(
          resolveSeriesTitle({
            data: aggregateWith({
              probeId: OHIO_ID,
              [MONITOR_STEP_ID_ATTRIBUTE]: step.id.toString(),
            }),
            monitorType: MonitorType.API,
            monitorMetricType: MonitorMetricType.ResponseTime,
            probes: PROBES,
            monitorSteps: monitorSteps,
          }).title,
        ).toBe(`Ohio \u00B7 Step ${index + 1}`);
      });
    });

    test("in the reader's words, with the separator their line takes", () => {
      const { monitorSteps, steps } = stepsOf(2);
      const data: AggregateModel = aggregateWith(
        JSON.stringify({
          probeId: OHIO_ID,
          [MONITOR_STEP_ID_ATTRIBUTE]: steps[1]!.id.toString(),
        }),
      );

      expect(
        resolveSeriesTitle({
          data: data,
          monitorType: MonitorType.API,
          monitorMetricType: MonitorMetricType.ResponseTime,
          probes: PROBES,
          monitorSteps: monitorSteps,
          translator: readerOf("de"),
        }).title,
      ).toBe("Ohio \u00B7 Schritt 2");

      // Persian writes its zero as a dot: its line takes a bullet.
      expect(
        resolveSeriesTitle({
          data: data,
          monitorType: MonitorType.API,
          monitorMetricType: MonitorMetricType.ResponseTime,
          probes: PROBES,
          monitorSteps: monitorSteps,
          translator: readerOf("fa"),
        }).title,
      ).toBe("Ohio \u2022 \u06AF\u0627\u0645 2");
    });

    test("a monitor with one step, a row that names no step, or a step since removed: the probe alone", () => {
      const one: { monitorSteps: MonitorSteps; steps: Array<MonitorStep> } =
        stepsOf(1);
      const two: { monitorSteps: MonitorSteps; steps: Array<MonitorStep> } =
        stepsOf(2);

      for (const [monitorSteps, attributes] of [
        [
          one.monitorSteps,
          {
            probeId: OHIO_ID,
            [MONITOR_STEP_ID_ATTRIBUTE]: one.steps[0]!.id.toString(),
          },
        ],
        [two.monitorSteps, { probeId: OHIO_ID }],
        [
          two.monitorSteps,
          {
            probeId: OHIO_ID,
            [MONITOR_STEP_ID_ATTRIBUTE]: ObjectID.generate().toString(),
          },
        ],
        [undefined, { probeId: OHIO_ID, [MONITOR_STEP_ID_ATTRIBUTE]: "x" }],
      ] as Array<[MonitorSteps | undefined, Record<string, string>]>) {
        expect(
          resolveSeriesTitle({
            data: aggregateWith(attributes),
            monitorType: MonitorType.API,
            monitorMetricType: MonitorMetricType.ResponseTime,
            probes: PROBES,
            monitorSteps: monitorSteps,
          }).title,
        ).toBe("Ohio");
      }
    });

    test("a series named by its metric is named by its step too", () => {
      const { monitorSteps, steps } = stepsOf(2);

      expect(
        resolveSeriesTitle({
          data: aggregateWith({
            [MONITOR_STEP_ID_ATTRIBUTE]: steps[0]!.id.toString(),
          }),
          monitorType: MonitorType.API,
          monitorMetricType: MonitorMetricType.ResponseTime,
          probes: PROBES,
          monitorSteps: monitorSteps,
        }).title,
      ).toBe(`${fallbackTitle} \u00B7 Step 1`);
    });
  });

  test("a server series with neither falls back to the metric title", () => {
    expect(
      resolveSeriesTitle({
        data: aggregateWith({ host: "web-01" }),
        monitorType: MonitorType.Server,
        monitorMetricType: MonitorMetricType.CPUUsagePercent,
        probes: [],
      }).title,
    ).toBe(
      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        MonitorMetricType.CPUUsagePercent,
        MonitorType.Server,
      ),
    );
  });
});
