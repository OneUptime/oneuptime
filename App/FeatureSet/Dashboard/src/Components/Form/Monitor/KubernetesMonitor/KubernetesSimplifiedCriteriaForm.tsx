import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  FilterType,
  CriteriaFilterUtil,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  buildOfflineCriteriaInstance,
  buildOnlineCriteriaInstance,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { InputType } from "Common/UI/Components/Input/Input";
import Input from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Toggle from "Common/UI/Components/Toggle/Toggle";

export interface ComponentProps {
  metricAlias: string;
  monitorName: string;
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  value?: MonitorCriteria | undefined;
  onChange: (value: MonitorCriteria) => void;
}

const operatorOptions: Array<DropdownOption> = [
  { label: "> Greater Than", value: FilterType.GreaterThan },
  { label: "< Less Than", value: FilterType.LessThan },
  { label: ">= Greater Than or Equal", value: FilterType.GreaterThanOrEqualTo },
  { label: "<= Less Than or Equal", value: FilterType.LessThanOrEqualTo },
  { label: "= Equal To", value: FilterType.EqualTo },
];

function extractStateFromCriteria(criteria: MonitorCriteria | undefined): {
  filterType: FilterType;
  thresholdValue: number;
  alertSeverityId: string;
  incidentSeverityId: string;
  autoResolve: boolean;
} {
  const defaults = {
    filterType: FilterType.GreaterThan,
    thresholdValue: 0,
    alertSeverityId: "",
    incidentSeverityId: "",
    autoResolve: true,
  };

  if (!criteria?.data?.monitorCriteriaInstanceArray?.length) {
    return defaults;
  }

  // Extract from the first criteria instance (the "unhealthy" one)
  const firstInstance: MonitorCriteriaInstance | undefined =
    criteria.data.monitorCriteriaInstanceArray[0];

  if (!firstInstance?.data) {
    return defaults;
  }

  const firstFilter = firstInstance.data.filters?.[0];
  if (firstFilter) {
    defaults.filterType = firstFilter.filterType || FilterType.GreaterThan;
    defaults.thresholdValue =
      typeof firstFilter.value === "number"
        ? firstFilter.value
        : parseFloat(String(firstFilter.value)) || 0;
  }

  if (firstInstance.data.alerts?.length) {
    const alert = firstInstance.data.alerts[0];
    if (alert) {
      defaults.alertSeverityId = alert.alertSeverityId?.toString() || "";
      defaults.autoResolve = alert.autoResolveAlert !== false;
    }
  }

  if (firstInstance.data.incidents?.length) {
    const incident = firstInstance.data.incidents[0];
    if (incident) {
      defaults.incidentSeverityId =
        incident.incidentSeverityId?.toString() || "";
    }
  }

  return defaults;
}

const KubernetesSimplifiedCriteriaForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const initialState = extractStateFromCriteria(props.value);

  const [filterType, setFilterType] = useState<FilterType>(
    initialState.filterType,
  );
  const [thresholdValue, setThresholdValue] = useState<number>(
    initialState.thresholdValue,
  );
  const [alertSeverityId, setAlertSeverityId] = useState<string>(
    initialState.alertSeverityId ||
      (props.alertSeverityDropdownOptions[0]?.value?.toString() || ""),
  );
  const [incidentSeverityId, setIncidentSeverityId] = useState<string>(
    initialState.incidentSeverityId ||
      (props.incidentSeverityDropdownOptions[0]?.value?.toString() || ""),
  );
  const [autoResolve, setAutoResolve] = useState<boolean>(
    initialState.autoResolve,
  );

  // Find online/offline status IDs from monitor status options
  const offlineMonitorStatusId: ObjectID = new ObjectID(
    props.monitorStatusDropdownOptions.length >= 2
      ? (props.monitorStatusDropdownOptions[1]?.value?.toString() || "")
      : (props.monitorStatusDropdownOptions[0]?.value?.toString() || ""),
  );

  const onlineMonitorStatusId: ObjectID = new ObjectID(
    props.monitorStatusDropdownOptions[0]?.value?.toString() || "",
  );

  const buildAndEmitCriteria = (): void => {
    if (!props.metricAlias) {
      return;
    }

    const inverseFilterType: FilterType =
      CriteriaFilterUtil.getInverseFilterType(filterType);

    const offlineInstance: MonitorCriteriaInstance =
      buildOfflineCriteriaInstance({
        offlineMonitorStatusId,
        incidentSeverityId: new ObjectID(incidentSeverityId),
        alertSeverityId: new ObjectID(alertSeverityId),
        monitorName: props.monitorName || "Kubernetes Monitor",
        metricAlias: props.metricAlias,
        filterType: filterType,
        value: thresholdValue,
      });

    // Set auto-resolve on alerts and incidents
    if (offlineInstance.data?.alerts) {
      for (const alert of offlineInstance.data.alerts) {
        alert.autoResolveAlert = autoResolve;
      }
    }
    if (offlineInstance.data?.incidents) {
      for (const incident of offlineInstance.data.incidents) {
        incident.autoResolveIncident = autoResolve;
      }
    }

    const onlineInstance: MonitorCriteriaInstance = buildOnlineCriteriaInstance({
      onlineMonitorStatusId,
      metricAlias: props.metricAlias,
      filterType: inverseFilterType,
      value: thresholdValue,
    });

    const monitorCriteria: MonitorCriteria = new MonitorCriteria();
    monitorCriteria.data = {
      monitorCriteriaInstanceArray: [offlineInstance, onlineInstance],
    };

    props.onChange(monitorCriteria);
  };

  useEffect(() => {
    buildAndEmitCriteria();
  }, [
    filterType,
    thresholdValue,
    alertSeverityId,
    incidentSeverityId,
    autoResolve,
    props.metricAlias,
    props.monitorName,
  ]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Configure when this monitor should trigger an alert. The recovery
        criteria will be auto-generated with the inverse condition.
      </p>

      {/* Threshold Row */}
      <div>
        <FieldLabelElement
          title="Alert Condition"
          description="When the metric value matches this condition, an alert will be triggered."
          required={true}
        />
        <div className="flex items-center space-x-3">
          <div className="w-64">
            <Dropdown
              options={operatorOptions}
              value={operatorOptions.find(
                (o: DropdownOption) => o.value === filterType,
              )}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                setFilterType(
                  (value as FilterType) || FilterType.GreaterThan,
                );
              }}
              placeholder="Select operator..."
            />
          </div>
          <div className="w-32">
            <Input
              value={String(thresholdValue)}
              type={InputType.NUMBER}
              onChange={(value: string) => {
                setThresholdValue(parseFloat(value) || 0);
              }}
              placeholder="Threshold"
            />
          </div>
        </div>
      </div>

      {/* Alert Severity */}
      <div>
        <FieldLabelElement
          title="Alert Severity"
          description="The severity level for alerts created by this monitor."
          required={true}
        />
        <Dropdown
          options={props.alertSeverityDropdownOptions}
          value={props.alertSeverityDropdownOptions.find(
            (o: DropdownOption) => o.value?.toString() === alertSeverityId,
          )}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            setAlertSeverityId(value?.toString() || "");
          }}
          placeholder="Select alert severity..."
        />
      </div>

      {/* Incident Severity */}
      <div>
        <FieldLabelElement
          title="Incident Severity"
          description="The severity level for incidents created by this monitor."
          required={true}
        />
        <Dropdown
          options={props.incidentSeverityDropdownOptions}
          value={props.incidentSeverityDropdownOptions.find(
            (o: DropdownOption) => o.value?.toString() === incidentSeverityId,
          )}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            setIncidentSeverityId(value?.toString() || "");
          }}
          placeholder="Select incident severity..."
        />
      </div>

      {/* Auto-Resolve */}
      <div>
        <Toggle
          title="Auto-resolve when recovered"
          description="Automatically resolve alerts and incidents when the metric returns to a healthy state."
          value={autoResolve}
          onChange={(value: boolean) => {
            setAutoResolve(value);
          }}
        />
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs text-gray-600">
          <strong>Summary:</strong> This monitor will create an alert and
          incident when the metric is{" "}
          <span className="font-mono bg-white px-1 rounded border">
            {operatorOptions.find((o: DropdownOption) => o.value === filterType)
              ?.label || filterType}{" "}
            {thresholdValue}
          </span>
          , and auto-recover when the condition clears.
        </p>
      </div>
    </div>
  );
};

export default KubernetesSimplifiedCriteriaForm;
