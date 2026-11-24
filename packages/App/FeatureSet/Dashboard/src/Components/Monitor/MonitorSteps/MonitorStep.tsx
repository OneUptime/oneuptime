import MonitorCriteriaElement from "./MonitorCriteria";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import MonitorStepMetricPreview from "./MonitorStepMetricPreview";
import TelemetryRuleSummary from "./TelemetryRuleSummary";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
} from "Common/Types/Monitor/TelemetryAlertRule";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Service from "Common/Models/DatabaseModels/Service";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeUtil from "../../../Utils/Probe";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import RecordsById from "Common/UI/Utils/RecordsById";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "Common/UI/Components/EntityDropdown/EntityDropdownNotFound";
import ServiceElement from "../../Service/ServiceElement";
import { MORE_SERVICES_TEMPLATE } from "../../TableColumnList/MoreItemsTemplates";
import ObjectID from "Common/Types/ObjectID";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import MonitorStepViewModel, {
  MonitorStepViewRow,
  MonitorStepViewValue,
  MonitorStepViewValueType,
} from "../../../Utils/MonitorStepViewModel";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AttributeFilterSentences from "./AttributeFilterSentences";
import SignalMonitorSessionsLink from "./SignalMonitorSessionsLink";
import { JSONObject } from "Common/Types/JSON";
import MonitorStepMetricQueries, {
  MonitorStepMetricReads,
} from "Common/Utils/Monitor/MonitorStepMetricQueries";

export interface ComponentProps {
  monitorStatusOptions: Array<MonitorStatus>;
  incidentSeverityOptions: Array<IncidentSeverity>;
  alertSeverityOptions: Array<AlertSeverity>;
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
  incidentRoleOptions: Array<IncidentRole>;
  // The status the monitor shows when no criteria match.
  defaultMonitorStatusId?: ObjectID | undefined;
}

/*
 * The rows a telemetry rule's sentence already says: the window it counts
 * in ("in 5 minutes").
 */
const RULE_WINDOW_ROW_KEYS: Array<string> = [
  "lastXSecondsOfLogs",
  "lastXSecondsOfSpans",
  "lastXSecondsOfExceptions",
];

type MonitorStepDetailItem = Record<string, MonitorStepViewValue>;

const fieldTypeByValueType: Record<MonitorStepViewValueType, FieldType> = {
  [MonitorStepViewValueType.Text]: FieldType.Text,
  [MonitorStepViewValueType.Number]: FieldType.Number,
  [MonitorStepViewValueType.Port]: FieldType.Port,
  [MonitorStepViewValueType.Boolean]: FieldType.Boolean,
  [MonitorStepViewValueType.ArrayOfText]: FieldType.ArrayOfText,
  [MonitorStepViewValueType.DictionaryOfStrings]: FieldType.DictionaryOfStrings,
  [MonitorStepViewValueType.JSON]: FieldType.JSON,
  [MonitorStepViewValueType.JavaScript]: FieldType.JavaScript,
  [MonitorStepViewValueType.Code]: FieldType.Code,
  // Both are resolved to a model by this component and rendered as elements.
  [MonitorStepViewValueType.TelemetryServices]: FieldType.Element,
  [MonitorStepViewValueType.NetworkDevice]: FieldType.Text,
  // Resolved to the probes' names by this component.
  [MonitorStepViewValueType.Probes]: FieldType.ArrayOfText,
  // Each filter said as one sentence (AttributeFilterSentences).
  [MonitorStepViewValueType.AttributeFilters]: FieldType.Element,
};

// A probe the step names that no probe list holds any more.
const DELETED_PROBE_NAME: string = translationKey("Deleted probe");

/*
 * One of the services a step is scoped to: the service, read by its id, or
 * none - deleted since, or out of the reader's reach.
 */
interface StepService {
  id: string;
  service: Service | undefined;
}

/*
 * The services a step is scoped to, each once, as the reader sees them: by
 * name, and the ones no service answers to last. Exported for its tests.
 */
export const getStepServices: (data: {
  ids: Array<string>;
  servicesById: Map<string, Service>;
}) => Array<StepService> = (data: {
  ids: Array<string>;
  servicesById: Map<string, Service>;
}): Array<StepService> => {
  const seen: Set<string> = new Set<string>();
  const found: Array<StepService> = [];
  const gone: Array<StepService> = [];

  for (const id of data.ids) {
    const key: string = (id || "").toString().trim().toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);

    const service: Service | undefined = data.servicesById.get(key);

    (service ? found : gone).push({ id: key, service: service });
  }

  found.sort((a: StepService, b: StepService): number => {
    return (a.service?.name || "").localeCompare(b.service?.name || "");
  });

  return [...found, ...gone];
};

/*
 * What the Monitor Details section holds. Only the probe-check types are run
 * by probes; every other type is judged from what reaches OneUptime (its
 * telemetry, an agent, a device's polls, the probes' own connection), where
 * "how the probes check this resource" would be wrong.
 */
const PROBE_RUN_DETAILS_DESCRIPTION: string = translationKey(
  "How the probes check this resource: what they connect to and the settings they use.",
);
const DETAILS_DESCRIPTION: string = translationKey(
  "What this monitor watches, and the settings it uses.",
);

const getWatchedProbeIds: (rows: Array<MonitorStepViewRow>) => Array<string> = (
  rows: Array<MonitorStepViewRow>,
): Array<string> => {
  const ids: Array<string> = [];

  for (const row of rows) {
    if (row.valueType !== MonitorStepViewValueType.Probes) {
      continue;
    }

    for (const id of (row.value as Array<string> | undefined) || []) {
      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids;
};

const getTelemetryServiceIds: (
  rows: Array<MonitorStepViewRow>,
) => Array<string> = (rows: Array<MonitorStepViewRow>): Array<string> => {
  const ids: Array<string> = [];

  for (const row of rows) {
    if (row.valueType !== MonitorStepViewValueType.TelemetryServices) {
      continue;
    }

    for (const id of (row.value as Array<string> | undefined) || []) {
      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids;
};

const getNetworkDeviceId: (
  rows: Array<MonitorStepViewRow>,
) => string | undefined = (
  rows: Array<MonitorStepViewRow>,
): string | undefined => {
  for (const row of rows) {
    if (
      row.valueType === MonitorStepViewValueType.NetworkDevice &&
      typeof row.value === "string" &&
      row.value
    ) {
      return row.value;
    }
  }

  return undefined;
};

const MonitorStepElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The single source of truth for what this page shows. Every monitor type
   * goes through it, so a type can no longer fall through to a blank
   * section the way it used to when this was a chain of if/else branches.
   */
  /*
   * A Logs, Traces, Exceptions or Metrics monitor whose criteria are one
   * rule reads as that rule (TelemetryRuleSummary), its criteria folded
   * under it; any other reads as its criteria.
   */
  const rule: TelemetryAlertRule | null = TelemetryAlertRuleUtil.read({
    monitorType: props.monitorType,
    monitorStep: props.monitorStep,
    defaultMonitorStatusId: props.defaultMonitorStatusId,
  }).rule;

  const [isCriteriaCollapsed, setIsCriteriaCollapsed] = useState<boolean>(true);

  const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
    monitorStep: props.monitorStep,
    monitorType: props.monitorType,
  }).filter((row: MonitorStepViewRow) => {
    return !(rule && RULE_WINDOW_ROW_KEYS.includes(row.key));
  });

  const telemetryServiceIds: Array<string> = getTelemetryServiceIds(rows);
  const networkDeviceId: string | undefined = getNetworkDeviceId(rows);
  const watchedProbeIds: Array<string> = getWatchedProbeIds(rows);
  const watchedProbeIdsKey: string = watchedProbeIds.join(",");

  /*
   * Most monitor types reference nothing outside the step, so they must not
   * pay for a fetch — or flash a loader — on the way in.
   */
  const hasReferencesToResolve: boolean =
    telemetryServiceIds.length > 0 ||
    Boolean(networkDeviceId) ||
    watchedProbeIds.length > 0;

  /*
   * The effect keys off this joined string rather than the array itself:
   * `rows` is rebuilt on every render, so array identity would refetch
   * forever.
   */
  const telemetryServiceIdsKey: string = telemetryServiceIds.join(",");

  const [isLoading, setIsLoading] = useState<boolean>(hasReferencesToResolve);
  const [error, setError] = useState<string | undefined>(undefined);
  /*
   * The services the step is scoped to, by id (lower case). Read by those
   * ids alone (RecordsById, in pages), so a service is named however many
   * the project has, and one deleted since says so (#10921).
   */
  const [telemetryServices, setServices] = useState<Map<string, Service>>(
    new Map<string, Service>(),
  );
  const [networkDeviceName, setNetworkDeviceName] = useState<
    string | undefined
  >(undefined);
  // Probe id (lower case) to name, for the probes a Probe Status step watches.
  const [probeNamesById, setProbeNamesById] = useState<Map<string, string>>(
    new Map<string, string>(),
  );

  const fetchServices: PromiseVoidFunction = async (): Promise<void> => {
    if (telemetryServiceIds.length === 0) {
      setServices(new Map<string, Service>());
      return;
    }

    const services: Array<Service> = await RecordsById.read<Service>({
      modelType: Service,
      ids: telemetryServiceIds,
      query: { projectId: ProjectUtil.getCurrentProjectId()! },
      select: {
        _id: true,
        name: true,
        serviceColor: true,
      },
    });

    setServices(RecordsById.byValue<Service>({ records: services }));
  };

  const fetchNetworkDevice: PromiseVoidFunction = async (): Promise<void> => {
    if (!networkDeviceId) {
      setNetworkDeviceName(undefined);
      return;
    }

    const networkDevice: NetworkDevice | null =
      await ModelAPI.getItem<NetworkDevice>({
        modelType: NetworkDevice,
        id: new ObjectID(networkDeviceId),
        select: {
          name: true,
        },
      });

    setNetworkDeviceName(networkDevice?.name || undefined);
  };

  /*
   * The global probes and the project's own, the same list the picker
   * offers, so a probe reads here as it does there.
   */
  const fetchWatchedProbes: PromiseVoidFunction = async (): Promise<void> => {
    if (watchedProbeIds.length === 0) {
      setProbeNamesById(new Map<string, string>());
      return;
    }

    const probes: Array<Probe> = await ProbeUtil.getAllProbes();
    const names: Map<string, string> = new Map<string, string>();

    for (const probe of probes) {
      if (probe._id) {
        names.set(
          probe._id.toString().toLowerCase(),
          probe.name?.toString() || "Probe",
        );
      }
    }

    setProbeNamesById(names);
  };

  const loadComponent: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError(undefined);

    try {
      await fetchServices();
      await fetchNetworkDevice();
      await fetchWatchedProbes();
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!hasReferencesToResolve) {
      setServices(new Map<string, Service>());
      setNetworkDeviceName(undefined);
      setProbeNamesById(new Map<string, string>());
      setIsLoading(false);
      return;
    }

    loadComponent();
  }, [
    props.monitorType,
    telemetryServiceIdsKey,
    networkDeviceId,
    watchedProbeIdsKey,
  ]);

  if (isLoading) {
    return <DetailListSkeleton fields={4} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const item: MonitorStepDetailItem = {};
  const fields: Array<Field<MonitorStepDetailItem>> = [];

  for (const row of rows) {
    if (row.valueType === MonitorStepViewValueType.TelemetryServices) {
      const ids: Array<string> = (row.value as Array<string> | undefined) || [];

      /*
       * Every service the step is scoped to: one deleted since stays in the
       * list, saying so, rather than leaving the step looking scoped to
       * fewer services than it is.
       */
      const services: Array<StepService> = getStepServices({
        ids: ids,
        servicesById: telemetryServices,
      });

      item[row.key] = ids;

      fields.push({
        key: row.key,
        title: row.title,
        description: row.description,
        fieldType: FieldType.Element,
        placeholder: row.placeholder,
        getElement: (): ReactElement => {
          return (
            <TableColumnListComponent
              items={services}
              moreTemplate={MORE_SERVICES_TEMPLATE}
              dataTestId="monitor-step-services"
              getEachElement={(stepService: StepService): ReactElement => {
                if (stepService.service) {
                  return <ServiceElement service={stepService.service} />;
                }

                return (
                  <span
                    className="text-sm italic text-gray-500"
                    title={stepService.id}
                    data-testid="monitor-step-service-not-found"
                  >
                    {translator.translateText(ENTITY_DROPDOWN_NOT_FOUND_LABEL)}
                  </span>
                );
              }}
              noItemsMessage="No services."
            />
          );
        },
      });

      continue;
    }

    if (row.valueType === MonitorStepViewValueType.AttributeFilters) {
      const filters: JSONObject = (row.value as JSONObject | undefined) || {};

      item[row.key] = filters;

      fields.push({
        key: row.key,
        title: row.title,
        description: row.description,
        fieldType: FieldType.Element,
        placeholder: row.placeholder,
        getElement: (): ReactElement => {
          return <AttributeFilterSentences filters={filters} />;
        },
      });

      continue;
    }

    if (row.valueType === MonitorStepViewValueType.Probes) {
      item[row.key] = ((row.value as Array<string> | undefined) || []).map(
        (probeId: string): string => {
          return (
            probeNamesById.get(probeId.toLowerCase()) ||
            translator.translateText(DELETED_PROBE_NAME) ||
            DELETED_PROBE_NAME
          );
        },
      );

      fields.push({
        key: row.key,
        title: row.title,
        description: row.description,
        fieldType: fieldTypeByValueType[row.valueType],
        placeholder: row.placeholder,
      });

      continue;
    }

    /*
     * A device that has since been deleted resolves to no name; showing the
     * stored id then beats showing nothing, because it is what the criteria
     * are still pointed at.
     */
    item[row.key] = MonitorStepViewModel.translateRowValue(
      row,
      row.valueType === MonitorStepViewValueType.NetworkDevice
        ? networkDeviceName || row.value
        : row.value,
      (text: string): string | undefined => {
        return translator.translateText(text);
      },
    );

    fields.push({
      key: row.key,
      title: row.title,
      description: row.description,
      fieldType: fieldTypeByValueType[row.valueType],
      placeholder: row.placeholder,
    });
  }

  const showMetricPreview: boolean = MonitorStepViewModel.hasMetricPreview(
    props.monitorType,
  );

  // What the step reads, as its monitor reads it: its PromQL expression too.
  const stepReads: MonitorStepMetricReads | null = showMetricPreview
    ? MonitorStepMetricQueries.getReads({
        monitorType: props.monitorType,
        monitorStep: props.monitorStep,
      })
    : null;

  const criteriaElement: ReactElement = (
    <MonitorCriteriaElement
      onCallPolicyOptions={props.onCallPolicyOptions}
      monitorStatusOptions={props.monitorStatusOptions}
      incidentSeverityOptions={props.incidentSeverityOptions}
      alertSeverityOptions={props.alertSeverityOptions}
      labelOptions={props.labelOptions}
      teamOptions={props.teamOptions}
      userOptions={props.userOptions}
      incidentRoleOptions={props.incidentRoleOptions}
      monitorCriteria={
        props.monitorStep?.data?.monitorCriteria as MonitorCriteria
      }
      monitorType={props.monitorType}
    />
  );

  return (
    <div className="mt-5">
      {fields.length > 0 && (
        <div data-testid="monitor-step-details">
          <FieldLabelElement
            title={"Monitor Details"}
            description={
              MonitorTypeHelper.isProbableMonitor(props.monitorType)
                ? PROBE_RUN_DETAILS_DESCRIPTION
                : DETAILS_DESCRIPTION
            }
            required={true}
            isHeading={true}
          />
          <div className="mt-5">
            <Detail<MonitorStepDetailItem>
              id={"monitor-step"}
              item={item}
              fields={fields}
            />
          </div>
          {/*
           * A monitor on one of a RUM application's own signals (issue
           * #6518) names the signal as it is called now, with its sessions.
           */}
          <SignalMonitorSessionsLink
            monitorType={props.monitorType}
            monitorStep={props.monitorStep}
          />
        </div>
      )}

      {showMetricPreview && (
        <MonitorStepMetricPreview
          /*
           * What the monitor evaluates: an infrastructure monitor's queries
           * narrowed to the resource it watches, as the worker reads them -
           * or a step's PromQL expression, for the services it reads (issue
           * #10227), never the builder's queries it keeps from before.
           */
          metricsViewConfig={MonitorStepViewModel.getEvaluatedMetricsViewConfig(
            {
              monitorType: props.monitorType,
              monitorStep: props.monitorStep,
            },
          )}
          rollingTime={MonitorStepViewModel.getRollingTime(props.monitorStep)}
          promQLQuery={stepReads?.promQLQuery}
          serviceIds={stepReads?.telemetryServiceIds}
        />
      )}

      {fields.length > 0 && <HorizontalRule />}

      {rule ? (
        <>
          <TelemetryRuleSummary
            monitorType={props.monitorType}
            monitorStep={props.monitorStep}
            rule={rule}
            defaultMonitorStatusId={props.defaultMonitorStatusId}
            monitorStatusOptions={props.monitorStatusOptions}
            alertSeverityOptions={props.alertSeverityOptions}
            incidentSeverityOptions={props.incidentSeverityOptions}
          />
          <FoldedSection
            title="Criteria details"
            variant="line"
            className="mt-6"
            summary="The rule's filter, and every setting of its alert or incident."
            isCollapsed={isCriteriaCollapsed}
            onToggle={(isCollapsed: boolean) => {
              setIsCriteriaCollapsed(isCollapsed);
            }}
            dataTestId="telemetry-rule-criteria-details"
          >
            {criteriaElement}
          </FoldedSection>
        </>
      ) : (
        <div className="mt-5">
          <FieldLabelElement
            title="Criteria"
            isHeading={true}
            description={
              "Criteria we will use to determine your resource status."
            }
            required={true}
          />

          {criteriaElement}
        </div>
      )}
    </div>
  );
};

export default MonitorStepElement;
