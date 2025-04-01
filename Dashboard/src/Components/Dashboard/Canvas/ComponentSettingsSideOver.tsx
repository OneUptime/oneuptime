import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Divider from "Common/UI/Components/Divider/Divider";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import SideOver from "Common/UI/Components/SideOver/SideOver";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ArgumentsForm from "./ArgumentsForm";
import MetricType from "Common/Models/DatabaseModels/MetricType";

export interface ComponentProps {
  title: string;
  description: string;
  onClose: () => void;
  onComponentUpdate: (component: DashboardBaseComponent) => void;
  onComponentDelete: (component: DashboardBaseComponent) => void;
  componentId: ObjectID;
  dashboardViewConfig: DashboardViewConfig;
  metrics: {
    metricTypes: Array<MetricType>;
    telemetryAttributes: string[];
  };
}

const ComponentSettingsSideOver: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const component: DashboardBaseComponent =
    props.dashboardViewConfig.components.find(
      (component: DashboardBaseComponent) => {
        return (
          component.componentId.toString() === props.componentId.toString()
        );
      },
    ) as DashboardBaseComponent;

  // const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
  //   Dictionary<boolean>
  // >({});

  const [showDeleteConfirmation, setShowDeleteConfirmation] =
    useState<boolean>(false);

  return (
    <SideOver
      title={props.title}
      description={props.description}
      onClose={() => {
        props.onComponentUpdate(component);
        props.onClose();
      }}
      leftFooterElement={
        <Button
          title={`Delete Component`}
          icon={IconProp.Trash}
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          onClick={() => {
            setShowDeleteConfirmation(true);
          }}
        />
      }
    >
      <>
        {showDeleteConfirmation && (
          <ConfirmModal
            title={`Delete?`}
            description={`Are you sure you want to delete this component? This action is not recoverable.`}
            onClose={() => {
              setShowDeleteConfirmation(false);
            }}
            submitButtonText={"Delete"}
            onSubmit={() => {
              props.onComponentDelete(component);
              setShowDeleteConfirmation(false);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.DANGER}
          />
        )}

        <Divider />

        <ArgumentsForm
          component={component}
          // onHasFormValidationErrors={(values: Dictionary<boolean>) => {
          //   setHasFormValidationErrors(values);
          // }}
          onFormChange={(component: DashboardBaseComponent) => {
            props.onComponentUpdate(component);
          }}
          metrics={props.metrics}
        />
      </>
    </SideOver>
  );
};

export default ComponentSettingsSideOver;
