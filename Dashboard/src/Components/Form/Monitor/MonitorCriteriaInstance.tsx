import CriteriaFilters from "./CriteriaFilters";
import MonitorCriteriaIncidentsForm from "./MonitorCriteriaIncidentsForm";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
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
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import Input from "Common/UI/Components/Input/Input";
import Radio from "Common/UI/Components/Radio/Radio";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MonitorCriteriaAlertsForm from "./MonitorCriteriaAlertsForm";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import FilterCondition from "Common/Types/Filter/FilterCondition";

export interface ComponentProps {
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
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

  return (
    <div className="mt-4">
      <div className="mt-5">
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
          error={touched["name"] && errors["name"] ? errors["name"] : undefined}
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
      <div className="mt-5">
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
      <div className="mt-4">
        <FieldLabelElement
          title="Filter Condition"
          description="Select All if you want all the criteria to be met. Select any if you like any criteria to be met."
          required={true}
        />
        <Radio
          value={
            monitorCriteriaInstance?.data?.filterCondition ||
            FilterCondition.All
          }
          options={filterConditionOptions}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
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
      <div className="mt-4">
        <FieldLabelElement
          title="Filters"
          required={true}
          description="Add criteria for different monitor properties."
        />

        <CriteriaFilters
          monitorStep={props.monitorStep}
          monitorType={props.monitorType}
          value={monitorCriteriaInstance?.data?.filters || []}
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

      <div className="mt-4">
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
        <div className="mt-4">
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
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
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
        <div className="mt-4">
          <FieldLabelElement title="Create Alert" />

          <MonitorCriteriaAlertsForm
            initialValue={monitorCriteriaInstance?.data?.alerts || []}
            alertSeverityDropdownOptions={props.alertSeverityDropdownOptions}
            onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
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
        <div className="mt-4">
          <FieldLabelElement title="Create Incident" />

          <MonitorCriteriaIncidentsForm
            initialValue={monitorCriteriaInstance?.data?.incidents || []}
            incidentSeverityDropdownOptions={
              props.incidentSeverityDropdownOptions
            }
            onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
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

      <HorizontalRule />
    </div>
  );
};

export default MonitorCriteriaInstanceElement;
