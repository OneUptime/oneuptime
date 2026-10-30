/*
 * The create-a-workflow wizard.
 *
 * Three steps: pick a starting point, name it, fill in whatever configuration
 * the template asked for. The third step only appears when the chosen template
 * declares variables or pages people, so "Start from scratch" and the
 * zero-config templates stay two clicks away.
 *
 * A template that pages people asks who, there, with the people picker the
 * Builder draws for its Page step (getWhoToPageQuestions): picked from the
 * project's own people, teams, schedules or policies, which no template can
 * name. So the workflow opens in the Builder with nothing left to set up -
 * before, its Page step waited there with an error on it.
 *
 * The first step is the template picker (WorkflowTemplatePicker): Start from
 * scratch first, then a few recommended templates with a search and a
 * category select, and the details of a template once it is picked. Its
 * state lives here, so stepping back from Name finds the picker as it was
 * left.
 *
 * There is no progress rail beside the steps. A wizard of two steps, three
 * at most, says enough with its footer - Back, and Next or Create Workflow -
 * and the rail took a column of the dialog's width away from the picker,
 * which the maintainer found showed too much at once already.
 *
 * Create Workflow, on the last step, is the wizard's one primary button.
 * The ways on before it - Use this template, Next - are plain, like Cancel
 * (Forms/Utils/SteppedFormFooter): they commit nothing.
 *
 * The order of writes at the end matters. The workflow is created through the
 * ordinary Workflow create path because that is what denormalizes the trigger
 * onto the row (WorkflowService.onCreateSuccess) — build the graph any other
 * way and you get a workflow that looks right in the builder and never fires.
 * Its variables can only be written afterwards, since they need the workflow's
 * id, and if any of them fails the workflow is deleted again rather than left
 * behind: a saved workflow whose {{local.variables.…}} references resolve to
 * nothing is not an error at run time, it just quietly posts literal braces.
 */

import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  SteppedModalFooter,
  getSteppedModalFooter,
} from "Common/UI/Components/Forms/Utils/SteppedFormFooter";
import IconProp from "Common/Types/Icon/IconProp";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import {
  WhoToPagePicks,
  WorkflowTemplate,
  WorkflowTemplateVariable,
  getWorkflowTemplate,
} from "Common/Types/Workflow/Templates";
import PeoplePicker from "Common/UI/Components/PeoplePicker/PeoplePicker";
import { PeoplePickerValue } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import {
  RECORD_LIST_COPY,
  RecordListCopy,
} from "Common/UI/Components/Workflow/RecordList/RecordListField";
import {
  TemplateVariableEdit,
  WhoToPageErrors,
  WhoToPageQuestion,
  WorkflowTemplateVariableErrors,
  WorkflowTemplateVariableValues,
  buildWorkflowFromTemplate,
  buildWorkflowVariables,
  editTemplateVariable,
  getWhoToPageQuestions,
  validateTemplateVariableValues,
  validateWhoToPage,
} from "../../Utils/Workflow/WorkflowTemplateCreateUtil";
import {
  INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
  WorkflowTemplatePickerState,
  getActiveWorkflowTemplate,
  withWorkflowTemplateSelected,
} from "../../Utils/Workflow/WorkflowTemplatePickerUtil";
import WorkflowTemplatePicker from "./WorkflowTemplatePicker";
import ChosenTemplate from "../TemplatePicker/ChosenTemplate";
import { CATALOG_TEXT_ALIGN_CLASS_NAME } from "../TemplatePicker/CatalogText";
import { isEnterToSubmit } from "../../Utils/TemplatePicker/WizardKeys";

export interface ComponentProps {
  onClose: () => void;
  /** Called with the created workflow so the page can navigate to it. */
  onCreated: (workflow: Workflow) => void;
}

enum WizardStep {
  PickTemplate = "pick-template",
  NameIt = "name",
  Configure = "configure",
}

interface ConfigureStepState {
  values: WorkflowTemplateVariableValues;
  typedVariableNames: Array<string>;
}

const EMPTY_CONFIGURATION: ConfigureStepState = {
  values: {},
  typedVariableNames: [],
};

const CreateWorkflowModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, translateTemplate } = useTranslateValue();
  const [step, setStep] = useState<WizardStep>(WizardStep.PickTemplate);
  /*
   * null is a real choice here — it means "start from scratch" — so a separate
   * flag tracks whether a choice has been made at all. Without it, coming Back
   * to step one after choosing Blank shows nothing selected.
   */
  const [hasChosen, setHasChosen] = useState<boolean>(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [nameError, setNameError] = useState<string>("");
  /*
   * What is typed into the Configure step, and the settings someone has typed
   * into. A setting prefilled from another (WorkflowTemplateVariable.
   * prefilledFrom) takes what is typed there until it is typed into itself:
   * the Jira API URL is the Jira Site URL on most sites, so it is typed once,
   * and changed only where it differs (editTemplateVariable). One state, so
   * each edit reads both as they stand, however edits are batched.
   */
  const [configuration, setConfiguration] =
    useState<ConfigureStepState>(EMPTY_CONFIGURATION);
  const variableValues: WorkflowTemplateVariableValues = configuration.values;
  const [variableErrors, setVariableErrors] =
    useState<WorkflowTemplateVariableErrors>({});
  // Who is picked for each Page step of the template, by its component id.
  const [whoToPage, setWhoToPage] = useState<WhoToPagePicks>({});
  const [whoToPageErrors, setWhoToPageErrors] = useState<WhoToPageErrors>({});
  const [pickerState, setPickerState] = useState<WorkflowTemplatePickerState>(
    INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
  );
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  /*
   * Set from the moment Create is pressed until the workflow and its
   * variables are written, so a second Enter in the name - or one pressed
   * before the button greys out - writes no second workflow.
   */
  const isCreatingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const selectedTemplate: WorkflowTemplate | null = useMemo(() => {
    return selectedTemplateId ? getWorkflowTemplate(selectedTemplateId) : null;
  }, [selectedTemplateId]);

  /*
   * The template the picker has picked, which "Use this template" takes.
   * None until one is clicked, moved to with the arrow keys or searched for.
   */
  const pickedTemplate: WorkflowTemplate | null = useMemo(() => {
    return getActiveWorkflowTemplate(pickerState);
  }, [pickerState]);

  const variables: Array<WorkflowTemplateVariable> =
    selectedTemplate?.variables || [];

  const whoToPageQuestions: Array<WhoToPageQuestion> = useMemo(() => {
    return getWhoToPageQuestions(selectedTemplate);
  }, [selectedTemplate]);

  const showConfigureStep: boolean =
    variables.length > 0 || whoToPageQuestions.length > 0;

  type ChooseStartFunction = (template: WorkflowTemplate | null) => void;

  /*
   * Moves on to Name with a template, or with null for an empty canvas. The
   * name, description and settings start from the template's suggestions,
   * unless this is the start already chosen: going Back to look around and
   * then taking the same template again keeps what was typed for it.
   */
  const chooseStart: ChooseStartFunction = (
    template: WorkflowTemplate | null,
  ): void => {
    const templateId: string | null = template ? template.id : null;
    const isSameStart: boolean = hasChosen && selectedTemplateId === templateId;

    setHasChosen(true);
    setSelectedTemplateId(templateId);

    /*
     * The template taken stays picked in the picker, so Back shows it open,
     * however it was reached: a search's best match is only picked while
     * that search stands. Starting from scratch lets go of any template
     * picked, so Back shows Start from scratch as the one chosen.
     */
    setPickerState(
      (current: WorkflowTemplatePickerState): WorkflowTemplatePickerState => {
        return template
          ? withWorkflowTemplateSelected(current, template.id)
          : { ...current, selectedTemplateId: null };
      },
    );

    if (!isSameStart) {
      setName(template ? template.workflowName : "");
      setDescription(template ? template.workflowDescription : "");
      setConfiguration(EMPTY_CONFIGURATION);
      setVariableErrors({});
      setWhoToPage({});
      setWhoToPageErrors({});
    }

    setNameError("");
    setError("");
    setStep(WizardStep.NameIt);
  };

  type GoBackFunction = () => void;

  const goBack: GoBackFunction = (): void => {
    setError("");

    if (step === WizardStep.Configure) {
      setStep(WizardStep.NameIt);
      return;
    }

    setStep(WizardStep.PickTemplate);
  };

  type CreateFunction = () => Promise<void>;

  const create: CreateFunction = async (): Promise<void> => {
    isCreatingRef.current = true;
    setIsCreating(true);
    setError("");

    let createdWorkflowId: ObjectID | null = null;
    let createdWorkflow: Workflow | null = null;

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      const workflow: Workflow = buildWorkflowFromTemplate({
        name: name,
        description: description,
        projectId: projectId,
        template: selectedTemplate,
        values: variableValues,
        whoToPage: whoToPage,
      });

      const response: HTTPResponse<
        JSONObject | JSONArray | Workflow | Array<Workflow>
      > = await ModelAPI.create<Workflow>({
        model: workflow,
        modelType: Workflow,
      });

      const created: Workflow = response.data as Workflow;
      createdWorkflowId = created.id as ObjectID;

      if (selectedTemplate) {
        const rows: Array<WorkflowVariable> = buildWorkflowVariables({
          template: selectedTemplate,
          values: variableValues,
          workflowId: createdWorkflowId,
          projectId: projectId,
        });

        /*
         * One at a time, and deliberately not in parallel: there is no bulk or
         * transactional create, and a half-written set is the failure we are
         * trying to avoid.
         */
        for (const row of rows) {
          await ModelAPI.create<WorkflowVariable>({
            model: row,
            modelType: WorkflowVariable,
          });
        }
      }

      createdWorkflow = created;
    } catch (err) {
      /*
       * Roll the workflow back if its variables could not be written. Leaving
       * it would leave a workflow that runs and silently does the wrong thing,
       * which is worse than leaving nothing at all.
       */
      if (createdWorkflowId) {
        try {
          await ModelAPI.deleteItem<Workflow>({
            modelType: Workflow,
            id: createdWorkflowId,
          });
        } catch {
          // Reported below as part of the original failure.
        }
      }

      setError(API.getFriendlyMessage(err));
    }

    isCreatingRef.current = false;
    setIsCreating(false);

    /*
     * Handed over outside the try on purpose. onCreated navigates away, and a
     * failure in navigation must not be mistaken for a failed create and roll
     * back a workflow that was written perfectly well.
     */
    if (createdWorkflow) {
      props.onCreated(createdWorkflow);
    }
  };

  type OnSubmitFunction = () => void;

  const onSubmit: OnSubmitFunction = (): void => {
    if (isCreatingRef.current) {
      return;
    }

    if (step === WizardStep.NameIt) {
      if (name.trim().length < 2) {
        setNameError("Please give this workflow a name of at least 2 letters.");
        return;
      }

      setNameError("");

      if (showConfigureStep) {
        setStep(WizardStep.Configure);
        return;
      }

      void create();
      return;
    }

    if (step === WizardStep.Configure) {
      const errors: WorkflowTemplateVariableErrors =
        validateTemplateVariableValues(
          selectedTemplate as WorkflowTemplate,
          variableValues,
        );
      const pageErrors: WhoToPageErrors = validateWhoToPage(
        selectedTemplate as WorkflowTemplate,
        whoToPage,
      );

      setVariableErrors(errors);
      setWhoToPageErrors(pageErrors);

      if (
        Object.keys(errors).length > 0 ||
        Object.keys(pageErrors).length > 0
      ) {
        return;
      }

      void create();
    }
  };

  type RenderPickStepFunction = () => ReactElement;

  const renderPickStep: RenderPickStepFunction = (): ReactElement => {
    return (
      <WorkflowTemplatePicker
        state={pickerState}
        onStateChange={setPickerState}
        onUseTemplate={(template: WorkflowTemplate) => {
          chooseStart(template);
        }}
        onStartFromScratch={() => {
          chooseStart(null);
        }}
        /*
         * Marked as the start chosen after Back, until a template is picked
         * instead: then that template is the one the step would go on with.
         */
        isStartFromScratchChosen={
          hasChosen && selectedTemplateId === null && !pickedTemplate
        }
      />
    );
  };

  type RenderNameStepFunction = () => ReactElement;

  const renderNameStep: RenderNameStepFunction = (): ReactElement => {
    return (
      <div className="space-y-5">
        {selectedTemplate ? (
          // What the builder will show once it opens, as Create a dashboard says what its template shows.
          <ChosenTemplate
            icon={selectedTemplate.icon}
            name={selectedTemplate.name}
            line={selectedTemplate.teaches}
            dataTestId="workflow-template-chosen"
          />
        ) : (
          <></>
        )}

        <div>
          <FieldLabelElement
            title="Name"
            htmlFor="workflow-name"
            required={true}
            description="Workflow names are unique within a project."
          />
          <Input
            id="workflow-name"
            value={name}
            autoFocus={true}
            placeholder="What should this workflow be called?"
            dataTestId="workflow-name-input"
            // Kept in English, as its key, and looked up as it is shown.
            error={translateString(nameError)}
            onChange={(value: string) => {
              setName(value);

              if (nameError) {
                setNameError("");
              }
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              // Enter goes on, as the footer's Next or Create Workflow does.
              if (isEnterToSubmit(event)) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
        </div>

        <div>
          <FieldLabelElement
            title="Description"
            htmlFor="workflow-description"
          />
          <TextArea
            id="workflow-description"
            value={description}
            placeholder="What is this workflow for?"
            dataTestId="workflow-description-input"
            onChange={(value: string) => {
              setDescription(value);
            }}
          />
        </div>
      </div>
    );
  };

  type RenderConfigureStepFunction = () => ReactElement;

  type CatalogDescriptionFunction = (text: string) => ReactElement | undefined;

  /*
   * A setting's help as the template words it: catalog content, in English,
   * read the way it is written - on a Persian page too, its full stop at its
   * end (CatalogText).
   */
  const catalogDescription: CatalogDescriptionFunction = (
    text: string,
  ): ReactElement | undefined => {
    if (!text) {
      return undefined;
    }

    return (
      <span dir="auto" className={`block ${CATALOG_TEXT_ALIGN_CLASS_NAME}`}>
        {translateString(text) || text}
      </span>
    );
  };

  type RenderWhoToPageFunction = (
    question: WhoToPageQuestion,
    index: number,
  ) => ReactElement;

  /*
   * One Page step's question: its title and help as the template words
   * them, and the people picker the Builder draws for the step, listing the
   * kind the step pages.
   */
  const renderWhoToPage: RenderWhoToPageFunction = (
    question: WhoToPageQuestion,
    index: number,
  ): ReactElement => {
    const fieldId: string = `workflow-who-to-page-${question.componentId}`;
    const copy: RecordListCopy = RECORD_LIST_COPY[question.kind];
    const fieldError: string | undefined =
      whoToPageErrors[question.componentId];

    return (
      <div key={question.componentId}>
        <FieldLabelElement
          title={question.title}
          id={`${fieldId}-label`}
          required={question.required}
          description={catalogDescription(question.description)}
          descriptionId={`${fieldId}-description`}
        />
        {/* The gap a field leaves between its help and its control. */}
        <div className="mt-2">
          <PeoplePicker
            kinds={[question.kind]}
            value={{ [question.kind]: whoToPage[question.componentId] || [] }}
            onChange={(next: PeoplePickerValue) => {
              const picked: Array<string> = next[question.kind] || [];

              setWhoToPage((current: WhoToPagePicks): WhoToPagePicks => {
                return { ...current, [question.componentId]: picked };
              });

              // Somebody picked: the message under the field goes.
              if (picked.length > 0) {
                setWhoToPageErrors(
                  (current: WhoToPageErrors): WhoToPageErrors => {
                    const remaining: WhoToPageErrors = { ...current };

                    delete remaining[question.componentId];

                    return remaining;
                  },
                );
              }
            }}
            addButtonText={copy.addButtonText}
            searchPlaceholder={copy.searchPlaceholder}
            emptyText={copy.emptyText}
            ariaLabelledby={`${fieldId}-label`}
            ariaDescribedby={`${fieldId}-description`}
            // Kept in English, as its key, and looked up as it is shown.
            error={fieldError ? translateString(fieldError) : undefined}
            dataTestId={fieldId}
            /*
             * A step that asks only who to page starts on its first question,
             * as one with settings starts in its first field.
             */
            autoFocus={index === 0 && variables.length === 0}
          />
        </div>
      </div>
    );
  };

  const renderConfigureStep: RenderConfigureStepFunction = (): ReactElement => {
    return (
      <div className="space-y-5">
        {/*
         * One sentence, translated whole. The template's name goes in as it
         * is: template names are catalog content, written in English.
         */}
        {variables.length > 0 ? (
          <p className="text-sm text-gray-600">
            {translateTemplate(
              "{{templateName}} needs a few details before it can run. These are saved as workflow variables, so you can change them later without editing the workflow itself.",
              { templateName: selectedTemplate?.name || "" },
            )}
          </p>
        ) : (
          <></>
        )}

        {variables.map(
          (variable: WorkflowTemplateVariable, index: number): ReactElement => {
            const inputId: string = `workflow-variable-${variable.name}`;

            return (
              <div key={variable.name}>
                <FieldLabelElement
                  title={variable.title}
                  htmlFor={inputId}
                  required={variable.required}
                  description={catalogDescription(variable.description)}
                />
                <Input
                  id={inputId}
                  // The step is for these fields: the first one is ready to type into.
                  autoFocus={index === 0}
                  type={variable.isSecret ? InputType.PASSWORD : InputType.TEXT}
                  autoComplete={variable.isSecret ? "new-password" : undefined}
                  disableSpellCheck={variable.isSecret}
                  value={variableValues[variable.name] || ""}
                  placeholder={variable.placeholder}
                  error={variableErrors[variable.name]}
                  dataTestId={inputId}
                  onChange={(value: string) => {
                    type EditFunction = (
                      state: ConfigureStepState,
                    ) => TemplateVariableEdit;

                    const editOf: EditFunction = (
                      state: ConfigureStepState,
                    ): TemplateVariableEdit => {
                      return editTemplateVariable({
                        template: selectedTemplate as WorkflowTemplate,
                        values: state.values,
                        typedVariableNames: state.typedVariableNames,
                        variableName: variable.name,
                        value: value,
                      });
                    };

                    setConfiguration(
                      (current: ConfigureStepState): ConfigureStepState => {
                        const next: TemplateVariableEdit = editOf(current);

                        return {
                          values: next.values,
                          typedVariableNames: next.typedVariableNames,
                        };
                      },
                    );

                    // The messages under the fields this edit changes go.
                    const edit: TemplateVariableEdit = editOf(configuration);

                    if (
                      edit.changedVariableNames.some((name: string) => {
                        return Boolean(variableErrors[name]);
                      })
                    ) {
                      setVariableErrors(
                        (
                          current: WorkflowTemplateVariableErrors,
                        ): WorkflowTemplateVariableErrors => {
                          const next: WorkflowTemplateVariableErrors = {
                            ...current,
                          };

                          for (const name of edit.changedVariableNames) {
                            delete next[name];
                          }

                          return next;
                        },
                      );
                    }
                  }}
                />
              </div>
            );
          },
        )}

        {/*
         * Who it pages, after the settings and under a line of their own:
         * not a workflow variable, so not under the sentence that says the
         * settings are. The same sentence with settings or without, and no
         * template name in it: "Page whoever is on call when a critical
         * incident is created pages people in this project" read as two
         * sentences run together, and as two languages on a German page.
         */}
        {whoToPageQuestions.length > 0 ? (
          <p
            className={`text-sm text-gray-600 ${
              variables.length > 0 ? "border-t border-gray-200 pt-5" : ""
            }`}
            data-testid="workflow-who-to-page-intro"
          >
            {translateString(
              "Pick who this workflow pages. You can change it later on its Page step in the Builder.",
            )}
          </p>
        ) : (
          <></>
        )}

        {whoToPageQuestions.map(renderWhoToPage)}
      </div>
    );
  };

  type PickStepNextFunction = (() => void) | undefined;

  /*
   * The first step's way on in the footer, Use this template, is there only
   * while a template is picked. Before that the step's way on is Start from
   * scratch, at the top of it, and a disabled "Use this template" beside
   * Cancel read as if a template had to be chosen.
   */
  const pickStepNext: PickStepNextFunction = pickedTemplate
    ? (): void => {
        chooseStart(pickedTemplate);
      }
    : undefined;

  /*
   * Create Workflow on the last step only - Name, or Configure when the
   * template asks for settings - and a plain way on before it: Use this
   * template on the picker, Next on Name. onSubmit checks Name and walks on
   * to Configure, or checks the settings, before it creates anything.
   */
  const footer: SteppedModalFooter = getSteppedModalFooter({
    hasSteps: true,
    isOnLastStep:
      step === WizardStep.Configure ||
      (step === WizardStep.NameIt && !showConfigureStep),
    onAction: onSubmit,
    onNext: step === WizardStep.PickTemplate ? pickStepNext : onSubmit,
    nextButtonText:
      step === WizardStep.PickTemplate ? "Use this template" : undefined,
  });

  return (
    <Modal
      title="Create a workflow"
      /*
       * Off pauses the trigger, not a test from the Builder: Run Workflow
       * tries a new workflow out before it is turned on.
       */
      description="Workflows are created switched off, so their trigger doesn't start them until you turn them on."
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      error={error || undefined}
      isLoading={isCreating}
      submitButtonText="Create Workflow"
      onSubmit={footer.onSubmit}
      secondaryButton={footer.secondaryButton}
      leftFooterElement={
        step === WizardStep.PickTemplate ? (
          <></>
        ) : (
          <Button
            title="Back"
            buttonStyle={ButtonStyleType.OUTLINE}
            icon={IconProp.ChevronLeft}
            disabled={isCreating}
            dataTestId="workflow-wizard-back"
            onClick={goBack}
          />
        )
      }
    >
      <div
        className="min-w-0"
        data-step={step}
        data-testid="workflow-wizard-step-content"
      >
        {step === WizardStep.PickTemplate ? renderPickStep() : <></>}
        {step === WizardStep.NameIt ? renderNameStep() : <></>}
        {step === WizardStep.Configure ? renderConfigureStep() : <></>}
      </div>
    </Modal>
  );
};

export default CreateWorkflowModal;
