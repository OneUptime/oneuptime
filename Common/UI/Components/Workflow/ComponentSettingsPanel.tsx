import Button, { ButtonStyleType } from "../Button/Button";
import BasicForm from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import ConfirmModal from "../Modal/ConfirmModal";
import Icon from "../Icon/Icon";
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

/*
 * The step configuration surface, rendered as a docked panel beside the
 * canvas (see Workflow.tsx) instead of a full-screen modal — so the graph
 * stays visible while you configure a step. It overlays the right edge of the
 * canvas, leaving the React Flow layout untouched.
 */

export interface ComponentProps {
  title: string;
  description: string;
  onClose: () => void;
  onSave: (component: NodeDataProp) => void;
  onDelete: (component: NodeDataProp) => void;
  component: NodeDataProp;
  graphComponents: Array<NodeDataProp>;
  // Component data ids that run before this step (their output is referenceable).
  upstreamComponentIds?: Set<string> | undefined;
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

const ComponentSettingsPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [component, setComponent] = useState<NodeDataProp>(props.component);
  const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
    Dictionary<boolean>
  >({});
  const [showDeleteConfirmation, setShowDeleteConfirmation] =
    useState<boolean>(false);

  /*
   * The Identifier is a technical detail most authors never touch (it's used
   * to reference this step from others). It's tucked behind an "Advanced"
   * disclosure so the panel stays focused on the actual settings.
   */
  const [showIdentifier, setShowIdentifier] = useState<boolean>(false);

  const settingsSection: ReactElement = (
    <SectionCard icon={IconProp.Settings} title="Settings">
      <ArgumentsForm
        graphComponents={props.graphComponents}
        upstreamComponentIds={props.upstreamComponentIds}
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
   * show — keeps the panel lean for triggers (no inputs) and components
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
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3">
        <div className="min-w-0 pr-2">
          <h2 className="truncate text-sm font-semibold text-gray-900">
            {props.title}
          </h2>
          {props.description && (
            <p className="truncate text-xs text-gray-500">
              {props.description}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close settings"
          onClick={props.onClose}
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 cursor-pointer"
        >
          <Icon icon={IconProp.Close} className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {settingsSection}
        {documentationSection}
        {inputsSection}
        {outputsSection}
        {returnsSection}
        {showIdentifier ? (
          idSection
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowIdentifier(true);
            }}
            className="text-sm font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
          >
            Show advanced (identifier)
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
        <Button
          title="Delete"
          icon={IconProp.Trash}
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          dataTestId="workflow-step-delete"
          onClick={() => {
            setShowDeleteConfirmation(true);
          }}
        />
        <Button
          title="Save"
          buttonStyle={ButtonStyleType.PRIMARY}
          disabled={hasErrors}
          dataTestId="workflow-step-save"
          onClick={() => {
            props.onSave(component);
          }}
        />
      </div>

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
    </div>
  );
};

export default ComponentSettingsPanel;
