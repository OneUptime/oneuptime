import { describe, expect, test } from "@jest/globals";
import LogMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import LogSeverity from "../../../Types/Log/LogSeverity";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor from "../../../Types/Monitor/MonitorStepLogMonitor";
import {
  OPENSTACK_LOG_CONNECTION_WINDOW_SECONDS,
  OPENSTACK_LOG_FAILURE_WINDOW_SECONDS,
  OPENSTACK_TOO_MANY_ERRORS_MIN_LINES,
  OPENSTACK_TOO_MANY_ERRORS_WINDOW_SECONDS,
  OpenStackLogAlertTemplate,
  getAllOpenStackLogAlertTemplates,
} from "../../../Types/Monitor/OpenStackLogAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
  OpenStackLogSignal,
  OpenStackLogStamp,
  stampOpenStackLogRecord,
} from "../../../Utils/OpenStack/OpenStackLogs";
import {
  OpenStackEventAttribute,
  OpenStackEventFailure,
} from "../../../Utils/OpenStack/OpenStackNotifications";

/*
 * The alerts offered on Recommendations, built on what a cloud's services say.
 *
 * A template is its query and its numbers. What a record reads as is the same code that stamps
 * real ones: so a line below is given to the real stamp, and only then to the monitor's query.
 * Each fires and recovers through the real criteria (LogMonitorCriteria).
 * OpenStackRecordedLogs.test.ts does the same on what the rig recorded when the bus, the database
 * and the scheduler really failed.
 */

const ARGS: {
  monitorName: string;
  cloudIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorId: ObjectID;
} = {
  monitorName: "production",
  cloudIdentifier: "production",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorId: ObjectID.generate(),
};

interface Built {
  template: OpenStackLogAlertTemplate;
  step: MonitorStep;
  logMonitor: MonitorStepLogMonitor;
  fire: CriteriaFilter;
  recover: CriteriaFilter;
  unhealthy: MonitorCriteriaInstance;
  healthy: MonitorCriteriaInstance;
}

function build(template: OpenStackLogAlertTemplate): Built {
  const step: MonitorStep = template.getMonitorStep(
    ARGS as unknown as Parameters<
      OpenStackLogAlertTemplate["getMonitorStep"]
    >[0],
  );
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    template,
    step,
    logMonitor: step.data!.logMonitor as MonitorStepLogMonitor,
    fire: instances[0]!.data!.filters[0]!,
    recover: instances[1]!.data!.filters[0]!,
    unhealthy: instances[0]!,
    healthy: instances[1]!,
  };
}

function byId(id: string): Built {
  const template: OpenStackLogAlertTemplate | undefined =
    getAllOpenStackLogAlertTemplates().find(
      (candidate: OpenStackLogAlertTemplate): boolean => {
        return candidate.id === id;
      },
    );

  expect(template).toBeDefined();

  return build(template as OpenStackLogAlertTemplate);
}

function responseOf(logCount: number): LogMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    logCount,
    logQuery: {},
    monitorId: ObjectID.generate(),
  };
}

// Whether a monitor's query reads a stamped record: every attribute it names, as stored.
function queryMatches(
  logMonitor: MonitorStepLogMonitor,
  stamp: OpenStackLogStamp,
): boolean {
  const stored: Record<string, string> = {
    ...stamp.attributes,
    [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "production",
  };

  return Object.entries(logMonitor.attributes).every(
    ([key, value]: [string, unknown]): boolean => {
      return stored[key] === value;
    },
  );
}

function stampOf(body: string): OpenStackLogStamp {
  return stampOpenStackLogRecord({ attributes: {}, body, severityNumber: 0 });
}

const ALL: ReadonlyArray<OpenStackLogAlertTemplate> =
  getAllOpenStackLogAlertTemplates();

describe("every template", () => {
  test("has a unique id, starting with what its product is", () => {
    const ids: Array<string> = ALL.map(
      (template: OpenStackLogAlertTemplate): string => {
        return template.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith("openstack-")).toBe(true);
    }
  });

  test.each(
    ALL.map((template: OpenStackLogAlertTemplate) => {
      return [template.id, template] as const;
    }),
  )(
    "%s fires at its number and recovers below it, with nothing between",
    async (_id: string, template: OpenStackLogAlertTemplate) => {
      const built: Built = build(template);
      const threshold: number = Number(built.fire.value);

      expect(built.fire.checkOn).toBe(CheckOn.LogCount);
      expect(built.fire.filterType).toBe(FilterType.GreaterThanOrEqualTo);
      expect(built.recover.filterType).toBe(FilterType.LessThan);
      expect(Number(built.recover.value)).toBe(threshold);

      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: responseOf(threshold),
          criteriaFilter: built.fire,
        }),
      ).not.toBeNull();
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: responseOf(threshold),
          criteriaFilter: built.recover,
        }),
      ).toBeNull();
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: responseOf(threshold - 1),
          criteriaFilter: built.fire,
        }),
      ).toBeNull();
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: responseOf(threshold - 1),
          criteriaFilter: built.recover,
        }),
      ).not.toBeNull();
    },
  );

  test.each(
    ALL.map((template: OpenStackLogAlertTemplate) => {
      return [template.id, template] as const;
    }),
  )(
    "%s reads only this cloud's logs",
    (_id: string, template: OpenStackLogAlertTemplate) => {
      expect(build(template).logMonitor.attributes).toMatchObject({
        [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "production",
      });
    },
  );

  test.each(
    ALL.map((template: OpenStackLogAlertTemplate) => {
      return [template.id, template] as const;
    }),
  )(
    "%s opens an alert and an incident, each resolving by itself",
    (_id: string, template: OpenStackLogAlertTemplate) => {
      const built: Built = build(template);
      const data: MonitorCriteriaInstance["data"] = built.unhealthy.data;

      expect(data?.createAlerts).toBe(true);
      expect(data?.createIncidents).toBe(true);
      expect(data?.alerts[0]?.autoResolveAlert).toBe(true);
      expect(data?.incidents[0]?.autoResolveIncident).toBe(true);
      expect(data?.monitorStatusId?.toString()).toBe(
        ARGS.offlineMonitorStatusId.toString(),
      );
      expect(built.healthy.data?.monitorStatusId?.toString()).toBe(
        ARGS.onlineMonitorStatusId.toString(),
      );
    },
  );

  test.each(
    ALL.map((template: OpenStackLogAlertTemplate) => {
      return [template.id, template] as const;
    }),
  )(
    "%s says what it needs, and when it ends, in one sentence and a paragraph",
    (_id: string, template: OpenStackLogAlertTemplate) => {
      expect(template.summary.length).toBeGreaterThan(10);
      expect(template.summary.length).toBeLessThan(160);
      expect(template.description.length).toBeGreaterThan(50);
      expect(template.description).toContain("Logs monitor");
    },
  );
});

describe("what makes each one fire", () => {
  test("No Valid Host", () => {
    const built: Built = byId("openstack-no-valid-host");

    expect(built.logMonitor.lastXSecondsOfLogs).toBe(
      OPENSTACK_LOG_FAILURE_WINDOW_SECONDS,
    );
    expect(Number(built.fire.value)).toBe(1);
    expect(
      queryMatches(
        built.logMonitor,
        stampOf(
          "2026-10-30 10:00:00.123 1234 ERROR nova.conductor.manager [req-a req-b - - - - - -] Failed to schedule instances: No valid host was found. There are not enough hosts available.",
        ),
      ),
    ).toBe(true);
    expect(
      queryMatches(
        built.logMonitor,
        stampOf(
          "2026-10-30 10:00:00.123 1234 INFO nova.scheduler [-] No valid host was found",
        ),
      ),
    ).toBe(false);
  });

  test("RabbitMQ Connection Lost", () => {
    const built: Built = byId("openstack-rabbitmq-connection-lost");

    expect(built.logMonitor.lastXSecondsOfLogs).toBe(
      OPENSTACK_LOG_CONNECTION_WINDOW_SECONDS,
    );
    expect(built.logMonitor.attributes).toMatchObject({
      [OpenStackLogAttribute.Signal]: OpenStackLogSignal.RabbitMqConnectionLost,
    });

    for (const line of [
      "2026-10-30 10:00:00.123 1234 ERROR oslo.messaging._drivers.impl_rabbit [-] [abc] AMQP server on 192.0.2.1:5672 is unreachable: [Errno 111] ECONNREFUSED. Trying again in 1 seconds.",
      "2026-10-30 10:00:00.123 1234 ERROR nova.compute.manager [-] oslo_messaging.exceptions.MessagingTimeout: Timed out waiting for a reply to message ID abc",
    ]) {
      expect(queryMatches(built.logMonitor, stampOf(line))).toBe(true);
    }
  });

  test("Database Connection Lost", () => {
    const built: Built = byId("openstack-database-connection-lost");

    for (const line of [
      "2026-10-30 10:00:00.123 1234 ERROR oslo_db.sqlalchemy.engines [-] Database connection was found disconnected; reconnecting: oslo_db.exception.DBConnectionError: (pymysql.err.OperationalError) (2013, 'Lost connection to MySQL server during query')",
      "2026-10-30 10:00:00.123 1234 WARNING oslo_db.sqlalchemy.engines [-] SQL connection failed. 10 attempts left.: oslo_db.exception.DBConnectionError: (pymysql.err.OperationalError) (2003, \"Can't connect to MySQL server on '192.0.2.1'\")",
    ]) {
      expect(queryMatches(built.logMonitor, stampOf(line))).toBe(true);
    }
  });

  test("Token Validation Failing", () => {
    const built: Built = byId("openstack-token-validation-failing");

    for (const line of [
      '2026-10-30 10:00:00.123 1234 WARNING keystonemiddleware.auth_token [-] Identity response: {"error": {}} Failed to validate token',
      "2026-10-30 10:00:00.123 1234 WARNING keystone.server.flask.application [-] Authorization failed. This is not a recognized Fernet token gAAAA",
    ]) {
      expect(queryMatches(built.logMonitor, stampOf(line))).toBe(true);
    }
  });

  test("Too Many Errors from a Service reads errors, per service and machine", () => {
    const built: Built = byId("openstack-too-many-errors-from-a-service");

    expect(built.logMonitor.severityTexts).toEqual([
      LogSeverity.Error,
      LogSeverity.Fatal,
    ]);
    expect(built.logMonitor.groupByAttributes).toEqual([
      OpenStackLogAttribute.Service,
      OpenStackLogAttribute.Host,
    ]);
    expect(built.logMonitor.lastXSecondsOfLogs).toBe(
      OPENSTACK_TOO_MANY_ERRORS_WINDOW_SECONDS,
    );
    expect(Number(built.fire.value)).toBe(OPENSTACK_TOO_MANY_ERRORS_MIN_LINES);
  });

  test("one service's burst fires it, however quiet the rest of the cloud", async () => {
    const built: Built = byId("openstack-too-many-errors-from-a-service");
    const grouped: LogMonitorResponse = {
      ...responseOf(OPENSTACK_TOO_MANY_ERRORS_MIN_LINES),
      groupBreakdown: [
        { logCount: 1, groupKey: "keystone", attributes: {} },
        {
          logCount: OPENSTACK_TOO_MANY_ERRORS_MIN_LINES,
          groupKey: "nova-compute|compute-01",
          attributes: {},
        },
      ],
    } as unknown as LogMonitorResponse;

    expect(
      await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: grouped,
        criteriaFilter: built.fire,
      }),
    ).not.toBeNull();
  });

  const INSTANCE: string = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";

  function notificationLine(
    type: string,
    fields: Record<string, unknown>,
  ): string {
    return `2026-10-30 10:00:00.123 1234 ERROR oslo.messaging.notification.${type} [-] ${JSON.stringify(
      {
        event_type: type,
        priority: "ERROR",
        publisher_id: "nova-compute:compute-01",
        timestamp: "2026-10-30 10:00:00.000000",
        payload: { "nova_object.data": { uuid: INSTANCE, ...fields } },
      },
    )}`;
  }

  test("Instance Action Failed, from an action's error and compute.exception", () => {
    const built: Built = byId("openstack-instance-action-failed");

    expect(built.logMonitor.attributes).toMatchObject({
      [OpenStackEventAttribute.Failure]: OpenStackEventFailure.Action,
    });
    expect(built.logMonitor.groupByAttributes).toEqual([
      OpenStackLogAttribute.InstanceId,
      OpenStackEventAttribute.Type,
      OpenStackEventAttribute.Reason,
    ]);
    expect(
      queryMatches(
        built.logMonitor,
        stampOf(notificationLine("instance.reboot.error", {})),
      ),
    ).toBe(true);
    expect(
      queryMatches(
        built.logMonitor,
        stampOf(notificationLine("compute.exception", {})),
      ),
    ).toBe(true);
  });

  test("Scheduling Failed, from the scheduler's error and a compute task's NoValidHost", () => {
    const built: Built = byId("openstack-scheduling-failed");

    expect(
      queryMatches(
        built.logMonitor,
        stampOf(notificationLine("scheduler.select_destinations.error", {})),
      ),
    ).toBe(true);
    expect(
      queryMatches(
        built.logMonitor,
        stampOf(
          notificationLine("compute_task.build_instances.error", {
            reason: {
              "nova_object.data": {
                exception: "NoValidHost",
                exception_message: "No valid host was found.",
              },
            },
          }),
        ),
      ),
    ).toBe(true);
    // And what fails to schedule is not an action failing too.
    expect(
      queryMatches(
        byId("openstack-instance-action-failed").logMonitor,
        stampOf(notificationLine("scheduler.select_destinations.error", {})),
      ),
    ).toBe(false);
  });

  test("a success fires nothing", () => {
    const stamp: OpenStackLogStamp = stampOf(
      `2026-10-30 10:00:00.123 1234 INFO oslo.messaging.notification.instance.reboot.end [-] ${JSON.stringify(
        {
          event_type: "instance.reboot.end",
          priority: "INFO",
          payload: { "nova_object.data": { uuid: INSTANCE } },
        },
      )}`,
    );

    for (const template of ALL) {
      if (template.id !== "openstack-too-many-errors-from-a-service") {
        expect(queryMatches(build(template).logMonitor, stamp)).toBe(false);
      }
    }
  });
});

describe("what each one's alert says", () => {
  test.each(
    ALL.map((template: OpenStackLogAlertTemplate) => {
      return [template.id, template] as const;
    }),
  )(
    "%s names the cloud, and takes no text from a log",
    (_id: string, template: OpenStackLogAlertTemplate) => {
      const built: Built = build(template);
      const alert: { title: string; description: string } = built.unhealthy
        .data!.alerts[0] as unknown as { title: string; description: string };

      expect(alert.title).toContain("[OpenStack]");
      expect(alert.title).toContain("production");
      expect(alert.description).toContain("production");
    },
  );
});
