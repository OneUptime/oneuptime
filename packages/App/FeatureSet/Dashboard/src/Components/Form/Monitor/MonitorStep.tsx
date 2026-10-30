import MonitorCriteriaElement from "./MonitorCriteria";
import TelemetryRuleEditor from "./TelemetryRule/TelemetryRuleEditor";
import TelemetryRuleRecipePicker from "./TelemetryRule/TelemetryRuleRecipePicker";
import TelemetryAlertRuleUtil from "Common/Types/Monitor/TelemetryAlertRule";
import MonitorStepMetricViewConfigUtil from "Common/Types/Monitor/MonitorStepMetricViewConfigUtil";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  applyRecipe,
  findRecipe,
  getRecipe,
  getRecipes,
  TelemetryRuleRecipe,
  TelemetryRuleRecipeKey,
  TelemetryRuleSeeds,
} from "../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";
import MonitorTemplateSyncFields from "./MonitorTemplateSyncFields";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import CodeType from "Common/Types/Code/CodeType";
import Dictionary from "Common/Types/Dictionary";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ReplacedCriteriaEdit from "../../../Utils/Form/Monitor/ReplacedCriteriaEdit";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import MonitorDestinationUtil, {
  ParsedMonitorDestination,
} from "Common/Utils/Monitor/MonitorDestinationUtil";
import Port from "Common/Types/Port";
import ScreenSizeType from "Common/Types/ScreenSizeType";
import ProjectUtil from "Common/UI/Utils/Project";
import { ButtonSize } from "Common/UI/Components/Button/Button";
import CheckBoxList, {
  CategoryCheckboxValue,
  enumToCategoryCheckboxOption,
} from "Common/UI/Components/CategoryCheckbox/CheckboxList";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import DictionaryOfStrings from "Common/UI/Components/Dictionary/DictionaryOfStrings";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getMonitorStepMoreFieldsItems } from "./MonitorMoreFields";
import Card from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import LogMonitorStepForm from "./LogMonitor/LogMonitorStepFrom";
import SecurityEventsMonitorStepForm from "./SecurityEventsMonitor/SecurityEventsMonitorStepForm";
import MonitorStepSecurityEventsMonitor, {
  MonitorStepSecurityEventsMonitorUtil,
} from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import TraceMonitorStepForm from "./TraceMonitor/TraceMonitorStepForm";
import LlmMonitorStepForm from "./LlmMonitor/LlmMonitorStepForm";
import MonitorStepLlmMonitor, {
  MonitorStepLlmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLlmMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/UI/Utils/API/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import MonitorTestForm from "./MonitorTest";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";
import Probe from "Common/Models/DatabaseModels/Probe";
import MetricMonitorStepForm from "./MetricMonitor/MetricMonitorStepForm";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import { INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION } from "./AlertTemplatePicker/AlertTemplateGroups";
import KubernetesMonitorStepForm from "./KubernetesMonitor/KubernetesMonitorStepForm";
import MonitorStepKubernetesMonitor, {
  MonitorStepKubernetesMonitorUtil,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import DockerMonitorStepForm from "./DockerMonitor/DockerMonitorStepForm";
import MonitorStepDockerMonitor, {
  MonitorStepDockerMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDockerMonitor";
import HostMonitorStepForm from "./HostMonitor/HostMonitorStepForm";
import MonitorStepHostMonitor, {
  MonitorStepHostMonitorUtil,
} from "Common/Types/Monitor/MonitorStepHostMonitor";
import PodmanMonitorStepForm from "./PodmanMonitor/PodmanMonitorStepForm";
import MonitorStepPodmanMonitor, {
  MonitorStepPodmanMonitorUtil,
} from "Common/Types/Monitor/MonitorStepPodmanMonitor";
import ProxmoxMonitorStepForm from "./ProxmoxMonitor/ProxmoxMonitorStepForm";
import MonitorStepProxmoxMonitor, {
  MonitorStepProxmoxMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import VMwareMonitorStepForm from "./VMwareMonitor/VMwareMonitorStepForm";
import MonitorStepVMwareMonitor, {
  MonitorStepVMwareMonitorUtil,
} from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import IoTMonitorStepForm from "./IoTMonitor/IoTMonitorStepForm";
import MonitorStepIoTMonitor, {
  MonitorStepIoTMonitorUtil,
} from "Common/Types/Monitor/MonitorStepIoTMonitor";
import DockerSwarmMonitorStepForm from "./DockerSwarmMonitor/DockerSwarmMonitorStepForm";
import MonitorStepDockerSwarmMonitor, {
  MonitorStepDockerSwarmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import CephMonitorStepForm from "./CephMonitor/CephMonitorStepForm";
import MonitorStepCephMonitor, {
  MonitorStepCephMonitorUtil,
} from "Common/Types/Monitor/MonitorStepCephMonitor";
import StorageArrayMonitorStepForm from "./StorageArrayMonitor/StorageArrayMonitorStepForm";
import MonitorStepStorageArrayMonitor, {
  MonitorStepStorageArrayMonitorUtil,
} from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import Link from "Common/UI/Components/Link/Link";
import TinyFormDocumentation from "Common/UI/Components/TinyFormDocumentation/TinyFormDocumentation";
import ExceptionMonitorStepForm from "./ExceptionMonitor/ExceptionMonitorStepForm";
import ProfileMonitorStepForm from "./ProfileMonitor/ProfileMonitorStepForm";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProfileMonitor";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import NetworkDeviceMonitorStepForm from "./NetworkDeviceMonitor/NetworkDeviceMonitorStepForm";
import MonitorStepNetworkDeviceMonitor, {
  MonitorStepNetworkDeviceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepNetworkDeviceMonitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import {
  NetworkDeviceCriteriaCatalogue,
  NetworkDeviceOidCatalogueEntry,
  NetworkDeviceTableCatalogueEntry,
} from "./CriteriaFilter";
import DnsMonitorStepForm from "./DnsMonitor/DnsMonitorStepForm";
import MonitorStepDnsMonitor, {
  MonitorStepDnsMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDnsMonitor";
import SqlMonitorStepForm from "./SqlMonitor/SqlMonitorStepForm";
import MonitorStepSqlMonitor, {
  MonitorStepSqlMonitorUtil,
} from "Common/Types/Monitor/MonitorStepSqlMonitor";
import DatabaseMonitorStepForm from "./DatabaseMonitor/DatabaseMonitorStepForm";
import MonitorStepDatabaseMonitor, {
  MonitorStepDatabaseMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import DomainMonitorStepForm from "./DomainMonitor/DomainMonitorStepForm";
import MonitorStepDomainMonitor, {
  MonitorStepDomainMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDomainMonitor";
import DnssecMonitorStepForm from "./DnssecMonitor/DnssecMonitorStepForm";
import MonitorStepDnssecMonitor, {
  MonitorStepDnssecMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDnssecMonitor";
import ExternalStatusPageMonitorStepForm from "./ExternalStatusPageMonitor/ExternalStatusPageMonitorStepForm";
import ProbeStatusMonitorStepForm from "./ProbeStatusMonitor/ProbeStatusMonitorStepForm";
import MonitorStepProbeStatusMonitor, {
  MonitorStepProbeStatusMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProbeStatusMonitor";
import MonitorStepExternalStatusPageMonitor, {
  MonitorStepExternalStatusPageMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import {
  getRequestTimeoutField,
  getRetriesOnFailureField,
  MonitorStepFieldHelp,
  PROBE_DEFAULT_RETRY_COUNT_LABEL,
} from "../../../Utils/MonitorRetryHelpText";
import SyntheticMonitorCopy from "../../../Utils/Form/Monitor/SyntheticMonitorCopy";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  getMonitorDestinationFieldCopy,
  MONITOR_PORT_FIELD_DESCRIPTION,
  MonitorDestinationFieldCopy,
  NTP_PORT_FIELD_DESCRIPTION,
  NTP_PORT_FIELD_ERROR,
} from "../../../Utils/Form/Monitor/MonitorDestinationFieldCopy";
import { DEFAULT_NTP_PORT } from "Common/Types/Monitor/NtpMonitor/NtpMonitorUtil";
import {
  SnmpTableDefinition,
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";

/*
 * The interface picker on an SNMP criteria is a picker, not an inventory. A
 * chassis switch can expose thousands of subinterfaces, so the list the
 * criteria editor asks for is bounded and never grows with the device.
 */
const MAX_NETWORK_INTERFACES_IN_CRITERIA_PICKER: number = 500;

/*
 * What the fetch below answers with: the catalogue minus isLoaded, which is
 * not the fetch's to report - a resolved promise says nothing about whether
 * the device it resolved for is still the selected one.
 */
type NetworkDeviceCatalogueData = Omit<
  NetworkDeviceCriteriaCatalogue,
  "isLoaded"
>;

export interface ComponentProps {
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  incidentRoleOptions?: Array<IncidentRoleOption> | undefined;
  value?: undefined | MonitorStep;
  onChange?: undefined | ((value: MonitorStep) => void);
  // onDelete?: undefined | (() => void);
  monitorType: MonitorType;
  isMonitorTemplate?: boolean | undefined;
  allMonitorSteps: MonitorSteps;
  probes: Array<Probe>;
  monitorId?: ObjectID | undefined; // this is used to populate secrets when testing the monitor.
  // IDs needed for Kubernetes template criteria
  onlineMonitorStatusId?: ObjectID | undefined;
  offlineMonitorStatusId?: ObjectID | undefined;
  defaultIncidentSeverityId?: ObjectID | undefined;
  defaultAlertSeverityId?: ObjectID | undefined;
  monitorName?: string | undefined;
  // Fold each criteria to its header (MonitorCriteria: foldDefaultCriteria).
  foldDefaultCriteria?: boolean | undefined;
  /*
   * For a telemetry monitor's rule (TelemetryRuleEditor): the status the
   * monitor shows when no criteria match, the project's statuses and
   * severities a rule is made with, and - on a new monitor - whether to
   * offer its recipes.
   */
  defaultMonitorStatusId?: ObjectID | undefined;
  ruleSeeds?: TelemetryRuleSeeds | undefined;
  offerRecipes?: boolean | undefined;
  // Whether the form was sent with an error in these steps.
  showErrors?: boolean | undefined;
}

/*
 * The values a telemetry rule's alert and incident titles can place: a
 * metric query's group-by keys, a Logs monitor's group-by attributes.
 */
export const getRuleSeriesAttributeKeys: (
  monitorStep: MonitorStep,
) => Array<string> = (monitorStep: MonitorStep): Array<string> => {
  return Array.from(
    new Set([
      ...(
        MonitorStepMetricViewConfigUtil.getMetricViewConfig(monitorStep.data)
          ?.queryConfigs || []
      ).flatMap((query: MetricQueryConfigData): Array<string> => {
        return query.metricQueryData?.groupByAttributeKeys || [];
      }),
      ...MonitorStepLogMonitorUtil.getGroupByAttributes(
        monitorStep.data?.logMonitor,
      ),
    ]),
  );
};

const MonitorStepElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [
    showAdvancedOptionsRequestBodyAndHeaders,
    setShowAdvancedOptionsRequestBodyAndHeaders,
  ] = useState<boolean>(false);

  const [showDoNotFollowRedirects, setShowDoNotFollowRedirects] =
    useState<boolean>(false);

  const [useTlsClientCertificate, setUseTlsClientCertificate] =
    useState<boolean>(
      Boolean(
        props.value?.data?.tlsClientCertificate ||
          props.value?.data?.tlsClientKey ||
          props.value?.data?.tlsClientKeyPassphrase,
      ),
    );

  const [
    showSyntheticMonitorAdvancedOptions,
    setShowSyntheticMonitorAdvancedOptions,
  ] = useState<boolean>(false);

  const [telemetryServices, setServices] = useState<Array<Service>>([]);

  const isRuleMonitorType: boolean = TelemetryAlertRuleUtil.isRuleMonitorType(
    props.monitorType,
  );

  const recipes: Array<TelemetryRuleRecipe> = getRecipes(props.monitorType);

  /*
   * The recipe the step's rule is, as it stood when the step was drawn, and
   * then the one picked: "Something else" stays picked once picked, though
   * the rule may still read as a recipe.
   */
  const [selectedRecipe, setSelectedRecipe] = useState<TelemetryRuleRecipeKey>(
    () => {
      return props.value && recipes.length > 0
        ? findRecipe({
            monitorType: props.monitorType,
            monitorStep: props.value,
            defaultMonitorStatusId: props.defaultMonitorStatusId,
          })
        : TelemetryRuleRecipeKey.Custom;
    },
  );

  /*
   * The query forms read their values once: a recipe that changes them
   * (Error and Fatal logs) draws them again.
   */
  const [queryFormKey, setQueryFormKey] = useState<number>(0);

  /*
   * "A message appears" asks for the words: picked, it puts the cursor in
   * Message contains - once, so a later redraw of the form (a type change)
   * leaves the cursor where it is.
   */
  const [isMessageFocusRequested, setIsMessageFocusRequested] =
    useState<boolean>(false);

  /*
   * Criteria set up afresh from outside - a new monitor type picked after
   * the step was drawn, which the steps form answers with that type's
   * recipe (MonitorSteps) - come with new criteria ids: the picker then
   * says which recipe they are, and the query forms draw their values
   * again. An edit of the rule keeps its id, so a recipe edited stays the
   * one picked, and "Something else" stays picked once picked.
   */
  const ruleCriteriaId: string | undefined =
    props.value?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray[0]
      ?.data?.id;
  const shownRuleCriteriaIdRef: React.MutableRefObject<string | undefined> =
    useRef<string | undefined>(ruleCriteriaId);

  useEffect(() => {
    if (ruleCriteriaId === shownRuleCriteriaIdRef.current) {
      return;
    }

    shownRuleCriteriaIdRef.current = ruleCriteriaId;

    if (!props.value || recipes.length === 0) {
      return;
    }

    setSelectedRecipe(
      findRecipe({
        monitorType: props.monitorType,
        monitorStep: props.value,
        defaultMonitorStatusId: props.defaultMonitorStatusId,
      }),
    );
    setQueryFormKey((key: number) => {
      return key + 1;
    });
  }, [ruleCriteriaId]);
  const [telemetryEntities, setTelemetryEntities] = useState<
    Array<InventoryItem>
  >([]);
  const [attributeKeys, setAttributeKeys] = useState<Array<string>>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchLogAttributes: PromiseVoidFunction = async (): Promise<void> => {
    const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/logs/get-attributes",
        ),
        data: {},
        headers: {
          ...ModelAPI.getCommonHeaders(),
        },
      });

    if (attributeRepsonse instanceof HTTPErrorResponse) {
      throw attributeRepsonse;
    } else {
      const attributes: Array<string> = attributeRepsonse.data[
        "attributes"
      ] as Array<string>;
      setAttributeKeys(attributes);
    }
  };

  const fetchSpanAttributes: PromiseVoidFunction = async (): Promise<void> => {
    const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/traces/get-attributes",
        ),
        data: {},
        headers: {
          ...ModelAPI.getCommonHeaders(),
        },
      });

    if (attributeRepsonse instanceof HTTPErrorResponse) {
      throw attributeRepsonse;
    } else {
      const attributes: Array<string> = attributeRepsonse.data[
        "attributes"
      ] as Array<string>;
      setAttributeKeys(attributes);
    }
  };

  const fetchServices: PromiseVoidFunction = async (): Promise<void> => {
    const telemetryServicesResult: ListResult<Service> =
      await ModelAPI.getList<Service>({
        modelType: Service,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

    if (telemetryServicesResult instanceof HTTPErrorResponse) {
      throw telemetryServicesResult;
    }

    setServices(telemetryServicesResult.data);
  };

  /*
   * The inventory-item registry (host / pod / container / ...) backing
   * the optional "scope to infrastructure entities" picker on the
   * log/trace/metric/exception monitor step forms. The picker stores
   * entityKey values which the criteria compile turns into
   * hasAny(entityKeys, [...]).
   */
  const fetchTelemetryEntities: PromiseVoidFunction =
    async (): Promise<void> => {
      const telemetryEntitiesResult: ListResult<InventoryItem> =
        await ModelAPI.getList<InventoryItem>({
          modelType: InventoryItem,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            entityKey: true,
            entityType: true,
            displayName: true,
          },
          sort: {
            displayName: SortOrder.Ascending,
          },
        });

      if (telemetryEntitiesResult instanceof HTTPErrorResponse) {
        throw telemetryEntitiesResult;
      }

      setTelemetryEntities(telemetryEntitiesResult.data);
    };

  const fetchServicesAndAttributes: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        await fetchServices();

        if (
          props.monitorType === MonitorType.Logs ||
          props.monitorType === MonitorType.Traces ||
          props.monitorType === MonitorType.Metrics ||
          props.monitorType === MonitorType.Exceptions ||
          props.monitorType === MonitorType.Profiles
        ) {
          await fetchTelemetryEntities();
        }

        if (props.monitorType === MonitorType.Logs) {
          await fetchLogAttributes();
        }

        if (props.monitorType === MonitorType.Traces) {
          await fetchSpanAttributes();
        }

        // For metrics monitor we don't need attributes because the metric view component fetches it for us. So we don't need to fetch it here.
      } catch (err) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchServicesAndAttributes().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Error));
    });
  }, [props.monitorType]);

  /*
   * What the network device this step points at actually collects.
   *
   * The SNMP OID criteria used to source their dropdown from
   * monitorStep.data.snmpMonitor.oids, a field of the retired standalone SNMP
   * monitor type that a Network Device step never writes - so the dropdown was
   * empty for everyone and no OID criteria could ever be configured. The real
   * source is the device: its OID Collection Template merged with its own
   * device-specific OIDs, resolved by the same util the poll path uses so the
   * editor shows exactly the list the probe will receive.
   *
   * Fetched once per STEP and handed down as props, following the MetricValue
   * precedent above - a criteria set can hold a dozen filters, and each of
   * them fetching this itself would be a dozen round trips for one answer.
   */
  const [networkDeviceOidCatalogue, setNetworkDeviceOidCatalogue] = useState<
    Array<NetworkDeviceOidCatalogueEntry>
  >([]);
  const [networkDeviceInterfaceNames, setNetworkDeviceInterfaceNames] =
    useState<Array<string>>([]);
  const [networkDeviceTableCatalogue, setNetworkDeviceTableCatalogue] =
    useState<Array<NetworkDeviceTableCatalogueEntry>>([]);

  /*
   * The device the catalogue currently in state was fetched for, rather than
   * a plain "loaded" flag. Comparing it to the current selection makes a
   * device change count as not-loaded from the very render it happens on,
   * instead of from whenever the effect below next runs - and a failed fetch
   * never sets it, because a request that did not answer is no evidence that
   * a saved OID or interface is gone.
   */
  const [loadedCatalogueNetworkDeviceId, setLoadedCatalogueNetworkDeviceId] =
    useState<string | undefined>(undefined);

  const selectedNetworkDeviceId: string | undefined =
    props.monitorType === MonitorType.NetworkDevice
      ? props.value?.data?.networkDeviceMonitor?.networkDeviceId || undefined
      : undefined;

  const isNetworkDeviceCatalogueLoaded: boolean = Boolean(
    selectedNetworkDeviceId &&
      loadedCatalogueNetworkDeviceId === selectedNetworkDeviceId,
  );

  const loadNetworkDeviceCatalogue: (
    networkDeviceId: string,
  ) => Promise<NetworkDeviceCatalogueData> = async (
    networkDeviceId: string,
  ): Promise<NetworkDeviceCatalogueData> => {
    const device: NetworkDevice | null = await ModelAPI.getItem<NetworkDevice>({
      modelType: NetworkDevice,
      id: new ObjectID(networkDeviceId),
      select: {
        snmpOids: true,
        snmpTables: true,
        snmpTableSnapshot: true,
        oidTemplate: {
          name: true,
          oids: true,
          tables: true,
        },
      },
    });

    const templateOids: Array<SnmpOid> = device?.oidTemplate?.oids || [];
    const templateName: string | undefined = device?.oidTemplate?.name;

    /*
     * Normalized before comparing: mergeOidLists returns canonical OIDs, and
     * ".1.3.6.1" and "1.3.6.1" are the same object spelled two ways. Without
     * this every template entry would look device-specific.
     */
    const normalizedTemplateOids: Set<string> = new Set(
      templateOids.map((entry: SnmpOid): string => {
        return SnmpOidListUtil.normalizeOid(entry.oid);
      }),
    );

    const effectiveOids: Array<SnmpOid> = SnmpOidListUtil.mergeOidLists(
      templateOids,
      device?.snmpOids || [],
    );

    const interfaceResult: ListResult<NetworkInterface> =
      await ModelAPI.getList<NetworkInterface>({
        modelType: NetworkInterface,
        query: {
          networkDeviceId: networkDeviceId,
          isMonitored: true,
        },
        limit: MAX_NETWORK_INTERFACES_IN_CRITERIA_PICKER,
        skip: 0,
        select: {
          name: true,
          alias: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

    if (interfaceResult instanceof HTTPErrorResponse) {
      throw interfaceResult;
    }

    /*
     * Aliases are offered alongside names because the server accepts either:
     * a criteria's interfaceName is matched against ifName AND ifAlias,
     * case-insensitively (SnmpMonitorCriteria.scopeInterfaces). Listing names
     * only did more than hide a valid choice - the picker then failed to find
     * an alias-scoped criteria in its own list and labelled a working
     * criteria "not on this device's last interface walk".
     *
     * Deduped case-insensitively, on the same rule, so a port whose alias only
     * differs from its name in case does not appear twice as two rows that do
     * exactly the same thing.
     */
    const seenInterfaceNames: Set<string> = new Set<string>();

    const interfaceNames: Array<string> = interfaceResult.data
      .flatMap((networkInterface: NetworkInterface): Array<string> => {
        return [
          (networkInterface.name || "").trim(),
          (networkInterface.alias || "").trim(),
        ];
      })
      .filter((interfaceName: string): boolean => {
        const key: string = interfaceName.toLowerCase();

        if (interfaceName.length === 0 || seenInterfaceNames.has(key)) {
          return false;
        }

        seenInterfaceNames.add(key);
        return true;
      });

    /*
     * The tables the device walks (template plus device-specific, merged
     * the way the poll merges them), each with the row names its last walk
     * reported so the row picker can offer them - as a walk stores them
     * now, so a row a walk no longer keeps is never offered.
     */
    const snapshots: Array<SnmpTableSnapshot> =
      SnmpTableListUtil.withListedRows(device?.snmpTableSnapshot || []);

    const tables: Array<NetworkDeviceTableCatalogueEntry> =
      SnmpTableListUtil.resolveEffectiveTables({
        templateTables: device?.oidTemplate?.tables,
        deviceTables: device?.snmpTables,
      }).tables.map(
        (definition: SnmpTableDefinition): NetworkDeviceTableCatalogueEntry => {
          const snapshot: SnmpTableSnapshot | undefined =
            SnmpTableListUtil.findSnapshot(snapshots, definition.key);

          return {
            definition: definition,
            rowNames: (snapshot?.rows || []).map(
              (row: SnmpTableSnapshotRow): string => {
                return row.label;
              },
            ),
          };
        },
      );

    return {
      tables: tables,
      oids: effectiveOids.map(
        (entry: SnmpOid): NetworkDeviceOidCatalogueEntry => {
          const isFromTemplate: boolean = normalizedTemplateOids.has(entry.oid);

          return {
            oid: entry.oid,
            ...(entry.name ? { name: entry.name } : {}),
            ...(isFromTemplate && templateName
              ? { templateName: templateName }
              : {}),
          };
        },
      ),
      interfaceNames: interfaceNames,
    };
  };

  useEffect(() => {
    let isCancelled: boolean = false;

    if (selectedNetworkDeviceId) {
      loadNetworkDeviceCatalogue(selectedNetworkDeviceId)
        .then((catalogue: NetworkDeviceCatalogueData): void => {
          if (isCancelled) {
            return;
          }

          setNetworkDeviceOidCatalogue(catalogue.oids);
          setNetworkDeviceTableCatalogue(catalogue.tables);
          setNetworkDeviceInterfaceNames(catalogue.interfaceNames);
          setLoadedCatalogueNetworkDeviceId(selectedNetworkDeviceId);
        })
        .catch((): void => {
          /*
           * Deliberately not surfaced as a form-level error. The criteria
           * pickers fall back to their empty state and every other field on
           * the step keeps working; a device the user cannot read, or one
           * deleted since the step was saved, must not blank out the whole
           * monitor editor.
           */
          if (isCancelled) {
            return;
          }

          setNetworkDeviceOidCatalogue([]);
          setNetworkDeviceTableCatalogue([]);
          setNetworkDeviceInterfaceNames([]);
          setLoadedCatalogueNetworkDeviceId(undefined);
        });
    } else {
      setNetworkDeviceOidCatalogue([]);
      setNetworkDeviceTableCatalogue([]);
      setNetworkDeviceInterfaceNames([]);
      setLoadedCatalogueNetworkDeviceId(undefined);
    }

    return () => {
      isCancelled = true;
    };
  }, [selectedNetworkDeviceId]);

  const [errors, setErrors] = useState<Dictionary<string>>({});
  const [touched, setTouched] = useState<Dictionary<boolean>>({});

  const requestTypeDropdownOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(HTTPMethod);

  const [destinationInputValue, setDestinationInputValue] = useState<string>(
    props.value?.data?.monitorDestination?.toString() || "",
  );

  let exampleScript: string = "";

  if (props.monitorType === MonitorType.CustomJavaScriptCode) {
    exampleScript = `
// You can use axios, http modules here.
const response = await axios.get('https://example.com');

// To capture custom metrics, use oneuptime.captureMetric(name, value, attributes)
// These metrics can be charted on dashboards via the Metric Explorer.
oneuptime.captureMetric('api.response.time', response.data.latency);
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1'
});

// when you want to return a value, use return statement with data as a prop.

return {
    data: 'Hello World'
};
        `;
  }

  if (props.monitorType === MonitorType.SyntheticMonitor) {
    exampleScript = `
// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: OneUptime's secure Playwright-compatible Page facade
// - screenshots: Pre-declared object to collect screenshots (preserved even if the script throws)
// - browserType: Browser type in the current run context - Chromium or Firefox
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop
// - oneuptime.captureMetric: Capture custom metrics for dashboards

await page.goto('https://playwright.dev/');

// OneUptime Synthetic Monitor docs: ${DOCS_URL.toString()}/monitor/synthetic-monitor

// To take screenshots, assign them to the provided \`screenshots\` object.
// Screenshots captured this way are preserved even when the script throws,
// so failed runs still have visual evidence attached.

screenshots['screenshot-name'] = await page.screenshot(); // you can save multiple screenshots with different names.

// To capture custom metrics, use oneuptime.captureMetric(name, value, attributes)
// These metrics can be charted on dashboards via the Metric Explorer.
const startTime = Date.now();
await page.waitForSelector('h1');
oneuptime.captureMetric('page.load.time', Date.now() - startTime);

// To log data, use console.log
console.log('Hello World');

// when you want to return a value, use return statement with data as a prop.

return {
    data: 'Hello World'
};
        `;
  }

  // The address field's name, help and example, by monitor type.
  const destinationFieldCopy: MonitorDestinationFieldCopy | null =
    getMonitorDestinationFieldCopy(props.monitorType);

  const hasMonitorDestination: boolean =
    props.monitorType === MonitorType.IP ||
    props.monitorType === MonitorType.Ping ||
    props.monitorType === MonitorType.Port ||
    props.monitorType === MonitorType.Website ||
    props.monitorType === MonitorType.API ||
    props.monitorType === MonitorType.SSLCertificate ||
    props.monitorType === MonitorType.NTP;

  const isCodeMonitor: boolean =
    props.monitorType === MonitorType.CustomJavaScriptCode ||
    props.monitorType === MonitorType.SyntheticMonitor;

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const monitorStep: MonitorStep = props.value || new MonitorStep();

  // The full criteria editor: every type's, and a telemetry rule's fallback.
  const criteriaElement: ReactElement = (
    <MonitorCriteriaElement
      monitorType={props.monitorType}
      monitorStep={monitorStep}
      foldDefaultCriteria={props.foldDefaultCriteria}
      networkDeviceOidCatalogue={networkDeviceOidCatalogue}
      networkDeviceInterfaceNames={networkDeviceInterfaceNames}
      networkDeviceTableCatalogue={networkDeviceTableCatalogue}
      isNetworkDeviceCatalogueLoaded={isNetworkDeviceCatalogueLoaded}
      offlineMonitorStatusId={props.offlineMonitorStatusId}
      monitorStatusDropdownOptions={props.monitorStatusDropdownOptions}
      incidentSeverityDropdownOptions={props.incidentSeverityDropdownOptions}
      alertSeverityDropdownOptions={props.alertSeverityDropdownOptions}
      onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
      labelDropdownOptions={props.labelDropdownOptions}
      userDropdownOptions={props.userDropdownOptions}
      incidentRoleOptions={props.incidentRoleOptions}
      value={monitorStep?.data?.monitorCriteria}
      onChange={(value: MonitorCriteria) => {
        // An echo of criteria the step form has just replaced (a default alert).
        if (
          ReplacedCriteriaEdit.isEditOfReplacedCriteria({
            current: monitorStep.data?.monitorCriteria,
            edited: value,
          })
        ) {
          return;
        }

        monitorStep.setMonitorCriteria(value);
        props.onChange?.(MonitorStep.clone(monitorStep));
      }}
    />
  );

  /*
   * What the monitor type's More fields section holds, for its folded
   * header: the options by name, and the ones that are set as chips. The
   * section starts folded, as every More fields section does - the chips
   * say what is set - and stays open once someone opens it.
   */
  const moreFieldsItems: Array<FoldedSectionItem> =
    getMonitorStepMoreFieldsItems({
      monitorType: props.monitorType,
      monitorStep: monitorStep,
      usesClientCertificate: useTlsClientCertificate,
    });

  /*
   * The timeout field starts on the default the probe really uses for this
   * type: 5 seconds for NTP, 60 for the TCP and HTTP checks. Both fields say
   * what they are in one line; the exact rule waits in the (i) by the title.
   */
  const requestTimeoutField: MonitorStepFieldHelp & {
    defaultSeconds: number;
  } = getRequestTimeoutField(props.monitorType);

  const retriesOnFailureField: MonitorStepFieldHelp = getRetriesOnFailureField(
    props.monitorType,
  );

  const renderTimeoutAndRetryFields: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div>
          <FieldLabelElement
            title={"Request Timeout (seconds)"}
            description={requestTimeoutField.description}
            tooltip={requestTimeoutField.tooltip}
            required={false}
          />
          <Input
            initialValue={
              monitorStep.data?.requestTimeoutInMs
                ? Math.round(
                    monitorStep.data.requestTimeoutInMs / 1000,
                  ).toString()
                : requestTimeoutField.defaultSeconds.toString()
            }
            onChange={(value: string) => {
              const seconds: number = parseInt(value);
              if (isNaN(seconds) || seconds <= 0) {
                monitorStep.setRequestTimeoutInMs(undefined);
              } else {
                const clampedSeconds: number = seconds > 60 ? 60 : seconds;
                monitorStep.setRequestTimeoutInMs(clampedSeconds * 1000);
              }
              if (props.onChange) {
                props.onChange(MonitorStep.clone(monitorStep));
              }
            }}
            placeholder={requestTimeoutField.defaultSeconds.toString()}
            type={InputType.NUMBER}
          />
        </div>

        <div>
          <FieldLabelElement
            title={"Retries on Failure"}
            description={retriesOnFailureField.description}
            tooltip={retriesOnFailureField.tooltip}
            required={false}
          />
          <Input
            value={
              monitorStep.data?.retryCount !== undefined &&
              monitorStep.data?.retryCount !== null
                ? monitorStep.data.retryCount.toString()
                : ""
            }
            onChange={(value: string) => {
              const num: number = parseInt(value);
              if (isNaN(num)) {
                monitorStep.setRetryCount(undefined);
              } else {
                const clamped: number = num < 0 ? 0 : num > 3 ? 3 : num;
                monitorStep.setRetryCount(clamped);
              }
              if (props.onChange) {
                props.onChange(MonitorStep.clone(monitorStep));
              }
            }}
            placeholder={PROBE_DEFAULT_RETRY_COUNT_LABEL}
            ariaLabel="Retries on Failure"
            type={InputType.NUMBER}
          />
        </div>
      </>
    );
  };

  return (
    <div className="mt-5 space-y-6">
      <MonitorTemplateSyncFields
        monitorType={props.monitorType}
        value={monitorStep}
        isMonitorTemplate={props.isMonitorTemplate}
        onChange={props.onChange}
      />
      {isRuleMonitorType && props.offerRecipes && recipes.length > 0 ? (
        <TelemetryRuleRecipePicker
          monitorType={props.monitorType}
          value={selectedRecipe}
          onChange={(key: TelemetryRuleRecipeKey) => {
            setSelectedRecipe(key);

            const recipe: TelemetryRuleRecipe | null = getRecipe(key);

            if (!recipe || !props.ruleSeeds) {
              return;
            }

            props.onChange?.(
              applyRecipe({
                monitorStep,
                recipe,
                seeds: props.ruleSeeds,
                translator,
              }),
            );
            setIsMessageFocusRequested(
              key === TelemetryRuleRecipeKey.LogMessage,
            );
            setQueryFormKey(queryFormKey + 1);
          }}
        />
      ) : (
        <></>
      )}
      {/* Monitor Target Card */}
      {/*
       * The address field below says what to enter, so the card's title is
       * all it needs: its old description said nothing the field does not.
       */}
      {hasMonitorDestination && (
        <Card title="Monitor Target">
          <div className="space-y-4">
            <div>
              <FieldLabelElement
                title={destinationFieldCopy?.title || "URL"}
                description={destinationFieldCopy?.description}
                required={true}
              />
              <Input
                initialValue={destinationInputValue}
                placeholder={destinationFieldCopy?.placeholder}
                disableSpellCheck={true}
                onBlur={() => {
                  setTouched({
                    ...touched,
                    destination: true,
                  });

                  const parsed: ParsedMonitorDestination =
                    MonitorDestinationUtil.parse({
                      value: destinationInputValue,
                      monitorType: props.monitorType,
                    });

                  setErrors({
                    ...errors,
                    destination: parsed.error || "",
                  });

                  /*
                   * Only a value that PARSED is echoed back into the field.
                   * This used to rewrite the input from the step whenever the
                   * step held anything at all, which put the previously saved
                   * address back over what the operator had just typed and
                   * cleared the error explaining why it had not been kept.
                   */
                  if (parsed.destination) {
                    setDestinationInputValue(parsed.destination.toString());
                  }
                }}
                error={
                  touched["destination"] && errors["destination"]
                    ? errors["destination"]
                    : undefined
                }
                onChange={(value: string) => {
                  const parsed: ParsedMonitorDestination =
                    MonitorDestinationUtil.parse({
                      value: value,
                      monitorType: props.monitorType,
                    });

                  setErrors({
                    ...errors,
                    destination: parsed.error || "",
                  });

                  /*
                   * The step is written on EVERY keystroke, including the
                   * ones that do not parse, where it is cleared.
                   *
                   * It used to be written only when a value parsed, and never
                   * cleared — so a step kept whatever last parsed while the
                   * field showed something else entirely. Editing a monitor's
                   * address left the OLD one saved, and half-typed IPv6 made
                   * that routine: "2001:518:2800:9::" parses (it is a real
                   * address) one keystroke before the operator finishes
                   * typing "2001:518:2800:9::2".
                   */
                  monitorStep.setMonitorDestination(parsed.destination);

                  setDestinationInputValue(value);
                  if (props.onChange) {
                    props.onChange(MonitorStep.clone(monitorStep));
                  }
                }}
              />
            </div>

            {(props.monitorType === MonitorType.API ||
              props.monitorType === MonitorType.Website) && (
              <TinyFormDocumentation title="URL placeholder help">
                <>
                  <div>
                    <TranslatedSentence
                      template="{{placeholder}} — replaced with current Unix timestamp"
                      slots={{
                        placeholder: (
                          <code className="bg-gray-100 px-1 rounded">
                            {"{{timestamp}}"}
                          </code>
                        ),
                      }}
                    />
                  </div>
                  <div>
                    <TranslatedSentence
                      template="{{placeholder}} — replaced with a random unique string"
                      slots={{
                        placeholder: (
                          <code className="bg-gray-100 px-1 rounded">
                            {"{{random}}"}
                          </code>
                        ),
                      }}
                    />
                  </div>
                  <div>
                    <TranslatedSentence
                      template="Example: {{url}}"
                      slots={{
                        url: (
                          <code className="bg-gray-100 px-1 rounded">
                            {"https://example.com?cb={{timestamp}}"}
                          </code>
                        ),
                      }}
                    />
                  </div>
                  <div>
                    {translator.translateText(
                      "Useful for busting CDN or proxy caches on each check.",
                    )}{" "}
                    <Link
                      className="underline"
                      openInNewTab={true}
                      to={URL.fromString(
                        DOCS_URL.toString() +
                          (props.monitorType === MonitorType.API
                            ? "/monitor/api-monitor"
                            : "/monitor/website-monitor"),
                      )}
                    >
                      {translator.translateText("Learn more.")}
                    </Link>
                  </div>
                </>
              </TinyFormDocumentation>
            )}

            {props.monitorType === MonitorType.Port && (
              <div>
                <FieldLabelElement
                  title={"Port"}
                  description={MONITOR_PORT_FIELD_DESCRIPTION}
                  required={true}
                />
                <Input
                  initialValue={monitorStep?.data?.monitorDestinationPort?.toString()}
                  placeholder="443"
                  onChange={(value: string) => {
                    const port: Port = new Port(value);
                    monitorStep.setPort(port);
                    if (props.onChange) {
                      props.onChange(MonitorStep.clone(monitorStep));
                    }
                  }}
                />
              </div>
            )}

            {props.monitorType === MonitorType.API && (
              <div>
                <FieldLabelElement
                  title={"API Request Type"}
                  description={"GET unless the endpoint needs another method."}
                  required={true}
                />
                {/*
                 * A request always has a method, so nothing to clear: an
                 * emptied box sent GET anyway.
                 */}
                <Dropdown
                  isClearable={false}
                  initialValue={requestTypeDropdownOptions.find(
                    (i: DropdownOption) => {
                      return (
                        i.value ===
                        (monitorStep?.data?.requestType || HTTPMethod.GET)
                      );
                    },
                  )}
                  options={requestTypeDropdownOptions}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    monitorStep.setRequestType(
                      (value?.toString() as HTTPMethod) || HTTPMethod.GET,
                    );
                    if (props.onChange) {
                      props.onChange(MonitorStep.clone(monitorStep));
                    }
                  }}
                />
              </div>
            )}
            {/*
             * The request settings are More fields of the target, so they
             * sit in its card, after its last field: More fields is one
             * quiet line now, not a card of its own, and drawn after this
             * card it would open its fields loose between two cards.
             *
             * More fields for API monitors: headers, body, redirects, TLS, then
             * the timeout and the retries - all of them named by the description.
             */}
            {props.monitorType === MonitorType.API && (
              <FoldedSection
                title={MORE_FIELDS_SECTION_TITLE}
                description="Headers, body, redirect, TLS, timeout and retry settings"
                items={moreFieldsItems}
                defaultCollapsed={!showAdvancedOptionsRequestBodyAndHeaders}
                dataTestId="monitor-step-more-fields"
                onToggle={(isCollapsed: boolean) => {
                  if (!isCollapsed) {
                    setShowAdvancedOptionsRequestBodyAndHeaders(true);
                  }
                }}
              >
                <div className="space-y-4">
                  <div>
                    <FieldLabelElement
                      title={"Request Headers"}
                      description={
                        <p>
                          {translator.translateText("Sent with every request.")}{" "}
                          <Link
                            className="underline"
                            openInNewTab={true}
                            to={URL.fromString(
                              DOCS_URL.toString() + "/monitor/monitor-secrets",
                            )}
                          >
                            {translator.translateText(
                              "You can use secrets here.",
                            )}
                          </Link>
                        </p>
                      }
                      required={false}
                    />
                    <DictionaryOfStrings
                      addButtonSuffix="Request Header"
                      keyPlaceholder={"Header Name"}
                      valuePlaceholder={"Header Value"}
                      initialValue={monitorStep.data?.requestHeaders || {}}
                      onChange={(value: Dictionary<string>) => {
                        monitorStep.setRequestHeaders(value);
                        if (props.onChange) {
                          props.onChange(MonitorStep.clone(monitorStep));
                        }
                      }}
                    />
                  </div>

                  <div>
                    <FieldLabelElement
                      title={"Request Body (in JSON)"}
                      description={
                        <p>
                          {translator.translateText(
                            "Sent with every request, as JSON.",
                          )}{" "}
                          <Link
                            className="underline"
                            openInNewTab={true}
                            to={URL.fromString(
                              DOCS_URL.toString() + "/monitor/monitor-secrets",
                            )}
                          >
                            {translator.translateText(
                              "You can use secrets here.",
                            )}
                          </Link>
                        </p>
                      }
                      required={false}
                    />
                    <CodeEditor
                      type={CodeType.JSON}
                      onBlur={() => {
                        setTouched({
                          ...touched,
                          requestBody: true,
                        });
                      }}
                      error={
                        touched["requestBody"] && errors["requestBody"]
                          ? errors["requestBody"]
                          : undefined
                      }
                      initialValue={monitorStep.data?.requestBody}
                      onChange={(value: string) => {
                        try {
                          JSON.parse(value);
                          setErrors({
                            ...errors,
                            requestBody: "",
                          });
                        } catch {
                          setErrors({
                            ...errors,
                            requestBody: "Invalid JSON",
                          });
                        }

                        monitorStep.setRequestBody(value);
                        if (props.onChange) {
                          props.onChange(MonitorStep.clone(monitorStep));
                        }
                      }}
                    />
                  </div>

                  <div>
                    <CheckboxElement
                      initialValue={
                        monitorStep.data?.doNotFollowRedirects || false
                      }
                      title={"Do not follow redirects"}
                      description="Check the redirect response itself, not the page it leads to."
                      onChange={(value: boolean) => {
                        monitorStep.setDoNotFollowRedirects(value);
                        if (props.onChange) {
                          props.onChange(MonitorStep.clone(monitorStep));
                        }
                      }}
                    />
                  </div>

                  <div>
                    <CheckboxElement
                      initialValue={
                        monitorStep.data?.allowSelfSignedCertificates || false
                      }
                      title={"Allow self-signed certificates"}
                      description="Skip certificate validation for this host, so self-signed certificates work."
                      onChange={(value: boolean) => {
                        monitorStep.setAllowSelfSignedCertificates(value);
                        if (props.onChange) {
                          props.onChange(MonitorStep.clone(monitorStep));
                        }
                      }}
                    />
                  </div>

                  <div>
                    <CheckboxElement
                      initialValue={useTlsClientCertificate}
                      title={"Use client certificate (mTLS)"}
                      description="Authenticate to the endpoint with a client certificate and private key, like curl --cert / --key."
                      onChange={(value: boolean) => {
                        setUseTlsClientCertificate(value);
                        if (!value) {
                          monitorStep.setTlsClientCertificate(undefined);
                          monitorStep.setTlsClientKey(undefined);
                          monitorStep.setTlsClientKeyPassphrase(undefined);
                          if (props.onChange) {
                            props.onChange(MonitorStep.clone(monitorStep));
                          }
                        }
                      }}
                    />
                  </div>

                  {useTlsClientCertificate && (
                    <>
                      <div>
                        <FieldLabelElement
                          title={"Client Certificate (PEM)"}
                          description={
                            <p>
                              <TranslatedSentence
                                template="Client certificate (mTLS). Paste the PEM-encoded certificate, or reference a monitor secret with {{secret}}."
                                slots={{
                                  secret: (
                                    <code className="bg-gray-100 px-1 rounded">
                                      {"{{monitorSecrets.name}}"}
                                    </code>
                                  ),
                                }}
                              />{" "}
                              <Link
                                className="underline"
                                openInNewTab={true}
                                to={URL.fromString(
                                  DOCS_URL.toString() +
                                    "/monitor/monitor-secrets",
                                )}
                              >
                                {translator.translateText(
                                  "Learn more about secrets.",
                                )}
                              </Link>
                            </p>
                          }
                          required={true}
                        />
                        <TextArea
                          initialValue={
                            monitorStep.data?.tlsClientCertificate || ""
                          }
                          disableSpellCheck={true}
                          placeholder={
                            "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----"
                          }
                          onChange={(value: string) => {
                            monitorStep.setTlsClientCertificate(value);
                            if (props.onChange) {
                              props.onChange(MonitorStep.clone(monitorStep));
                            }
                          }}
                        />
                      </div>

                      <div>
                        <FieldLabelElement
                          title={"Client Private Key (PEM)"}
                          description={
                            <p>
                              <TranslatedSentence
                                template="Private key paired with the client certificate above. Reference a monitor secret with {{secret}} to keep the key encrypted at rest."
                                slots={{
                                  secret: (
                                    <code className="bg-gray-100 px-1 rounded">
                                      {"{{monitorSecrets.name}}"}
                                    </code>
                                  ),
                                }}
                              />
                            </p>
                          }
                          required={true}
                        />
                        <TextArea
                          initialValue={monitorStep.data?.tlsClientKey || ""}
                          disableSpellCheck={true}
                          placeholder={
                            "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"
                          }
                          onChange={(value: string) => {
                            monitorStep.setTlsClientKey(value);
                            if (props.onChange) {
                              props.onChange(MonitorStep.clone(monitorStep));
                            }
                          }}
                        />
                      </div>

                      <div>
                        <FieldLabelElement
                          title={"Client Private Key Passphrase"}
                          description={
                            "Optional passphrase if the private key above is encrypted."
                          }
                          required={false}
                        />
                        <Input
                          initialValue={
                            monitorStep.data?.tlsClientKeyPassphrase || ""
                          }
                          onChange={(value: string) => {
                            monitorStep.setTlsClientKeyPassphrase(value);
                            if (props.onChange) {
                              props.onChange(MonitorStep.clone(monitorStep));
                            }
                          }}
                          placeholder="Leave blank if the key is not encrypted"
                        />
                      </div>
                    </>
                  )}

                  {renderTimeoutAndRetryFields()}
                </div>
              </FoldedSection>
            )}

            {/* More fields for Website monitors: redirects, TLS, timeout, retries. */}
            {props.monitorType === MonitorType.Website && (
              <FoldedSection
                title={MORE_FIELDS_SECTION_TITLE}
                description="Redirect, TLS, timeout and retry settings"
                items={moreFieldsItems}
                defaultCollapsed={!showDoNotFollowRedirects}
                dataTestId="monitor-step-more-fields"
                onToggle={(isCollapsed: boolean) => {
                  if (!isCollapsed) {
                    setShowDoNotFollowRedirects(true);
                  }
                }}
              >
                <div className="space-y-4">
                  <div>
                    <CheckboxElement
                      initialValue={
                        monitorStep.data?.doNotFollowRedirects || false
                      }
                      title={"Do not follow redirects"}
                      description="Check the redirect response itself, not the page it leads to."
                      onChange={(value: boolean) => {
                        monitorStep.setDoNotFollowRedirects(value);
                        if (props.onChange) {
                          props.onChange(MonitorStep.clone(monitorStep));
                        }
                      }}
                    />
                  </div>

                  <div>
                    <CheckboxElement
                      initialValue={
                        monitorStep.data?.allowSelfSignedCertificates || false
                      }
                      title={"Allow self-signed certificates"}
                      description="Skip certificate validation for this host, so self-signed certificates work."
                      onChange={(value: boolean) => {
                        monitorStep.setAllowSelfSignedCertificates(value);
                        if (props.onChange) {
                          props.onChange(MonitorStep.clone(monitorStep));
                        }
                      }}
                    />
                  </div>

                  <div>
                    <CheckboxElement
                      initialValue={useTlsClientCertificate}
                      title={"Use client certificate (mTLS)"}
                      description="Authenticate to the endpoint with a client certificate and private key, like curl --cert / --key."
                      onChange={(value: boolean) => {
                        setUseTlsClientCertificate(value);
                        if (!value) {
                          monitorStep.setTlsClientCertificate(undefined);
                          monitorStep.setTlsClientKey(undefined);
                          monitorStep.setTlsClientKeyPassphrase(undefined);
                          if (props.onChange) {
                            props.onChange(MonitorStep.clone(monitorStep));
                          }
                        }
                      }}
                    />
                  </div>

                  {useTlsClientCertificate && (
                    <>
                      <div>
                        <FieldLabelElement
                          title={"Client Certificate (PEM)"}
                          description={
                            <p>
                              <TranslatedSentence
                                template="Client certificate (mTLS). Paste the PEM-encoded certificate, or reference a monitor secret with {{secret}}."
                                slots={{
                                  secret: (
                                    <code className="bg-gray-100 px-1 rounded">
                                      {"{{monitorSecrets.name}}"}
                                    </code>
                                  ),
                                }}
                              />{" "}
                              <Link
                                className="underline"
                                openInNewTab={true}
                                to={URL.fromString(
                                  DOCS_URL.toString() +
                                    "/monitor/monitor-secrets",
                                )}
                              >
                                {translator.translateText(
                                  "Learn more about secrets.",
                                )}
                              </Link>
                            </p>
                          }
                          required={true}
                        />
                        <TextArea
                          initialValue={
                            monitorStep.data?.tlsClientCertificate || ""
                          }
                          disableSpellCheck={true}
                          placeholder={
                            "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----"
                          }
                          onChange={(value: string) => {
                            monitorStep.setTlsClientCertificate(value);
                            if (props.onChange) {
                              props.onChange(MonitorStep.clone(monitorStep));
                            }
                          }}
                        />
                      </div>

                      <div>
                        <FieldLabelElement
                          title={"Client Private Key (PEM)"}
                          description={
                            <p>
                              <TranslatedSentence
                                template="Private key paired with the client certificate above. Reference a monitor secret with {{secret}} to keep the key encrypted at rest."
                                slots={{
                                  secret: (
                                    <code className="bg-gray-100 px-1 rounded">
                                      {"{{monitorSecrets.name}}"}
                                    </code>
                                  ),
                                }}
                              />
                            </p>
                          }
                          required={true}
                        />
                        <TextArea
                          initialValue={monitorStep.data?.tlsClientKey || ""}
                          disableSpellCheck={true}
                          placeholder={
                            "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"
                          }
                          onChange={(value: string) => {
                            monitorStep.setTlsClientKey(value);
                            if (props.onChange) {
                              props.onChange(MonitorStep.clone(monitorStep));
                            }
                          }}
                        />
                      </div>

                      <div>
                        <FieldLabelElement
                          title={"Client Private Key Passphrase"}
                          description={
                            "Optional passphrase if the private key above is encrypted."
                          }
                          required={false}
                        />
                        <Input
                          initialValue={
                            monitorStep.data?.tlsClientKeyPassphrase || ""
                          }
                          onChange={(value: string) => {
                            monitorStep.setTlsClientKeyPassphrase(value);
                            if (props.onChange) {
                              props.onChange(MonitorStep.clone(monitorStep));
                            }
                          }}
                          placeholder="Leave blank if the key is not encrypted"
                        />
                      </div>
                    </>
                  )}

                  {renderTimeoutAndRetryFields()}
                </div>
              </FoldedSection>
            )}

            {/*
             * More fields for NTP monitors: the port, which nearly everyone leaves
             * at 123, then the timeout and the retries.
             */}
            {props.monitorType === MonitorType.NTP && (
              <FoldedSection
                title={MORE_FIELDS_SECTION_TITLE}
                description="Port, timeout and retry settings"
                items={moreFieldsItems}
                dataTestId="monitor-step-more-fields"
              >
                <div className="space-y-4">
                  <div>
                    <FieldLabelElement
                      title={"Port"}
                      description={NTP_PORT_FIELD_DESCRIPTION}
                      required={false}
                    />
                    <Input
                      initialValue={
                        monitorStep.data?.monitorDestinationPort?.toString() ||
                        ""
                      }
                      placeholder={DEFAULT_NTP_PORT.toString()}
                      type={InputType.NUMBER}
                      ariaLabel="Port"
                      error={errors["ntpPort"] ? errors["ntpPort"] : undefined}
                      onChange={(value: string) => {
                        const trimmed: string = value.trim();
                        const portNumber: number = Number(trimmed);
                        const isValidPort: boolean =
                          Number.isInteger(portNumber) &&
                          portNumber >= 1 &&
                          portNumber <= 65535;

                        setErrors({
                          ...errors,
                          ntpPort:
                            trimmed && !isValidPort ? NTP_PORT_FIELD_ERROR : "",
                        });

                        monitorStep.setPort(
                          trimmed && isValidPort
                            ? new Port(portNumber)
                            : undefined,
                        );

                        if (props.onChange) {
                          props.onChange(MonitorStep.clone(monitorStep));
                        }
                      }}
                    />
                  </div>
                  {renderTimeoutAndRetryFields()}
                </div>
              </FoldedSection>
            )}

            {/* More fields for Ping, IP, Port and SSL monitors: timeout, retries. */}
            {(props.monitorType === MonitorType.Ping ||
              props.monitorType === MonitorType.IP ||
              props.monitorType === MonitorType.Port ||
              props.monitorType === MonitorType.SSLCertificate) && (
              <FoldedSection
                title={MORE_FIELDS_SECTION_TITLE}
                description="Timeout and retry settings"
                items={moreFieldsItems}
                dataTestId="monitor-step-more-fields"
              >
                <div className="space-y-4">{renderTimeoutAndRetryFields()}</div>
              </FoldedSection>
            )}
          </div>
        </Card>
      )}

      {/* Telemetry Monitor Forms */}
      {props.monitorType === MonitorType.Logs && (
        <Card
          title="Logs to watch"
          description="The logs this monitor counts. A filter left empty matches every log."
        >
          <LogMonitorStepForm
            key={`logs-${queryFormKey}`}
            focusMessageField={isMessageFocusRequested}
            onMessageFieldFocused={() => {
              setIsMessageFocusRequested(false);
            }}
            monitorStepLogMonitor={
              monitorStep.data?.logMonitor ||
              MonitorStepLogMonitorUtil.getDefault()
            }
            onMonitorStepLogMonitorChanged={(value: MonitorStepLogMonitor) => {
              /*
               * The window is the rule's ("When to alert"): the step holds
               * it, and the filters form never sets it.
               */
              monitorStep.setLogMonitor({
                ...value,
                lastXSecondsOfLogs:
                  TelemetryAlertRuleUtil.getWindowInSeconds({
                    monitorType: props.monitorType,
                    monitorStep,
                  }) || value.lastXSecondsOfLogs,
              });
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            attributeKeys={attributeKeys}
            telemetryServices={telemetryServices}
            telemetryEntities={telemetryEntities}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.SecurityEvents && (
        <Card title="Security Events Monitor Configuration">
          <SecurityEventsMonitorStepForm
            monitorStepSecurityEventsMonitor={
              monitorStep.data?.securityEventsMonitor ||
              MonitorStepSecurityEventsMonitorUtil.getDefault()
            }
            onMonitorStepSecurityEventsMonitorChanged={(
              value: MonitorStepSecurityEventsMonitor,
            ) => {
              monitorStep.setSecurityEventsMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            telemetryServices={telemetryServices}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Llm && (
        <Card
          title="What counts as a bad answer"
          description="Pick the problems that count, and where to look. The criteria below decide how many bad answers are too many."
        >
          <LlmMonitorStepForm
            monitorStepLlmMonitor={
              monitorStep.data?.llmMonitor ||
              MonitorStepLlmMonitorUtil.getDefault()
            }
            onMonitorStepLlmMonitorChanged={(value: MonitorStepLlmMonitor) => {
              monitorStep.setLlmMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            telemetryServices={telemetryServices}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Metrics && (
        <Card
          title="Metric to watch"
          description="The metric this monitor reads, picked and narrowed down as in the Metrics explorer. The red line on its chart is the value the rule compares with."
        >
          <MetricMonitorStepForm
            previewRule={
              TelemetryAlertRuleUtil.read({
                monitorType: props.monitorType,
                monitorStep,
                defaultMonitorStatusId: props.defaultMonitorStatusId,
              }).rule
            }
            monitorStepMetricMonitor={
              monitorStep.data?.metricMonitor ||
              MonitorStepMetricMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepMetricMonitor) => {
              monitorStep.setMetricMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Kubernetes && (
        <Card
          title="Kubernetes Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <KubernetesMonitorStepForm
            monitorStepKubernetesMonitor={
              monitorStep.data?.kubernetesMonitor ||
              MonitorStepKubernetesMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepKubernetesMonitor) => {
              monitorStep.setKubernetesMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Docker && (
        <Card
          title="Docker Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <DockerMonitorStepForm
            monitorStepDockerMonitor={
              monitorStep.data?.dockerMonitor ||
              MonitorStepDockerMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepDockerMonitor) => {
              monitorStep.setDockerMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Host && (
        <Card
          title="Host Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <HostMonitorStepForm
            monitorStepHostMonitor={
              monitorStep.data?.hostMonitor ||
              MonitorStepHostMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepHostMonitor) => {
              monitorStep.setHostMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Podman && (
        <Card
          title="Podman Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <PodmanMonitorStepForm
            monitorStepPodmanMonitor={
              monitorStep.data?.podmanMonitor ||
              MonitorStepPodmanMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepPodmanMonitor) => {
              monitorStep.setPodmanMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Proxmox && (
        <Card
          title="Proxmox Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <ProxmoxMonitorStepForm
            monitorStepProxmoxMonitor={
              monitorStep.data?.proxmoxMonitor ||
              MonitorStepProxmoxMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepProxmoxMonitor) => {
              monitorStep.setProxmoxMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.VMware && (
        <Card
          title="VMware Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <VMwareMonitorStepForm
            monitorStepVMwareMonitor={
              monitorStep.data?.vmwareMonitor ||
              MonitorStepVMwareMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepVMwareMonitor) => {
              monitorStep.setVMwareMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.IoTDevice && (
        <Card
          title="IoT Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <IoTMonitorStepForm
            monitorStepIoTMonitor={
              monitorStep.data?.iotMonitor ||
              MonitorStepIoTMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepIoTMonitor) => {
              monitorStep.setIoTMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.DockerSwarm && (
        <Card
          title="Docker Swarm Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <DockerSwarmMonitorStepForm
            monitorStepDockerSwarmMonitor={
              monitorStep.data?.dockerSwarmMonitor ||
              MonitorStepDockerSwarmMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepDockerSwarmMonitor) => {
              monitorStep.setDockerSwarmMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Ceph && (
        <Card
          title="Ceph Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <CephMonitorStepForm
            monitorStepCephMonitor={
              monitorStep.data?.cephMonitor ||
              MonitorStepCephMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepCephMonitor) => {
              monitorStep.setCephMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.StorageArray && (
        <Card
          title="Storage Array Monitor Configuration"
          description={INFRASTRUCTURE_MONITOR_CONFIGURATION_DESCRIPTION}
        >
          <StorageArrayMonitorStepForm
            monitorStepStorageArrayMonitor={
              monitorStep.data?.storageArrayMonitor ||
              MonitorStepStorageArrayMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepStorageArrayMonitor) => {
              monitorStep.setStorageArrayMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onMonitorCriteriaChange={(criteria: MonitorCriteria) => {
              monitorStep.setMonitorCriteria(criteria);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            onlineMonitorStatusId={props.onlineMonitorStatusId}
            offlineMonitorStatusId={props.offlineMonitorStatusId}
            defaultIncidentSeverityId={props.defaultIncidentSeverityId}
            defaultAlertSeverityId={props.defaultAlertSeverityId}
            monitorName={props.monitorName}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Traces && (
        <Card
          title="Spans to watch"
          description="The spans this monitor counts. A filter left empty matches every span."
        >
          <TraceMonitorStepForm
            key={`traces-${queryFormKey}`}
            monitorStepTraceMonitor={
              monitorStep.data?.traceMonitor ||
              MonitorStepTraceMonitorUtil.getDefault()
            }
            onMonitorStepTraceMonitorChanged={(
              value: MonitorStepTraceMonitor,
            ) => {
              // The window is the rule's, as on a Logs monitor.
              monitorStep.setTraceMonitor({
                ...value,
                lastXSecondsOfSpans:
                  TelemetryAlertRuleUtil.getWindowInSeconds({
                    monitorType: props.monitorType,
                    monitorStep,
                  }) || value.lastXSecondsOfSpans,
              });
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            attributeKeys={attributeKeys}
            telemetryServices={telemetryServices}
            telemetryEntities={telemetryEntities}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Exceptions && (
        <Card
          title="Exceptions to watch"
          description="The exceptions this monitor counts. A filter left empty matches every exception."
        >
          <ExceptionMonitorStepForm
            key={`exceptions-${queryFormKey}`}
            monitorStepExceptionMonitor={
              monitorStep.data?.exceptionMonitor ||
              MonitorStepExceptionMonitorUtil.getDefault()
            }
            telemetryServices={telemetryServices}
            telemetryEntities={telemetryEntities}
            onMonitorStepExceptionMonitorChanged={(
              value: MonitorStepExceptionMonitor,
            ) => {
              // The window is the rule's, as on a Logs monitor.
              monitorStep.setExceptionMonitor({
                ...value,
                lastXSecondsOfExceptions:
                  TelemetryAlertRuleUtil.getWindowInSeconds({
                    monitorType: props.monitorType,
                    monitorStep,
                  }) || value.lastXSecondsOfExceptions,
              });
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Profiles && (
        <Card
          title="Profiles Monitor Configuration"
          description="Which profiles the monitor reads, and the function its Function Share criteria watch"
        >
          <ProfileMonitorStepForm
            monitorStepProfileMonitor={
              monitorStep.data?.profileMonitor ||
              MonitorStepProfileMonitorUtil.getDefault()
            }
            telemetryServices={telemetryServices}
            telemetryEntities={telemetryEntities}
            onMonitorStepProfileMonitorChanged={(
              value: MonitorStepProfileMonitor,
            ) => {
              monitorStep.setProfileMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.NetworkDevice && (
        <Card
          title="Network Device Monitor Configuration"
          description="Pick the registered network device this monitor alerts on"
        >
          <NetworkDeviceMonitorStepForm
            monitorStepNetworkDeviceMonitor={
              monitorStep.data?.networkDeviceMonitor ||
              MonitorStepNetworkDeviceMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepNetworkDeviceMonitor) => {
              monitorStep.setNetworkDeviceMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.DNS && (
        <Card title="DNS Monitor Configuration">
          <DnsMonitorStepForm
            monitorStepDnsMonitor={
              monitorStep.data?.dnsMonitor ||
              MonitorStepDnsMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepDnsMonitor) => {
              monitorStep.setDnsMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.SQLQuery && (
        <Card
          title="SQL Query Monitor Configuration"
          description="Configure the database connection and the read-only query to run. This monitor requires a probe with network access to your database."
        >
          <SqlMonitorStepForm
            monitorStepSqlMonitor={
              monitorStep.data?.sqlMonitor ||
              MonitorStepSqlMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepSqlMonitor) => {
              monitorStep.setSqlMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Database && (
        <Card
          title="Database Health Monitor Configuration"
          description="Configure the database connection and the statistics this monitor collects. This monitor requires a probe with network access to your database."
        >
          <DatabaseMonitorStepForm
            monitorStepDatabaseMonitor={
              monitorStep.data?.databaseMonitor ||
              MonitorStepDatabaseMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepDatabaseMonitor) => {
              monitorStep.setDatabaseMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Domain && (
        <Card title="Domain Monitor Configuration">
          <DomainMonitorStepForm
            monitorStepDomainMonitor={
              monitorStep.data?.domainMonitor ||
              MonitorStepDomainMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepDomainMonitor) => {
              monitorStep.setDomainMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.DNSSEC && (
        <Card
          title="DNSSEC Monitor Configuration"
          description="Configure full DNSSEC validation: DNSKEY/DS/RRSIG, multi-resolver AD-flag/SERVFAIL behavior, and primary/secondary nameserver consistency."
        >
          <DnssecMonitorStepForm
            monitorStepDnssecMonitor={
              monitorStep.data?.dnssecMonitor ||
              MonitorStepDnssecMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepDnssecMonitor) => {
              monitorStep.setDnssecMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.ExternalStatusPage && (
        <Card
          title="External Status Page Configuration"
          description="Configure which external status page to monitor (e.g. AWS, GCP, GitHub)"
        >
          <ExternalStatusPageMonitorStepForm
            monitorStepExternalStatusPageMonitor={
              monitorStep.data?.externalStatusPageMonitor ||
              MonitorStepExternalStatusPageMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepExternalStatusPageMonitor) => {
              monitorStep.setExternalStatusPageMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.ProbeStatus && (
        <Card
          title="Probes to Watch"
          description="Opens one incident when one of these probes goes three minutes without a heartbeat. It resolves itself when the probe is back."
        >
          <ProbeStatusMonitorStepForm
            monitorStepProbeStatusMonitor={
              monitorStep.data?.probeStatusMonitor ||
              MonitorStepProbeStatusMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepProbeStatusMonitor) => {
              monitorStep.setProbeStatusMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {/* Code Monitor Section */}
      {isCodeMonitor && (
        <Card
          title={
            props.monitorType === MonitorType.CustomJavaScriptCode
              ? "JavaScript Code"
              : "Playwright Code"
          }
          description={
            props.monitorType === MonitorType.CustomJavaScriptCode
              ? SyntheticMonitorCopy.javaScriptCodeDescription
              : SyntheticMonitorCopy.playwrightCodeDescription
          }
        >
          <div className="space-y-4">
            <div>
              <CodeEditor
                initialValue={monitorStep?.data?.customCode?.toString()}
                type={CodeType.JavaScript}
                onChange={(value: string) => {
                  monitorStep.setCustomCode(value);
                  if (props.onChange) {
                    props.onChange(MonitorStep.clone(monitorStep));
                  }
                }}
                example={exampleScript}
                minLines={12}
              />
              <p className="mt-2 text-sm text-gray-500">
                <Link
                  className="underline"
                  openInNewTab={true}
                  to={URL.fromString(
                    DOCS_URL.toString() + "/monitor/monitor-secrets",
                  )}
                >
                  {translator.translateText("You can use secrets here.")}
                </Link>
              </p>
              {props.monitorType === MonitorType.SyntheticMonitor && (
                <p className="mt-2 text-sm text-gray-500">
                  <Link
                    className="underline"
                    openInNewTab={true}
                    to={URL.fromString(
                      DOCS_URL.toString() + "/monitor/synthetic-monitor",
                    )}
                  >
                    {translator.translateText(
                      "Read the OneUptime Synthetic Monitor documentation.",
                    )}
                  </Link>
                </p>
              )}
            </div>

            {props.monitorType === MonitorType.SyntheticMonitor && (
              <>
                <div>
                  <FieldLabelElement
                    title={"Browser Type"}
                    description={SyntheticMonitorCopy.browserTypeDescription}
                    required={true}
                  />
                  <CheckBoxList
                    options={enumToCategoryCheckboxOption(BrowserType)}
                    initialValue={props.value?.data?.browserTypes || []}
                    onChange={(values: Array<CategoryCheckboxValue>) => {
                      monitorStep.setBrowserTypes(values as Array<BrowserType>);
                      if (props.onChange) {
                        props.onChange(MonitorStep.clone(monitorStep));
                      }
                    }}
                  />
                </div>

                <div>
                  <FieldLabelElement
                    title={"Screen Type"}
                    description={SyntheticMonitorCopy.screenTypeDescription}
                    required={true}
                  />
                  <CheckBoxList
                    options={enumToCategoryCheckboxOption(ScreenSizeType)}
                    initialValue={props.value?.data?.screenSizeTypes || []}
                    onChange={(values: Array<CategoryCheckboxValue>) => {
                      monitorStep.setScreenSizeTypes(
                        values as Array<ScreenSizeType>,
                      );
                      if (props.onChange) {
                        props.onChange(MonitorStep.clone(monitorStep));
                      }
                    }}
                  />
                </div>
              </>
            )}
            {/*
             * More fields for Synthetic monitors: retries on error - in the
             * code card, after its last field, as the target's are in theirs.
             */}
            {props.monitorType === MonitorType.SyntheticMonitor && (
              <FoldedSection
                title={MORE_FIELDS_SECTION_TITLE}
                description="Retry settings and more"
                items={moreFieldsItems}
                defaultCollapsed={!showSyntheticMonitorAdvancedOptions}
                dataTestId="monitor-step-more-fields"
                onToggle={(isCollapsed: boolean) => {
                  if (!isCollapsed) {
                    setShowSyntheticMonitorAdvancedOptions(true);
                  }
                }}
              >
                <div>
                  <FieldLabelElement
                    title={"Retry Count on Error"}
                    description={
                      SyntheticMonitorCopy.retryCountOnErrorDescription
                    }
                    required={false}
                  />
                  <Input
                    initialValue={
                      props.value?.data?.retryCountOnError?.toString() || "0"
                    }
                    onChange={(value: string) => {
                      const retryCountOnError: number = parseInt(value) || 0;
                      monitorStep.setRetryCountOnError(
                        retryCountOnError < 0
                          ? 0
                          : retryCountOnError > 5
                            ? 5
                            : retryCountOnError,
                      );
                      if (props.onChange) {
                        props.onChange(MonitorStep.clone(monitorStep));
                      }
                    }}
                    placeholder="0"
                    type={InputType.NUMBER}
                  />
                </div>
              </FoldedSection>
            )}
          </div>
        </Card>
      )}

      {/* Test Monitor Card - only shown for probeable monitors */}
      {MonitorTypeHelper.isProbableMonitor(props.monitorType) && (
        <Card
          title="Test Monitor"
          description="Run one check now, before you save."
          className="bg-blue-50 border-blue-200"
        >
          <MonitorTestForm
            monitorId={props.monitorId}
            monitorSteps={props.allMonitorSteps}
            monitorType={props.monitorType}
            probes={props.probes}
            buttonSize={ButtonSize.Normal}
          />
        </Card>
      )}

      {/*
       * A Logs, Traces, Exceptions or Metrics monitor's criteria are edited
       * as the one rule most of them are (TelemetryRuleEditor): "When to
       * alert" and "What happens". Criteria that are more than one rule
       * open in the full editor inside it, the one every other type gets.
       */}
      {isRuleMonitorType ? (
        <TelemetryRuleEditor
          monitorType={props.monitorType}
          monitorStep={monitorStep}
          defaultMonitorStatusId={props.defaultMonitorStatusId}
          seeds={
            props.ruleSeeds || {
              monitorName: props.monitorName || "",
            }
          }
          monitorStatusDropdownOptions={props.monitorStatusDropdownOptions}
          incidentSeverityDropdownOptions={
            props.incidentSeverityDropdownOptions
          }
          alertSeverityDropdownOptions={props.alertSeverityDropdownOptions}
          onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
          labelDropdownOptions={props.labelDropdownOptions}
          userDropdownOptions={props.userDropdownOptions}
          incidentRoleOptions={props.incidentRoleOptions}
          seriesAttributeKeys={getRuleSeriesAttributeKeys(monitorStep)}
          onChange={(value: MonitorStep) => {
            props.onChange?.(value);
          }}
          customCriteria={criteriaElement}
          showErrors={props.showErrors}
        />
      ) : (
        <Card
          title="Monitor Criteria"
          description="When this monitor changes status, declares an incident or creates an alert. They are checked from top to bottom, and the first one that matches decides."
        >
          {criteriaElement}
        </Card>
      )}
    </div>
  );
};

export default MonitorStepElement;
