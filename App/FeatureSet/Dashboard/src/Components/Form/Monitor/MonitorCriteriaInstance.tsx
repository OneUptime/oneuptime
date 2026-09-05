import CriteriaFilters from "./CriteriaFilters";
import {
  NetworkDeviceCriteriaCatalogue,
  NetworkDeviceCriteriaCatalogueContext,
  NetworkDeviceOidCatalogueEntry,
} from "./CriteriaFilter";
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
import Icon from "Common/UI/Components/Icon/Icon";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Radio from "Common/UI/Components/Radio/Radio";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import CollapsibleSection from "./MonitorFormSection";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
  useState,
} from "react";
import MonitorCriteriaAlertsForm from "./MonitorCriteriaAlertsForm";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricViewConfigUtil from "Common/Types/Monitor/MonitorStepMetricViewConfigUtil";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import FilterCondition from "Common/Types/Filter/FilterCondition";

interface RuleActionToggleProps {
  title: string;
  description?: string | undefined;
  value: boolean;
  onChange: (value: boolean) => void;
}

// Give the action title and its help separate lines, with one accessible switch.
const RuleActionToggle: FunctionComponent<RuleActionToggleProps> = (
  props: RuleActionToggleProps,
): ReactElement => {
  const inputId: string = useId();
  const titleId: string = useId();
  const descriptionId: string = useId();

  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
        <span
          id={titleId}
          className="block text-sm font-medium leading-6 text-gray-900"
        >
          {props.title}
        </span>
        {props.description && (
          <span
            id={descriptionId}
            className="mt-0.5 block text-sm leading-5 text-gray-500"
          >
            {props.description}
          </span>
        )}
      </label>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={props.value}
        aria-labelledby={titleId}
        aria-describedby={props.description ? descriptionId : undefined}
        onClick={() => {
          props.onChange(!props.value);
        }}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${props.value ? "bg-indigo-600" : "bg-gray-200"}`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${props.value ? "translate-x-5" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
};

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
  /*
   * For Network Device monitors: the effective health-OID list of the device
   * this step points at, and the names and aliases of the interfaces its last
   * walk found. Both are fetched once per step in MonitorStep and read by the
   * SNMP OID and interface pickers on each criteria filter.
   *
   * isNetworkDeviceCatalogueLoaded says whether that fetch has answered for
   * the currently selected device; until it has, the pickers must not read an
   * empty catalogue as proof that a saved value is gone.
   */
  networkDeviceOidCatalogue?: Array<NetworkDeviceOidCatalogueEntry> | undefined;
  networkDeviceInterfaceNames?: Array<string> | undefined;
  isNetworkDeviceCatalogueLoaded?: boolean | undefined;
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
        MonitorStepMetricViewConfigUtil.getMetricViewConfig(
          props.monitorStep?.data,
        )?.queryConfigs || []
      ).flatMap((q: MetricQueryConfigData): Array<string> => {
        return q.metricQueryData?.groupByAttributeKeys || [];
      }),
    ),
  );

  /*
   * Memoized so the provider hands the same object down on every re-render
   * this component does for unrelated reasons - the pickers below rebuild
   * their option lists from it.
   */
  const networkDeviceCatalogue: NetworkDeviceCriteriaCatalogue =
    useMemo((): NetworkDeviceCriteriaCatalogue => {
      return {
        oids: props.networkDeviceOidCatalogue || [],
        interfaceNames: props.networkDeviceInterfaceNames || [],
        isLoaded: props.isNetworkDeviceCatalogueLoaded === true,
      };
    }, [
      props.networkDeviceOidCatalogue,
      props.networkDeviceInterfaceNames,
      props.isNetworkDeviceCatalogueLoaded,
    ]);

  const [errors, setErrors] = useState<Dictionary<string>>({});
  const [touched, setTouched] = useState<Dictionary<boolean>>({});
  const ruleNameId: string = useId();
  const ruleDescriptionId: string = useId();

  /*
   * The evaluator gates each action on its flag. Retained configuration,
   * including a saved status id, must never make a disabled action look active.
   */
  const showMonitorStatusChangeControl: boolean = Boolean(
    monitorCriteriaInstance.data?.changeMonitorStatus,
  );
  const showIncidentControl: boolean = Boolean(
    monitorCriteriaInstance.data?.createIncidents,
  );
  const showAlertControl: boolean = Boolean(
    monitorCriteriaInstance.data?.createAlerts,
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

  const filterCount: number =
    monitorCriteriaInstance?.data?.filters?.length || 0;
  const hasActions: boolean =
    showMonitorStatusChangeControl || showAlertControl || showIncidentControl;

  const isEnabled: boolean = monitorCriteriaInstance?.data?.isEnabled !== false;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <FieldLabelElement
          title="Rule name"
          htmlFor={ruleNameId}
          required={true}
        />
        <Input
          id={ruleNameId}
          value={monitorCriteriaInstance?.data?.name?.toString() || ""}
          placeholder="e.g. Website is unavailable"
          onBlur={() => {
            setTouched({ ...touched, name: true });
            setErrors({
              ...errors,
              name: monitorCriteriaInstance?.data?.name?.trim()
                ? ""
                : "Rule name is required",
            });
          }}
          error={touched["name"] && errors["name"] ? errors["name"] : undefined}
          onChange={(value: string) => {
            setErrors({
              ...errors,
              name: value.trim() ? "" : "Rule name is required",
            });
            monitorCriteriaInstance.setName(value);
            props.onChange?.(
              MonitorCriteriaInstance.clone(monitorCriteriaInstance),
            );
          }}
        />
        <CollapsibleSection
          title="Rule description"
          badge={
            monitorCriteriaInstance.data?.description ? "Added" : "Optional"
          }
          defaultCollapsed={true}
        >
          <FieldLabelElement
            title="Description"
            htmlFor={ruleDescriptionId}
            description="Add context for your team, if helpful."
          />
          <TextArea
            id={ruleDescriptionId}
            value={monitorCriteriaInstance?.data?.description?.toString() || ""}
            placeholder="What should your team know about this rule?"
            onChange={(value: string) => {
              monitorCriteriaInstance.setDescription(value);
              props.onChange?.(
                MonitorCriteriaInstance.clone(monitorCriteriaInstance),
              );
            }}
          />
        </CollapsibleSection>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-2 xl:gap-6">
        <section
          className="min-w-0 space-y-3 border-t border-gray-200 pt-5"
          aria-label="When"
        >
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-gray-900">When</h3>
            <p className="mt-1 text-xs text-gray-500">
              Choose the conditions that trigger this rule.
            </p>
          </div>
          <div className="space-y-3">
            {filterCount > 1 && (
              <Radio
                ariaLabel="Match conditions"
                className="flex flex-wrap gap-x-6 !space-y-0"
                value={
                  monitorCriteriaInstance?.data?.filterCondition ||
                  FilterCondition.All
                }
                options={[
                  { label: "All conditions match", value: FilterCondition.All },
                  {
                    label: "Any condition matches",
                    value: FilterCondition.Any,
                  },
                ]}
                onChange={(value: DropdownValue | null) => {
                  monitorCriteriaInstance.setFilterCondition(
                    value as FilterCondition,
                  );
                  props.onChange?.(
                    MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                  );
                }}
              />
            )}

            <NetworkDeviceCriteriaCatalogueContext.Provider
              value={networkDeviceCatalogue}
            >
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
            </NetworkDeviceCriteriaCatalogueContext.Provider>
          </div>
        </section>

        <section
          className="min-w-0 space-y-3 border-t border-gray-200 pt-5"
          aria-label="Then"
        >
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-gray-900">Then</h3>
            <p className="mt-1 text-xs text-gray-500">
              Choose what happens when this rule matches.
            </p>
          </div>
          <div className="divide-y divide-gray-200">
            <div className="py-4 first:pt-0 last:pb-0">
              <RuleActionToggle
                value={Boolean(showMonitorStatusChangeControl)}
                title="Change monitor status"
                onChange={(value: boolean) => {
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
              {showMonitorStatusChangeControl && (
                <div className="mt-3 max-w-sm">
                  <FieldLabelElement
                    title="Change monitor status to"
                    required={true}
                  />
                  <Dropdown
                    ariaLabel="Change monitor status to"
                    isClearable={false}
                    placeholder="Select monitor status"
                    value={props.monitorStatusDropdownOptions.find(
                      (i: DropdownOption) => {
                        return (
                          i.value ===
                            monitorCriteriaInstance?.data?.monitorStatusId
                              ?.id || undefined
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
                          MonitorCriteriaInstance.clone(
                            monitorCriteriaInstance,
                          ),
                        );
                      }
                    }}
                  />
                </div>
              )}
            </div>

            <div className="py-4 first:pt-0 last:pb-0">
              <RuleActionToggle
                value={showAlertControl}
                title="Create an alert"
                description="Notify your team about a problem."
                onChange={(value: boolean) => {
                  monitorCriteriaInstance.setCreateAlerts(value);

                  /*
                   * Seed the blank row on the way ON only. Unguarded, switching
                   * OFF an action that had no rows yet *added* one - a row the
                   * user then could not see, because the sub-form below renders
                   * only while the switch is on.
                   */
                  if (
                    value &&
                    (!monitorCriteriaInstance.data?.alerts ||
                      monitorCriteriaInstance.data?.alerts?.length === 0)
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
              {showAlertControl && (
                <div className="mt-4">
                  <MonitorCriteriaAlertsForm
                    initialValue={monitorCriteriaInstance?.data?.alerts || []}
                    alertSeverityDropdownOptions={
                      props.alertSeverityDropdownOptions
                    }
                    onCallPolicyDropdownOptions={
                      props.onCallPolicyDropdownOptions
                    }
                    labelDropdownOptions={props.labelDropdownOptions}
                    teamDropdownOptions={props.teamDropdownOptions}
                    userDropdownOptions={props.userDropdownOptions}
                    monitorType={props.monitorType}
                    seriesAttributeKeys={seriesAttributeKeys}
                    onChange={(value: Array<CriteriaAlert>) => {
                      monitorCriteriaInstance.setAlerts(value);
                      if (props.onChange) {
                        props.onChange(
                          MonitorCriteriaInstance.clone(
                            monitorCriteriaInstance,
                          ),
                        );
                      }
                    }}
                  />
                </div>
              )}
            </div>

            <div className="py-4 first:pt-0 last:pb-0">
              <RuleActionToggle
                value={showIncidentControl}
                title="Declare an incident"
                description="Track the issue and coordinate a response."
                onChange={(value: boolean) => {
                  monitorCriteriaInstance.setCreateIncidents(value);

                  // Seed on the way ON only - see the alert switch above.
                  if (
                    value &&
                    (!monitorCriteriaInstance.data?.incidents ||
                      monitorCriteriaInstance.data?.incidents?.length === 0)
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
              {showIncidentControl && (
                <div className="mt-4">
                  <MonitorCriteriaIncidentsForm
                    initialValue={
                      monitorCriteriaInstance?.data?.incidents || []
                    }
                    incidentSeverityDropdownOptions={
                      props.incidentSeverityDropdownOptions
                    }
                    onCallPolicyDropdownOptions={
                      props.onCallPolicyDropdownOptions
                    }
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
                          MonitorCriteriaInstance.clone(
                            monitorCriteriaInstance,
                          ),
                        );
                      }
                    }}
                  />
                </div>
              )}
            </div>
            {!hasActions && (
              <p className="py-3 text-xs text-gray-500">
                Turn on an action to use this rule.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Settings — criteria enable toggle + (incoming request) incident grouping */}
      <CollapsibleSection
        title="Advanced rule settings"
        description="Pause this rule or customize how incoming events are grouped."
        badge={isEnabled ? "Enabled" : "Disabled"}
        variant="bordered"
        defaultCollapsed={!showIncidentGrouping}
      >
        <div className="mt-2">
          <RuleActionToggle
            value={isEnabled}
            title="Enable this rule"
            description="Paused rules do not run or trigger actions."
            onChange={(value: boolean) => {
              monitorCriteriaInstance.setIsEnabled(value);
              if (props.onChange) {
                props.onChange(
                  MonitorCriteriaInstance.clone(monitorCriteriaInstance),
                );
              }
            }}
          />

          {props.monitorType === MonitorType.IncomingRequest && (
            <div className="mt-5 border-t border-gray-200 pt-4">
              <RuleActionToggle
                value={showIncidentGrouping}
                title="Group incidents and alerts by a payload field"
                description="Open a separate incident or alert for each distinct value in the incoming request."
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
                <div className="mt-4 space-y-3">
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

      <div className="border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={() => {
            props.onDelete?.();
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          <Icon icon={IconProp.Trash} className="h-4 w-4" />
          Delete rule
        </button>
      </div>
    </div>
  );
};

export default MonitorCriteriaInstanceElement;
