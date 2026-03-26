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
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp } from "../../../Types/Workflow/Component";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Icon from "../Icon/Icon";

export interface ComponentProps {
  title: string;
  description: string;
  onClose: () => void;
  onSave: (component: NodeDataProp) => void;
  onDelete: (component: NodeDataProp) => void;
  component: NodeDataProp;
  graphComponents: Array<NodeDataProp>;
  workflowId: ObjectID;
}

const ComponentSettingsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [component, setComponent] = useState<NodeDataProp>(props.component);
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
          title={`Delete`}
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
            title={`Delete ${component.metadata.componentType}`}
            description={`Are you sure you want to delete this ${component.metadata.componentType.toLowerCase()}? This action is not recoverable.`}
            onClose={() => {
              setShowDeleteConfirmation(false);
            }}
            submitButtonText={"Delete"}
            onSubmit={() => {
              props.onDelete(component);
              setShowDeleteConfirmation(false);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.DANGER}
          />
        )}

        {/* Component ID Section */}
        <div
          style={{
            backgroundColor: "#f8fafc",
            borderRadius: "10px",
            border: "1px solid #e2e8f0",
            padding: "1rem",
            marginTop: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.5rem",
            }}
          >
            <Icon
              icon={IconProp.Label}
              style={{ color: "#64748b", width: "0.875rem", height: "0.875rem" }}
            />
            <span
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "#334155",
              }}
            >
              Identity
            </span>
          </div>
          <BasicForm
            hideSubmitButton={true}
            initialValues={{
              id: component?.id,
            }}
            onChange={(values: FormValues<JSONObject>) => {
              setComponent({ ...component, ...values });
            }}
            onFormValidationErrorChanged={(hasError: boolean) => {
              setHasFormValidationErrors({
                ...hasFormValidationErrors,
                id: hasError,
              });
            }}
            fields={[
              {
                title: `${component.metadata.componentType} ID`,
                description: `Unique identifier used to reference this ${component.metadata.componentType.toLowerCase()} from other components.`,
                field: {
                  id: true,
                },
                required: true,
                fieldType: FormFieldSchemaType.Text,
              },
            ]}
          />
        </div>

        {/* Documentation Section */}
        {component.metadata.documentationLink && (
          <div
            style={{
              backgroundColor: "#eff6ff",
              borderRadius: "10px",
              border: "1px solid #bfdbfe",
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "0.5rem",
              }}
            >
              <Icon
                icon={IconProp.Book}
                style={{
                  color: "#3b82f6",
                  width: "0.875rem",
                  height: "0.875rem",
                }}
              />
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "#1e40af",
                }}
              >
                Documentation
              </span>
            </div>
            <DocumentationViewer
              documentationLink={component.metadata.documentationLink}
              workflowId={props.workflowId}
            />
          </div>
        )}

        {/* Arguments Section */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e2e8f0",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.75rem",
            }}
          >
            <Icon
              icon={IconProp.Settings}
              style={{ color: "#64748b", width: "0.875rem", height: "0.875rem" }}
            />
            <span
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "#334155",
              }}
            >
              Configuration
            </span>
          </div>
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
        </div>

        {/* Ports Section */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e2e8f0",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.25rem",
            }}
          >
            <Icon
              icon={IconProp.Link}
              style={{ color: "#64748b", width: "0.875rem", height: "0.875rem" }}
            />
            <span
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "#334155",
              }}
            >
              Connections
            </span>
          </div>
          <ComponentPortViewer
            name="In Ports"
            description="Input connections for this component"
            ports={component.metadata.inPorts}
          />
          <ComponentPortViewer
            name="Out Ports"
            description="Output connections from this component"
            ports={component.metadata.outPorts}
          />
        </div>

        {/* Return Values Section */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e2e8f0",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.25rem",
            }}
          >
            <Icon
              icon={IconProp.ArrowCircleRight}
              style={{ color: "#64748b", width: "0.875rem", height: "0.875rem" }}
            />
            <span
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "#334155",
              }}
            >
              Output
            </span>
          </div>
          <ComponentReturnValueViewer
            name="Return Values"
            description="Values this component produces for downstream use"
            returnValues={component.metadata.returnValues}
          />
        </div>
      </>
    </SideOver>
  );
};

export default ComponentSettingsModal;
