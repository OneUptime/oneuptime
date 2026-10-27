import Button, { ButtonStyleType } from "../Button/Button";
import BasicForm from "../Forms/BasicForm";
import Icon from "../Icon/Icon";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import ConfirmModal from "../Modal/ConfirmModal";
import DeleteConfirmationMessage from "../DeleteConfirmation/DeleteConfirmationMessage";
import Modal, { ModalWidth } from "../Modal/Modal";
import ArgumentsForm from "./ArgumentsForm";
import { getComponentPrimaryPanel } from "./ComponentPrimaryPanel";
import ComponentPortViewer from "./ComponentPortViewer";
import ComponentReturnValueViewer from "./ComponentReturnValueViewer";
import ComponentSettingsSection from "./ComponentSettingsSection";
import DocumentationViewer from "./DocumentationViewer";
import { getPageStepRunWarning } from "./OnCall/PageStepRunWarning";
import { OutputConnections } from "./Switch/SwitchModel";
import { StepValueSources } from "./ValuePicker/StepGraph";
import { WORKFLOW_URL } from "../../Config";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp, Port } from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { getComponentOutPorts } from "../../../Types/Workflow/ComponentOutPorts";
import ComponentDocumentation from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import { getComponentDocumentation } from "../../../Types/Workflow/Documentation/Index";
import { getWebhookTriggerUrl } from "../../../Types/Workflow/WebhookTrigger";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  translatableTerm,
  translateNamedAction,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

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
  /*
   * Why the user may not run this step on its own - it takes permission to
   * edit the workflow - or undefined when they may. The button stays, locked,
   * with this in its tooltip.
   */
  runStepDisabledReason?: string | undefined;
  component: NodeDataProp;
  graphComponents: Array<NodeDataProp>;
  /*
   * Which steps run before and after this one, so its settings only offer
   * values that will exist when it runs. See ValuePicker/StepGraph.
   */
  valueSources?: StepValueSources | undefined;
  /*
   * The steps each of this step's outputs leads to on the canvas, by output
   * id: a Switch / Case says where each case's output leads, and what
   * removing a case disconnects.
   */
  outputConnections?: OutputConnections | undefined;
  workflowId: ObjectID;
  webhookSecretKey?: string | undefined;
  /*
   * Whether the user may read the webhook secret key, so whether
   * webhookSecretKey is the workflow's real key. See ComponentPrimaryPanel.
   */
  canSeeWebhookSecretKey?: boolean | undefined;
  /*
   * Gives the workflow a new webhook secret key; the Webhook trigger's Reset
   * URL. Takes effect at once, whether or not this dialog is then saved.
   */
  onResetWebhookSecretKey?: (() => Promise<void>) | undefined;
  /*
   * The Incoming Email trigger's address is built from this key; see
   * ComponentPrimaryPanel. Like the webhook's, it is only what the workflow
   * really has when canSeeIncomingEmailSecretKey says the user may read it.
   */
  incomingEmailSecretKey?: string | undefined;
  canSeeIncomingEmailSecretKey?: boolean | undefined;
  /*
   * Gives the workflow a new incoming email secret key - Reset address, or
   * the first address of a workflow that has none. Takes effect at once,
   * whether or not this dialog is then saved.
   */
  onResetIncomingEmailSecretKey?: (() => Promise<void>) | undefined;
  /*
   * The workflow is turned off (and not archived): its trigger is paused, so
   * the Webhook's URL refuses requests and the Incoming Email address ignores
   * email. Their panels say so. See ComponentPrimaryPanel.
   */
  isWorkflowOff?: boolean | undefined;
  /*
   * Opens the Run Workflow panel for a test run. Offered by the value
   * picker while the workflow is off and a Webhook or Incoming Email trigger
   * has no request to list the fields of; this step's settings are saved
   * first. Absent for someone who may not run the workflow.
   */
  onRequestTestRun?: (() => void) | undefined;
  /*
   * Why the reader may not change the workflow (WorkflowRunGate's edit
   * gate), or undefined when they may. Given one, the step opens to be read
   * (WorkflowViewOnly): its settings and identifier are shown as they are
   * and cannot be changed, the dialog has Close in place of Save, and
   * neither Delete nor Run just this step - which takes the same
   * permission - is offered. Its footer says why.
   */
  readOnlyReason?: string | undefined;
}

// The view-only dialog's footer: what it is, before the reason.
export const WORKFLOW_STEP_VIEW_ONLY_TEXT: string = translationKey(
  "You can look at this step but not change it.",
);

const ComponentSettingsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // A view, for someone who may not change the workflow.
  const isViewOnly: boolean = Boolean(props.readOnlyReason);
  const [component, setComponent] = useState<NodeDataProp>(props.component);
  const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
    Dictionary<boolean>
  >({});
  const [showDeleteConfirmation, setShowDeleteConfirmation] =
    useState<boolean>(false);
  const [showRunStepConfirmation, setShowRunStepConfirmation] =
    useState<boolean>(false);
  const bodyRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  const hasErrors: boolean = Object.values(hasFormValidationErrors).some(
    (v: boolean) => {
      return v;
    },
  );

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
    const firstSection: Element | null = body ? body.firstElementChild : null;
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

  /*
   * Which step a delete removes: its kind and the identifier the workflow
   * knows it by - "Send Email (send-email-2)" - since a workflow can hold
   * several steps of the same kind. Read from the step as it is on the
   * canvas, not from this dialog's unsaved edits: an identifier typed here
   * and not saved names no step at all.
   */
  const savedStepTitle: string = props.component.metadata.title?.trim() || "";
  const savedStepId: string = props.component.id?.trim() || "";
  const stepName: string =
    savedStepTitle && savedStepId && savedStepId !== savedStepTitle
      ? `${savedStepTitle} (${savedStepId})`
      : savedStepTitle || savedStepId;

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

  /*
   * As the step is set up in this dialog: a Switch / Case has an output per
   * case, which change as its cases do.
   */
  const outPorts: Array<Port> = getComponentOutPorts({
    metadata: component.metadata,
    arguments: component.arguments,
  });
  const hasOutputs: boolean = outPorts.length > 0;
  const hasReturns: boolean =
    Array.isArray(component.metadata.returnValues) &&
    component.metadata.returnValues.length > 0;

  const primarySection: ReactElement | null = getComponentPrimaryPanel({
    component: component,
    workflowId: props.workflowId,
    webhookSecretKey: props.webhookSecretKey,
    canSeeWebhookSecretKey: props.canSeeWebhookSecretKey,
    onResetWebhookSecretKey: props.onResetWebhookSecretKey,
    incomingEmailSecretKey: props.incomingEmailSecretKey,
    canSeeIncomingEmailSecretKey: props.canSeeIncomingEmailSecretKey,
    onResetIncomingEmailSecretKey: props.onResetIncomingEmailSecretKey,
    isWorkflowOff: props.isWorkflowOff,
  });

  /*
   * Where a test request goes. A step after a Webhook that nothing has called
   * yet offers one to copy in its value picker, so its fields can be seen.
   * Built only for someone who may see the key, as the Webhook's own URL is.
   */
  const webhookUrl: string | undefined =
    props.canSeeWebhookSecretKey !== false && props.webhookSecretKey
      ? getWebhookTriggerUrl({
          workflowServiceUrl: WORKFLOW_URL.toString(),
          secretKey: props.webhookSecretKey,
        })
      : undefined;

  /*
   * An If / Else step's settings are one thing, its condition, and are
   * called that (see Condition/ConditionEditor).
   */
  const isCondition: boolean = component.metadata.id === ComponentID.IfElse;

  /*
   * What a view shows of a form: the fields as they are, every one disabled.
   * A disabled fieldset disables every control inside it - a screen reader
   * still reads each one and its value - and the pointer goes through the
   * rest (the pickers that open on a press), so nothing in it changes.
   */
  type ViewOnlyFormFunction = (
    form: ReactElement,
    testId: string,
  ) => ReactElement;

  const viewOnlyForm: ViewOnlyFormFunction = (
    form: ReactElement,
    testId: string,
  ): ReactElement => {
    if (!isViewOnly) {
      return form;
    }

    return (
      <fieldset
        disabled={true}
        className="pointer-events-none m-0 min-w-0 border-0 p-0"
        data-testid={testId}
      >
        {form}
      </fieldset>
    );
  };

  const settingsSection: ReactElement | null = hasSettings ? (
    <ComponentSettingsSection
      id="settings"
      icon={isCondition ? IconProp.Condition : IconProp.Settings}
      title={isCondition ? "Condition" : "Settings"}
    >
      {viewOnlyForm(
        <ArgumentsForm
          graphComponents={props.graphComponents}
          valueSources={props.valueSources}
          workflowId={props.workflowId}
          webhookUrl={webhookUrl}
          outputConnections={props.outputConnections}
          isWorkflowOff={props.isWorkflowOff}
          onTestRun={
            props.onRequestTestRun && !hasErrors
              ? () => {
                  // Saved first, so nothing typed here is lost to the run.
                  props.onSave(component);
                  props.onRequestTestRun?.();
                }
              : undefined
          }
          component={component}
          onFormChange={(c: NodeDataProp) => {
            setComponent({ ...c });
          }}
          onHasFormValidationErrors={(value: Dictionary<boolean>) => {
            /*
             * From the latest state, not this render's: the identifier's form
             * reports in the same moment as the settings do when the dialog
             * opens, and merging into a stale copy dropped the other's report.
             * A new If / Else could then be saved with nothing set.
             */
            setHasFormValidationErrors((current: Dictionary<boolean>) => {
              return {
                ...current,
                ...value,
              };
            });
          }}
        />,
        "workflow-component-settings-view-only",
      )}
    </ComponentSettingsSection>
  ) : null;

  const idSection: ReactElement = (
    <ComponentSettingsSection id="id" icon={IconProp.Label} title="ID">
      {viewOnlyForm(
        <BasicForm
          hideSubmitButton={true}
          /*
           * Save is off while a field fails, so no press would say what is
           * wrong: a field says it as soon as it is left, changed or not.
           */
          showErrorsWhenLeftUnchanged={true}
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
            setHasFormValidationErrors((current: Dictionary<boolean>) => {
              return {
                ...current,
                id: hasError,
              };
            });
          }}
          fields={[
            {
              title: "Identifier",
              description: translator.translateTemplate(
                "How other steps refer to this {{type}}. Renaming it breaks references that use the old name.",
                {
                  type: translatableTerm(component.metadata.componentType, {
                    inSentence: true,
                  }),
                },
              ),
              field: { id: true },
              required: true,
              fieldType: FormFieldSchemaType.Text,
            },
          ]}
        />,
        "workflow-component-id-view-only",
      )}
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
      <ComponentPortViewer name="" description="" ports={outPorts} />
    </ComponentSettingsSection>
  ) : null;

  /*
   * Built here rather than fetched: the help is written from the step itself,
   * so its examples use the identifier the step has right now - renaming it
   * in the ID section renames it in every example too.
   */
  const documentation: ComponentDocumentation | null = useMemo(() => {
    return getComponentDocumentation({
      metadata: component.metadata,
      stepId: component.id,
      graphComponents: props.graphComponents,
    });
  }, [component.metadata, component.id, props.graphComponents]);

  const documentationSection: ReactElement | null = documentation ? (
    <ComponentSettingsSection
      id="documentation"
      icon={IconProp.Book}
      title="How to use"
      tone="info"
      isFocusTarget={true}
    >
      <DocumentationViewer documentation={documentation} />
    </ComponentSettingsSection>
  ) : null;

  /*
   * The help is the last section, below everything the step is opened for, so
   * the header carries a way to it. It scrolls the help into view and moves
   * the focus there, so a keyboard or screen reader user is taken along.
   */
  const showDocumentation: () => void = (): void => {
    const section: HTMLElement | null =
      bodyRef.current?.querySelector<HTMLElement>(
        '[data-testid="workflow-component-section-documentation"]',
      ) || null;

    if (!section) {
      return;
    }

    const prefersReducedMotion: boolean =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (typeof section.scrollIntoView === "function") {
      section.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }

    section.focus({ preventScroll: true });
  };

  const documentationButton: ReactElement | undefined = documentation ? (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      data-testid="workflow-component-docs-jump"
      onClick={showDocumentation}
    >
      <Icon icon={IconProp.Book} className="h-4 w-4" />
      <span className="max-sm:sr-only">
        {translator.translateText("How to use")}
      </span>
    </button>
  ) : undefined;

  /*
   * The identifier and the connections are a line or two each. Given the
   * dialog's full width apiece, each was a short strip of mostly empty card,
   * so they share a row: split evenly however many there are (a trigger has
   * no inputs), and wrapped onto rows of their own when the dialog is too
   * narrow for them.
   */
  const compactRowSections: Array<ReactElement> = [
    idSection,
    inputsSection,
    outputsSection,
  ].filter((section: ReactElement | null): section is ReactElement => {
    return section !== null;
  });

  /*
   * A view's footer: no Delete and no Run just this step, both of which take
   * permission to edit the workflow - only what the dialog is, and why.
   */
  const viewOnlyFooter: ReactElement = (
    <p
      className="flex min-w-0 items-start gap-2 text-sm text-gray-600"
      title={props.readOnlyReason}
      data-testid="workflow-component-view-only-note"
    >
      <Icon
        icon={IconProp.Lock}
        className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
      />
      <span className="min-w-0">
        {translator.translateText(WORKFLOW_STEP_VIEW_ONLY_TEXT)}
        <span className="sr-only"> {props.readOnlyReason}</span>
      </span>
    </p>
  );

  return (
    <Modal
      title={props.title}
      description={props.description}
      onClose={props.onClose}
      onSubmit={
        isViewOnly
          ? undefined
          : () => {
              return component && props.onSave(component);
            }
      }
      submitButtonText="Save"
      closeButtonText={isViewOnly ? "Close" : undefined}
      modalWidth={ModalWidth.Large}
      rightElement={documentationButton}
      disableSubmitButton={hasErrors}
      leftFooterElement={
        /*
         * Say why Save is off. Form errors are only rendered under a field
         * once it has been touched, so a component opened with a setting that
         * was already invalid — a stored JSON value that does not parse, say —
         * otherwise presents a dead button and no explanation anywhere.
         */
        isViewOnly ? (
          viewOnlyFooter
        ) : hasErrors ? (
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
              {translator.translateText(
                "Some settings need fixing before this can be saved.",
              )}
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
                disabled={Boolean(props.runStepDisabledReason)}
                tooltip={props.runStepDisabledReason}
                dataTestId="run-step-button"
                onClick={() => {
                  if (props.runStepDisabledReason) {
                    return;
                  }

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
            description={[
              translator.translateTemplate(
                'This runs "{{step}}" for real, on its own. Anything it sends, writes or deletes actually happens. Values it reads from other steps will be empty, because nothing else runs.',
                { step: translatableTerm(component.metadata.title) },
              ),
              // A Page step says what "for real" means for it: phones ring.
              translator.translateText(
                getPageStepRunWarning(component.metadata.id) || undefined,
              ),
            ]
              .filter((sentence: string | undefined): boolean => {
                return Boolean(sentence);
              })
              .join(" ")}
            onClose={() => {
              setShowRunStepConfirmation(false);
            }}
            submitButtonText="Run this step"
            onSubmit={() => {
              setShowRunStepConfirmation(false);
              props.onRunStep?.(component);
            }}
            /*
             * Running the step is what the user opened this dialog to do, so it
             * is the one primary button; Cancel is the plain way out.
             */
            submitButtonType={ButtonStyleType.PRIMARY}
          />
        )}

        {showDeleteConfirmation && (
          <ConfirmModal
            title={translateNamedAction(translator, {
              template: "Delete {{itemName}}",
              itemName: component.metadata.componentType,
            })}
            description={
              <DeleteConfirmationMessage
                kind="question"
                name={stepName}
                typeLabel={component.metadata.componentType}
              />
            }
            onClose={() => {
              setShowDeleteConfirmation(false);
            }}
            submitButtonText="Delete"
            onSubmit={() => {
              /*
               * The step on the canvas, which the sentence named. This passed
               * the dialog's working copy, so a step whose identifier had been
               * edited here and not saved was looked up by the new identifier,
               * matched nothing, and stayed on the canvas while the dialog
               * closed as though it had gone.
               */
              props.onDelete(props.component);
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
         * and last the step's "How to use" help, which the header links to.
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
