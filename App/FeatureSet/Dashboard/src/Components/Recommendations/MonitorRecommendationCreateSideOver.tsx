import React, { FunctionComponent, ReactElement, useState } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import BasicRadioButtons, {
  BasicRadioButtonOption,
} from "Common/UI/Components/RadioButtons/BasicRadioButtons";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import MonitorRecommendationSeverityMapper, {
  MonitorRecommendationSeverityOption,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import {
  MonitorRecommendation,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationNotificationSettings,
  MonitorRecommendationSeverity,
  MonitorRecommendationSeverityMap,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  MonitorBatchPayAsYouGoConsent,
  isMonitorBatchConsentRequired,
} from "../Billing/PayAsYouGo";

export interface ComponentProps {
  selectedRecommendations: Array<MonitorRecommendation>;
  resourceLabel: string;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  incidentSeverityOptions: Array<MonitorRecommendationSeverityOption>;
  alertSeverityOptions: Array<MonitorRecommendationSeverityOption>;
  isCreating: boolean;
  progressMessage?: string | undefined;
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (
    notificationSettings: MonitorRecommendationNotificationSettings,
    hasAcknowledgedBilling: boolean,
  ) => void;
}

type ToObjectIDArrayFunction = (
  value: DropdownValue | Array<DropdownValue> | null,
) => Array<ObjectID>;

const toObjectIDArray: ToObjectIDArrayFunction = (
  value: DropdownValue | Array<DropdownValue> | null,
): Array<ObjectID> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item: DropdownValue) => {
    return new ObjectID(item.toString());
  });
};

type SelectedOptionsFunction = (
  options: Array<DropdownOption>,
  selected: Array<ObjectID>,
) => Array<DropdownOption>;

const selectedOptions: SelectedOptionsFunction = (
  options: Array<DropdownOption>,
  selected: Array<ObjectID>,
): Array<DropdownOption> => {
  return options.filter((option: DropdownOption) => {
    return selected.some((id: ObjectID) => {
      return id.toString() === option.value;
    });
  });
};

type ToDropdownOptionsFunction = (
  options: Array<MonitorRecommendationSeverityOption>,
) => Array<DropdownOption>;

const toDropdownOptions: ToDropdownOptionsFunction = (
  options: Array<MonitorRecommendationSeverityOption>,
): Array<DropdownOption> => {
  return options.map((option: MonitorRecommendationSeverityOption) => {
    return { value: option.id.toString(), label: option.name };
  });
};

const MonitorRecommendationCreateSideOver: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * `Alert` rather than `Both` is the default even though `Both` reproduces
   * what the templates did before this control existed. Every shipped template
   * sets createIncidents AND createAlerts, so one threshold breach opened an
   * incident and an alert saying the same thing — two records to acknowledge
   * and two notification fan-outs per event. For infrastructure thresholds the
   * alert is the right record: it notifies the team without publishing to the
   * status page. Anyone who wants the old behaviour picks Both, one click away
   * and visible before they create anything.
   */
  const [notificationMode, setNotificationMode] =
    useState<MonitorRecommendationNotificationMode>(
      MonitorRecommendationNotificationMode.Alert,
    );

  /*
   * Every recommendation in the catalogue is a non-Manual monitor, so on the
   * Free plan this batch starts a real monthly charge. Same acknowledgement
   * the single create-monitor form asks for, gating the same action.
   */
  const monitorTypes: Array<MonitorType> = props.selectedRecommendations.map(
    (recommendation: MonitorRecommendation) => {
      return recommendation.monitorType;
    },
  );

  const needsBillingConsent: boolean =
    isMonitorBatchConsentRequired(monitorTypes);

  const [hasAcknowledgedBilling, setHasAcknowledgedBilling] =
    useState<boolean>(false);

  const [onCallPolicyIds, setOnCallPolicyIds] = useState<Array<ObjectID>>([]);
  const [ownerTeamIds, setOwnerTeamIds] = useState<Array<ObjectID>>([]);
  const [ownerUserIds, setOwnerUserIds] = useState<Array<ObjectID>>([]);
  const [labelIds, setLabelIds] = useState<Array<ObjectID>>([]);

  /*
   * Severity mapping starts at the project's own defaults — most severe for
   * Critical, next for Warning — and is editable. It is seeded once from
   * props rather than recomputed on render so that an edit survives the next
   * render.
   */
  const [incidentSeverityMap, setIncidentSeverityMap] =
    useState<MonitorRecommendationSeverityMap>(() => {
      return MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
        props.incidentSeverityOptions,
      );
    });

  const [alertSeverityMap, setAlertSeverityMap] =
    useState<MonitorRecommendationSeverityMap>(() => {
      return MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
        props.alertSeverityOptions,
      );
    });

  const willCreateIncidents: boolean =
    notificationMode === MonitorRecommendationNotificationMode.Incident ||
    notificationMode === MonitorRecommendationNotificationMode.Both;

  const willCreateAlerts: boolean =
    notificationMode === MonitorRecommendationNotificationMode.Alert ||
    notificationMode === MonitorRecommendationNotificationMode.Both;

  const criticalCount: number = props.selectedRecommendations.filter(
    (recommendation: MonitorRecommendation) => {
      return recommendation.severity === "Critical";
    },
  ).length;

  const warningCount: number =
    props.selectedRecommendations.length - criticalCount;

  const modeOptions: Array<BasicRadioButtonOption> = [
    {
      title: "Create an alert",
      description:
        "Notifies the team and runs the on-call policy. Not published to your status page.",
      value: MonitorRecommendationNotificationMode.Alert,
    },
    {
      title: "Declare an incident",
      description:
        "Notifies the team, runs the on-call policy, and can be shown on your status page.",
      value: MonitorRecommendationNotificationMode.Incident,
    },
    {
      title: "Both",
      description:
        "One breach opens an alert and an incident. Two records to resolve — pick this only if your workflow needs both.",
      value: MonitorRecommendationNotificationMode.Both,
    },
  ];

  type RenderSeverityRowFunction = (data: {
    severity: MonitorRecommendationSeverity;
    count: number;
    options: Array<MonitorRecommendationSeverityOption>;
    severityMap: MonitorRecommendationSeverityMap;
    onChange: (severityId: ObjectID | undefined) => void;
  }) => ReactElement;

  /*
   * One "Critical -> [dropdown]" row. Rendering the mapping instead of just
   * applying it is what keeps an automatic choice reviewable: the whole point
   * of deriving severity from the recommendation is that nobody has to think
   * about it, and the cost of that is nobody notices when it is wrong.
   */
  const renderSeverityRow: RenderSeverityRowFunction = (data: {
    severity: MonitorRecommendationSeverity;
    count: number;
    options: Array<MonitorRecommendationSeverityOption>;
    severityMap: MonitorRecommendationSeverityMap;
    onChange: (severityId: ObjectID | undefined) => void;
  }): ReactElement => {
    const dropdownOptions: Array<DropdownOption> = toDropdownOptions(
      data.options,
    );
    const currentId: ObjectID | undefined = data.severityMap[data.severity];

    return (
      <div className="flex items-center gap-3">
        <div className="w-32 flex-shrink-0">
          <span
            className={`text-xs font-medium ${
              data.severity === "Critical" ? "text-red-600" : "text-amber-600"
            }`}
          >
            {data.severity}
          </span>
          <span className="ml-1 text-xs text-gray-400">({data.count})</span>
        </div>
        <Icon
          icon={IconProp.ArrowCircleRight}
          className="h-4 w-4 text-gray-300"
        />
        <div className="flex-1">
          <Dropdown
            value={
              dropdownOptions.find((option: DropdownOption) => {
                return option.value === currentId?.toString();
              }) || undefined
            }
            options={dropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              data.onChange(
                value && !Array.isArray(value)
                  ? new ObjectID(value.toString())
                  : undefined,
              );
            }}
            placeholder="Keep the template's severity"
          />
        </div>
      </div>
    );
  };

  return (
    <SideOver
      title={`Create ${props.selectedRecommendations.length} ${
        props.selectedRecommendations.length === 1 ? "Monitor" : "Monitors"
      }`}
      description={`These monitors will be created on this ${props.resourceLabel.toLowerCase()}. Everything below applies to every monitor in this batch.`}
      size={SideOverSize.Medium}
      submitButtonText={props.isCreating ? "Creating..." : "Create Monitors"}
      submitButtonDisabled={
        props.isCreating ||
        props.selectedRecommendations.length === 0 ||
        (needsBillingConsent && !hasAcknowledgedBilling)
      }
      onClose={props.onClose}
      onSubmit={() => {
        const notificationSettings: MonitorRecommendationNotificationSettings =
          {
            notificationMode: notificationMode,
            onCallPolicyIds: onCallPolicyIds,
            ownerTeamIds: ownerTeamIds,
            ownerUserIds: ownerUserIds,
            labelIds: labelIds,
            incidentSeverityIdBySeverity: incidentSeverityMap,
            alertSeverityIdBySeverity: alertSeverityMap,
          };

        props.onSubmit(notificationSettings, hasAcknowledgedBilling);
      }}
    >
      <div className="space-y-6">
        {props.error ? <ErrorMessage message={props.error} /> : <></>}

        <MonitorBatchPayAsYouGoConsent
          monitorTypes={monitorTypes}
          value={hasAcknowledgedBilling}
          onChange={(value: boolean) => {
            setHasAcknowledgedBilling(value);
          }}
        />

        {props.progressMessage ? (
          <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
            {props.progressMessage}
          </div>
        ) : (
          <></>
        )}

        <div>
          <FieldLabelElement
            title="When one of these fires"
            description="Every shipped template opens both an alert and an incident for the same breach. Pick the one your team actually works from."
            required={true}
          />
          <BasicRadioButtons
            initialValue={notificationMode}
            options={modeOptions}
            onChange={(value: string) => {
              if (value) {
                setNotificationMode(
                  value as MonitorRecommendationNotificationMode,
                );
              }
            }}
          />
        </div>

        <div>
          <FieldLabelElement
            title="On-Call Policy"
            description="Executed when any of these monitors opens its alert or incident. This is the difference between a record being written and a person being woken up."
            required={true}
          />
          <Dropdown
            value={selectedOptions(
              props.onCallPolicyDropdownOptions,
              onCallPolicyIds,
            )}
            options={props.onCallPolicyDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setOnCallPolicyIds(toObjectIDArray(value));
            }}
            isMultiSelect={true}
            placeholder="Select On-Call Policies"
          />
          {onCallPolicyIds.length === 0 ? (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
              />
              <p className="text-xs text-amber-700">
                {props.onCallPolicyDropdownOptions.length === 0
                  ? "This project has no on-call policies. These monitors will record what happened, but nobody will be paged. You can add a policy later and edit these monitors."
                  : `Without a policy, ${
                      criticalCount > 0
                        ? `the ${criticalCount} Critical ${
                            criticalCount === 1 ? "monitor" : "monitors"
                          } in this batch will open records that`
                        : "these monitors will open records that"
                    } sit unacknowledged until someone opens the dashboard.`}
              </p>
            </div>
          ) : (
            <></>
          )}
        </div>

        <div>
          <FieldLabelElement
            title="Severity"
            description="Taken from each recommendation's own severity so a Warning does not page like an outage. Change either row to override."
          />
          <div className="space-y-3 rounded-md border border-gray-200 p-3">
            {willCreateAlerts ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Alert severity
                </p>
                {renderSeverityRow({
                  severity: "Critical",
                  count: criticalCount,
                  options: props.alertSeverityOptions,
                  severityMap: alertSeverityMap,
                  onChange: (severityId: ObjectID | undefined) => {
                    setAlertSeverityMap({
                      ...alertSeverityMap,
                      Critical: severityId,
                    });
                  },
                })}
                {renderSeverityRow({
                  severity: "Warning",
                  count: warningCount,
                  options: props.alertSeverityOptions,
                  severityMap: alertSeverityMap,
                  onChange: (severityId: ObjectID | undefined) => {
                    setAlertSeverityMap({
                      ...alertSeverityMap,
                      Warning: severityId,
                    });
                  },
                })}
              </div>
            ) : (
              <></>
            )}

            {willCreateIncidents ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Incident severity
                </p>
                {renderSeverityRow({
                  severity: "Critical",
                  count: criticalCount,
                  options: props.incidentSeverityOptions,
                  severityMap: incidentSeverityMap,
                  onChange: (severityId: ObjectID | undefined) => {
                    setIncidentSeverityMap({
                      ...incidentSeverityMap,
                      Critical: severityId,
                    });
                  },
                })}
                {renderSeverityRow({
                  severity: "Warning",
                  count: warningCount,
                  options: props.incidentSeverityOptions,
                  severityMap: incidentSeverityMap,
                  onChange: (severityId: ObjectID | undefined) => {
                    setIncidentSeverityMap({
                      ...incidentSeverityMap,
                      Warning: severityId,
                    });
                  },
                })}
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>

        <CollapsibleSection
          title="Owners and labels"
          description="Optional. Owners are notified about everything these monitors open."
          variant="bordered"
          defaultCollapsed={true}
        >
          <div className="space-y-4 pt-2">
            <div>
              <FieldLabelElement
                title="Owner Teams"
                description="Teams that own these monitors."
              />
              <Dropdown
                value={selectedOptions(props.teamDropdownOptions, ownerTeamIds)}
                options={props.teamDropdownOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setOwnerTeamIds(toObjectIDArray(value));
                }}
                isMultiSelect={true}
                placeholder="Select Teams"
              />
            </div>

            <div>
              <FieldLabelElement
                title="Owner Users"
                description="Individual users who own these monitors."
              />
              <Dropdown
                value={selectedOptions(props.userDropdownOptions, ownerUserIds)}
                options={props.userDropdownOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setOwnerUserIds(toObjectIDArray(value));
                }}
                isMultiSelect={true}
                placeholder="Select Users"
              />
            </div>

            <div>
              <FieldLabelElement
                title="Labels"
                description="Applied to the created monitors and to everything they open."
              />
              <Dropdown
                value={selectedOptions(props.labelDropdownOptions, labelIds)}
                options={props.labelDropdownOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setLabelIds(toObjectIDArray(value));
                }}
                isMultiSelect={true}
                placeholder="Select Labels"
              />
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title={`Monitors to create (${props.selectedRecommendations.length})`}
          variant="bordered"
          defaultCollapsed={true}
        >
          <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto">
            {props.selectedRecommendations.map(
              (recommendation: MonitorRecommendation) => {
                return (
                  <li
                    key={recommendation.recommendationId}
                    className="flex items-center justify-between px-1 py-2 text-sm text-gray-700"
                  >
                    <span>{recommendation.name}</span>
                    <span
                      className={`text-xs ${
                        recommendation.severity === "Critical"
                          ? "text-red-600"
                          : "text-amber-600"
                      }`}
                    >
                      {recommendation.severity}
                    </span>
                  </li>
                );
              },
            )}
          </ul>
        </CollapsibleSection>
      </div>
    </SideOver>
  );
};

export default MonitorRecommendationCreateSideOver;
