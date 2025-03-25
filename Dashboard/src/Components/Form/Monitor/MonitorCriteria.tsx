import MonitorCriteriaInstanceElement from "./MonitorCriteriaInstance";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  value: MonitorCriteria | undefined;
  onChange?: undefined | ((value: MonitorCriteria) => void);
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  monitorType: MonitorType;
  monitorStep: MonitorStep;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showCantDeleteModal, setShowCantDeleteModal] =
    React.useState<boolean>(false);

  const monitorCriteria: MonitorCriteria = props.value || new MonitorCriteria();

  return (
    <div className="mt-4">
      {monitorCriteria.data?.monitorCriteriaInstanceArray.map(
        (i: MonitorCriteriaInstance) => {
          return (
            <div className="mt-10 mb-10" key={i.data?.id}>
              <MonitorCriteriaInstanceElement
                monitorType={props.monitorType}
                monitorStep={props.monitorStep}
                monitorStatusDropdownOptions={
                  props.monitorStatusDropdownOptions
                }
                incidentSeverityDropdownOptions={
                  props.incidentSeverityDropdownOptions
                }
                alertSeverityDropdownOptions={
                  props.alertSeverityDropdownOptions
                }
                onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
                value={i}
                onDelete={() => {
                  if (
                    monitorCriteria.data?.monitorCriteriaInstanceArray
                      .length === 1
                  ) {
                    setShowCantDeleteModal(true);
                    return;
                  }

                  // remove the criteria filter
                  const index: number | undefined =
                    monitorCriteria.data?.monitorCriteriaInstanceArray.findIndex(
                      (item: MonitorCriteriaInstance) => {
                        return item.data?.id === i.data?.id;
                      },
                    );

                  if (index === undefined) {
                    return;
                  }

                  const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
                    ...(monitorCriteria.data?.monitorCriteriaInstanceArray ||
                      []),
                  ];
                  newMonitorCriterias.splice(index, 1);
                  props.onChange?.(
                    MonitorCriteria.fromJSON({
                      _type: "MonitorCriteria",
                      value: {
                        monitorCriteriaInstanceArray: [...newMonitorCriterias],
                      },
                    }),
                  );
                }}
                onChange={(value: MonitorCriteriaInstance) => {
                  const index: number | undefined =
                    monitorCriteria.data?.monitorCriteriaInstanceArray.findIndex(
                      (item: MonitorCriteriaInstance) => {
                        return item.data?.id === value.data?.id;
                      },
                    );

                  if (index === undefined) {
                    return;
                  }
                  const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
                    ...(monitorCriteria.data?.monitorCriteriaInstanceArray ||
                      []),
                  ];
                  newMonitorCriterias[index] = value;
                  props.onChange?.(
                    MonitorCriteria.fromJSON({
                      _type: "MonitorCriteria",
                      value: {
                        monitorCriteriaInstanceArray: newMonitorCriterias,
                      },
                    }),
                  );
                }}
              />
            </div>
          );
        },
      )}
      <div className="mt-4 -ml-3">
        <Button
          title="Add Criteria"
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const newMonitorCriterias: Array<MonitorCriteriaInstance> = [
              ...(monitorCriteria.data?.monitorCriteriaInstanceArray || []),
            ];
            newMonitorCriterias.push(new MonitorCriteriaInstance());
            props.onChange?.(
              MonitorCriteria.fromJSON({
                _type: "MonitorCriteria",
                value: {
                  monitorCriteriaInstanceArray: newMonitorCriterias,
                },
              }),
            );
          }}
        />
      </div>
      {showCantDeleteModal ? (
        <ConfirmModal
          description={`We need at least one criteria for this monitor. We cant delete one remaining criteria.`}
          title={`Cannot delete last remaining criteria.`}
          onSubmit={() => {
            setShowCantDeleteModal(false);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText="Close"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default MonitorCriteriaElement;
