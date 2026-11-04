import ObjectID from "../ObjectID";
import FilterCondition from "../Filter/FilterCondition";
import LogSeverity from "../Log/LogSeverity";
import { CheckOn, FilterType } from "./CriteriaFilter";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorStepLogMonitor from "./MonitorStepLogMonitor";
import { OpenStackAlertTemplateArgs } from "./OpenStackAlertTemplates";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
  OpenStackLogSignal,
} from "../../Utils/OpenStack/OpenStackLogs";
import {
  OpenStackEventAttribute,
  OpenStackEventFailure,
} from "../../Utils/OpenStack/OpenStackNotifications";

/*
 * ALERTS ON WHAT AN OPENSTACK CLOUD'S SERVICES SAY.
 *
 * Some things are only ever said in a log: the scheduler finding nowhere to put an instance,
 * every service losing the message bus or the database at once, Keystone refusing tokens
 * it gave out because a controller's Fernet keys differ. The openstack_* series say nothing
 * of these. So these are Logs monitors over the cloud's records, offered on its Recommendations
 * page under their own headings: an OpenStack monitor reads metrics, and its Quick Setup
 * never lists them. They need the agent's logs profile on the cloud's machines.
 *
 * Each one reads what OpenStackLogs stamped when the line arrived: an exact attribute, so
 * it costs a monitor no search through bodies, and it means the same thing whichever
 * deployment tool wrote the line.
 *
 *   No Valid Host, RabbitMQ Connection Lost, Database Connection Lost and Token Validation
 *   Failing are one alert for the cloud. When RabbitMQ goes, every service on every machine
 *   says so at once, and one incident is what is wanted.
 *   Too Many Errors from a Service is one alert per service per machine.
 *   Instance Action Failed and Scheduling Failed are one alert per instance and reason:
 *   the reason is in the alert's own name (SeriesContextEnricher), which is the first
 *   thing anyone asks. They need notifications with driver = log, or a probe reading
 *   Nova's instance actions for a cloud that cannot turn those on.
 *
 * All of them recover: a log that stops is a group that stops breaching. These attribute
 * keys are stored in customers' logs and monitors: never rename one.
 */

export const OPENSTACK_NO_VALID_HOST_TEMPLATE_ID: string =
  "openstack-no-valid-host";
export const OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID: string =
  "openstack-rabbitmq-connection-lost";
export const OPENSTACK_DATABASE_CONNECTION_LOST_TEMPLATE_ID: string =
  "openstack-database-connection-lost";
export const OPENSTACK_TOO_MANY_ERRORS_TEMPLATE_ID: string =
  "openstack-too-many-errors-from-a-service";
export const OPENSTACK_TOKEN_VALIDATION_FAILING_TEMPLATE_ID: string =
  "openstack-token-validation-failing";
export const OPENSTACK_INSTANCE_ACTION_FAILED_TEMPLATE_ID: string =
  "openstack-instance-action-failed";
export const OPENSTACK_SCHEDULING_FAILED_TEMPLATE_ID: string =
  "openstack-scheduling-failed";

// A failure keeps its alert open this long after the last line that says so.
export const OPENSTACK_LOG_FAILURE_WINDOW_SECONDS: number = 900;

// A connection a service gets back within a few retries is not worth a page.
export const OPENSTACK_LOG_CONNECTION_WINDOW_SECONDS: number = 300;
export const OPENSTACK_RABBITMQ_LOST_MIN_LINES: number = 5;
export const OPENSTACK_DATABASE_LOST_MIN_LINES: number = 5;

/*
 * One expired token is someone's stale session. Many in five minutes is what a controller
 * whose Fernet keys differ from the others looks like.
 */
export const OPENSTACK_TOKEN_FAILING_MIN_LINES: number = 10;

export const OPENSTACK_TOO_MANY_ERRORS_WINDOW_SECONDS: number = 300;
export const OPENSTACK_TOO_MANY_ERRORS_MIN_LINES: number = 50;

export type OpenStackLogAlertTemplateCategory = "Service Logs" | "Events";

export interface OpenStackLogAlertTemplate {
  id: string;
  name: string;
  // One plain sentence: when it fires (see OpenStackAlertTemplate.summary).
  summary: string;
  description: string;
  category: OpenStackLogAlertTemplateCategory;
  severity: "Critical" | "Warning";
  getMonitorStep: (args: OpenStackAlertTemplateArgs) => MonitorStep;
}

function logMonitorOf(data: {
  cloudIdentifier: string;
  attributes: Record<string, string>;
  windowSeconds: number;
  severityTexts?: Array<LogSeverity> | undefined;
  groupBy?: Array<string> | undefined;
}): MonitorStepLogMonitor {
  return {
    attributes: {
      [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: data.cloudIdentifier,
      ...data.attributes,
    },
    body: "",
    severityTexts: data.severityTexts || [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: data.windowSeconds,
    groupByAttributes: data.groupBy ? [...data.groupBy] : undefined,
  };
}

export function buildOpenStackLogSignalMonitor(data: {
  cloudIdentifier: string;
  signal: OpenStackLogSignal;
  windowSeconds: number;
}): MonitorStepLogMonitor {
  return logMonitorOf({
    cloudIdentifier: data.cloudIdentifier,
    attributes: { [OpenStackLogAttribute.Signal]: data.signal },
    windowSeconds: data.windowSeconds,
  });
}

export function buildOpenStackTooManyErrorsMonitor(
  cloudIdentifier: string,
): MonitorStepLogMonitor {
  return logMonitorOf({
    cloudIdentifier,
    attributes: {},
    windowSeconds: OPENSTACK_TOO_MANY_ERRORS_WINDOW_SECONDS,
    severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
    groupBy: [OpenStackLogAttribute.Service, OpenStackLogAttribute.Host],
  });
}

export function buildOpenStackEventFailureMonitor(data: {
  cloudIdentifier: string;
  failure: OpenStackEventFailure;
}): MonitorStepLogMonitor {
  return logMonitorOf({
    cloudIdentifier: data.cloudIdentifier,
    attributes: { [OpenStackEventAttribute.Failure]: data.failure },
    windowSeconds: OPENSTACK_LOG_FAILURE_WINDOW_SECONDS,
    groupBy: [
      OpenStackLogAttribute.InstanceId,
      OpenStackEventAttribute.Type,
      OpenStackEventAttribute.Reason,
    ],
  });
}

function buildCriteria(data: {
  args: OpenStackAlertTemplateArgs;
  title: string;
  description: string;
  criteriaName: string;
  criteriaDescription: string;
  healthyDescription: string;
  minimumLines: number;
}): MonitorCriteria {
  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: data.minimumLines,
      },
    ],
    incidents: [
      {
        title: data.title,
        description: data.description,
        incidentSeverityId: data.args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: data.title,
        description: data.description,
        alertSeverityId: data.args.defaultAlertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    // Both, as every template ships (see ProxmoxNotificationAlertTemplates).
    createIncidents: true,
    createAlerts: true,
    name: data.criteriaName,
    description: data.criteriaDescription,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.LessThan,
        value: data.minimumLines,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: data.healthyDescription,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

function buildStep(data: {
  criteria: MonitorCriteria;
  logMonitor: MonitorStepLogMonitor;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: data.criteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: data.logMonitor,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
  };

  return monitorStep;
}

const noValidHostTemplate: OpenStackLogAlertTemplate = {
  id: OPENSTACK_NO_VALID_HOST_TEMPLATE_ID,
  name: "No Valid Host",
  summary:
    "A service says no valid host was found for an instance, in the last 15 minutes.",
  description:
    "Alert when a service logs Nova's No valid host was found: the scheduler could not place an instance. The cloud is out of room for that flavor, the hosts that could take it are down or disabled, or an aggregate or image property has ruled them all out. It resolves 15 minutes after the last such line. Needs the agent's logs profile on the controllers. It is a Logs monitor over the cloud's service logs.",
  category: "Service Logs",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const title: string = `[OpenStack] No Valid Host - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildOpenStackLogSignalMonitor({
        cloudIdentifier: args.cloudIdentifier,
        signal: OpenStackLogSignal.NoValidHost,
        windowSeconds: OPENSTACK_LOG_FAILURE_WINDOW_SECONDS,
      }),
      criteria: buildCriteria({
        args,
        title,
        description: `A service on ${args.monitorName} says no valid host was found for an instance. Open the instance's Logs tab and follow its request to the scheduler's line, which says which filter ruled the hosts out. Check capacity on the Hypervisors page, and whether hosts that could take it are down or disabled.`,
        criteriaName: `${args.monitorName} - No valid host`,
        criteriaDescription:
          "A service said no valid host was found in the last 15 minutes.",
        healthyDescription:
          "No service said no valid host was found in the last 15 minutes.",
        minimumLines: 1,
      }),
    });
  },
};

const rabbitMqLostTemplate: OpenStackLogAlertTemplate = {
  id: OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID,
  name: "RabbitMQ Connection Lost",
  summary: `Services log ${OPENSTACK_RABBITMQ_LOST_MIN_LINES} or more lines about losing the message bus in 5 minutes.`,
  description:
    "Alert when services say AMQP server is unreachable, or time out waiting for a reply on the bus (MessagingTimeout). A service keeps its own connection to RabbitMQ and says so when it loses it, even while RabbitMQ's own metrics look fine from elsewhere. One alert for the cloud, because when the bus goes every service says so at once. It resolves when they stop saying it. Needs the agent's logs profile. It is a Logs monitor over the cloud's service logs.",
  category: "Service Logs",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const title: string = `[OpenStack] RabbitMQ Connection Lost - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildOpenStackLogSignalMonitor({
        cloudIdentifier: args.cloudIdentifier,
        signal: OpenStackLogSignal.RabbitMqConnectionLost,
        windowSeconds: OPENSTACK_LOG_CONNECTION_WINDOW_SECONDS,
      }),
      criteria: buildCriteria({
        args,
        title,
        description: `Services on ${args.monitorName} say they cannot reach RabbitMQ, or that calls on the bus are timing out. Nothing that goes through the bus works meanwhile: instances stop building and agents stop answering. Check RabbitMQ's cluster and partitions first. If the bus is healthy, a MessagingTimeout usually means the service that should answer is down.`,
        criteriaName: `${args.monitorName} - RabbitMQ connection lost`,
        criteriaDescription: `Services logged ${OPENSTACK_RABBITMQ_LOST_MIN_LINES} or more lines about losing the bus in 5 minutes.`,
        healthyDescription: `Services logged fewer than ${OPENSTACK_RABBITMQ_LOST_MIN_LINES} lines about losing the bus in 5 minutes.`,
        minimumLines: OPENSTACK_RABBITMQ_LOST_MIN_LINES,
      }),
    });
  },
};

const databaseLostTemplate: OpenStackLogAlertTemplate = {
  id: OPENSTACK_DATABASE_CONNECTION_LOST_TEMPLATE_ID,
  name: "Database Connection Lost",
  summary: `Services log ${OPENSTACK_DATABASE_LOST_MIN_LINES} or more lines about losing the database in 5 minutes.`,
  description:
    "Alert when services say they lost their database: DBConnectionError, or MySQL's Lost connection and Can't connect. Every API that needs its database answers 500 meanwhile. One alert for the cloud, because when the database goes every service says so at once. It resolves when they stop saying it. Needs the agent's logs profile. It is a Logs monitor over the cloud's service logs.",
  category: "Service Logs",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const title: string = `[OpenStack] Database Connection Lost - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildOpenStackLogSignalMonitor({
        cloudIdentifier: args.cloudIdentifier,
        signal: OpenStackLogSignal.DatabaseConnectionLost,
        windowSeconds: OPENSTACK_LOG_CONNECTION_WINDOW_SECONDS,
      }),
      criteria: buildCriteria({
        args,
        title,
        description: `Services on ${args.monitorName} say they lost their database. Check Galera's quorum and each node's state, HAProxy's view of them, and whether a node is out of connections or disk.`,
        criteriaName: `${args.monitorName} - Database connection lost`,
        criteriaDescription: `Services logged ${OPENSTACK_DATABASE_LOST_MIN_LINES} or more lines about losing the database in 5 minutes.`,
        healthyDescription: `Services logged fewer than ${OPENSTACK_DATABASE_LOST_MIN_LINES} lines about losing the database in 5 minutes.`,
        minimumLines: OPENSTACK_DATABASE_LOST_MIN_LINES,
      }),
    });
  },
};

const tooManyErrorsTemplate: OpenStackLogAlertTemplate = {
  id: OPENSTACK_TOO_MANY_ERRORS_TEMPLATE_ID,
  name: "Too Many Errors from a Service",
  summary: `One service on one machine logs ${OPENSTACK_TOO_MANY_ERRORS_MIN_LINES} or more errors in 5 minutes: one alert per service and machine.`,
  description:
    "Alert when one service on one machine writes a burst of ERROR and CRITICAL lines, whatever they say: a failing service often says so here first, while its heartbeat still reads up. One alert per service and machine, which resolves when the rate falls. Needs the agent's logs profile. It is a Logs monitor over the cloud's service logs.",
  category: "Service Logs",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const title: string = `[OpenStack] Too Many Errors from a Service - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildOpenStackTooManyErrorsMonitor(args.cloudIdentifier),
      criteria: buildCriteria({
        args,
        title,
        description: `One service on ${args.monitorName} is writing many ERROR or CRITICAL lines. The service and machine are named on this alert: open that service's Logs tab to read what it says.`,
        criteriaName: `${args.monitorName} - Too many errors from a service`,
        criteriaDescription: `A service logged ${OPENSTACK_TOO_MANY_ERRORS_MIN_LINES} or more errors in 5 minutes.`,
        healthyDescription: `No service logged ${OPENSTACK_TOO_MANY_ERRORS_MIN_LINES} errors in 5 minutes.`,
        minimumLines: OPENSTACK_TOO_MANY_ERRORS_MIN_LINES,
      }),
    });
  },
};

const tokenFailingTemplate: OpenStackLogAlertTemplate = {
  id: OPENSTACK_TOKEN_VALIDATION_FAILING_TEMPLATE_ID,
  name: "Token Validation Failing",
  summary: `Services log ${OPENSTACK_TOKEN_FAILING_MIN_LINES} or more lines about tokens they cannot validate in 5 minutes.`,
  description:
    "Alert when services or Keystone say they cannot validate tokens: Keystone refusing tokens it gave out is what a controller whose Fernet keys differ from the others looks like, and users get 401 from one request in every few. One expired token is someone's stale session, so this takes several in a few minutes. It resolves when they stop. Needs the agent's logs profile. It is a Logs monitor over the cloud's service logs.",
  category: "Service Logs",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const title: string = `[OpenStack] Token Validation Failing - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildOpenStackLogSignalMonitor({
        cloudIdentifier: args.cloudIdentifier,
        signal: OpenStackLogSignal.TokenValidationFailing,
        windowSeconds: OPENSTACK_LOG_CONNECTION_WINDOW_SECONDS,
      }),
      criteria: buildCriteria({
        args,
        title,
        description: `Services on ${args.monitorName} cannot validate tokens. Compare the Fernet keys in /etc/keystone/fernet-keys on each controller: they must be identical, and a rotation that did not reach one of them is the usual cause. Check that Keystone answers, and that the controllers' clocks agree.`,
        criteriaName: `${args.monitorName} - Token validation failing`,
        criteriaDescription: `Services logged ${OPENSTACK_TOKEN_FAILING_MIN_LINES} or more lines about tokens they cannot validate in 5 minutes.`,
        healthyDescription: `Services logged fewer than ${OPENSTACK_TOKEN_FAILING_MIN_LINES} such lines in 5 minutes.`,
        minimumLines: OPENSTACK_TOKEN_FAILING_MIN_LINES,
      }),
    });
  },
};

const instanceActionFailedTemplate: OpenStackLogAlertTemplate = {
  id: OPENSTACK_INSTANCE_ACTION_FAILED_TEMPLATE_ID,
  name: "Instance Action Failed",
  summary:
    "Nova says an action on an instance failed: one alert per instance and reason, for 15 minutes.",
  description:
    "Alert when Nova says an action on an instance failed: compute.exception, or any instance.*.error, with the reason it gives named on the alert. Needs notifications with driver = log, or a probe, which reads the same from Nova's instance actions on a cloud that cannot turn those on. It is a Logs monitor over the cloud's service logs.",
  category: "Events",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const title: string = `[OpenStack] Instance Action Failed - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildOpenStackEventFailureMonitor({
        cloudIdentifier: args.cloudIdentifier,
        failure: OpenStackEventFailure.Action,
      }),
      criteria: buildCriteria({
        args,
        title,
        description: `Nova says an action on an instance of ${args.monitorName} failed. The instance and the reason Nova gave are named on this alert. The instance's Logs tab has every line of the request, across services.`,
        criteriaName: `${args.monitorName} - Instance action failed`,
        criteriaDescription:
          "Nova said an action on an instance failed in the last 15 minutes.",
        healthyDescription:
          "Nova said no action on an instance failed in the last 15 minutes.",
        minimumLines: 1,
      }),
    });
  },
};

const schedulingFailedTemplate: OpenStackLogAlertTemplate = {
  id: OPENSTACK_SCHEDULING_FAILED_TEMPLATE_ID,
  name: "Scheduling Failed",
  summary:
    "Nova says it could not schedule an instance: one alert per instance and reason, for 15 minutes.",
  description:
    "Alert when Nova's notifications, or a probe reading its instance actions, say an instance could not be scheduled, with the reason named on the alert. No Valid Host says the same from the log lines alone, on a cloud without notifications turned on. It is a Logs monitor over the cloud's service logs.",
  category: "Events",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const title: string = `[OpenStack] Scheduling Failed - ${args.monitorName}`;

    return buildStep({
      logMonitor: buildOpenStackEventFailureMonitor({
        cloudIdentifier: args.cloudIdentifier,
        failure: OpenStackEventFailure.Scheduling,
      }),
      criteria: buildCriteria({
        args,
        title,
        description: `Nova could not schedule an instance of ${args.monitorName}. The instance and the reason Nova gave are named on this alert. Check capacity on the Hypervisors page, and the scheduler's lines in the instance's Logs tab.`,
        criteriaName: `${args.monitorName} - Scheduling failed`,
        criteriaDescription:
          "Nova said it could not schedule an instance in the last 15 minutes.",
        healthyDescription:
          "Nova scheduled every instance it was asked to in the last 15 minutes.",
        minimumLines: 1,
      }),
    });
  },
};

// Every OpenStack alert built on what the cloud's services say.
export function getAllOpenStackLogAlertTemplates(): Array<OpenStackLogAlertTemplate> {
  return [
    noValidHostTemplate,
    rabbitMqLostTemplate,
    databaseLostTemplate,
    tooManyErrorsTemplate,
    tokenFailingTemplate,
    instanceActionFailedTemplate,
    schedulingFailedTemplate,
  ];
}
