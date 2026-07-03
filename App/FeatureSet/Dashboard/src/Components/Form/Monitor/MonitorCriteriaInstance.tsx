import CriteriaFilters from "./CriteriaFilters";
import MonitorCriteriaIncidentsForm from "./MonitorCriteriaIncidentsForm";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import IncidentGroupingConfig from "Common/Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Radio from "Common/UI/Components/Radio/Radio";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import MonitorCriteriaAlertsForm from "./MonitorCriteriaAlertsForm";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import FilterCondition from "Common/Types/Filter/FilterCondition";

export interface ComponentProps {
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  incidentRoleOptions?: Array<IncidentRoleOption> | undefined;
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  value?: undefined | MonitorCriteriaInstance;
  onChange?: undefined | ((value: MonitorCriteriaInstance) => void);
  onDelete?: undefined | (() => void);
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitorCriteriaInstance: MonitorCriteriaInstance =
    props.value || new MonitorCriteriaInstance();

  /*
   * Gather the per-series group-by attribute keys from every metric
   * query on this monitor step so the template-variables modal can
   * expose them as per-host / per-container variables
   * (`{{host.name}}`, `{{resource.k8s.container.name}}`, …). When the
   * monitor isn't metric-shaped, this is an empty array and the modal
   * simply doesn't render the series-labels section.
   */
  const seriesAttributeKeys: Array<string> = Array.from(
    new Set(
      (
        props.monitorStep?.data?.metricMonitor?.metricViewConfig
          ?.queryConfigs || []
      ).flatMap((q: MetricQueryConfigData): Array<string> => {
        return q.metricQueryData?.groupByAttributeKeys || [];
      }),
    ),
  );

  const [defaultMonitorStatusId, setDefaultMonitorStatusId] = useState<
    ObjectID | undefined
  >(monitorCriteriaInstance?.data?.monitorStatusId);

  const filterConditionOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(FilterCondition);

  const [errors, setErrors] = useState<Dictionary<string>>({});
  const [touched, setTouched] = useState<Dictionary<boolean>>({});

  useEffect(() => {
    // set first value as default
    if (
      props.monitorStatusDropdownOptions.length > 0 &&
      !defaultMonitorStatusId &&
      props.monitorStatusDropdownOptions[0] &&
      props.monitorStatusDropdownOptions[0].value
    ) {
      setDefaultMonitorStatusId(
        new ObjectID(props.monitorStatusDropdownOptions[0].value.toString()),
      );
    }
  }, [props.monitorStatusDropdownOptions]);

  const [showMonitorStatusChangeControl, setShowMonitorStatusChangeControl] =
    useState<boolean>(Boolean(props.value?.data?.monitorStatusId?.id) || false);
  const [showIncidentControl, setShowIncidentControl] = useState<boolean>(
    props.value?.data?.createIncidents || false,
  );

  const [showAlertControl, setShowAlertControl] = useState<boolean>(
    props.value?.data?.createAlerts || false,
  );

  const [showIncidentGrouping, setShowIncidentGrouping] = useState<boolean>(
    Boolean(props.value?.data?.incidentGrouping?.groupByJSONPath),
  );

  const incidentGrouping: IncidentGroupingConfig | undefined =
    monitorCriteriaInstance?.data?.incidentGrouping;

  /*
   * Stable ids so every grouping input has a programmatically-associated
   * label (WCAG 1.3.1 / 4.1.2) — the shared Input has no aria-label
   * fallback, so without these it would be announced by placeholder only.
   */
  const groupByLabelId: string = useId();
  const resolvedPathInputId: string = useId();
  const resolvedValueInputId: string = useId();
  const maxKeysLabelId: string = useId();

  // Merge a partial update into the criteria's incidentGrouping config.
  const updateIncidentGrouping: (
    patch: Partial<IncidentGroupingConfig>,
  ) => void = (patch: Partial<IncidentGroupingConfig>): void => {
    const current: IncidentGroupingConfig = monitorCriteriaInstance?.data
      ?.incidentGrouping || {
      groupByJSONPath: "",
    };
    monitorCriteriaInstance.setIncidentGrouping({ ...current, ...patch });
    if (props.onChange) {
      props.onChange(MonitorCriteriaInstance.clone(monitorCriteriaInstance));
    }
  };

  // Calculate summary information for badges
  const filterCount: number =
    monitorCriteriaInstance?.data?.filters?.length || 0;
  const filterCondition: FilterCondition =
    monitorCriteriaInstance?.data?.filterCondition || FilterCondition.All;
  const filterSummary: string = `${filterCount} filter${filterCount !== 1 ? "s" : ""}${filterCount > 1 ? `, ${filterCondition === FilterCondition.All ? "ALL" : "ANY"} match` : ""}`;

  // Calculate actions summary
  const getActionsSummary: () => string = (): string => {
    const actions: Array<string> = [];
    if (showMonitorStatusChangeControl) {
      const statusOption: DropdownOption | undefined =
        props.monitorStatusDropdownOptions.find((i: DropdownOption) => {
          return (
            i.value === monitorCriteriaInstance?.data?.monitorStatusId?.id ||
            undefined
          );
        });
      if (statusOption) {
        actions.push(`Status: ${statusOption.label}`);
      }
    }
    if (showAlertControl) {
      const alertCount: number =
        monitorCriteriaInstance?.data?.alerts?.length || 0;
      actions.push(`${alertCount} alert${alertCount !== 1 ? "s" : ""}`);
    }
    if (showIncidentControl) {
      const incidentCount: number =
        monitorCriteriaInstance?.data?.incidents?.length || 0;
      actions.push(
        `${incidentCount} incident${incidentCount !== 1 ? "s" : ""}`,
      );
    }
    return actions.length > 0 ? actions.join(", ") : "No actions";
  };

  const hasActions: boolean =
    showMonitorStatusChangeControl || showAlertControl || showIncidentControl;

  const isEnabled: boolean = monitorCriteriaInstance?.data?.isEnabled !== false;

  return (
    <div className="mt-4">
      {/* Criteria Name and Description */}
      <div className="mb-4">
        <div className="mt-3">
          <FieldLabelElement
            title={"Criteria Name"}
            description={
              "Any friendly name for this criteria, that will help you remember later."
            }
            required={true}
          />
          <Input
            value={monitorCriteriaInstance?.data?.name?.toString() || ""}
            onBlur={() => {
              setTouched({
                ...touched,
                name: true,
              });

              if (!monitorCriteriaInstance?.data?.name) {
                setErrors({
                  ...errors,
                  name: "Name is required",
                });
              } else {
                setErrors({
                  ...errors,
                  name: "",
                });
              }
            }}
            error={
              touched["name"] && errors["name"] ? errors["name"] : undefined
            }
            placeholder="Online Criteria"
            onChange={(value: string) => {
              if (!value) {
                setErrors({
                  ...errors,
                  name: "Name is required",
                });
              } else {
                setErrors({
                  ...errors,
                  name: "",
                });
              }

              monitorCriteriaInstance.setName(value);
              if (props.onChange) {
                props.onChange(
                  MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                );
              }
            }}
          />
        </div>
        <div className="mt-4">
          <FieldLabelElement
            title={"Criteria Description"}
            description={
              "Any friendly description for this criteria, that will help you remember later."
            }
            required={true}
          />
          <TextArea
            value={monitorCriteriaInstance?.data?.description?.toString() || ""}
            onBlur={() => {
              setTouched({
                ...touched,
                description: true,
              });

              if (!monitorCriteriaInstance?.data?.description) {
                setErrors({
                  ...errors,
                  description: "Description is required",
                });
              } else {
                setErrors({
                  ...errors,
                  description: "",
                });
              }
            }}
            error={
              touched["description"] && errors["description"]
                ? errors["description"]
                : undefined
            }
            onChange={(value: string) => {
              if (!value) {
                setErrors({
                  ...errors,
                  description: "Description is required",
                });
              } else {
                setErrors({
                  ...errors,
                  description: "",
                });
              }
              monitorCriteriaInstance.setDescription(value);
              if (props.onChange) {
                props.onChange(
                  MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                );
              }
            }}
            placeholder="This criteria checks if the monitor is online."
          />
        </div>
      </div>

      {/* Filters Section - Collapsible */}
      <CollapsibleSection
        title={
          props.monitorType === MonitorType.Kubernetes ||
          props.monitorType === MonitorType.Metrics
            ? "Alert Rules"
            : "Filters"
        }
        description={
          props.monitorType === MonitorType.Kubernetes ||
          props.monitorType === MonitorType.Metrics
            ? "Define when this alert should trigger based on metric values."
            : "Add criteria for different monitor properties."
        }
        badge={filterSummary}
        variant="bordered"
        defaultCollapsed={false}
        className="mb-4"
      >
        <div>
          <div className="mb-3">
            <FieldLabelElement
              title={
                props.monitorType === MonitorType.Kubernetes ||
                props.monitorType === MonitorType.Metrics
                  ? "Match Condition"
                  : "Filter Condition"
              }
              description={
                props.monitorType === MonitorType.Kubernetes ||
                props.monitorType === MonitorType.Metrics
                  ? "Should all rules match, or just any one of them?"
                  : "Select All if you want all the criteria to be met. Select any if you like any criteria to be met."
              }
              required={true}
            />
            <Radio
              value={
                monitorCriteriaInstance?.data?.filterCondition ||
                FilterCondition.All
              }
              options={filterConditionOptions}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                monitorCriteriaInstance.setFilterCondition(
                  value as FilterCondition,
                );
                if (props.onChange) {
                  props.onChange(
                    MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                  );
                }
              }}
            />
          </div>

          <CriteriaFilters
            monitorStep={props.monitorStep}
            monitorType={props.monitorType}
            value={monitorCriteriaInstance?.data?.filters || []}
            filterCondition={
              monitorCriteriaInstance?.data?.filterCondition ||
              FilterCondition.All
            }
            onChange={(value: Array<CriteriaFilter>) => {
              monitorCriteriaInstance.setFilters(value);
              if (props.onChange) {
                props.onChange(
                  MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                );
              }
            }}
          />
        </div>
      </CollapsibleSection>

      {/* Actions Section - Collapsible */}
      <CollapsibleSection
        title="Actions"
        description="Configure what happens when filters match."
        badge={getActionsSummary()}
        variant="bordered"
        defaultCollapsed={!hasActions}
        className="mb-4"
      >
        <div>
          <div className="mt-2">
            <Toggle
              value={Boolean(showMonitorStatusChangeControl)}
              title="When filters match, change monitor status."
              onChange={(value: boolean) => {
                setShowMonitorStatusChangeControl(value);
                monitorCriteriaInstance.setChangeMonitorStatus(value);

                if (!value) {
                  monitorCriteriaInstance.setMonitorStatusId(undefined);
                }

                if (props.onChange) {
                  props.onChange(
                    MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                  );
                }
              }}
            />
          </div>

          {showMonitorStatusChangeControl && (
            <div className="mt-4 ml-6 p-3 bg-gray-50 rounded-md border border-gray-100">
              <FieldLabelElement
                title="Change monitor status to"
                description="What would you like the monitor status to be when the criteria have been met?"
              />
              <Dropdown
                value={props.monitorStatusDropdownOptions.find(
                  (i: DropdownOption) => {
                    return (
                      i.value ===
                        monitorCriteriaInstance?.data?.monitorStatusId?.id ||
                      undefined
                    );
                  },
                )}
                options={props.monitorStatusDropdownOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  monitorCriteriaInstance.setMonitorStatusId(
                    value ? new ObjectID(value.toString()) : undefined,
                  );
                  if (props.onChange) {
                    props.onChange(
                      MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                    );
                  }
                }}
              />
            </div>
          )}

          <div className="mt-4">
            <Toggle
              value={showAlertControl}
              title="When filters match, create an alert."
              tooltip="When you create an alert, it is used to notify the team but is not shown on the status page."
              onChange={(value: boolean) => {
                setShowAlertControl(value);
                monitorCriteriaInstance.setCreateAlerts(value);

                if (
                  !monitorCriteriaInstance.data?.alerts ||
                  monitorCriteriaInstance.data?.alerts?.length === 0
                ) {
                  monitorCriteriaInstance.setAlerts([
                    {
                      title: "",
                      description: "",
                      alertSeverityId: undefined,
                      id: ObjectID.generate().toString(),
                    },
                  ]);
                }

                if (props.onChange) {
                  props.onChange(
                    MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                  );
                }
              }}
            />
          </div>

          {showAlertControl && (
            <div className="mt-4 ml-6 p-3 bg-gray-50 rounded-md border border-gray-100">
              <FieldLabelElement title="Create Alert" />

              <MonitorCriteriaAlertsForm
                initialValue={monitorCriteriaInstance?.data?.alerts || []}
                alertSeverityDropdownOptions={
                  props.alertSeverityDropdownOptions
                }
                onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
                labelDropdownOptions={props.labelDropdownOptions}
                teamDropdownOptions={props.teamDropdownOptions}
                userDropdownOptions={props.userDropdownOptions}
                monitorType={props.monitorType}
                seriesAttributeKeys={seriesAttributeKeys}
                onChange={(value: Array<CriteriaAlert>) => {
                  monitorCriteriaInstance.setAlerts(value);
                  if (props.onChange) {
                    props.onChange(
                      MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                    );
                  }
                }}
              />
            </div>
          )}

          <div className="mt-4">
            <Toggle
              value={showIncidentControl}
              title="When filters match, declare an incident."
              tooltip="When you delcare an incident, it is used to notify the team and is shown on the status page as well."
              onChange={(value: boolean) => {
                setShowIncidentControl(value);
                monitorCriteriaInstance.setCreateIncidents(value);

                if (
                  !monitorCriteriaInstance.data?.incidents ||
                  monitorCriteriaInstance.data?.incidents?.length === 0
                ) {
                  monitorCriteriaInstance.setIncidents([
                    {
                      title: "",
                      description: "",
                      incidentSeverityId: undefined,
                      id: ObjectID.generate().toString(),
                    },
                  ]);
                }

                if (props.onChange) {
                  props.onChange(
                    MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                  );
                }
              }}
            />
          </div>

          {showIncidentControl && (
            <div className="mt-4 ml-6 p-3 bg-gray-50 rounded-md border border-gray-100">
              <FieldLabelElement title="Create Incident" />

              <MonitorCriteriaIncidentsForm
                initialValue={monitorCriteriaInstance?.data?.incidents || []}
                incidentSeverityDropdownOptions={
                  props.incidentSeverityDropdownOptions
                }
                onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
                labelDropdownOptions={props.labelDropdownOptions}
                teamDropdownOptions={props.teamDropdownOptions}
                userDropdownOptions={props.userDropdownOptions}
                incidentRoleOptions={props.incidentRoleOptions}
                monitorType={props.monitorType}
                seriesAttributeKeys={seriesAttributeKeys}
                onChange={(value: Array<CriteriaIncident>) => {
                  monitorCriteriaInstance.setIncidents(value);
                  if (props.onChange) {
                    props.onChange(
                      MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                    );
                  }
                }}
              />
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Settings — criteria enable toggle + (incoming request) incident grouping */}
      <CollapsibleSection
        title="Settings"
        description="Configure additional settings for this criteria."
        badge={isEnabled ? "Enabled" : "Disabled"}
        variant="bordered"
        defaultCollapsed={!showIncidentGrouping}
        className="mb-4"
      >
        <div className="mt-2">
          <Toggle
            value={isEnabled}
            title="Enable this criteria"
            description="When disabled, this criteria will not be evaluated. It will not change the monitor status, create incidents, or trigger alerts."
            onChange={(value: boolean) => {
              monitorCriteriaInstance.setIsEnabled(value);
              if (props.onChange) {
                props.onChange(
                  MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                );
              }
            }}
          />

          <div className="mt-6 border-t border-gray-100 pt-4">
            <FieldLabelElement
              title="Consecutive breaches before alerting"
              description="The criteria must match on this many evaluations in a row before incidents or alerts are created (monitor status still changes immediately). Leave blank or 1 to alert on the first breach. Counted per device/series for grouped monitors."
            />
            <Input
              type={InputType.NUMBER}
              value={
                monitorCriteriaInstance?.data?.minimumBreachedEvaluations?.toString() ||
                ""
              }
              placeholder="1"
              onChange={(value: string) => {
                const parsed: number = parseInt(value, 10);
                monitorCriteriaInstance.setMinimumBreachedEvaluations(
                  !isNaN(parsed) && parsed > 1 ? parsed : undefined,
                );
                if (props.onChange) {
                  props.onChange(
                    MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                  );
                }
              }}
            />

            <div className="mt-4">
              <FieldLabelElement
                title="Re-open cooldown (seconds)"
                description="After an incident or alert auto-resolves, suppress re-creating it for this window — protects against flapping. Leave blank to re-alert immediately."
              />
              <Input
                type={InputType.NUMBER}
                value={
                  monitorCriteriaInstance?.data?.reopenCooldownSeconds?.toString() ||
                  ""
                }
                placeholder="0"
                onChange={(value: string) => {
                  const parsed: number = parseInt(value, 10);
                  monitorCriteriaInstance.setReopenCooldownSeconds(
                    !isNaN(parsed) && parsed > 0 ? parsed : undefined,
                  );
                  if (props.onChange) {
                    props.onChange(
                      MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                    );
                  }
                }}
              />
            </div>
          </div>

          {props.monitorType === MonitorType.IncomingRequest && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <Toggle
                value={showIncidentGrouping}
                title="Group incidents and alerts by a payload field"
                description="When enabled, this criteria opens a separate incident and alert per distinct value extracted from the request body, so a single webhook endpoint (e.g. Grafana) can keep multiple incidents active at once. Leave off for the default one-active-incident-per-criteria behaviour."
                onChange={(value: boolean) => {
                  setShowIncidentGrouping(value);
                  if (value) {
                    monitorCriteriaInstance.setIncidentGrouping(
                      monitorCriteriaInstance?.data?.incidentGrouping || {
                        groupByJSONPath: "",
                      },
                    );
                  } else {
                    monitorCriteriaInstance.setIncidentGrouping(undefined);
                  }
                  if (props.onChange) {
                    props.onChange(
                      MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                    );
                  }
                }}
              />

              {showIncidentGrouping && (
                <div className="mt-4 ml-6 space-y-3">
                  {/* Step 1 — what splits incidents apart */}
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">
                        1
                      </span>
                      <span
                        id={groupByLabelId}
                        className="text-sm font-medium text-gray-900"
                      >
                        Open a separate incident for each…
                      </span>
                    </div>
                    <p className="mb-2 ml-7 mt-1 text-xs text-gray-500">
                      A path into the request body — the same{" "}
                      <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
                        requestBody
                      </code>{" "}
                      you reference in incident templates. Every distinct value
                      opens its own incident; add{" "}
                      <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
                        [*]
                      </code>{" "}
                      to fan out over an array.
                    </p>
                    <div className="ml-7 font-mono">
                      <Input
                        ariaLabelledby={groupByLabelId}
                        value={incidentGrouping?.groupByJSONPath || ""}
                        placeholder="requestBody.alerts[*].labels.alertname"
                        onChange={(value: string) => {
                          updateIncidentGrouping({ groupByJSONPath: value });
                        }}
                      />
                    </div>
                    <p className="ml-7 mt-1.5 text-xs text-gray-500">
                      e.g. one incident per Grafana alert name.
                    </p>
                  </div>

                  {/* Step 2 — how each grouped incident auto-resolves */}
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">
                        2
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        Auto-resolve each incident when…{" "}
                        <span className="font-normal text-gray-500">
                          (optional)
                        </span>
                      </span>
                    </div>
                    <p className="mb-3 ml-7 mt-1 text-xs text-gray-500">
                      A webhook only describes what is firing right now, so
                      OneUptime cannot tell an incident has recovered unless the
                      payload says so. Set the field and value that signal
                      recovery. Leave blank to resolve these incidents manually.
                    </p>
                    <div className="ml-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor={resolvedPathInputId}
                          className="block text-xs font-medium text-gray-600"
                        >
                          Field that signals recovery
                        </label>
                        <div className="mt-1 font-mono">
                          <Input
                            id={resolvedPathInputId}
                            value={incidentGrouping?.resolvedWhenJSONPath || ""}
                            placeholder="requestBody.alerts[*].status"
                            onChange={(value: string) => {
                              updateIncidentGrouping({
                                resolvedWhenJSONPath: value || undefined,
                              });
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          htmlFor={resolvedValueInputId}
                          className="block text-xs font-medium text-gray-600"
                        >
                          Value that means recovered
                        </label>
                        <div className="mt-1 font-mono">
                          <Input
                            id={resolvedValueInputId}
                            value={incidentGrouping?.resolvedWhenValue || ""}
                            placeholder="resolved"
                            onChange={(value: string) => {
                              updateIncidentGrouping({
                                resolvedWhenValue: value || undefined,
                              });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    {incidentGrouping?.resolvedWhenJSONPath &&
                      incidentGrouping?.resolvedWhenValue && (
                        <p className="ml-7 mt-2 text-xs text-gray-500">
                          Resolves an incident when{" "}
                          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
                            {incidentGrouping.resolvedWhenJSONPath}
                          </code>{" "}
                          equals{" "}
                          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
                            {incidentGrouping.resolvedWhenValue}
                          </code>
                          .
                        </p>
                      )}
                  </div>

                  {/* Safety cap — kept compact and out of the way */}
                  <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2.5">
                    <div className="min-w-0">
                      <p
                        id={maxKeysLabelId}
                        className="text-sm font-medium text-gray-900"
                      >
                        Max incidents per request
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Safety cap so a high-cardinality field cannot open
                        unbounded incidents. Defaults to 100.
                      </p>
                    </div>
                    <div className="w-24 flex-shrink-0">
                      <Input
                        ariaLabelledby={maxKeysLabelId}
                        type={InputType.NUMBER}
                        value={
                          incidentGrouping?.maxKeysPerPayload !== undefined
                            ? incidentGrouping.maxKeysPerPayload.toString()
                            : ""
                        }
                        placeholder="100"
                        onChange={(value: string) => {
                          const parsed: number = parseInt(value, 10);
                          updateIncidentGrouping({
                            maxKeysPerPayload:
                              value && !isNaN(parsed) ? parsed : undefined,
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Delete Criteria Button */}
      <div className="mt-4 -ml-3">
        <Button
          onClick={() => {
            if (props.onDelete) {
              props.onDelete();
            }
          }}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          icon={IconProp.Trash}
          title="Delete Criteria"
        />
      </div>
    </div>
  );
};

export default MonitorCriteriaInstanceElement;
