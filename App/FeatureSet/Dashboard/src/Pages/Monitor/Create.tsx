import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Navigation from "Common/UI/Utils/Navigation";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MonitorTypeUtil from "../../Utils/MonitorType";
import {
  CustomElementProps,
  FormFieldStyleType,
} from "Common/UI/Components/Forms/Types/Field";
import MonitorSteps from "../../Components/Form/Monitor/MonitorSteps";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import OneUptimeDate from "Common/Types/Date";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import {
  buildFormulaConfigsFromSerializedFormulas,
  buildQueryConfigsFromSerializedQueries,
} from "../../Components/Metrics/Utils/MetricConfigReconstruct";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import MonitoringInterval from "../../Utils/MonitorIntervalDropdownOptions";
import Card from "Common/UI/Components/Card/Card";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import {
  buildDetectionRuleMonitorPrefill,
  buildThreatIntelFeedMonitorPrefill,
} from "../../Utils/SecurityEventsMonitorPrefill";
import NetworkDeviceAlertPackUtil from "Common/Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  MonitorCriteriaSeedIds,
  PING_MONITOR_INTERVAL,
  PingMonitorOrigin,
  buildPingMonitorForAddress,
} from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import BadDataException from "Common/Types/Exception/BadDataException";
import PingMonitorSeedIds from "../../Components/NetworkDevice/PingMonitorSeedIds";
import { bindMonitorToDevice } from "../../Components/NetworkDevice/PingMonitorProvisioning";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import UiAnalytics from "Common/UI/Utils/Analytics";
import {
  RevenueEventName,
  RevenueFunnelStage,
} from "Common/Types/Analytics/RevenueEvent";
import ProbeUtil from "../../Utils/Probe";
import MonitorProbeSelectionUtil from "Common/Utils/Monitor/MonitorProbeSelectionUtil";
import {
  MonitorPayAsYouGoCard,
  getMonitorPayAsYouGoFormFields,
} from "../../Components/Billing/PayAsYouGo";

/*
 * Candidate rolling windows for "create monitor from this explorer view" —
 * the explorer's arbitrary window snaps to the nearest one. Ordered
 * ascending in minutes.
 */
const ROLLING_TIME_CANDIDATES: Array<{
  minutes: number;
  rollingTime: RollingTime;
}> = [
  { minutes: 1, rollingTime: RollingTime.Past1Minute },
  { minutes: 5, rollingTime: RollingTime.Past5Minutes },
  { minutes: 10, rollingTime: RollingTime.Past10Minutes },
  { minutes: 15, rollingTime: RollingTime.Past15Minutes },
  { minutes: 30, rollingTime: RollingTime.Past30Minutes },
  { minutes: 60, rollingTime: RollingTime.Past1Hour },
  { minutes: 120, rollingTime: RollingTime.Past2Hours },
  { minutes: 180, rollingTime: RollingTime.Past3Hours },
  { minutes: 360, rollingTime: RollingTime.Past6Hours },
  { minutes: 720, rollingTime: RollingTime.Past12Hours },
  // Past1Hours is the enum's (historically misnamed) "Past 1 Day" member.
  { minutes: 1440, rollingTime: RollingTime.Past1Hours },
  { minutes: 2880, rollingTime: RollingTime.Past2Days },
  { minutes: 4320, rollingTime: RollingTime.Past3Days },
  { minutes: 10080, rollingTime: RollingTime.Past7Days },
  { minutes: 20160, rollingTime: RollingTime.Past14Days },
  { minutes: 43200, rollingTime: RollingTime.Past30Days },
  { minutes: 86400, rollingTime: RollingTime.Past60Days },
  { minutes: 129600, rollingTime: RollingTime.Past90Days },
  { minutes: 259200, rollingTime: RollingTime.Past180Days },
  { minutes: 525600, rollingTime: RollingTime.Past365Days },
];

function getNearestRollingTimeForWindow(): RollingTime {
  const startTimeParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.StartTime,
  );
  const endTimeParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.EndTime,
  );

  // No window on the link — fall back to the explorer's default hour.
  if (
    !startTimeParam ||
    !endTimeParam ||
    !OneUptimeDate.isValidDateString(startTimeParam) ||
    !OneUptimeDate.isValidDateString(endTimeParam)
  ) {
    return RollingTime.Past1Hour;
  }

  const windowMinutes: number =
    (OneUptimeDate.fromString(endTimeParam).getTime() -
      OneUptimeDate.fromString(startTimeParam).getTime()) /
    60000;

  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return RollingTime.Past1Hour;
  }

  let nearest: { minutes: number; rollingTime: RollingTime } =
    ROLLING_TIME_CANDIDATES[0]!;

  for (const candidate of ROLLING_TIME_CANDIDATES) {
    if (
      Math.abs(candidate.minutes - windowMinutes) <
      Math.abs(nearest.minutes - windowMinutes)
    ) {
      nearest = candidate;
    }
  }

  return nearest.rollingTime;
}

function buildThresholdCriteriaInstance(input: {
  name: string;
  description: string;
  filters: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.Any,
    filters: input.filters,
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: input.name,
    description: input.description,
  };

  return instance;
}

const MonitorCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const monitorTemplateId: string | null =
    Navigation.getQueryStringByName("monitorTemplateId");

  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(monitorTemplateId),
  );
  const [error, setError] = useState<string>("");
  const [initialValues, setInitialValues] = useState<JSONObject>({});

  /*
   * Probe picker state. Probes used to be chosen for you after the monitor was
   * created (every probe flagged "auto enable on new monitors"), with no way to
   * say which probe should watch this particular resource. The picker starts
   * out on exactly that default set, so leaving it alone keeps the old
   * behaviour and changing it is now possible.
   */
  const [probeOptions, setProbeOptions] = useState<Array<DropdownOption>>([]);
  const [defaultProbeIds, setDefaultProbeIds] = useState<Array<string> | null>(
    null,
  );
  const [isLoadingProbes, setIsLoadingProbes] = useState<boolean>(true);

  /*
   * Probes pinned by a "Create Ping Monitor" deep link from a monitor-backed
   * device (see preSeedPingMonitorForMonitorBackedDevice). Kept apart from
   * defaultProbeIds on purpose: loadProbes and the pre-seed run concurrently
   * and would otherwise race on one setter, with whichever finished last
   * silently winning the form. The merge before the render prefers this one
   * whenever it is set and the loaded probe list contains it.
   */
  const [deviceProbeIds, setDeviceProbeIds] = useState<Array<string> | null>(
    null,
  );

  /*
   * The device a monitor created from that deep link is bound to afterwards
   * (NetworkDevice.monitorId), and the loading gate for the bind itself. A
   * ref rather than state: onSuccess is its only reader and nothing renders
   * from it.
   */
  const bindToNetworkDeviceId: MutableRefObject<ObjectID | null> =
    useRef<ObjectID | null>(null);
  const [isBinding, setIsBinding] = useState<boolean>(false);

  const loadProbes: () => Promise<void> = async (): Promise<void> => {
    try {
      const [probes, project]: [Array<Probe>, Project | null] =
        await Promise.all([
          ProbeUtil.getAllProbes(),
          ModelAPI.getItem<Project>({
            modelType: Project,
            id: ProjectUtil.getCurrentProjectId()!,
            select: {
              doNotAddGlobalProbesByDefaultOnNewMonitors: true,
            },
          }),
        ]);

      setProbeOptions(
        probes
          .filter((probe: Probe) => {
            return Boolean(probe._id);
          })
          .map((probe: Probe) => {
            return {
              label: probe.name?.toString() || "Probe",
              value: probe._id!.toString(),
            };
          }),
      );

      setDefaultProbeIds(
        MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
          probes: probes.map((probe: Probe) => {
            return {
              id: probe._id?.toString() || "",
              isGlobalProbe: Boolean(probe.isGlobalProbe),
              shouldAutoEnableProbeOnNewMonitors: Boolean(
                probe.shouldAutoEnableProbeOnNewMonitors,
              ),
            };
          }),
          doNotAddGlobalProbesByDefaultOnNewMonitors:
            project?.doNotAddGlobalProbesByDefaultOnNewMonitors,
        }),
      );
    } catch {
      /*
       * Non-fatal. With no probe list the picker is hidden and no "probes"
       * value is submitted, so the server keeps assigning the defaults exactly
       * as it did before - creating a monitor must not be blocked by this.
       */
      setProbeOptions([]);
      setDefaultProbeIds(null);
    }

    setIsLoadingProbes(false);
  };

  useEffect(() => {
    loadProbes().catch(() => {
      setIsLoadingProbes(false);
    });
  }, []);

  /*
   * "Create monitor from this view" deep link from the metric explorer:
   * pre-seed a Metric monitor from the shared serializer's
   * metricQueries/metricFormulas params (plus the window → rolling time).
   * Any warning/critical thresholds on the queries become generated
   * warning/critical criteria; otherwise criteria stay at the form's
   * defaults. Template links take priority — they carry full steps.
   */
  const preSeedFromMetricExplorerLink: (
    rawMetricQueries: string,
  ) => Promise<void> = async (rawMetricQueries: string): Promise<void> => {
    const serializedQueries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(rawMetricQueries);

    if (serializedQueries.length === 0) {
      return;
    }

    const rawMetricFormulas: string | null = Navigation.getQueryStringByName(
      MetricExplorerUrlParam.MetricFormulas,
    );
    const serializedFormulas: Array<SerializedMetricFormula> = rawMetricFormulas
      ? MetricExplorerUrl.parseMetricFormulasParam(rawMetricFormulas)
      : [];

    const queryConfigs: Array<MetricQueryConfigData> =
      buildQueryConfigsFromSerializedQueries(serializedQueries);
    const formulaConfigs: Array<MetricFormulaConfigData> =
      buildFormulaConfigsFromSerializedFormulas(
        serializedFormulas,
        queryConfigs.length,
      );

    const monitorSteps: MonitorStepsType = new MonitorStepsType();
    const monitorStep: MonitorStep | undefined =
      monitorSteps.data?.monitorStepsInstanceArray[0];

    if (!monitorStep || !monitorStep.data) {
      return;
    }

    monitorStep.data.metricMonitor = {
      metricViewConfig: {
        queryConfigs: queryConfigs,
        formulaConfigs: formulaConfigs,
      },
      rollingTime: getNearestRollingTimeForWindow(),
    };

    /*
     * The MonitorSteps form only auto-fills the default (operational)
     * monitor status when it bootstraps WITHOUT an initial value, so a
     * pre-seeded MonitorSteps must carry it itself — otherwise
     * validation blocks the criteria step with "Default Monitor Status
     * is required" until the user finds the dropdown manually.
     */
    try {
      const monitorStatusList: ListResult<MonitorStatus> =
        await ModelAPI.getList({
          modelType: MonitorStatus,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            isOperationalState: true,
          },
          sort: {},
        });

      const operationalStatus: MonitorStatus | undefined =
        monitorStatusList.data.find((status: MonitorStatus) => {
          return status.isOperationalState;
        });

      if (operationalStatus?.id) {
        monitorSteps.setDefaultMonitorStatusId(operationalStatus.id);
      }
    } catch {
      // Recoverable: the user can still pick the default status in the form.
    }

    const warningFilters: Array<CriteriaFilter> = [];
    const criticalFilters: Array<CriteriaFilter> = [];

    for (const queryConfig of queryConfigs) {
      const metricAlias: string =
        queryConfig.metricAliasData?.metricVariable || "";

      const buildFilter: (thresholdValue: number) => CriteriaFilter = (
        thresholdValue: number,
      ): CriteriaFilter => {
        return {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: thresholdValue,
          metricMonitorOptions: {
            metricAggregationType: EvaluateOverTimeType.AnyValue,
            ...(metricAlias ? { metricAlias: metricAlias } : {}),
          },
        };
      };

      if (queryConfig.criticalThreshold !== undefined) {
        criticalFilters.push(buildFilter(queryConfig.criticalThreshold));
      }

      if (queryConfig.warningThreshold !== undefined) {
        warningFilters.push(buildFilter(queryConfig.warningThreshold));
      }
    }

    const criteriaInstances: Array<MonitorCriteriaInstance> = [];

    if (criticalFilters.length > 0) {
      criteriaInstances.push(
        buildThresholdCriteriaInstance({
          name: "Critical",
          description:
            "Generated from the critical threshold on the metric explorer view.",
          filters: criticalFilters,
        }),
      );
    }

    if (warningFilters.length > 0) {
      criteriaInstances.push(
        buildThresholdCriteriaInstance({
          name: "Warning",
          description:
            "Generated from the warning threshold on the metric explorer view.",
          filters: warningFilters,
        }),
      );
    }

    if (criteriaInstances.length > 0) {
      const monitorCriteria: MonitorCriteria = new MonitorCriteria();
      monitorCriteria.data = {
        monitorCriteriaInstanceArray: criteriaInstances,
      };
      monitorStep.data.monitorCriteria = monitorCriteria;
    }

    const firstQuery: SerializedMetricQuery = serializedQueries[0]!;
    const metricDisplayName: string =
      firstQuery.alias?.title?.trim() ||
      firstQuery.metricName.trim() ||
      "Metric";

    setInitialValues({
      name: `${metricDisplayName} Monitor`,
      description: `Created from the Metric Explorer view for ${metricDisplayName}.`,
      monitorType: MonitorType.Metrics,
      monitorSteps: monitorSteps.toJSON(),
      monitoringInterval: "*/5 * * * *",
    });
  };

  /*
   * "Create Ping Monitor" from a monitor-backed device's Overview or
   * Monitors page — the second shape the Network Device deep link can take.
   *
   * A monitor-backed device is polled by nothing: the monitor bound through
   * NetworkDevice.monitorId IS its health, and until one is bound its status
   * reads "Pending" forever (OneUptime/oneuptime#3447). So the form opens on
   * the same Ping monitor the discovery import and the device list's bulk
   * action build — type, interval, criteria, incident suppression — pointed
   * at the device's address, and onSuccess binds it to the device
   * (bindCreatedMonitorToDevice) instead of leaving the operator to find the
   * binding under the device's Settings by hand.
   *
   * Seeding the SNMP shape here would be wrong twice over: a Network Device
   * monitor expects a device a probe walks, and creating it binds nothing.
   */
  const preSeedPingMonitorForMonitorBackedDevice: (data: {
    networkDeviceId: string;
    device: NetworkDevice;
  }) => Promise<void> = async (data: {
    networkDeviceId: string;
    device: NetworkDevice;
  }): Promise<void> => {
    let monitor: Monitor;

    try {
      /*
       * A project missing an operational status or a severity throws an
       * operator-facing message that names the fix; it replaces the form
       * rather than opening one that cannot be saved.
       */
      const seedIds: MonitorCriteriaSeedIds =
        await PingMonitorSeedIds.resolve();

      monitor = buildPingMonitorForAddress({
        projectId: ProjectUtil.getCurrentProjectId()!,
        address: data.device.hostname || "",
        deviceName: data.device.name || "",
        seedIds: seedIds,
        origin: PingMonitorOrigin.DevicePage,
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      return;
    }

    bindToNetworkDeviceId.current = new ObjectID(data.networkDeviceId);

    /*
     * A device switched from SNMP to monitor-backed keeps its probe, and that
     * probe is the one that can reach it: the project's defaults include
     * global probes on the public internet, which cannot reach an RFC1918
     * address and would drive the device straight to "Offline" — a worse
     * answer than "Pending", because it reads as an outage. A device with no
     * probe of its own falls through to the defaults, which the operator can
     * change on the Probes step. The pin also needs the probe list to have
     * loaded this probe — the merge before the render checks that, so a
     * failed load submits no selection rather than an empty one.
     */
    setDeviceProbeIds(
      data.device.probeId ? [data.device.probeId.toString()] : null,
    );

    setInitialValues({
      name: monitor.name || "",
      description: monitor.description || "",
      monitorType: MonitorType.Ping,
      monitorSteps: monitor.monitorSteps!.toJSON(),
      monitoringInterval: PING_MONITOR_INTERVAL,
    });
  };

  /*
   * "Create monitor for this device" deep link from the Network Device
   * pages. What it seeds depends on how the device is monitored:
   *
   *   SNMP           - pre-select the Network Device type, reference the
   *                    device in the step, and seed the Recommended Alert
   *                    Pack criteria (device unreachable → incident,
   *                    interface down → incident, utilization / errors →
   *                    alerts) so alerting on a device is one
   *                    review-and-save instead of assembling the monitor by
   *                    hand.
   *   Monitor-backed - a Ping monitor on the device's address, bound to the
   *                    device once created; see
   *                    preSeedPingMonitorForMonitorBackedDevice.
   *
   * The device is read once, up front, because the branch needs its
   * monitoring method and the Ping branch needs its address and probe.
   */
  const preSeedFromNetworkDeviceLink: (
    networkDeviceId: string,
  ) => Promise<void> = async (networkDeviceId: string): Promise<void> => {
    let device: NetworkDevice | null = null;

    try {
      device = await ModelAPI.getItem({
        modelType: NetworkDevice,
        id: new ObjectID(networkDeviceId),
        select: {
          name: true,
          hostname: true,
          monitoringMethod: true,
          probeId: true,
        },
      });
    } catch {
      /*
       * Recoverable: an unreadable device seeds the SNMP shape with a
       * generic name, exactly as before this branched — the monitoring
       * method parses NULL as SNMP, which is what every device was.
       */
    }

    if (
      device &&
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)
    ) {
      await preSeedPingMonitorForMonitorBackedDevice({
        networkDeviceId: networkDeviceId,
        device: device,
      });
      return;
    }

    const monitorSteps: MonitorStepsType = new MonitorStepsType();
    const monitorStep: MonitorStep | undefined =
      monitorSteps.data?.monitorStepsInstanceArray[0];

    if (!monitorStep || !monitorStep.data) {
      return;
    }

    monitorStep.data.networkDeviceMonitor = {
      networkDeviceId: networkDeviceId,
      // Deprecated collection fields — kept for step-shape compatibility.
      monitorInterfaces: true,
      collectEndpoints: false,
      oids: [],
    };

    const deviceName: string = device?.name || "";

    try {
      const monitorStatusList: ListResult<MonitorStatus> =
        await ModelAPI.getList({
          modelType: MonitorStatus,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            isOperationalState: true,
            isOfflineState: true,
          },
          sort: {},
        });

      const operationalStatus: MonitorStatus | undefined =
        monitorStatusList.data.find((status: MonitorStatus) => {
          return status.isOperationalState;
        });

      if (operationalStatus?.id) {
        monitorSteps.setDefaultMonitorStatusId(operationalStatus.id);
      }

      const offlineStatus: MonitorStatus | undefined =
        monitorStatusList.data.find((status: MonitorStatus) => {
          return status.isOfflineState;
        });

      const recommendedCriteria: Array<MonitorCriteriaInstance> =
        NetworkDeviceAlertPackUtil.buildCriteriaInstances({
          downMonitorStatusId: offlineStatus?.id || undefined,
        });

      if (recommendedCriteria.length > 0) {
        const monitorCriteria: MonitorCriteria = new MonitorCriteria();
        monitorCriteria.data = {
          monitorCriteriaInstanceArray: recommendedCriteria,
        };
        monitorStep.data.monitorCriteria = monitorCriteria;
      }
    } catch {
      // Recoverable: the user can still pick statuses / criteria manually.
    }

    setInitialValues({
      name: deviceName ? `${deviceName} Monitor` : "Network Device Monitor",
      description: deviceName
        ? `Alerts on the ${deviceName} network device.`
        : "Alerts on a registered network device.",
      monitorType: MonitorType.NetworkDevice,
      monitorSteps: monitorSteps.toJSON(),
    });
  };

  /*
   * "Create Monitor" deep link from a detection rule (Security Events →
   * Detection Rules): pre-select the Security Events type and seed a step
   * scoped to the Detection Finding rows that rule writes, so the monitor
   * watches the rule's rate rather than the raw event stream.
   */
  const preSeedFromDetectionRuleLink: (
    detectionRuleId: string,
  ) => Promise<void> = async (detectionRuleId: string): Promise<void> => {
    let ruleName: string = "";

    try {
      const rule: DetectionRule | null = await ModelAPI.getItem({
        modelType: DetectionRule,
        id: new ObjectID(detectionRuleId),
        select: {
          name: true,
        },
      });
      ruleName = rule?.name || "";
    } catch {
      // Recoverable: the monitor name just falls back to a generic one.
    }

    let operationalStatusId: ObjectID | null = null;

    try {
      const monitorStatusList: ListResult<MonitorStatus> =
        await ModelAPI.getList({
          modelType: MonitorStatus,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            isOperationalState: true,
          },
          sort: {},
        });

      const operationalStatus: MonitorStatus | undefined =
        monitorStatusList.data.find((status: MonitorStatus) => {
          return status.isOperationalState;
        });

      operationalStatusId = operationalStatus?.id || null;
    } catch {
      // Recoverable: the user can still pick the default status in the form.
    }

    setInitialValues(
      buildDetectionRuleMonitorPrefill({
        /*
         * The id scopes the monitor's filter; the name is display only,
         * so its fallback affects nothing but the monitor's title.
         */
        ruleId: detectionRuleId,
        ruleName: ruleName || "Detection rule",
        operationalStatusId,
      }),
    );
  };

  /*
   * "Create Monitor" deep link from a threat intel feed (Security Events
   * → Threat Intel): the detection-rule flow's twin, seeded with a step
   * scoped to the Threat Intel finding rows the matcher writes for that
   * feed.
   */
  const preSeedFromThreatIntelFeedLink: (
    threatIntelFeedId: string,
  ) => Promise<void> = async (threatIntelFeedId: string): Promise<void> => {
    let feedName: string = "";

    try {
      const feed: ThreatIntelFeed | null = await ModelAPI.getItem({
        modelType: ThreatIntelFeed,
        id: new ObjectID(threatIntelFeedId),
        select: {
          name: true,
        },
      });
      feedName = feed?.name || "";
    } catch {
      // Recoverable: the monitor name just falls back to a generic one.
    }

    let operationalStatusId: ObjectID | null = null;

    try {
      const monitorStatusList: ListResult<MonitorStatus> =
        await ModelAPI.getList({
          modelType: MonitorStatus,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            isOperationalState: true,
          },
          sort: {},
        });

      const operationalStatus: MonitorStatus | undefined =
        monitorStatusList.data.find((status: MonitorStatus) => {
          return status.isOperationalState;
        });

      operationalStatusId = operationalStatus?.id || null;
    } catch {
      // Recoverable: the user can still pick the default status in the form.
    }

    setInitialValues(
      buildThreatIntelFeedMonitorPrefill({
        feedId: threatIntelFeedId,
        feedName: feedName || "Threat intel feed",
        operationalStatusId,
      }),
    );
  };

  useEffect(() => {
    if (monitorTemplateId) {
      fetchMonitorTemplate(new ObjectID(monitorTemplateId));
      return;
    }

    const networkDeviceId: string | null =
      Navigation.getQueryStringByName("networkDeviceId");

    if (networkDeviceId) {
      setIsLoading(true);
      preSeedFromNetworkDeviceLink(networkDeviceId).finally(() => {
        setIsLoading(false);
      });
      return;
    }

    const rawMetricQueries: string | null = Navigation.getQueryStringByName(
      MetricExplorerUrlParam.MetricQueries,
    );

    if (rawMetricQueries) {
      /*
       * Gate the form on loading (like the template flow) so the
       * pre-seeded initial values — including the async-fetched default
       * monitor status — are in place before the form mounts.
       */
      setIsLoading(true);
      preSeedFromMetricExplorerLink(rawMetricQueries).finally(() => {
        setIsLoading(false);
      });
      return;
    }

    const detectionRuleId: string | null =
      Navigation.getQueryStringByName("detectionRuleId");

    if (detectionRuleId) {
      setIsLoading(true);
      preSeedFromDetectionRuleLink(detectionRuleId).finally(() => {
        setIsLoading(false);
      });
      return;
    }

    const threatIntelFeedId: string | null =
      Navigation.getQueryStringByName("threatIntelFeedId");

    if (threatIntelFeedId) {
      setIsLoading(true);
      preSeedFromThreatIntelFeedLink(threatIntelFeedId).finally(() => {
        setIsLoading(false);
      });
      return;
    }

    /*
     * Weakest prefill, so it goes last: preselect the monitor type alone.
     * Synchronous — with no monitorSteps in the initial values the steps
     * form bootstraps itself and auto-fills the operational status, so
     * nothing needs fetching and no loading gate is needed.
     */
    const monitorTypeParam: string | null =
      Navigation.getQueryStringByName("monitorType");

    if (
      monitorTypeParam &&
      Object.values(MonitorType).includes(monitorTypeParam as MonitorType)
    ) {
      setInitialValues({
        monitorType: monitorTypeParam as MonitorType,
      });
    }
  }, []);

  /*
   * The second half of the monitor-backed deep link: point the device at the
   * monitor the form just created. Binding re-stamps the device with the
   * monitor's current status through NetworkDeviceService.onUpdateSuccess,
   * so its pill resolves on the next render instead of waiting for the
   * monitor's next status CHANGE (OneUptime/oneuptime#3392) — which is why
   * the operator lands on the DEVICE, where that result is visible, rather
   * than on the monitor.
   *
   * ModelForm does not await onSuccess, so this must never reject: a bind
   * that fails is reported here, in place of the form. The monitor exists
   * either way and is deliberately NOT deleted — unlike the bulk action's
   * cleanup, the operator just reviewed and saved this one on purpose — so
   * the message says where to finish the binding by hand.
   */
  const bindCreatedMonitorToDevice: (data: {
    deviceId: ObjectID;
    createdMonitor: Monitor;
  }) => Promise<void> = async (data: {
    deviceId: ObjectID;
    createdMonitor: Monitor;
  }): Promise<void> => {
    setIsBinding(true);

    try {
      if (!data.createdMonitor.id) {
        throw new BadDataException(
          "the server did not return the new monitor's id",
        );
      }

      await bindMonitorToDevice({
        deviceId: data.deviceId,
        monitorId: data.createdMonitor.id,
      });

      Navigation.navigate(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
          {
            modelId: data.deviceId,
          },
        ),
      );
    } catch (err) {
      setIsBinding(false);
      setError(
        `The monitor was created but could not be bound to the device: ${API.getFriendlyMessage(
          err,
        )}. Bind it under the device's Settings → Monitor.`,
      );
    }
  };

  const fetchMonitorTemplate: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const template: MonitorTemplate | null =
        await ModelAPI.getItem<MonitorTemplate>({
          modelType: MonitorTemplate,
          id: id,
          select: {
            monitorName: true,
            monitorDescription: true,
            monitorType: true,
            monitorSteps: true,
            monitoringInterval: true,
            labels: true,
          },
        });

      if (template) {
        const templateJSON: JSONObject = BaseModel.toJSONObject(
          template,
          MonitorTemplate,
        );

        const values: JSONObject = {
          ...templateJSON,
          name: template.monitorName,
          description: template.monitorDescription,
          monitorType: template.monitorType,
          monitorSteps: templateJSON["monitorSteps"],
          monitoringInterval: template.monitoringInterval,
          labels: template.labels?.map((label: Label) => {
            return label.id!.toString();
          }),
        };

        setInitialValues(values);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  /*
   * Which probes the form opens with. A monitor-backed device's own probe
   * beats the project defaults — it is the one that can reach the device —
   * but it is pinned only when the probe list actually loaded it: BasicForm
   * drops any initial value that is not among the options, and an explicit
   * empty selection is honoured by the server as "attach no probes" — a
   * monitor nothing evaluates (see probeMiscDataProps in
   * Components/NetworkDevice/PingMonitorProvisioning.ts). With no usable pin
   * the defaults apply, and with no defaults either no selection is
   * submitted: null here means "submit no selection", which the server
   * treats as "use the defaults", exactly as when the probe list could not
   * be loaded.
   */
  const pinnedDeviceProbes: Array<string> | null =
    deviceProbeIds &&
    deviceProbeIds.every((probeId: string): boolean => {
      return probeOptions.some((option: DropdownOption): boolean => {
        return option.value === probeId;
      });
    })
      ? deviceProbeIds
      : null;

  const seededProbes: Array<string> | null =
    pinnedDeviceProbes ?? defaultProbeIds;

  return (
    <Fragment>
      {/*
       * Every monitor type except Manual is metered as an active monitor, so
       * a Free plan project is told the rate before it picks a type - and has
       * to acknowledge it below the type picker.
       */}
      <MonitorPayAsYouGoCard />
      <Card
        title="Create New Monitor"
        description={
          "Monitor anything - Websites, API, IPv4, IPv6, or send data inbound and more. Create alerts on any metrics and alert the right team."
        }
        className="mb-10"
      >
        <div>
          {(isLoading || isLoadingProbes || isBinding) && (
            <PageLoader isVisible={true} />
          )}
          {error && <ErrorMessage message={error} />}
          {!isLoading && !isLoadingProbes && !isBinding && !error && (
            <ModelForm<Monitor>
              modelType={Monitor}
              name="Create New Monitor"
              id="create-monitor-form"
              initialValues={
                /*
                 * The form reads initialValues once, on mount - which is why
                 * the render above waits for the probe list.
                 */
                seededProbes
                  ? { ...initialValues, probes: seededProbes }
                  : initialValues
              }
              fields={[
                {
                  field: {
                    name: true,
                  },
                  title: "Name",
                  stepId: "monitor-info",
                  fieldType: FormFieldSchemaType.Text,
                  required: true,
                  placeholder: "Monitor Name",
                  validation: {
                    minLength: 2,
                  },
                },
                {
                  field: {
                    description: true,
                  },
                  stepId: "monitor-info",
                  title: "Description",
                  fieldType: FormFieldSchemaType.LongText,
                  required: false,
                  placeholder: "Description",
                },
                {
                  field: {
                    monitorType: true,
                  },
                  title: "Monitor Type",
                  description: "Select the type of monitor you want to create",
                  stepId: "monitor-info",
                  fieldType: FormFieldSchemaType.CardSelect,
                  required: true,
                  cardSelectOptions:
                    MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions(),
                  cardSelectSearchable: true,
                  cardSelectSearchPlaceholder:
                    "Search monitor types - try ping, ssl, k8s, postgres",
                  cardSelectCollapsibleGroups: true,
                },
                /*
                 * Sits directly under the type picker, on the same step, so
                 * the charge is acknowledged next to the choice that causes
                 * it. Empty off the Free plan; hidden for Manual monitors.
                 */
                ...getMonitorPayAsYouGoFormFields({ stepId: "monitor-info" }),
                {
                  field: {
                    monitorSteps: true,
                  },
                  stepId: "criteria",
                  styleType: FormFieldStyleType.Heading,
                  title: "Monitor Details",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: true,
                  customValidation: (values: FormValues<Monitor>) => {
                    const error: string | null =
                      MonitorStepsType.getValidationError(
                        values.monitorSteps as MonitorStepsType,
                        values.monitorType as MonitorType,
                      );

                    return error;
                  },
                  getCustomElement: (
                    value: FormValues<Monitor>,
                    props: CustomElementProps,
                  ) => {
                    return (
                      <MonitorSteps
                        {...props}
                        monitorType={value.monitorType || MonitorType.Manual}
                        monitorName={value.name || ""}
                      />
                    );
                  },
                },
                {
                  /*
                   * Not a Monitor column - the selection is carried to the
                   * server in miscDataProps and turned into MonitorProbe rows
                   * by MonitorService.onCreateSuccess. overrideField keeps it
                   * out of the Monitor payload; showEvenIfPermissionDoesNotExist
                   * is required because Monitor has no "probes" column to
                   * derive field permissions from.
                   */
                  overrideField: {
                    probes: true,
                  },
                  overrideFieldKey: "probes",
                  showEvenIfPermissionDoesNotExist: true,
                  stepId: "monitoring-interval",
                  title: "Probes",
                  description:
                    "Which probes should monitor this resource? Leave this empty to use every probe that is set to monitor new monitors by default.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  required: false,
                  placeholder: "Select Probes",
                  dropdownOptions: probeOptions,
                  showIf: () => {
                    // Nothing to choose from - keep the step uncluttered.
                    return probeOptions.length > 0;
                  },
                },
                {
                  field: {
                    monitoringInterval: true,
                  },
                  stepId: "monitoring-interval",
                  title: "Monitoring Interval",
                  fieldType: FormFieldSchemaType.Dropdown,
                  required: true,
                  fetchDropdownOptions: (item: FormValues<Monitor>) => {
                    let interval: Array<DropdownOption> = [
                      ...MonitoringInterval,
                    ];

                    if (
                      item &&
                      (item.monitorType === MonitorType.SyntheticMonitor ||
                        item.monitorType === MonitorType.CustomJavaScriptCode ||
                        item.monitorType === MonitorType.SSLCertificate)
                    ) {
                      // remove the every minute option, every 2 mins, every 10 minutes
                      interval = interval.filter((option: DropdownOption) => {
                        return (
                          option.value !== "* * * * *" &&
                          option.value !== "*/2 * * * *"
                        );
                      });

                      return Promise.resolve(interval);
                    }

                    return Promise.resolve(interval);
                  },

                  placeholder: "Select Monitoring Interval",
                },
                {
                  field: {
                    labels: true,
                  },
                  title: "Labels",
                  stepId: "labels",
                  description:
                    "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Label,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Labels",
                },
              ]}
              steps={[
                {
                  title: "Monitor Info",
                  id: "monitor-info",
                },
                {
                  title: "Criteria",
                  id: "criteria",
                  showIf: (values: FormValues<Monitor>) => {
                    return values.monitorType !== MonitorType.Manual;
                  },
                },
                {
                  /*
                   * Probes live on this step rather than a step of their own:
                   * doesMonitorTypeHaveInterval is isProbableMonitor, so this
                   * step already appears for exactly the monitor types that
                   * are watched by probes.
                   */
                  title: "Probes & Interval",
                  id: "monitoring-interval",
                  showIf: (values: FormValues<Monitor>) => {
                    return MonitorTypeHelper.doesMonitorTypeHaveInterval(
                      values.monitorType as MonitorType,
                    );
                  },
                },
                {
                  title: "Labels",
                  id: "labels",
                },
              ]}
              onBeforeCreate={async (item: Monitor): Promise<Monitor> => {
                if (monitorTemplateId) {
                  item.monitorTemplateId = new ObjectID(monitorTemplateId);
                }
                return item;
              }}
              onSuccess={(createdItem: Monitor) => {
                UiAnalytics.captureRevenueEvent(
                  RevenueEventName.MonitorCreated,
                  {
                    funnel_stage: RevenueFunnelStage.Activation,
                    project_id:
                      ProjectUtil.getCurrentProjectId()?.toString() || "",
                    monitor_id: createdItem.id?.toString() || "",
                    monitor_type: createdItem.monitorType || "",
                  },
                );

                const deviceToBind: ObjectID | null =
                  bindToNetworkDeviceId.current;

                if (deviceToBind) {
                  /*
                   * Not awaited — ModelForm does not await onSuccess — and
                   * the helper reports its own failure, so there is nothing
                   * for a rejection handler to do.
                   */
                  bindCreatedMonitorToDevice({
                    deviceId: deviceToBind,
                    createdMonitor: createdItem,
                  }).catch(() => {
                    // Unreachable: the helper catches everything it does.
                  });
                  return;
                }

                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.MONITOR_VIEW] as Route,
                      {
                        modelId: createdItem._id,
                      },
                    ),
                  ),
                );
              }}
              submitButtonText={"Create Monitor"}
              formType={FormType.Create}
            />
          )}
        </div>
      </Card>
    </Fragment>
  );
};

export default MonitorCreate;
