import Probe from "Common/Models/DatabaseModels/Probe";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorStepSeries from "Common/Types/Monitor/MonitorStepSeries";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  Translator,
  fillTemplate,
  getInlineSeparator,
} from "Common/Types/Translator";
import MonitorMetricTypeUtil from "Common/Utils/Monitor/MonitorMetricType";

/*
 * How a monitor's own metric (response time, CPU, disk, ...) is charted.
 * Shared by the Metrics tab and the overview's response-time card, so the
 * two always query and label a series the same way.
 */

export type GetSeriesResolverArgs = {
  data: AggregateModel;
  monitorType: MonitorType;
  monitorMetricType: MonitorMetricType;
  probes: Array<Probe>;
  /*
   * The reader's: a series with no probe, disk or interface of its own is
   * named by its metric (a Server monitor's CPU), in their words.
   */
  translator?: Translator | undefined;
  /*
   * The monitor's steps: on a monitor with several, each step's checks are
   * a line of their own, named by the step (#10906).
   */
  monitorSteps?: MonitorSteps | undefined;
};

/*
 * One of a chart's words in the reader's language, looked up once: the
 * shared utilities write them in English, and the chart draws them as it is
 * handed them. Without a translator, the English, as the server and a unit
 * test read it.
 */
const translateChartWord: (
  text: string,
  translator: Translator | undefined,
) => string = (text: string, translator: Translator | undefined): string => {
  if (!translator || !text) {
    return text;
  }

  return translator.translateText(text) || text;
};

// A series' attributes, as the aggregate hands them: an object, or its JSON.
function readSeriesAttributes(
  data: AggregateModel | undefined,
): JSONObject | null {
  const attributes: unknown = data?.["attributes"];

  if (typeof attributes === "string") {
    try {
      return JSONFunctions.parseJSONObject(attributes);
    } catch {
      return null;
    }
  }

  return attributes && typeof attributes === "object"
    ? (attributes as JSONObject)
    : null;
}

/*
 * Shared title resolver for a chart series. Extracted so each category's
 * MetricView can reuse the same logic for probe name / disk path / interface
 * grouping without duplicating the closure.
 *
 * On a monitor with several steps, each step's checks are a series of their
 * own (their rows name their step, #10906): one probe's two steps would
 * otherwise share its name and be drawn as one line between them. Each is
 * named by its step too: "London · Step 2".
 */
export function resolveSeriesTitle(args: GetSeriesResolverArgs): ChartSeries {
  const series: ChartSeries = resolveSeriesTitleOfItsOwn(args);

  const stepNumber: number | null = MonitorStepSeries.getStepNumber({
    attributes: readSeriesAttributes(args.data),
    monitorSteps: args.monitorSteps,
  });

  if (stepNumber === null) {
    return series;
  }

  const stepName: string = args.translator
    ? args.translator.translateTemplate("Step {{number}}", {
        number: stepNumber,
      })
    : fillTemplate("Step {{number}}", { number: stepNumber });

  return {
    ...series,
    title: `${series.title}${getInlineSeparator(args.translator?.language)}${stepName}`,
  };
}

// The series' own title: its probe, disk or interface, or its metric.
function resolveSeriesTitleOfItsOwn(args: GetSeriesResolverArgs): ChartSeries {
  const { data, monitorType, monitorMetricType, probes } = args;

  const fallback: ChartSeries = {
    title: translateChartWord(
      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        monitorMetricType,
        monitorType,
      ),
      args.translator,
    ),
  };

  if (!data) {
    return fallback;
  }

  let attributes: JSONObject = data["attributes"] as JSONObject;
  if (!attributes) {
    return fallback;
  }
  if (typeof attributes === "string") {
    try {
      attributes = JSONFunctions.parseJSONObject(attributes);
    } catch {
      return fallback;
    }
  }

  /*
   * Probe-pull monitors group by probe, because the probe is the only thing
   * that varies between two rows of the same series. Database Health relies
   * on that: every one of its series is single-valued per monitor, so it
   * writes no dimension beyond probeId. A future change that fans a database
   * series out per database or per table has to extend this function first,
   * or every one of those series shares the probe's legend.
   */
  if (MonitorTypeHelper.isProbableMonitor(monitorType)) {
    const probeIdString: string | undefined = (attributes as JSONObject)[
      "probeId"
    ] as string | undefined;
    if (!probeIdString) {
      return fallback;
    }
    const probe: Probe | undefined = probes.find((p: Probe) => {
      return p.id?.toString() === new ObjectID(probeIdString).toString();
    });
    return {
      title: probe?.name?.toString() || fallback.title,
    };
  }

  if (monitorType === MonitorType.Server) {
    if (attributes["diskPath"]) {
      return { title: attributes["diskPath"].toString() };
    }
    if (attributes["interfaceName"]) {
      return { title: attributes["interfaceName"].toString() };
    }
  }

  return fallback;
}

/*
 * One chart's query: the metric, filtered to this monitor and project,
 * grouped by attributes so each probe (or disk, or interface) is its own
 * series.
 *
 * The chart draws its title, its description and its legend as it is handed
 * them (EmbeddedMetricCard, MetricCharts), and so a series named by its
 * metric, so with the reader's translator each is looked up here, once:
 * "Antwortzeit" over a German website monitor's chart (#8282), and a
 * Database monitor's metric says what it is in the reader's language, from
 * its catalog's description (#8014). Without one they read English, as the
 * server and a unit test get them. The configs are never handed through
 * chartWordsInReadersLanguage as well: a translation looked up again can be
 * an English key itself (#7790).
 */
export function buildMonitorMetricQueryConfig(data: {
  monitorId: ObjectID;
  projectId: ObjectID | null;
  monitorType: MonitorType;
  metric: MonitorMetricType;
  probes: Array<Probe>;
  translator?: Translator | undefined;
  // On a monitor with several steps, each step's checks are a line of their own.
  monitorSteps?: MonitorSteps | undefined;
}): MetricQueryConfigData {
  const monitorMetricType: MonitorMetricType = data.metric;
  const monitorType: MonitorType = data.monitorType;
  const translator: Translator | undefined = data.translator;

  return {
    metricAliasData: {
      metricVariable: monitorMetricType,
      title: translateChartWord(
        MonitorMetricTypeUtil.getTitleByMonitorMetricType(
          monitorMetricType,
          monitorType,
        ),
        translator,
      ),
      description: translateChartWord(
        MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
          monitorMetricType,
          monitorType,
        ),
        translator,
      ),
      legend: translateChartWord(
        MonitorMetricTypeUtil.getLegendByMonitorMetricType(
          monitorMetricType,
          monitorType,
        ),
        translator,
      ),
      legendUnit:
        MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
          monitorMetricType,
        ),
    },
    metricQueryData: {
      filterData: {
        metricName: monitorMetricType,
        attributes: {
          monitorId: data.monitorId.toString(),
          projectId: data.projectId?.toString() || "",
        },
        aggegationType:
          MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
            monitorMetricType,
          ),
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: (aggregate: AggregateModel): ChartSeries => {
      return resolveSeriesTitle({
        data: aggregate,
        monitorType: monitorType,
        monitorMetricType: monitorMetricType,
        probes: data.probes,
        translator: translator,
        monitorSteps: data.monitorSteps,
      });
    },
  };
}
