import DatabaseProperty from "../Database/DatabaseProperty";
import BadDataException from "../Exception/BadDataException";
import FilterCondition from "../Filter/FilterCondition";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import Typeof from "../Typeof";
import { CriteriaAlert, CriteriaAlertSchema } from "./CriteriaAlert";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
  EvaluateOverTimeType,
  CriteriaFilterUtil,
  CriteriaFilterSchema,
} from "./CriteriaFilter";
import { CriteriaIncident, CriteriaIncidentSchema } from "./CriteriaIncident";
import MonitorType from "./MonitorType";
import { FindOperator } from "typeorm";
import Zod, { ZodSchema } from "../../Utils/Schema/Zod";

export interface MonitorCriteriaInstanceType {
  monitorStatusId: ObjectID | undefined;
  filterCondition: FilterCondition;
  filters: Array<CriteriaFilter>;
  incidents: Array<CriteriaIncident>;
  alerts: Array<CriteriaAlert>;
  name: string;
  description: string;
  changeMonitorStatus?: boolean | undefined;
  createIncidents?: boolean | undefined;
  createAlerts?: boolean | undefined;
  id: string;
}

export default class MonitorCriteriaInstance extends DatabaseProperty {
  public data: MonitorCriteriaInstanceType | undefined = undefined;

  public constructor() {
    super();
    this.data = {
      id: ObjectID.generate().toString(),
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: undefined,
          value: undefined,
        },
      ],
      createIncidents: false,
      createAlerts: false,
      changeMonitorStatus: false,
      incidents: [],
      alerts: [],
      name: "",
      description: "",
    };
  }

  public static getDefaultOnlineMonitorCriteriaInstance(arg: {
    monitorType: MonitorType;
    monitorStatusId: ObjectID;
    monitorName: string;
    metricOptions?: {
      metricAliases: Array<string>;
    };
  }): MonitorCriteriaInstance | null {
    if (arg.monitorType === MonitorType.IncomingRequest) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IncomingRequest,
            filterType: FilterType.RecievedInMinutes,
            value: 30,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.IncomingEmail) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.EmailReceivedAt,
            filterType: FilterType.RecievedInMinutes,
            value: 30,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Logs) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.GreaterThan,
            value: 0, // if there are some logs then monitor is online.
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Exceptions) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.ExceptionCount,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: `Check if ${arg.monitorName} has no exceptions`,
        description: `This criteria checks if the ${arg.monitorName} has no exceptions.`,
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Metrics) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.MetricValue,
            filterType: FilterType.GreaterThan,

            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.AnyValue,
              metricAlias:
                arg.metricOptions &&
                arg.metricOptions.metricAliases &&
                arg.metricOptions.metricAliases.length > 0
                  ? arg.metricOptions.metricAliases[0]
                  : undefined,
            },
            value: 0, // if there are some logs then monitor is online.
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Traces) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SpanCount,
            filterType: FilterType.GreaterThan,
            value: 0, // if there are some logs then monitor is online.
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.SSLCertificate) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IsValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      return monitorCriteriaInstance;
    }

    if (
      arg.monitorType === MonitorType.CustomJavaScriptCode ||
      arg.monitorType === MonitorType.SyntheticMonitor
    ) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.IsEmpty,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Server) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      return monitorCriteriaInstance;
    }

    if (
      arg.monitorType === MonitorType.Website ||
      arg.monitorType === MonitorType.API ||
      arg.monitorType === MonitorType.Ping ||
      arg.monitorType === MonitorType.IP ||
      arg.monitorType === MonitorType.Port
    ) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} is online`,
      };

      if (
        arg.monitorType === MonitorType.Website ||
        arg.monitorType === MonitorType.API
      ) {
        monitorCriteriaInstance.data.filters.push({
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
          value: 200,
        });
      }

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.SNMP) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.SnmpIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} SNMP device is online`,
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.DNS) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.DnsIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: `Check if ${arg.monitorName} is online`,
        description: `This criteria checks if the ${arg.monitorName} DNS resolution is online`,
      };

      return monitorCriteriaInstance;
    }

    return null;
  }

  public static getDefaultOfflineMonitorCriteriaInstance(arg: {
    monitorType: MonitorType;
    monitorStatusId: ObjectID;
    incidentSeverityId: ObjectID;
    alertSeverityId: ObjectID;
    monitorName: string;
    metricOptions?: {
      metricAliases: Array<string>;
    };
  }): MonitorCriteriaInstance {
    const monitorCriteriaInstance: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();

    if (
      arg.monitorType === MonitorType.Ping ||
      arg.monitorType === MonitorType.IP ||
      arg.monitorType === MonitorType.Port ||
      arg.monitorType === MonitorType.Server
    ) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    if (arg.monitorType === MonitorType.SNMP) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SnmpIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} SNMP device is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} SNMP device is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} SNMP device is offline`,
      };
    }

    if (arg.monitorType === MonitorType.DNS) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.DnsIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} DNS resolution is currently failing.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} DNS resolution is currently failing.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} DNS resolution is failing`,
      };
    }

    if (
      arg.monitorType === MonitorType.API ||
      arg.monitorType === MonitorType.Website
    ) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
          {
            checkOn: CheckOn.ResponseStatusCode,
            filterType: FilterType.NotEqualTo,
            value: 200,
          },
        ],
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    if (arg.monitorType === MonitorType.Logs) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.EqualTo,
            value: 0, // if there are no logs then the monitor is offline
          },
        ],
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    if (arg.monitorType === MonitorType.Exceptions) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.ExceptionCount,
            filterType: FilterType.GreaterThan,
            value: 0,
          },
        ],
        incidents: [
          {
            title: `${arg.monitorName} has exceptions`,
            description: `${arg.monitorName} has active exceptions.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: `${arg.monitorName} has exceptions`,
            description: `${arg.monitorName} has active exceptions.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} has exceptions`,
        description: `This criteria checks if the ${arg.monitorName} has exceptions.`,
      };
    }

    if (arg.monitorType === MonitorType.Metrics) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.MetricValue,
            filterType: FilterType.EqualTo,
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.AnyValue,
              metricAlias:
                arg.metricOptions &&
                arg.metricOptions.metricAliases &&
                arg.metricOptions.metricAliases.length > 0
                  ? arg.metricOptions.metricAliases[0]
                  : undefined,
            },
            value: 0, // if there are no logs then the monitor is offline
          },
        ],
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    if (arg.monitorType === MonitorType.Traces) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SpanCount,
            filterType: FilterType.EqualTo,
            value: 0, // if there are no logs then the monitor is offline
          },
        ],
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    if (arg.monitorType === MonitorType.IncomingRequest) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.IncomingRequest,
            filterType: FilterType.NotRecievedInMinutes,
            value: 30, // if the request is not recieved in 30 minutes, then the monitor is offline
          },
        ],
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    if (arg.monitorType === MonitorType.IncomingEmail) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.EmailReceivedAt,
            filterType: FilterType.NotRecievedInMinutes,
            value: 30, // if email is not received in 30 minutes, then the monitor is offline
          },
        ],
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline. No email received.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline. No email received.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    if (
      arg.monitorType === MonitorType.CustomJavaScriptCode ||
      arg.monitorType === MonitorType.SyntheticMonitor
    ) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.IsNotEmpty,
            value: undefined,
          },
        ],
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    if (arg.monitorType === MonitorType.SSLCertificate) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        alerts: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        filters: [
          {
            checkOn: CheckOn.IsNotAValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: `${arg.monitorName} is offline`,
            description: `${arg.monitorName} is currently offline.`,
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: `Check if ${arg.monitorName} is offline`,
        description: `This criteria checks if the ${arg.monitorName} is offline`,
      };
    }

    return monitorCriteriaInstance;
  }

  public static getNewMonitorCriteriaInstanceAsJSON(): JSONObject {
    return {
      id: ObjectID.generate().toString(),
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      ],
      incidents: [],
      name: "",
      description: "",
      createIncidents: false,
      changeMonitorStatus: false,
    };
  }

  public static getValidationError(
    value: MonitorCriteriaInstance,
    monitorType: MonitorType,
  ): string | null {
    if (!value.data) {
      return `Monitor Step is required.`;
    }

    if (value.data.filters.length === 0) {
      return `Filter is required for criteria "${value.data.name}"`;
    }

    if (!value.data.name) {
      return `Name is required for criteria "${value.data.name}"`;
    }

    if (!value.data.description) {
      return `Description is required for criteria "${value.data.name}"`;
    }

    for (const incident of value.data.incidents) {
      if (!incident) {
        continue;
      }

      if (!incident.title) {
        return `Incident title is required for criteria "${value.data.name}"`;
      }

      if (!incident.description) {
        return `Incident description is required for criteria "${value.data.name}"`;
      }

      if (!incident.incidentSeverityId) {
        return `Incident severity is required for criteria "${value.data.name}"`;
      }
    }

    for (const alert of value.data.alerts) {
      if (!alert) {
        continue;
      }

      if (!alert.title) {
        return `Alert title is required for criteria "${value.data.name}"`;
      }

      if (!alert.description) {
        return `Alert description is required for criteria "${value.data.name}"`;
      }

      if (!alert.alertSeverityId) {
        return `Alert severity is required for criteria "${value.data.name}"`;
      }
    }

    for (const filter of value.data.filters) {
      if (!filter.checkOn) {
        return `Filter Type is required for criteria "${value.data.name}"`;
      }

      if (
        monitorType === MonitorType.Ping &&
        filter.checkOn !== CheckOn.IsOnline &&
        filter.checkOn !== CheckOn.ResponseTime
      ) {
        return "Ping Monitor cannot have filter type: " + filter.checkOn;
      }

      if (
        filter.checkOn === CheckOn.DiskUsagePercent &&
        !filter.serverMonitorOptions?.diskPath
      ) {
        return "Disk Path is required for Disk Usage Percent";
      }

      if (
        CriteriaFilterUtil.hasValueField({
          checkOn: filter.checkOn,
          filterType: filter.filterType,
        })
      ) {
        if (!filter.value && filter.value !== 0) {
          return `Value is required for criteria "${value.data.name}" on filter type: ${filter.checkOn}`;
        }
      }
    }

    return null;
  }

  public setName(name: string): MonitorCriteriaInstance {
    if (this.data) {
      this.data.name = name;
    }

    return this;
  }

  public setDescription(description: string): MonitorCriteriaInstance {
    if (this.data) {
      this.data.description = description;
    }

    return this;
  }

  public static clone(
    monitorCriteriaInstance: MonitorCriteriaInstance,
  ): MonitorCriteriaInstance {
    return MonitorCriteriaInstance.fromJSON(monitorCriteriaInstance.toJSON());
  }

  public setMonitorStatusId(
    monitorStatusId: ObjectID | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.monitorStatusId = monitorStatusId;
    }

    return this;
  }

  public setFilterCondition(
    filterCondition: FilterCondition,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.filterCondition = filterCondition;
    }

    return this;
  }

  public setFilters(filters: Array<CriteriaFilter>): MonitorCriteriaInstance {
    if (this.data) {
      this.data.filters = filters;
    }

    return this;
  }

  public setIncidents(
    incidents: Array<CriteriaIncident>,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.incidents = [...incidents];
    }

    return this;
  }

  public setAlerts(alerts: Array<CriteriaAlert>): MonitorCriteriaInstance {
    if (this.data) {
      this.data.alerts = [...alerts];
    }

    return this;
  }

  public setChangeMonitorStatus(
    changeMonitorStatus: boolean | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.changeMonitorStatus = changeMonitorStatus;
    }

    return this;
  }

  public setCreateIncidents(
    createIncidents: boolean | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.createIncidents = createIncidents;
    }

    return this;
  }

  public setCreateAlerts(
    createAlerts: boolean | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.createAlerts = createAlerts;
    }

    return this;
  }

  public override toJSON(): JSONObject {
    if (!this.data) {
      return MonitorCriteriaInstance.getNewMonitorCriteriaInstanceAsJSON();
    }

    return JSONFunctions.serialize({
      _type: ObjectType.MonitorCriteriaInstance,
      value: {
        id: this.data.id,
        monitorStatusId: this.data.monitorStatusId?.toString(),
        filterCondition: this.data.filterCondition,
        filters: this.data.filters,
        incidents: this.data.incidents,
        alerts: this.data.alerts,
        createAlerts: this.data.createAlerts,
        changeMonitorStatus: this.data.changeMonitorStatus,
        createIncidents: this.data.createIncidents,
        name: this.data.name,
        description: this.data.description,
      } as any,
    });
  }

  public static override fromJSON(json: JSONObject): MonitorCriteriaInstance {
    if (json instanceof MonitorCriteriaInstance) {
      return json;
    }

    if (!json) {
      throw new BadDataException("json is null");
    }

    if (!json["_type"]) {
      throw new BadDataException("json._type is null");
    }

    if (json["_type"] !== ObjectType.MonitorCriteriaInstance) {
      throw new BadDataException(
        "json._type should be MonitorCriteriaInstance",
      );
    }

    if (!json["value"]) {
      throw new BadDataException("json.value is null");
    }

    json = json["value"] as JSONObject;

    if (!json["filterCondition"]) {
      throw new BadDataException("json.filterCondition is null");
    }

    if (!json["filters"]) {
      throw new BadDataException("json.filters is null");
    }

    if (!Array.isArray(json["filters"])) {
      throw new BadDataException("json.filters should be an array");
    }

    if (!json["incidents"]) {
      json["incidents"] = [];
    }

    if (!Array.isArray(json["incidents"])) {
      throw new BadDataException("json.incidents should be an array");
    }

    if (!json["alerts"]) {
      json["alerts"] = [];
    }

    if (!Array.isArray(json["alerts"])) {
      throw new BadDataException("json.alerts should be an array");
    }

    let monitorStatusId: ObjectID | undefined = undefined;

    if (
      json["monitorStatusId"] &&
      typeof json["monitorStatusId"] === Typeof.String
    ) {
      monitorStatusId = new ObjectID(json["monitorStatusId"] as string);
    } else if (
      json["monitorStatusId"] &&
      (json["monitorStatusId"] as JSONObject)["value"] !== null
    ) {
      monitorStatusId = new ObjectID(
        (json["monitorStatusId"] as JSONObject)["value"] as string,
      );
    }

    const filterCondition: FilterCondition = json[
      "filterCondition"
    ] as FilterCondition;

    const filters: Array<CriteriaFilter> = [];

    const incidents: Array<CriteriaIncident> = [];

    for (const filter of json["filters"]) {
      filters.push({ ...(filter as any) });
    }

    for (const incident of json["incidents"]) {
      incidents.push({ ...(incident as any) });
    }

    const alerts: Array<CriteriaAlert> = [];

    for (const alert of json["alerts"]) {
      alerts.push({ ...(alert as any) });
    }

    const monitorCriteriaInstance: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();

    monitorCriteriaInstance.data = JSONFunctions.deserialize({
      id: (json["id"] as string) || ObjectID.generate().toString(),
      monitorStatusId,
      filterCondition,
      changeMonitorStatus: (json["changeMonitorStatus"] as boolean) || false,
      createIncidents: (json["createIncidents"] as boolean) || false,
      createAlerts: (json["createAlerts"] as boolean) || false,
      filters: filters as any,
      incidents: incidents as any,
      alerts: alerts as any,
      name: (json["name"] as string) || "",
      description: (json["description"] as string) || "",
    }) as any;

    return monitorCriteriaInstance;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.MonitorCriteriaInstance),
      value: Zod.object({
        id: Zod.string(),
        monitorStatusId: Zod.any(),
        filterCondition: Zod.any(),
        filters: Zod.array(CriteriaFilterSchema),
        incidents: Zod.array(CriteriaIncidentSchema),
        alerts: Zod.array(CriteriaAlertSchema),
        name: Zod.string(),
        description: Zod.string(),
        changeMonitorStatus: Zod.boolean().optional(),
        createIncidents: Zod.boolean().optional(),
        createAlerts: Zod.boolean().optional(),
      }).openapi({
        type: "object",
        example: {
          id: "id",
          monitorStatusId: "statusId",
          filterCondition: "All",
          filters: [],
          incidents: [],
          alerts: [],
          name: "Criteria Name",
          description: "Description",
        },
      }),
    }).openapi({
      type: "object",
      description: "MonitorCriteriaInstance object",
      example: {
        _type: ObjectType.MonitorCriteriaInstance,
        value: {
          id: "id",
          monitorStatusId: "statusId",
          filterCondition: "All",
          filters: [],
          incidents: [],
          alerts: [],
          name: "Criteria Name",
          description: "Description",
        },
      },
    });
  }

  public static isValid(_json: JSONObject): boolean {
    return true;
  }

  protected static override toDatabase(
    value: MonitorCriteriaInstance | FindOperator<MonitorCriteriaInstance>,
  ): JSONObject | null {
    if (value && value instanceof MonitorCriteriaInstance) {
      return (value as MonitorCriteriaInstance).toJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(
    value: JSONObject,
  ): MonitorCriteriaInstance | null {
    if (value) {
      return MonitorCriteriaInstance.fromJSON(value);
    }

    return null;
  }

  public override toString(): string {
    return JSON.stringify(this.toJSON());
  }
}
