// Seeds the stack through its public API, as people build an install in the
// Dashboard: per project a user, 20 monitors (14 checked by the Probe every
// minute - one Website in eight pointed at a failing page - 2 heartbeats, 3
// telemetry monitors and a manual one), a status page with five of them, a
// telemetry ingestion key, and 20 incidents and 30 alerts, most resolved.
// Writes what the load generators need (sessions, ids, keys) to a JSON file.
//
// Usage: bash in-app.sh seed.js <projects> <out.json>
// Settings: PERF_APP_URL (http://localhost:3371), PERF_TARGET_URL - where
// the Website and API monitors point (http://172.17.0.1:3373: the Probe
// refuses loopback targets, so target-server.js listens on the docker bridge).
"use strict";

const fs = require("fs");
const MonitorSteps =
  require("/usr/src/Common/Types/Monitor/MonitorSteps").default;
const MonitorType =
  require("/usr/src/Common/Types/Monitor/MonitorType").default;
const ObjectID = require("/usr/src/Common/Types/ObjectID").default;
const URL = require("/usr/src/Common/Types/API/URL").default;
const Hostname = require("/usr/src/Common/Types/API/Hostname").default;
const Port = require("/usr/src/Common/Types/Port").default;
const MetricsAggregationType =
  require("/usr/src/Common/Types/Metrics/MetricsAggregationType").default;
const { create, getList, idOf, pool, signUp } = require("./api.js");

const PROJECTS = Number(process.argv[2] || "50");
const OUT = process.argv[3] || "seed.json";
const TARGET = process.env.PERF_TARGET_URL || "http://172.17.0.1:3373";

const PLAN = [
  {
    type: MonitorType.Website,
    count: 8,
    path: (index) => {
      return index === 7 ? `/down/site-${index}` : `/ok/site-${index}`;
    },
  },
  {
    type: MonitorType.API,
    count: 4,
    path: (index) => {
      return `/api/v1/health-${index}`;
    },
  },
  { type: MonitorType.Port, count: 2 },
  { type: MonitorType.IncomingRequest, count: 2 },
  { type: MonitorType.Logs, count: 1 },
  { type: MonitorType.Metrics, count: 1 },
  { type: MonitorType.Traces, count: 1 },
  { type: MonitorType.Manual, count: 1 },
];

function stepsFor(data) {
  const steps = MonitorSteps.getDefaultMonitorSteps({
    defaultMonitorStatusId: new ObjectID(data.operational),
    monitorType: data.type,
    monitorName: data.name,
    onlineMonitorStatusId: new ObjectID(data.operational),
    offlineMonitorStatusId: new ObjectID(data.offline),
    defaultIncidentSeverityId: new ObjectID(data.incidentSeverity),
    defaultAlertSeverityId: new ObjectID(data.alertSeverity),
  });
  const step = steps.data.monitorStepsInstanceArray[0];

  if (data.type === MonitorType.Website || data.type === MonitorType.API) {
    step.data.monitorDestination = URL.fromString(TARGET + (data.path || "/"));
  }

  if (data.type === MonitorType.Port) {
    step.data.monitorDestination = Hostname.fromString(
      new globalThis.URL(TARGET).hostname,
    );
    step.data.monitorDestinationPort = new Port(
      Number(new globalThis.URL(TARGET).port || "80"),
    );
  }

  if (data.type === MonitorType.Metrics) {
    step.data.metricMonitor.metricViewConfig = {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "a",
            title: "CPU",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: "system.cpu.utilization",
              aggegationType: MetricsAggregationType.Avg,
            },
            groupByAttributeKeys:
              data.index % 2 === 0 ? ["resource.host.name"] : undefined,
          },
        },
      ],
      formulaConfigs: [],
    };
  }

  return steps.toJSON();
}

async function firstWhere(session, path, projectId, select, predicate, sort) {
  const rows = await getList(session, path, { projectId }, select, 20, sort);
  return idOf(rows.find(predicate)._id);
}

async function seedProject(index) {
  const email = `perf-${index}-${Date.now()}@example.com`;
  const session = await signUp(email, `Perf User ${index}`);
  const projectId = await create(session, "/api/project", {
    name: `Perf Project ${index}`,
  });
  session.projectId = projectId;

  const operational = await firstWhere(
    session,
    "/api/monitor-status",
    projectId,
    { _id: true, isOperationalState: true },
    (row) => {
      return row.isOperationalState;
    },
  );
  const offline = await firstWhere(
    session,
    "/api/monitor-status",
    projectId,
    { _id: true, isOfflineState: true },
    (row) => {
      return row.isOfflineState;
    },
  );
  const incidentSeverity = idOf(
    (
      await getList(
        session,
        "/api/incident-severity",
        { projectId },
        { _id: true, order: true },
        20,
        { order: "Ascending" },
      )
    )[0]._id,
  );
  const alertSeverity = idOf(
    (
      await getList(
        session,
        "/api/alert-severity",
        { projectId },
        { _id: true, order: true },
        20,
        { order: "Ascending" },
      )
    )[0]._id,
  );

  const monitorIds = [];
  const heartbeatIds = [];

  for (const plan of PLAN) {
    for (let at = 0; at < plan.count; at++) {
      const name = `${plan.type} ${at + 1} of project ${index}`;
      const data = {
        name,
        projectId,
        monitorType: plan.type,
        monitoringInterval: "* * * * *",
        monitorSteps: stepsFor({
          type: plan.type,
          name,
          operational,
          offline,
          incidentSeverity,
          alertSeverity,
          index: at,
          path: plan.path ? plan.path(at) : undefined,
        }),
      };

      if (plan.type === MonitorType.Manual) {
        delete data.monitorSteps;
        delete data.monitoringInterval;
      }

      const id = await create(session, "/api/monitor", data);
      monitorIds.push(id);

      if (plan.type === MonitorType.IncomingRequest) {
        heartbeatIds.push(id);
      }
    }
  }

  const heartbeatKeys = [];

  for (const id of heartbeatIds) {
    const read = await session.request("POST", `/api/monitor/${id}/get-item`, {
      select: { incomingRequestSecretKey: true },
    });
    heartbeatKeys.push(
      idOf(
        ((read.json && read.json.data) || read.json).incomingRequestSecretKey,
      ),
    );
  }

  const statusPageId = await create(session, "/api/status-page", {
    name: `Status of project ${index}`,
    projectId,
    pageTitle: "Status",
  });

  for (let at = 0; at < 5; at++) {
    await create(session, "/api/status-page-resource", {
      projectId,
      statusPageId,
      monitorId: monitorIds[at],
      displayName: `Service ${at + 1}`,
      order: at + 1,
    });
  }

  const ingestionKeyId = await create(session, "/api/telemetry-ingestion-key", {
    name: "Load",
    projectId,
  });
  const ingestionKey = await session.request(
    "POST",
    `/api/telemetry-ingestion-key/${ingestionKeyId}/get-item`,
    {
      select: { secretKey: true },
    },
  );

  const incidentResolved = await firstWhere(
    session,
    "/api/incident-state",
    projectId,
    { _id: true, isResolvedState: true },
    (row) => {
      return row.isResolvedState;
    },
    { order: "Ascending" },
  );
  const alertResolved = await firstWhere(
    session,
    "/api/alert-state",
    projectId,
    { _id: true, isResolvedState: true },
    (row) => {
      return row.isResolvedState;
    },
    { order: "Ascending" },
  );

  const incidentIds = [];

  for (let at = 0; at < 20; at++) {
    incidentIds.push(
      await create(session, "/api/incident", {
        title: `Past incident ${at + 1} of project ${index}`,
        projectId,
        incidentSeverityId: incidentSeverity,
        monitors: [{ _id: monitorIds[at % 12] }],
      }),
    );
  }

  for (let at = 0; at < 18; at++) {
    await create(session, "/api/incident-state-timeline", {
      projectId,
      incidentId: incidentIds[at],
      incidentStateId: incidentResolved,
    });
  }

  const alertIds = [];

  for (let at = 0; at < 30; at++) {
    alertIds.push(
      await create(session, "/api/alert", {
        title: `Past alert ${at + 1} of project ${index}`,
        projectId,
        alertSeverityId: alertSeverity,
        monitorId: monitorIds[at % 12],
      }),
    );
  }

  for (let at = 0; at < 27; at++) {
    await create(session, "/api/alert-state-timeline", {
      projectId,
      alertId: alertIds[at],
      alertStateId: alertResolved,
    });
  }

  return {
    index,
    email,
    cookies: session.cookies,
    projectId,
    monitorIds,
    heartbeatKeys,
    ingestionKey: idOf(
      ((ingestionKey.json && ingestionKey.json.data) || ingestionKey.json)
        .secretKey,
    ),
    statusPageId,
    incidentIds,
    alertIds,
  };
}

(async () => {
  const started = Date.now();
  let done = 0;
  const projects = await pool(
    Array.from({ length: PROJECTS }, (_unused, index) => {
      return index;
    }),
    4,
    async (index) => {
      const seeded = await seedProject(index);
      done++;

      if (done % 5 === 0) {
        console.log(
          `seeded ${done} projects in ${Math.round((Date.now() - started) / 1000)} s`,
        );
      }

      return seeded;
    },
  );

  fs.writeFileSync(OUT, JSON.stringify({ projects }, null, 1));
  console.log(
    `seeded ${projects.length} projects in ${Math.round((Date.now() - started) / 1000)} s; wrote ${OUT}`,
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
