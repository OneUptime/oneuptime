/*
 * The create-a-workflow wizard.
 *
 * Three steps: pick a starting point, name it, fill in whatever configuration
 * the template asked for. The third step only appears when the chosen template
 * declares variables, so "Start from scratch" and the zero-config templates
 * stay two clicks away.
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
  useState,
} from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import {
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getWorkflowTemplate,
  getWorkflowTemplatesByCategory,
} from "Common/Types/Workflow/Templates";
import {
  WorkflowTemplateVariableErrors,
  WorkflowTemplateVariableValues,
  buildWorkflowFromTemplate,
  buildWorkflowVariables,
  validateTemplateVariableValues,
} from "../../Utils/Workflow/WorkflowTemplateCreateUtil";

export interface ComponentProps {
  onClose: () => void;
  /** Called with the created workflow so the page can navigate to it. */
  onCreated: (workflow: Workflow) => void;
}

enum WizardStep {
  PickTemplate = 1,
  NameIt = 2,
  Configure = 3,
}

const STEP_TITLES: Record<WizardStep, string> = {
  [WizardStep.PickTemplate]: "Start from",
  [WizardStep.NameIt]: "Name",
  [WizardStep.Configure]: "Configure",
};

interface StepIndicatorProps {
  current: WizardStep;
  showConfigureStep: boolean;
}

const StepIndicator: FunctionComponent<StepIndicatorProps> = (
  props: StepIndicatorProps,
): ReactElement => {
  const steps: Array<WizardStep> = [WizardStep.PickTemplate, WizardStep.NameIt];

  if (props.showConfigureStep) {
    steps.push(WizardStep.Configure);
  }

  return (
    <ol className="flex items-center gap-3 mb-6" aria-label="Progress">
      {steps.map((step: WizardStep, index: number): ReactElement => {
        const isCompleted: boolean = step < props.current;
        const isActive: boolean = step === props.current;

        return (
          <li key={step} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  isCompleted
                    ? "bg-indigo-600 text-white"
                    : isActive
                      ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-500"
                      : "bg-gray-100 text-gray-400"
                }`}
                aria-current={isActive ? "step" : undefined}
              >
                {isCompleted ? (
                  <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={`text-sm ${
                  isActive
                    ? "font-semibold text-gray-900"
                    : isCompleted
                      ? "font-medium text-gray-600"
                      : "text-gray-400"
                }`}
              >
                {STEP_TITLES[step]}
              </span>
            </div>
            {index < steps.length - 1 ? (
              <span
                className={`h-px w-8 ${
                  isCompleted ? "bg-indigo-300" : "bg-gray-200"
                }`}
              />
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ol>
  );
};

interface TemplateCardProps {
  title: string;
  description: string;
  icon: IconProp;
  isSelected: boolean;
  badge?: string | undefined;
  onClick: () => void;
}

const TemplateCard: FunctionComponent<TemplateCardProps> = (
  props: TemplateCardProps,
): ReactElement => {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={props.isSelected}
      data-testid={`workflow-template-card-${props.title}`}
      className={`relative flex cursor-pointer flex-col rounded-lg border p-4 shadow-sm transition-all duration-200 hover:border-indigo-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
        props.isSelected
          ? "border-indigo-500 bg-indigo-50/50"
          : "border-gray-200 bg-white"
      }`}
      onClick={props.onClick}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onClick();
        }
      }}
    >
      <div className="mb-3 flex items-start justify-between">
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
            props.isSelected ? "bg-indigo-100" : "bg-gray-100"
          }`}
        >
          <Icon
            icon={props.icon}
            size={SizeProp.Large}
            className={`h-5 w-5 ${
              props.isSelected ? "text-indigo-600" : "text-gray-600"
            }`}
          />
        </span>
        {props.isSelected ? (
          <Icon
            icon={IconProp.CheckCircle}
            size={SizeProp.Large}
            className="h-5 w-5 text-indigo-500"
          />
        ) : (
          <></>
        )}
      </div>
      <p className="text-sm font-semibold text-gray-900">{props.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-gray-500">
        {props.description}
      </p>
      {props.badge ? (
        <p className="mt-3 inline-flex w-fit items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {props.badge}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const CreateWorkflowModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
  const [variableValues, setVariableValues] =
    useState<WorkflowTemplateVariableValues>({});
  const [variableErrors, setVariableErrors] =
    useState<WorkflowTemplateVariableErrors>({});
  const [search, setSearch] = useState<string>("");
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const selectedTemplate: WorkflowTemplate | null = useMemo(() => {
    return selectedTemplateId ? getWorkflowTemplate(selectedTemplateId) : null;
  }, [selectedTemplateId]);

  const variables: Array<WorkflowTemplateVariable> =
    selectedTemplate?.variables || [];

  const showConfigureStep: boolean = variables.length > 0;

  type MatchesSearchFunction = (template: WorkflowTemplate) => boolean;

  const matchesSearch: MatchesSearchFunction = (
    template: WorkflowTemplate,
  ): boolean => {
    const query: string = search.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return (
      template.name.toLowerCase().includes(query) ||
      template.description.toLowerCase().includes(query) ||
      template.teaches.toLowerCase().includes(query) ||
      template.category.toLowerCase().includes(query)
    );
  };

  type SelectTemplateFunction = (template: WorkflowTemplate | null) => void;

  const selectTemplate: SelectTemplateFunction = (
    template: WorkflowTemplate | null,
  ): void => {
    setHasChosen(true);
    setSelectedTemplateId(template ? template.id : null);
    setName(template ? template.workflowName : "");
    setDescription(template ? template.workflowDescription : "");
    setNameError("");
    setVariableValues({});
    setVariableErrors({});
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
        } catch (cleanupError) {
          // Reported below as part of the original failure.
        }
      }

      setError(API.getFriendlyMessage(err));
    }

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

      setVariableErrors(errors);

      if (Object.keys(errors).length > 0) {
        return;
      }

      void create();
    }
  };

  type RenderPickStepFunction = () => ReactElement;

  const renderPickStep: RenderPickStepFunction = (): ReactElement => {
    const categoriesWithMatches: Array<{
      category: WorkflowTemplateCategory;
      templates: Array<WorkflowTemplate>;
    }> = WorkflowTemplateCategories.map(
      (category: WorkflowTemplateCategory) => {
        return {
          category: category,
          templates:
            getWorkflowTemplatesByCategory(category).filter(matchesSearch),
        };
      },
    ).filter(
      (group: {
        category: WorkflowTemplateCategory;
        templates: Array<WorkflowTemplate>;
      }) => {
        return group.templates.length > 0;
      },
    );

    const blankMatches: boolean =
      !search.trim() ||
      "start from scratch blank empty".includes(search.trim().toLowerCase());

    return (
      <div>
        <Input
          placeholder="Search templates…"
          value={search}
          onChange={(value: string) => {
            setSearch(value);
          }}
          dataTestId="workflow-template-search"
        />

        <div className="mt-5 space-y-6">
          {blankMatches ? (
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Blank
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <TemplateCard
                  title="Start from scratch"
                  description="An empty canvas. Add your own trigger and steps."
                  icon={IconProp.Add}
                  isSelected={hasChosen && selectedTemplateId === null}
                  onClick={() => {
                    selectTemplate(null);
                  }}
                />
              </div>
            </div>
          ) : (
            <></>
          )}

          {categoriesWithMatches.map(
            (group: {
              category: WorkflowTemplateCategory;
              templates: Array<WorkflowTemplate>;
            }): ReactElement => {
              return (
                <div key={group.category}>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {group.category}
                  </h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.templates.map(
                      (template: WorkflowTemplate): ReactElement => {
                        return (
                          <TemplateCard
                            key={template.id}
                            title={template.name}
                            description={template.description}
                            icon={template.icon}
                            isSelected={selectedTemplateId === template.id}
                            badge={
                              template.variables.length > 0
                                ? `Needs ${template.variables.length} setting${
                                    template.variables.length === 1 ? "" : "s"
                                  }`
                                : undefined
                            }
                            onClick={() => {
                              selectTemplate(template);
                            }}
                          />
                        );
                      },
                    )}
                  </div>
                </div>
              );
            },
          )}

          {!blankMatches && categoriesWithMatches.length === 0 ? (
            <div className="py-10 text-center">
              <Icon
                icon={IconProp.Search}
                size={SizeProp.Large}
                className="mx-auto h-6 w-6 text-gray-400"
              />
              <p className="mt-2 text-sm font-medium text-gray-900">
                No templates match “{search}”.
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Try a different word, or start from scratch.
              </p>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  };

  type RenderNameStepFunction = () => ReactElement;

  const renderNameStep: RenderNameStepFunction = (): ReactElement => {
    return (
      <div className="space-y-5">
        {selectedTemplate ? (
          <div className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100">
              <Icon
                icon={selectedTemplate.icon}
                size={SizeProp.Large}
                className="h-5 w-5 text-indigo-600"
              />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {selectedTemplate.name}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {selectedTemplate.teaches}
              </p>
            </div>
          </div>
        ) : (
          <></>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Name
          </label>
          <Input
            value={name}
            autoFocus={true}
            placeholder="What should this workflow be called?"
            dataTestId="workflow-name-input"
            error={nameError}
            onChange={(value: string) => {
              setName(value);

              if (nameError) {
                setNameError("");
              }
            }}
          />
          <p className="mt-1 text-xs text-gray-500">
            Workflow names are unique within a project.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <TextArea
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

  const renderConfigureStep: RenderConfigureStepFunction = (): ReactElement => {
    return (
      <div className="space-y-5">
        <p className="text-sm text-gray-600">
          {selectedTemplate?.name} needs a few details before it can run. These
          are saved as workflow variables, so you can change them later without
          editing the workflow itself.
        </p>

        {variables.map((variable: WorkflowTemplateVariable): ReactElement => {
          return (
            <div key={variable.name}>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {variable.title}
                {variable.required ? (
                  <span className="ml-1 text-red-500">*</span>
                ) : (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    Optional
                  </span>
                )}
              </label>
              <Input
                value={variableValues[variable.name] || ""}
                placeholder={variable.placeholder}
                error={variableErrors[variable.name]}
                dataTestId={`workflow-variable-${variable.name}`}
                type={
                  variable.isSecret
                    ? ("password" as InputType)
                    : InputType.TEXT
                }
                onChange={(value: string) => {
                  setVariableValues(
                    (
                      current: WorkflowTemplateVariableValues,
                    ): WorkflowTemplateVariableValues => {
                      return { ...current, [variable.name]: value };
                    },
                  );

                  if (variableErrors[variable.name]) {
                    setVariableErrors(
                      (
                        current: WorkflowTemplateVariableErrors,
                      ): WorkflowTemplateVariableErrors => {
                        const next: WorkflowTemplateVariableErrors = {
                          ...current,
                        };
                        delete next[variable.name];
                        return next;
                      },
                    );
                  }
                }}
              />
              <p className="mt-1 text-xs text-gray-500">
                {variable.description}
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  type SubmitTextFunction = () => string;

  const submitButtonText: SubmitTextFunction = (): string => {
    if (step === WizardStep.NameIt && showConfigureStep) {
      return "Next";
    }

    return "Create Workflow";
  };

  return (
    <Modal
      title="Create a workflow"
      description="Start from a template or build your own. Workflows are created switched off, so nothing runs until you turn them on."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      error={error || undefined}
      isLoading={isCreating}
      submitButtonText={step === WizardStep.PickTemplate ? undefined : submitButtonText()}
      onSubmit={step === WizardStep.PickTemplate ? undefined : onSubmit}
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
      <div>
        <StepIndicator current={step} showConfigureStep={showConfigureStep} />
        {step === WizardStep.PickTemplate ? renderPickStep() : <></>}
        {step === WizardStep.NameIt ? renderNameStep() : <></>}
        {step === WizardStep.Configure ? renderConfigureStep() : <></>}
      </div>
    </Modal>
  );
};

export default CreateWorkflowModal;
