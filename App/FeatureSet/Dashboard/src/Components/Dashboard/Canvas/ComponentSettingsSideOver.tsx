import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement, useState } from "react";
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

  /*
   * const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
   *   Dictionary<boolean>
   * >({});
   */

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
          title={`Delete Widget`}
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
            title={`Delete Widget?`}
            description={`Are you sure you want to delete this widget? This action cannot be undone.`}
            onClose={() => {
              setShowDeleteConfirmation(false);
            }}
            submitButtonText={"Delete Widget"}
            onSubmit={() => {
              props.onComponentDelete(component);
              setShowDeleteConfirmation(false);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.DANGER}
          />
        )}

        {/* Widget type and size info */}
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700 capitalize">
            {component.componentType}
          </span>
          <span className="text-xs text-gray-400">
            {component.widthInDashboardUnits} x{" "}
            {component.heightInDashboardUnits} units
          </span>
        </div>

        <ArgumentsForm
          component={component}
          /*
           * onHasFormValidationErrors={(values: Dictionary<boolean>) => {
           *   setHasFormValidationErrors(values);
           * }}
           */
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
