import Button, { ButtonStyleType } from "../Button/Button";
import BasicForm from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import ConfirmModal from "../Modal/ConfirmModal";
import Modal, { ModalWidth } from "../Modal/Modal";
import ArgumentsForm from "./ArgumentsForm";
import { getComponentPrimaryPanel } from "./ComponentPrimaryPanel";
import ComponentPortViewer from "./ComponentPortViewer";
import ComponentReturnValueViewer from "./ComponentReturnValueViewer";
import ComponentSettingsSection from "./ComponentSettingsSection";
import DocumentationViewer from "./DocumentationViewer";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp } from "../../../Types/Workflow/Component";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  title: string;
  description: string;
  onClose: () => void;
  onSave: (component: NodeDataProp) => void;
  onDelete: (component: NodeDataProp) => void;
  /**
   * Run this one step now. Absent for triggers, which have nothing to run on
   * their own.
   */
  onRunStep?: ((component: NodeDataProp) => void) | undefined;
  component: NodeDataProp;
  graphComponents: Array<NodeDataProp>;
  workflowId: ObjectID;
  webhookSecretKey?: string | undefined;
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
  const [showRunStepConfirmation, setShowRunStepConfirmation] =
    useState<boolean>(false);
  const bodyRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  /*
   * The dialog focuses the first control it finds as it opens. A step's
   * settings are often not there yet at that moment - BasicForm renders its
   * fields a beat later, and the field pickers wait for the model's columns -
   * so the first control was a copy button in Returns, halfway down the
   * dialog. Focus that lands past the first section goes back to the dialog
   * itself. BasicForm still focuses a first text setting when it renders, the
   * Webhook trigger keeps its focus on Copy URL, and Tab starts from the top.
   *
   * This runs after the Modal's own effect: React runs a child's effects
   * before its parent's.
   */
  useEffect(() => {
    const body: HTMLDivElement | null = bodyRef.current;
    const firstSection: Element | null = body
      ? body.firstElementChild
      : null;
    const focused: Element | null = document.activeElement;

    if (
      !body ||
      !firstSection ||
      !focused ||
      !body.contains(focused) ||
      firstSection.contains(focused)
    ) {
      return;
    }

    const dialog: Element | null = body.closest('[role="dialog"]');

    if (dialog instanceof HTMLElement) {
      dialog.focus();
    }
  }, []);

  const componentTypeName: string =
    component.metadata.componentType.toLowerCase();

  /*
   * A section is only rendered when it has something to say. A step with no
   * settings used to get a two-thirds-width card saying "This step does not
   * need any settings." above a large empty area, while everything else was
   * stacked in the narrow column beside it.
   */
  const hasSettings: boolean =
    Array.isArray(component.metadata.arguments) &&
    component.metadata.arguments.length > 0;
  const hasInputs: boolean =
    Array.isArray(component.metadata.inPorts) &&
    component.metadata.inPorts.length > 0;
  const hasOutputs: boolean =
    Array.isArray(component.metadata.outPorts) &&
    component.metadata.outPorts.length > 0;
  const hasReturns: boolean =
    Array.isArray(component.metadata.returnValues) &&
    component.metadata.returnValues.length > 0;

  const primarySection: ReactElement | null = getComponentPrimaryPanel({
    component: component,
    webhookSecretKey: props.webhookSecretKey,
  });

  const settingsSection: ReactElement | null = hasSettings ? (
    <ComponentSettingsSection
      id="settings"
      icon={IconProp.Settings}
      title="Settings"
    >
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
    </ComponentSettingsSection>
  ) : null;

  const idSection: ReactElement = (
    <ComponentSettingsSection id="id" icon={IconProp.Label} title="ID">
      <BasicForm
        hideSubmitButton={true}
        /*
         * BasicForm focuses its first field on mount. This form mounts after
         * the settings, so it took the focus from the first setting, and on
         * the Webhook trigger from the URL's copy button.
         */
        disableAutofocus={true}
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
            description: `How other steps refer to this ${componentTypeName}. Renaming it breaks references that use the old name.`,
            field: { id: true },
            required: true,
            fieldType: FormFieldSchemaType.Text,
          },
        ]}
      />
    </ComponentSettingsSection>
  );

  const returnsSection: ReactElement | null = hasReturns ? (
    <ComponentSettingsSection
      id="returns"
      icon={IconProp.Database}
      title="Returns"
      description="Data this step makes available downstream. Copy a reference into a later step's settings to use it there."
    >
      <ComponentReturnValueViewer
        name=""
        description=""
        returnValues={component.metadata.returnValues}
        componentId={component.id}
      />
    </ComponentSettingsSection>
  ) : null;

  const inputsSection: ReactElement | null = hasInputs ? (
    <ComponentSettingsSection
      id="inputs"
      icon={IconProp.ArrowCircleDown}
      title="Inputs"
      description="Where this step is reached from."
    >
      <ComponentPortViewer
        name=""
        description=""
        ports={component.metadata.inPorts}
      />
    </ComponentSettingsSection>
  ) : null;

  const outputsSection: ReactElement | null = hasOutputs ? (
    <ComponentSettingsSection
      id="outputs"
      icon={IconProp.ArrowCircleRight}
      title="Outputs"
      description="What runs after this step."
    >
      <ComponentPortViewer
        name=""
        description=""
        ports={component.metadata.outPorts}
      />
    </ComponentSettingsSection>
  ) : null;

  const documentationSection: ReactElement | null = component.metadata
    .documentationLink ? (
    <ComponentSettingsSection
      id="documentation"
      icon={IconProp.Book}
      title="Documentation"
      tone="info"
    >
      <DocumentationViewer
        documentationLink={component.metadata.documentationLink}
        workflowId={props.workflowId}
        webhookSecretKey={props.webhookSecretKey}
        tableName={component.metadata.tableName}
      />
    </ComponentSettingsSection>
  ) : null;

  /*
   * The identifier and the connections are a line or two each. Each across the
   * dialog's full width was a short strip of mostly empty card, so they share
   * a row: split evenly however many there are (a trigger has no inputs), and
   * wrapped onto rows of their own when the dialog is too narrow for them.
   */
  const compactRowSections: Array<ReactElement> = [
    idSection,
    inputsSection,
    outputsSection,
  ].filter((section: ReactElement | null): section is ReactElement => {
    return section !== null;
  });

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
        /*
         * Say why Save is off. Form errors are only rendered under a field
         * once it has been touched, so a component opened with a setting that
         * was already invalid — a stored JSON value that does not parse, say —
         * otherwise presents a dead button and no explanation anywhere.
         */
        hasErrors ? (
          <div className="flex items-center gap-3">
            <Button
              title="Delete"
              icon={IconProp.Trash}
              buttonStyle={ButtonStyleType.DANGER_OUTLINE}
              onClick={() => {
                setShowDeleteConfirmation(true);
              }}
            />
            <span className="text-sm text-red-600">
              Some settings need fixing before this can be saved.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              title="Delete"
              icon={IconProp.Trash}
              buttonStyle={ButtonStyleType.DANGER_OUTLINE}
              onClick={() => {
                setShowDeleteConfirmation(true);
              }}
            />
            {props.onRunStep && (
              <Button
                title="Run just this step"
                icon={IconProp.Play}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => {
                  setShowRunStepConfirmation(true);
                }}
              />
            )}
          </div>
        )
      }
    >
      <>
        {showRunStepConfirmation && (
          <ConfirmModal
            title={`Run this step now?`}
            /*
             * Worded as what it is. There is no dry run: the step executes for
             * real, and anything it sends or changes is not undone afterwards.
             */
            description={`This runs "${component.metadata.title}" for real, on its own. Anything it sends, writes or deletes actually happens. Values it reads from other steps will be empty, because nothing else runs.`}
            onClose={() => {
              setShowRunStepConfirmation(false);
            }}
            submitButtonText="Run this step"
            onSubmit={() => {
              setShowRunStepConfirmation(false);
              props.onRunStep?.(component);
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}

        {showDeleteConfirmation && (
          <ConfirmModal
            title={`Delete ${component.metadata.componentType}`}
            description={`Are you sure you want to delete this ${componentTypeName}? This action is not recoverable.`}
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
         * One column. What someone opens a step for comes first: the trigger's
         * URL, or how it is started, where that is the point of the step, and
         * otherwise its settings. Reference material follows: the identifier
         * and the connections, then the references built from that identifier,
         * and last the documentation, a shared file about a whole family of
         * steps.
         *
         * The old layout put the settings in a two-thirds column and everything
         * else in a narrow one beside it. A step with few settings, or none,
         * left the wide column mostly empty while the narrow one ran below the
         * fold, with the Webhook trigger's URL at the very bottom of it, and
         * every reference wrapped mid-word.
         */}
        <div
          ref={bodyRef}
          className="space-y-4"
          data-testid="workflow-component-settings"
        >
          {primarySection}
          {settingsSection}
          <div
            className="flex flex-wrap gap-4"
            data-testid="workflow-component-settings-compact-row"
          >
            {compactRowSections.map((section: ReactElement, index: number) => {
              return (
                <div
                  key={index}
                  className="min-w-[15rem] flex-1 [&>section]:h-full"
                >
                  {section}
                </div>
              );
            })}
          </div>
          {returnsSection}
          {documentationSection}
        </div>
      </>
    </Modal>
  );
};

export default ComponentSettingsModal;
