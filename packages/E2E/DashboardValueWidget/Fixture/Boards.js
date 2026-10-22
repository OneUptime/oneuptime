/*
 * The fixture's dashboard and the series its Value widgets read, shared by
 * the dashboard inside OneUptime (AppFixture.js) and the public one
 * (PublicFixture.js).
 *
 * One dashboard ("Weekly signals", Past 1 Week) of Value widgets, one for
 * each shape a series can have:
 *
 *   errors     a count from a log recording rule, rising across the week
 *   latency    an average in ms, falling
 *   queue      a level that never moves
 *   requests   a sum grouped by service: three series per bucket
 *   deploys    a sparse count: most hours have no bucket at all
 *   errorRate  an average past its critical threshold (the red tint)
 *   firstRead  a metric with a single bucket
 *   silent     a metric with no data in the window
 *   external   a Data Source Value widget, its rows in no order at all
 *              (the dashboard inside OneUptime only: a public dashboard
 *              draws a placeholder for it)
 *
 * Every metric read is answered as OneUptime's metrics API answers it:
 * NEWEST bucket first (AnalyticsDatabaseService sorts an aggregate by time,
 * descending, unless the caller asks otherwise). That order is the whole
 * point of the suite: the widget used to draw it as it came, newest on the
 * left, and its arrow pointed the wrong way.
 */
import ObjectID from "Common/Types/ObjectID";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import DashboardValueComponentUtil from "Common/Utils/Dashboard/Components/DashboardValueComponent";
import DashboardDataSourceValueComponentUtil from "Common/Utils/Dashboard/Components/DashboardDataSourceValueComponent";

export const PROJECT_ID = "10000000-0000-4000-8000-0000000000f7";

export const DASHBOARD_ID = "db000000-0000-4000-8000-0000000000f7";

export const DATA_SOURCE_ID = "da000000-0000-4000-8000-0000000000f7";

export const WIDGETS = {
  errors: "c0000000-0000-4000-8000-0000000000a1",
  latency: "c0000000-0000-4000-8000-0000000000a2",
  queue: "c0000000-0000-4000-8000-0000000000a3",
  requests: "c0000000-0000-4000-8000-0000000000a4",
  deploys: "c0000000-0000-4000-8000-0000000000a5",
  errorRate: "c0000000-0000-4000-8000-0000000000a6",
  firstRead: "c0000000-0000-4000-8000-0000000000a7",
  silent: "c0000000-0000-4000-8000-0000000000a8",
  external: "c0000000-0000-4000-8000-0000000000a9",
};

export const METRICS = {
  errors: "log.errors.count",
  latency: "checkout.latency",
  queue: "queue.depth",
  requests: "http.requests",
  deploys: "deploys.count",
  errorRate: "error.rate",
  firstRead: "first.reading.count",
  silent: "disk.alerts",
};

export const METRIC_TYPES = [
  [METRICS.errors, ""],
  [METRICS.latency, "ms"],
  [METRICS.queue, ""],
  [METRICS.requests, ""],
  [METRICS.deploys, ""],
  [METRICS.errorRate, "%"],
  [METRICS.firstRead, ""],
  [METRICS.silent, ""],
];

export const SERVICES = ["checkout", "payments", "search"];

const place = (component, data) => {
  component.componentId = new ObjectID(data.id);
  component.topInDashboardUnits = data.top;
  component.leftInDashboardUnits = data.left;
  component.widthInDashboardUnits = 4;
  component.heightInDashboardUnits = 3;
  component.arguments = data.arguments;
  return component;
};

const metricValue = (data) => {
  return place(DashboardValueComponentUtil.getDefaultComponent(), {
    id: data.id,
    top: data.top,
    left: data.left,
    arguments: {
      title: data.title,
      metricQueryConfig: {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: data.metricName,
            aggegationType: data.aggregation,
          },
          ...(data.groupByAttributeKeys
            ? { groupByAttributeKeys: data.groupByAttributeKeys }
            : {}),
        },
      },
      ...(data.extra || {}),
    },
  });
};

/*
 * The dashboard's config as the server stores it. `isPublic` leaves out the
 * Data Source widget, as the public route strips it.
 */
export const buildConfig = (options) => {
  const components = [
    metricValue({
      id: WIDGETS.errors,
      top: 0,
      left: 0,
      title: "Log errors",
      metricName: METRICS.errors,
      aggregation: "Sum",
    }),
    metricValue({
      id: WIDGETS.latency,
      top: 0,
      left: 4,
      title: "Checkout latency",
      metricName: METRICS.latency,
      aggregation: "Avg",
    }),
    metricValue({
      id: WIDGETS.queue,
      top: 0,
      left: 8,
      title: "Queue depth",
      metricName: METRICS.queue,
      aggregation: "Avg",
    }),
    metricValue({
      id: WIDGETS.requests,
      top: 3,
      left: 0,
      title: "Requests",
      metricName: METRICS.requests,
      aggregation: "Sum",
      groupByAttributeKeys: ["service.name"],
    }),
    metricValue({
      id: WIDGETS.deploys,
      top: 3,
      left: 4,
      title: "Deploys",
      metricName: METRICS.deploys,
      aggregation: "Sum",
    }),
    metricValue({
      id: WIDGETS.errorRate,
      top: 3,
      left: 8,
      title: "Error rate",
      metricName: METRICS.errorRate,
      aggregation: "Avg",
      extra: { warningThreshold: 3, criticalThreshold: 5 },
    }),
    metricValue({
      id: WIDGETS.firstRead,
      top: 6,
      left: 0,
      title: "First reading",
      metricName: METRICS.firstRead,
      aggregation: "Sum",
    }),
    metricValue({
      id: WIDGETS.silent,
      top: 6,
      left: 4,
      title: "Disk alerts",
      metricName: METRICS.silent,
      aggregation: "Sum",
    }),
  ];

  if (!(options && options.isPublic)) {
    components.push(
      place(DashboardDataSourceValueComponentUtil.getDefaultComponent(), {
        id: WIDGETS.external,
        top: 6,
        left: 8,
        arguments: {
          title: "Orders (warehouse)",
          query: {
            id: "orders",
            dataSourceId: DATA_SOURCE_ID,
            query: "SELECT hour, orders FROM orders_per_hour",
          },
          reduce: "Sum",
        },
      }),
    );
  }

  return {
    _type: "DashboardViewConfig",
    components,
    heightInDashboardUnits: 9,
    timeRange: "Past 1 Week",
  };
};

/*
 * The buckets of a window, oldest first, at the interval the server picks
 * for it: one stamped at the start of each interval, the first one at or
 * before the window's start and the last one at or before its end.
 */
export const bucketsOf = (start, end) => {
  const interval = AggregationIntervalUtil.getAggregationIntervalForWindow({
    startDate: new Date(start),
    endDate: new Date(end),
  });
  const widthMs = AggregationIntervalUtil.getAggregationIntervalMs(interval);
  const first = Math.floor(start / widthMs) * widthMs;
  const buckets = [];

  for (let time = first; time <= end; time += widthMs) {
    buckets.push(time);
  }

  return buckets;
};

const round = (value, places) => {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
};

/*
 * One metric's points across [start, end], oldest first: a value per bucket
 * (several per bucket for a grouped read, none for a bucket with no data),
 * shaped by the metric. `fraction` is how far through the window a bucket
 * is, so every shape is the same whatever the clock says.
 */
export const pointsFor = (data) => {
  const buckets = bucketsOf(data.start, data.end);
  const span = Math.max(data.end - data.start, 1);
  const points = [];

  buckets.forEach((time, index) => {
    const fraction = Math.min(Math.max((time - data.start) / span, 0), 1);
    const wobble = Math.sin(index / 2.5);

    switch (data.metricName) {
      case METRICS.errors:
        points.push({
          time,
          value: Math.round(60 + 140 * fraction + 12 * wobble),
        });
        break;
      case METRICS.latency:
        points.push({
          time,
          value: round(420 - 160 * fraction + 15 * wobble, 1),
        });
        break;
      case METRICS.queue:
        points.push({ time, value: 42 });
        break;
      case METRICS.requests:
        if (data.groupByAttributeKeys && data.groupByAttributeKeys.length) {
          SERVICES.forEach((service, serviceIndex) => {
            points.push({
              time,
              value: Math.round(
                (serviceIndex + 1) * (200 + 300 * fraction) + 20 * wobble,
              ),
              attributes: { "service.name": service },
            });
          });
        } else {
          points.push({ time, value: Math.round(1200 + 1800 * fraction) });
        }
        break;
      case METRICS.deploys:
        // A deploy a day in the first half of the week, four a day after.
        if (index % (fraction < 0.5 ? 24 : 6) === 3) {
          points.push({ time, value: 1 });
        }
        break;
      case METRICS.errorRate:
        points.push({ time, value: round(5.5 + 1.5 * fraction, 2) });
        break;
      case METRICS.firstRead:
        if (index === buckets.length - 1) {
          points.push({ time, value: 7 });
        }
        break;
      case METRICS.silent:
        break;
      default:
        points.push({ time, value: Math.round(100 * fraction) });
    }
  });

  return points;
};

/*
 * The Data Source widget's rows: a rising count of orders per hour, in the
 * order a query with no ORDER BY could hand them back - here, a fixed
 * shuffle of the hours.
 */
export const externalPointsFor = (data) => {
  const buckets = bucketsOf(data.start, data.end);
  const span = Math.max(data.end - data.start, 1);
  const oldestFirst = buckets.map((time, index) => {
    const fraction = Math.min(Math.max((time - data.start) / span, 0), 1);
    return {
      time,
      value: Math.round(40 + 80 * fraction + 6 * Math.sin(index / 2)),
    };
  });
  const shuffled = [];
  const count = oldestFirst.length;

  // 37 shares no factor with any count of hours a week's window holds.
  for (let index = 0; index < count; index++) {
    shuffled.push(oldestFirst[(index * 37) % count]);
  }

  return shuffled;
};
