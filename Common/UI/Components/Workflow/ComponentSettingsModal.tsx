import Button, { ButtonStyleType } from "../Button/Button";
import BasicForm from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import ConfirmModal from "../Modal/ConfirmModal";
import Modal, { ModalWidth } from "../Modal/Modal";
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
  webhookSecretKey?: string | undefined;
}

interface SectionCardProps {
  icon: IconProp;
  title: string;
  children: ReactElement | Array<ReactElement>;
  tone?: "default" | "info" | undefined;
}

const SectionCard: FunctionComponent<SectionCardProps> = (
  props: SectionCardProps,
): ReactElement => {
  const isInfo: boolean = props.tone === "info";
  const containerClass: string = isInfo
    ? "rounded-lg border border-blue-100 bg-blue-50/40 p-4"
    : "rounded-lg border border-gray-200 bg-white p-4";
  const iconClass: string = isInfo ? "text-blue-500" : "text-gray-400";
  const titleClass: string = isInfo
    ? "text-[11px] font-semibold uppercase tracking-wider text-blue-700"
    : "text-[11px] font-semibold uppercase tracking-wider text-gray-500";

  return (
    <div className={containerClass}>
      <div className="flex items-center gap-1.5 mb-3">
        <Icon icon={props.icon} className={`h-3.5 w-3.5 ${iconClass}`} />
        <span className={titleClass}>{props.title}</span>
      </div>
      {props.children}
    </div>
  );
};

const ComponentSettingsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [component, setComponent] = useState<NodeDataProp>(props.component);
  const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
    Dictionary<boolean>
  >({});
  const [showDeleteConfirmation, setShowDeleteConfirmation] =
    useState<boolean>(false);

  const settingsSection: ReactElement = (
    <SectionCard icon={IconProp.Settings} title="Settings">
      <ArgumentsForm
        graphComponents={props.graphComponents}
        workflowId={props.workflowId}
        component={component}
        onFormChange={(c: NodeDataProp) => {
          setComponent({ ...c });
        }}
        onHasFormValidationErrors={(value: Dictionary<boolean>) => {
          setHasFormValidationErrors({
            ...hasFormValidationErrors,
            ...value,
          });
        }}
      />
    </SectionCard>
  );

  const idSection: ReactElement = (
    <SectionCard icon={IconProp.Label} title="ID">
      <BasicForm
        hideSubmitButton={true}
        initialValues={{ id: component?.id }}
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
            title: "Identifier",
            description: `Used to reference this ${component.metadata.componentType.toLowerCase()} from other steps.`,
            field: { id: true },
            required: true,
            fieldType: FormFieldSchemaType.Text,
          },
        ]}
      />
    </SectionCard>
  );

  const documentationSection: ReactElement | null = component.metadata
    .documentationLink ? (
    <SectionCard icon={IconProp.Book} title="Documentation" tone="info">
      <DocumentationViewer
        documentationLink={component.metadata.documentationLink}
        workflowId={props.workflowId}
        webhookSecretKey={props.webhookSecretKey}
      />
    </SectionCard>
  ) : null;

  /*
   * Each connection/output card is only rendered if there's something to
   * show — keeps the sidebar lean for triggers (no inputs) and components
   * that don't return any data.
   */
  const hasInputs: boolean =
    Array.isArray(component.metadata.inPorts) &&
    component.metadata.inPorts.length > 0;
  const hasOutputs: boolean =
    Array.isArray(component.metadata.outPorts) &&
    component.metadata.outPorts.length > 0;
  const hasReturns: boolean =
    Array.isArray(component.metadata.returnValues) &&
    component.metadata.returnValues.length > 0;

  const inputsSection: ReactElement | null = hasInputs ? (
    <SectionCard icon={IconProp.ArrowCircleDown} title="Inputs">
      <ComponentPortViewer
        name=""
        description="Where this step is reached from."
        ports={component.metadata.inPorts}
      />
    </SectionCard>
  ) : null;

  const outputsSection: ReactElement | null = hasOutputs ? (
    <SectionCard icon={IconProp.ArrowCircleRight} title="Outputs">
      <ComponentPortViewer
        name=""
        description="What runs after this step."
        ports={component.metadata.outPorts}
      />
    </SectionCard>
  ) : null;

  const returnsSection: ReactElement | null = hasReturns ? (
    <SectionCard icon={IconProp.Database} title="Returns">
      <ComponentReturnValueViewer
        name=""
        description="Data this step makes available downstream."
        returnValues={component.metadata.returnValues}
      />
    </SectionCard>
  ) : null;

  const hasErrors: boolean = Object.values(hasFormValidationErrors).some(
    (v: boolean) => {
      return v;
    },
  );

  return (
    <Modal
      title={props.title}
      description={props.description}
      onClose={props.onClose}
      onSubmit={() => {
        return component && props.onSave(component);
      }}
      submitButtonText="Save"
      modalWidth={ModalWidth.Large}
      disableSubmitButton={hasErrors}
      leftFooterElement={
        <Button
          title="Delete"
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
            submitButtonText="Delete"
            onSubmit={() => {
              props.onDelete(component);
              setShowDeleteConfirmation(false);
              props.onClose();
            }}
            submitButtonType={ButtonStyleType.DANGER}
          />
        )}

        {/*
         * Two-column layout: arguments take the main column (2/3 width on
         * md+), metadata sits in a narrower sidebar. Collapses to one
         * column below md.
         */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-4">{settingsSection}</div>
          <div className="md:col-span-1 space-y-4">
            {idSection}
            {documentationSection}
            {inputsSection}
            {outputsSection}
            {returnsSection}
          </div>
        </div>
      </>
    </Modal>
  );
};

export default ComponentSettingsModal;
