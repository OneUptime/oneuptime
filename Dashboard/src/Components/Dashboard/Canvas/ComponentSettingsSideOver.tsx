import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import Button, { ButtonStyleType } from "../Button/Button";
import BasicForm from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import ConfirmModal from "../Modal/ConfirmModal";
import SideOver from "../SideOver/SideOver";
import ArgumentsForm from "./ArgumentsForm";
import ComponentPortViewer from "./ComponentPortViewer";
import ComponentReturnValueViewer from "./ComponentReturnValueViewer";
import DocumentationViewer from "./DocumentationViewer";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { NodeDataProp } from "Common/Types/Workflow/Component";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Divider from "Common/UI/Components/Divider/Divider";

export interface ComponentProps {
  title: string;
  description: string;
  onClose: () => void;
  onDashboardViewConfigChange: (dashboardViewConfig: DashboardViewConfig) => void;
  componentId: ObjectID;
  dashboardViewConfig: DashboardViewConfig;
}

const ComponentSettingsSideOver: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  
  const component

  const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
    Dictionary<boolean>
  >({});
  const [showDeleteConfirmation, setShowDeleteConfirmation] =
    useState<boolean>(false);

  return (
    <SideOver
      title={props.title}
      description={props.description}
      onClose={props.onClose}
      onSubmit={() => {
        return component && props.onSave(component);
      }}
      leftFooterElement={
        <Button
          title={`Delete ${component.metadata.componentType}`}
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

              // remove this compoennt from the dashboardViewConfig
              const newComponents = props.dashboardViewConfig.components.filter(
                (component) => component.componentId.toString() !== props.componentId.toString()
              );


              const updatedDashboardViewConfig: DashboardViewConfig = {
                ...props.dashboardViewConfig,
                components: [...newComponents],
              };

              props.onDashboardViewConfigChange(updatedDashboardViewConfig);
              setShowDeleteConfirmation(false);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.DANGER}
          />
        )}
        

        <Divider />

        <ArgumentsForm
          graphComponents={props.graphComponents}
          workflowId={props.workflowId}
          component={component}
          onFormChange={(component: NodeDataProp) => {
            setComponent({ ...component });
          }}
          onHasFormValidationErrors={(value: Dictionary<boolean>) => {
            setHasFormValidationErrors({
              ...hasFormValidationErrors,
              ...value,
            });
          }}
        />

      </>
    </SideOver>
  );
};

export default ComponentSettingsSideOver;
