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

  const argumentsSection: ReactElement = (
    <SectionCard icon={IconProp.Settings} title="Configuration">
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

  const identitySection: ReactElement = (
    <SectionCard
      icon={IconProp.Label}
      title={`${component.metadata.componentType} ID`}
    >
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
            description: `Used to reference this ${component.metadata.componentType.toLowerCase()} from other components.`,
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

  const connectionsSection: ReactElement = (
    <SectionCard icon={IconProp.Link} title="Connections">
      <>
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
      </>
    </SectionCard>
  );

  const outputSection: ReactElement = (
    <SectionCard icon={IconProp.ArrowCircleRight} title="Output">
      <ComponentReturnValueViewer
        name="Return Values"
        description="Values this component produces for downstream use"
        returnValues={component.metadata.returnValues}
      />
    </SectionCard>
  );

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
          <div className="md:col-span-2 space-y-4">{argumentsSection}</div>
          <div className="md:col-span-1 space-y-4">
            {identitySection}
            {documentationSection}
            {connectionsSection}
            {outputSection}
          </div>
        </div>
      </>
    </Modal>
  );
};

export default ComponentSettingsModal;
