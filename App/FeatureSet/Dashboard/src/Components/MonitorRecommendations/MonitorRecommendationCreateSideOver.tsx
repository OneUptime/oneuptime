import React, { FunctionComponent, ReactElement, useState } from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ObjectID from "Common/Types/ObjectID";
import {
  MonitorRecommendation,
  MonitorRecommendationNotificationSettings,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

export interface ComponentProps {
  selectedRecommendations: Array<MonitorRecommendation>;
  resourceLabel: string;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  isCreating: boolean;
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (
    notificationSettings: MonitorRecommendationNotificationSettings,
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

const MonitorRecommendationCreateSideOver: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [onCallPolicyIds, setOnCallPolicyIds] = useState<Array<ObjectID>>([]);
  const [ownerTeamIds, setOwnerTeamIds] = useState<Array<ObjectID>>([]);
  const [ownerUserIds, setOwnerUserIds] = useState<Array<ObjectID>>([]);
  const [labelIds, setLabelIds] = useState<Array<ObjectID>>([]);
  const [incidentSeverityId, setIncidentSeverityId] = useState<
    ObjectID | undefined
  >(undefined);
  const [alertSeverityId, setAlertSeverityId] = useState<ObjectID | undefined>(
    undefined,
  );

  const criticalCount: number = props.selectedRecommendations.filter(
    (recommendation: MonitorRecommendation) => {
      return recommendation.severity === "Critical";
    },
  ).length;

  return (
    <SideOver
      title={`Create ${props.selectedRecommendations.length} ${
        props.selectedRecommendations.length === 1 ? "Monitor" : "Monitors"
      }`}
      description={`These monitors will be created on this ${props.resourceLabel.toLowerCase()}. Everything below is applied to every monitor in this batch.`}
      size={SideOverSize.Medium}
      submitButtonText={props.isCreating ? "Creating..." : "Create Monitors"}
      submitButtonDisabled={
        props.isCreating || props.selectedRecommendations.length === 0
      }
      onClose={props.onClose}
      onSubmit={() => {
        const notificationSettings: MonitorRecommendationNotificationSettings =
          {
            onCallPolicyIds: onCallPolicyIds,
            ownerTeamIds: ownerTeamIds,
            ownerUserIds: ownerUserIds,
            labelIds: labelIds,
            ...(incidentSeverityId
              ? { incidentSeverityId: incidentSeverityId }
              : {}),
            ...(alertSeverityId ? { alertSeverityId: alertSeverityId } : {}),
          };

        props.onSubmit(notificationSettings);
      }}
    >
      <div className="space-y-6">
        {props.error ? <ErrorMessage message={props.error} /> : <></>}

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Monitors to create
          </h4>
          <ul className="rounded-md border border-gray-200 divide-y divide-gray-100 max-h-48 overflow-y-auto">
            {props.selectedRecommendations.map(
              (recommendation: MonitorRecommendation) => {
                return (
                  <li
                    key={recommendation.recommendationId}
                    className="px-3 py-2 text-sm text-gray-700 flex items-center justify-between"
                  >
                    <span>{recommendation.name}</span>
                    <span className="text-xs text-gray-400">
                      {recommendation.severity}
                    </span>
                  </li>
                );
              },
            )}
          </ul>
        </div>

        <div>
          <FieldLabelElement
            title="On-Call Policies"
            description="Execute these on-call policies when any of these monitors opens an incident or alert. Without one, an incident is created but nobody is paged."
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
          {criticalCount > 0 && onCallPolicyIds.length === 0 ? (
            <p className="mt-1 text-xs text-amber-600">
              {criticalCount}{" "}
              {criticalCount === 1 ? "monitor is" : "monitors are"} Critical.
              Without an on-call policy their incidents will sit unacknowledged
              until someone opens the dashboard.
            </p>
          ) : (
            <></>
          )}
        </div>

        <div>
          <FieldLabelElement
            title="Owner Teams"
            description="Teams that own these monitors. Owners are notified about incidents and alerts on them."
          />
          <Dropdown
            value={selectedOptions(props.teamDropdownOptions, ownerTeamIds)}
            options={props.teamDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
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
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setOwnerUserIds(toObjectIDArray(value));
            }}
            isMultiSelect={true}
            placeholder="Select Users"
          />
        </div>

        <div>
          <FieldLabelElement
            title="Labels"
            description="Labels applied to the created monitors and to the incidents and alerts they open."
          />
          <Dropdown
            value={selectedOptions(props.labelDropdownOptions, labelIds)}
            options={props.labelDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setLabelIds(toObjectIDArray(value));
            }}
            isMultiSelect={true}
            placeholder="Select Labels"
          />
        </div>

        <div>
          <FieldLabelElement
            title="Incident Severity"
            description="Overrides the severity each template would otherwise use. Leave unset to keep the template's own choice."
          />
          <Dropdown
            value={
              props.incidentSeverityDropdownOptions.find(
                (option: DropdownOption) => {
                  return option.value === incidentSeverityId?.toString();
                },
              ) || undefined
            }
            options={props.incidentSeverityDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setIncidentSeverityId(
                value && !Array.isArray(value)
                  ? new ObjectID(value.toString())
                  : undefined,
              );
            }}
            placeholder="Use the template's severity"
          />
        </div>

        <div>
          <FieldLabelElement
            title="Alert Severity"
            description="Overrides the severity each template would otherwise use. Leave unset to keep the template's own choice."
          />
          <Dropdown
            value={
              props.alertSeverityDropdownOptions.find(
                (option: DropdownOption) => {
                  return option.value === alertSeverityId?.toString();
                },
              ) || undefined
            }
            options={props.alertSeverityDropdownOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setAlertSeverityId(
                value && !Array.isArray(value)
                  ? new ObjectID(value.toString())
                  : undefined,
              );
            }}
            placeholder="Use the template's severity"
          />
        </div>
      </div>
    </SideOver>
  );
};

export default MonitorRecommendationCreateSideOver;
