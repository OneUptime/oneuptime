import Zod, { ZodSchema } from "./Zod";
import { ObjectType } from "../../Types/JSON";
import MonitorTemplateSyncFieldUtil from "../../Types/Monitor/MonitorTemplateSyncField";

/*
 * The API schemas of the monitor Types: a monitor's steps (MonitorSteps,
 * MonitorStep) and its criteria (MonitorCriteria, MonitorCriteriaInstance,
 * and what a criteria holds - filters, incidents, alerts, incident grouping).
 *
 * They used to sit on the Types themselves, and the criteria ones were made
 * as their modules loaded - so every page of every frontend loaded zod and
 * made those schemas, for nothing: no browser reads them. Only the server
 * loads this module (TypeSchemas.ts says more).
 *
 * The keys of each object schema here are the fields of its Type's interface
 * (MonitorStepType, CriteriaFilter and the rest), less the ones the server
 * fills in while it evaluates and never stores: Tests/Utils/Schema/
 * MonitorSchemas reads both and fails when a field is added to one and not
 * the other. (It found exceptionMonitor, which the Exceptions monitor stores
 * in its step and the API reference never listed.)
 */

export const CriteriaFilterSchema: ZodSchema = Zod.object({
  checkOn: Zod.string(),
  serverMonitorOptions: Zod.object({
    diskPath: Zod.string().optional(),
  }).optional(),
  metricMonitorOptions: Zod.object({
    metricAlias: Zod.string().optional(),
    metricAggregationType: Zod.string().optional(),
    onNoDataPolicy: Zod.string().optional(),
    thresholdUnit: Zod.string().optional(),
    anomalyDetection: Zod.object({
      sensitivity: Zod.string().optional(),
      method: Zod.string().optional(),
      windowDays: Zod.number().optional(),
      minSamples: Zod.number().optional(),
    }).optional(),
  }).optional(),
  snmpMonitorOptions: Zod.object({
    oid: Zod.string().optional(),
    interfaceName: Zod.string().optional(),
    tableKey: Zod.string().optional(),
    tableColumnOid: Zod.string().optional(),
    tableRow: Zod.string().optional(),
    transceiverReading: Zod.string().optional(),
  }).optional(),
  databaseMonitorOptions: Zod.object({
    metricType: Zod.string().optional(),
  }).optional(),
  customCodeMonitorOptions: Zod.object({
    resultValuePath: Zod.string().optional(),
  }).optional(),
  filterType: Zod.string().optional(),
  value: Zod.union([Zod.string(), Zod.number()]).optional(),
  evaluateOverTime: Zod.boolean().optional(),
  evaluateOverTimeOptions: Zod.object({
    timeValueInMinutes: Zod.number().optional(),
    evaluateOverTimeType: Zod.string().optional(),
    onNoDataPolicy: Zod.string().optional(),
  }).optional(),
});

export const CriteriaIncidentSchema: ZodSchema = Zod.object({
  title: Zod.string(),
  description: Zod.string(),
  incidentSeverityId: Zod.any().optional(),
  autoResolveIncident: Zod.boolean().optional(),
  remediationNotes: Zod.string().optional(),
  id: Zod.string(),
  onCallPolicyIds: Zod.array(Zod.any()).optional(),
  labelIds: Zod.array(Zod.any()).optional(),
  ownerTeamIds: Zod.array(Zod.any()).optional(),
  ownerUserIds: Zod.array(Zod.any()).optional(),
  incidentMemberRoles: Zod.array(
    Zod.object({
      roleId: Zod.any(),
      userId: Zod.any(),
    }),
  ).optional(),
  showIncidentOnStatusPage: Zod.boolean().optional(),
  isPrivate: Zod.boolean().optional(),
});

export const CriteriaAlertSchema: ZodSchema = Zod.object({
  title: Zod.string(),
  description: Zod.string(),
  alertSeverityId: Zod.any().optional(),
  autoResolveAlert: Zod.boolean().optional(),
  remediationNotes: Zod.string().optional(),
  id: Zod.string(),
  onCallPolicyIds: Zod.array(Zod.any()).optional(),
  labelIds: Zod.array(Zod.any()).optional(),
  ownerTeamIds: Zod.array(Zod.any()).optional(),
  ownerUserIds: Zod.array(Zod.any()).optional(),
  isPrivate: Zod.boolean().optional(),
});

export const IncidentGroupingConfigSchema: ZodSchema = Zod.object({
  groupByJSONPath: Zod.string(),
  resolvedWhenJSONPath: Zod.string().optional(),
  resolvedWhenValue: Zod.string().optional(),
  maxKeysPerPayload: Zod.number().optional(),
});

export function getMonitorCriteriaInstanceSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.MonitorCriteriaInstance),
    value: Zod.object({
      id: Zod.string(),
      /*
       * Optional: a criteria that changes no monitor status stores none.
       * zod 3 read a key of any() as optional; zod 4 requires the key.
       */
      monitorStatusId: Zod.any().optional(),
      filterCondition: Zod.any(),
      filters: Zod.array(CriteriaFilterSchema),
      incidents: Zod.array(CriteriaIncidentSchema),
      alerts: Zod.array(CriteriaAlertSchema),
      name: Zod.string(),
      // Optional: a criteria needs a name, not a description.
      description: Zod.string().optional(),
      changeMonitorStatus: Zod.boolean().optional(),
      createIncidents: Zod.boolean().optional(),
      createAlerts: Zod.boolean().optional(),
      isEnabled: Zod.boolean().optional(),
      incidentGrouping: IncidentGroupingConfigSchema.optional(),
      openForEveryEmail: Zod.boolean().optional(),
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

export function getMonitorCriteriaSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.MonitorCriteria),
    value: Zod.object({
      monitorCriteriaInstanceArray: Zod.array(
        getMonitorCriteriaInstanceSchema(),
      ),
    }).openapi({
      type: "object",
      example: {
        monitorCriteriaInstanceArray: [],
      },
    }),
  }).openapi({
    type: "object",
    description: "MonitorCriteria object",
    example: {
      _type: ObjectType.MonitorCriteria,
      value: { monitorCriteriaInstanceArray: [] },
    },
  });
}

export function getMonitorStepSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.MonitorStep),
    value: Zod.object({
      id: Zod.string(),
      doNotSyncFields: Zod.array(
        Zod.string().refine((value: string): boolean => {
          try {
            MonitorTemplateSyncFieldUtil.parse([value]);
            return true;
          } catch {
            return false;
          }
        }, "Unsupported do not sync field"),
      ).optional(),
      monitorDestination: Zod.any().optional(),
      monitorCriteria: Zod.any(),
      requestType: Zod.any(),
      requestHeaders: Zod.any().optional(),
      requestBody: Zod.string().optional(),
      doNotFollowRedirects: Zod.boolean().optional(),
      allowSelfSignedCertificates: Zod.boolean().optional(),
      tlsClientCertificate: Zod.string().optional(),
      tlsClientKey: Zod.string().optional(),
      tlsClientKeyPassphrase: Zod.string().optional(),
      monitorDestinationPort: Zod.any().optional(),
      customCode: Zod.string().optional(),
      screenSizeTypes: Zod.any().optional(),
      browserTypes: Zod.any().optional(),
      retryCountOnError: Zod.number().optional(),
      requestTimeoutInMs: Zod.number().optional(),
      retryCount: Zod.number().optional(),
      logMonitor: Zod.any().optional(),
      securityEventsMonitor: Zod.any().optional(),
      llmMonitor: Zod.any().optional(),
      traceMonitor: Zod.any().optional(),
      metricMonitor: Zod.any().optional(),
      exceptionMonitor: Zod.any().optional(),
      profileMonitor: Zod.any().optional(),
      snmpMonitor: Zod.any().optional(),
      networkDeviceMonitor: Zod.any().optional(),
      dnsMonitor: Zod.any().optional(),
      domainMonitor: Zod.any().optional(),
      dnssecMonitor: Zod.any().optional(),
      sqlMonitor: Zod.any().optional(),
      databaseMonitor: Zod.any().optional(),
      externalStatusPageMonitor: Zod.any().optional(),
      kubernetesMonitor: Zod.any().optional(),
      dockerMonitor: Zod.any().optional(),
      hostMonitor: Zod.any().optional(),
      podmanMonitor: Zod.any().optional(),
      proxmoxMonitor: Zod.any().optional(),
      vmwareMonitor: Zod.any().optional(),
      dockerSwarmMonitor: Zod.any().optional(),
      cephMonitor: Zod.any().optional(),
      storageArrayMonitor: Zod.any().optional(),
      iotMonitor: Zod.any().optional(),
      probeStatusMonitor: Zod.any().optional(),
    }).openapi({
      type: "object",
      example: {
        id: "stepId",
        monitorDestination: undefined,
        monitorCriteria: {},
        requestType: "GET",
      },
    }),
  }).openapi({
    type: "object",
    description: "MonitorStep object",
    example: {
      _type: ObjectType.MonitorStep,
      value: {
        id: "stepId",
        monitorDestination: undefined,
        monitorCriteria: {},
        requestType: "GET",
      },
    },
  });
}

export function getMonitorStepsSchema(): ZodSchema {
  return Zod.object({
    _type: Zod.literal(ObjectType.MonitorSteps),
    value: Zod.object({
      monitorStepsInstanceArray: Zod.array(getMonitorStepSchema()),
      defaultMonitorStatusId: Zod.string().optional(),
    }).openapi({
      type: "object",
      example: {
        monitorStepsInstanceArray: [],
        defaultMonitorStatusId: undefined,
      },
    }),
  }).openapi({
    type: "object",
    description: "MonitorSteps object",
    /*
     * Machine-readable marker so spec consumers (e.g. the Terraform
     * provider generator) can emit a typed nested schema for this field.
     */
    "x-oneuptime-type": ObjectType.MonitorSteps,
    example: {
      _type: ObjectType.MonitorSteps,
      value: {
        monitorStepsInstanceArray: [],
        defaultMonitorStatusId: undefined,
      },
    },
  });
}
