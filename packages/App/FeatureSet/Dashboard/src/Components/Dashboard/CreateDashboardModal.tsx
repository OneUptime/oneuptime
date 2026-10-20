/*
 * Create a dashboard: the wizard Dashboards > Create Dashboard opens.
 *
 * It works the way Create a workflow does (Components/Workflow/
 * CreateWorkflowModal), because the maintainer asked for exactly that: "The
 * workflow templates model is a lot easier to understand and use. Please
 * make the dashboard templates model like workflow templates." It used to
 * be two dialogs: Create from Template, a wall of sixteen cards where a
 * click on any card went straight on, then Create New Dashboard, a form of
 * its own with no way back to the cards. Now it is one dialog of two steps:
 *
 *   1. How to start (DashboardTemplatePicker): Start from scratch first,
 *      then a few recommended templates, a search and a category select,
 *      and a template's details - the widgets it adds, the variables it
 *      brings - once it is picked. Use this template, in the footer, goes
 *      on with the template picked; a double-click or Enter does too.
 *   2. Name: the chosen template at the top, the name filled in - the
 *      template's own, numbered past the project's dashboards ("Kubernetes
 *      Dashboard 2", since a dashboard's name is unique in its project) -
 *      and the description folded under More fields. Back returns to the
 *      picker as it was left. Create Dashboard, the dialog's one primary
 *      button, creates it.
 *
 * There is no progress rail beside the steps: two steps say enough with the
 * footer, Back and Create Dashboard, and the rail would take a column of
 * the dialog's width away from the picker.
 *
 * The project's dashboard names are looked up as the dialog opens, while
 * the templates are read, so a template taken goes on at once with a name
 * nothing has yet. One taken before they arrive waits for them, its row
 * saying so; the last one taken wins, and Start from scratch never waits.
 * The server's unique check still decides: a name taken meanwhile is
 * refused with the server's own message, on the Name step, where it can be
 * changed - and Create then still builds the template.
 *
 * Created, the new dashboard opens (onCreated): what the template built,
 * or a blank dashboard's empty canvas with its Add Widget button. What each
 * template creates is unchanged: the create request names the template
 * (addDashboardTemplateToMiscData) and the server builds it from the same
 * catalog.
 */

import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { DashboardTemplateType } from "Common/Types/Dashboard/DashboardTemplates";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import {
  SteppedModalFooter,
  getSteppedModalFooter,
} from "Common/UI/Components/Forms/Utils/SteppedFormFooter";
import Input from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  DASHBOARD_TEMPLATE_PICKER_RULES,
  DashboardPickerTemplate,
  DashboardTemplatePickerState,
  INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE,
  getDashboardPickerTemplate,
} from "../../Utils/Dashboard/DashboardTemplatePickerUtil";
import { isEnterToSubmit } from "../../Utils/TemplatePicker/WizardKeys";
import ChosenTemplate from "../TemplatePicker/ChosenTemplate";
import {
  addDashboardTemplateToMiscData,
  fetchDashboardNames,
  getDashboardNameForTemplate,
} from "./DashboardCreateForm";
import DashboardTemplatePicker from "./DashboardTemplatePicker";

export interface ComponentProps {
  onClose: () => void;
  /** Called with the created dashboard so the page can open it. */
  onCreated: (dashboard: Dashboard) => void;
}

enum WizardStep {
  PickTemplate = "pick-template",
  NameIt = "name",
}

// The name's shortest length, as the create form before this asked for.
const NAME_MIN_LENGTH: number = 2;

const CreateDashboardModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const [step, setStep] = useState<WizardStep>(WizardStep.PickTemplate);
  /*
   * null is a real choice here - it means "start from scratch" - so a
   * separate flag tracks whether a choice has been made at all. Without it,
   * coming Back to step one after choosing it shows nothing chosen.
   */
  const [hasChosen, setHasChosen] = useState<boolean>(false);
  const [selectedTemplateType, setSelectedTemplateType] =
    useState<DashboardTemplateType | null>(null);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [nameError, setNameError] = useState<string>("");
  const [pickerState, setPickerState] = useState<DashboardTemplatePickerState>(
    INITIAL_DASHBOARD_TEMPLATE_PICKER_STATE,
  );
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  /*
   * The names of the project's dashboards, archived ones too - the server's
   * unique check counts those as well. Null while they are on the way.
   */
  const [existingNames, setExistingNames] = useState<Array<string> | null>(
    null,
  );
  // A template taken before the names arrived: it goes on once they do.
  const [waitingTemplateType, setWaitingTemplateType] =
    useState<DashboardTemplateType | null>(null);

  // The dialog may close while the names are on the way.
  const isOpenRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  /*
   * Set from the moment Create is pressed until the server answers, so a
   * second Enter in the name - or one pressed before the button greys out -
   * makes no second dashboard.
   */
  const isCreatingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    isOpenRef.current = true;

    // A lookup that fails hands back no names (fetchDashboardNames).
    void fetchDashboardNames().then((names: Array<string>): void => {
      if (isOpenRef.current) {
        setExistingNames(names);
      }
    });

    return () => {
      isOpenRef.current = false;
    };
  }, []);

  const selectedTemplate: DashboardPickerTemplate | null = useMemo(() => {
    return selectedTemplateType
      ? getDashboardPickerTemplate(selectedTemplateType)
      : null;
  }, [selectedTemplateType]);

  /*
   * The template the picker has picked, which "Use this template" takes.
   * None until one is clicked, moved to with the arrow keys or searched for.
   */
  const pickedTemplate: DashboardPickerTemplate | null = useMemo(() => {
    return DASHBOARD_TEMPLATE_PICKER_RULES.getActiveTemplate(pickerState);
  }, [pickerState]);

  type GoToNameFunction = (
    template: DashboardPickerTemplate | null,
    names: Array<string>,
  ) => void;

  /*
   * Moves on to Name with a template, or with null for an empty dashboard.
   * The name starts from the template's own, made unique in the project,
   * unless this is the start already chosen: going Back to look around and
   * then taking the same template again keeps what was typed for it.
   */
  const goToName: GoToNameFunction = (
    template: DashboardPickerTemplate | null,
    names: Array<string>,
  ): void => {
    const templateType: DashboardTemplateType | null = template
      ? template.type
      : null;
    const isSameStart: boolean =
      hasChosen && selectedTemplateType === templateType;

    setHasChosen(true);
    setSelectedTemplateType(templateType);

    /*
     * The template taken stays picked in the picker, so Back shows it open,
     * however it was reached: a search's best match is only picked while
     * that search stands. Starting from scratch lets go of any template
     * picked, so Back shows Start from scratch as the one chosen.
     */
    setPickerState(
      (current: DashboardTemplatePickerState): DashboardTemplatePickerState => {
        return template
          ? DASHBOARD_TEMPLATE_PICKER_RULES.withSelected(current, template.id)
          : { ...current, selectedTemplateId: null };
      },
    );

    if (!isSameStart) {
      // Blank leaves the name to whoever knows what the dashboard will show.
      setName(
        template
          ? getDashboardNameForTemplate({
              templateType: template.type,
              existingNames: names,
            })
          : "",
      );
      setDescription("");
    }

    setNameError("");
    setError("");
    setStep(WizardStep.NameIt);
  };

  type ChooseStartFunction = (template: DashboardPickerTemplate | null) => void;

  const chooseStart: ChooseStartFunction = (
    template: DashboardPickerTemplate | null,
  ): void => {
    if (template && existingNames === null) {
      // Taken before the names arrived: it waits for them, the last one wins.
      setWaitingTemplateType(template.type);
      setPickerState(
        (
          current: DashboardTemplatePickerState,
        ): DashboardTemplatePickerState => {
          return DASHBOARD_TEMPLATE_PICKER_RULES.withSelected(
            current,
            template.id,
          );
        },
      );
      return;
    }

    // Start from scratch never waits, and lets go of a template waiting.
    setWaitingTemplateType(null);
    goToName(template, existingNames || []);
  };

  // The names arrived: a template taken meanwhile goes on.
  useEffect(() => {
    if (!waitingTemplateType || existingNames === null) {
      return;
    }

    const template: DashboardPickerTemplate | null =
      getDashboardPickerTemplate(waitingTemplateType);

    setWaitingTemplateType(null);

    if (template) {
      goToName(template, existingNames);
    }
  }, [waitingTemplateType, existingNames]);

  type GoBackFunction = () => void;

  const goBack: GoBackFunction = (): void => {
    setError("");
    setNameError("");
    setStep(WizardStep.PickTemplate);
  };

  type CreateFunction = () => Promise<void>;

  const create: CreateFunction = async (): Promise<void> => {
    isCreatingRef.current = true;
    setIsCreating(true);
    setError("");

    let createdDashboard: Dashboard | null = null;

    try {
      const dashboard: Dashboard = new Dashboard();
      dashboard.name = name.trim();

      if (description.trim()) {
        dashboard.description = description.trim();
      }

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (projectId) {
        dashboard.projectId = projectId;
      }

      const response: HTTPResponse<
        JSONObject | JSONArray | Dashboard | Array<Dashboard>
      > = await ModelAPI.create<Dashboard>({
        model: dashboard,
        modelType: Dashboard,
        // Which template the server builds the new dashboard from; none for Blank.
        miscDataProps: addDashboardTemplateToMiscData({
          miscDataProps: {},
          templateType: selectedTemplateType,
        }),
      });

      createdDashboard = response.data as Dashboard;
    } catch (err) {
      // A name taken meanwhile, a plan's limit: said here, and Create can be pressed again.
      setError(API.getFriendlyMessage(err));
    }

    isCreatingRef.current = false;
    setIsCreating(false);

    /*
     * Handed over outside the try on purpose. onCreated opens the new
     * dashboard, and a failure there must not read as a failed create.
     */
    if (createdDashboard) {
      props.onCreated(createdDashboard);
    }
  };

  type OnSubmitFunction = () => void;

  const onSubmit: OnSubmitFunction = (): void => {
    if (isCreatingRef.current) {
      return;
    }

    if (name.trim().length < NAME_MIN_LENGTH) {
      setNameError("Please give this dashboard a name of at least 2 letters.");
      return;
    }

    setNameError("");
    void create();
  };

  type RenderPickStepFunction = () => ReactElement;

  const renderPickStep: RenderPickStepFunction = (): ReactElement => {
    return (
      <DashboardTemplatePicker
        state={pickerState}
        onStateChange={setPickerState}
        onUseTemplate={(template: DashboardPickerTemplate) => {
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
          hasChosen && selectedTemplateType === null && !pickedTemplate
        }
        busyTemplateId={waitingTemplateType}
      />
    );
  };

  type RenderNameStepFunction = () => ReactElement;

  const renderNameStep: RenderNameStepFunction = (): ReactElement => {
    return (
      <div className="space-y-5">
        {selectedTemplate ? (
          // What the new dashboard will show: the template's own words.
          <ChosenTemplate
            icon={selectedTemplate.icon}
            name={selectedTemplate.name}
            line={selectedTemplate.description}
            dataTestId="dashboard-template-chosen"
          />
        ) : (
          <></>
        )}

        <div>
          <FieldLabelElement
            title="Name"
            htmlFor="dashboard-name"
            required={true}
            description="Dashboard names are unique within a project."
          />
          <Input
            id="dashboard-name"
            value={name}
            autoFocus={true}
            placeholder="What should this dashboard be called?"
            dataTestId="dashboard-name-input"
            // Kept in English, as its key, and looked up as it is shown.
            error={translateString(nameError)}
            onChange={(value: string) => {
              setName(value);

              if (nameError) {
                setNameError("");
              }
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              // Enter creates, as Create Dashboard does (isEnterToSubmit).
              if (isEnterToSubmit(event)) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
        </div>

        {/*
         * Optional, and editable later on the dashboard's Overview, so it
         * waits under More fields, as it did in the form before: the step is
         * one name and one click on Create Dashboard.
         */}
        <FoldedSection
          title={MORE_FIELDS_SECTION_TITLE}
          dataTestId="dashboard-more-fields"
          items={[
            {
              key: "description",
              title: "Description",
              isSet: description.trim().length > 0,
            },
          ]}
        >
          <div className="pt-1">
            <FieldLabelElement
              title="Description"
              htmlFor="dashboard-description"
            />
            <TextArea
              id="dashboard-description"
              value={description}
              placeholder="What is this dashboard for?"
              dataTestId="dashboard-description-input"
              onChange={(value: string) => {
                setDescription(value);
              }}
            />
          </div>
        </FoldedSection>
      </div>
    );
  };

  type PickStepNextFunction = (() => void) | undefined;

  /*
   * The first step's way on in the footer, Use this template, is there only
   * while a template is picked. Before that the step's way on is Start from
   * scratch, at the top of it.
   */
  const pickStepNext: PickStepNextFunction = pickedTemplate
    ? (): void => {
        chooseStart(pickedTemplate);
      }
    : undefined;

  /*
   * Create Dashboard on the last step only, Name, and a plain way on before
   * it: Use this template on the picker (SteppedFormFooter). While a
   * template waits for the names, Use this template waits too.
   */
  const footer: SteppedModalFooter = getSteppedModalFooter({
    hasSteps: true,
    isOnLastStep: step === WizardStep.NameIt,
    onAction: onSubmit,
    onNext: step === WizardStep.PickTemplate ? pickStepNext : undefined,
    nextButtonText: "Use this template",
    isNextButtonDisabled: Boolean(waitingTemplateType),
  });

  return (
    <Modal
      title="Create a dashboard"
      modalWidth={ModalWidth.Medium}
      onClose={props.onClose}
      error={error || undefined}
      isLoading={isCreating}
      submitButtonText="Create Dashboard"
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
            dataTestId="dashboard-wizard-back"
            onClick={goBack}
          />
        )
      }
    >
      <div
        className="min-w-0"
        data-step={step}
        data-testid="dashboard-wizard-step-content"
      >
        {step === WizardStep.PickTemplate ? renderPickStep() : <></>}
        {step === WizardStep.NameIt ? renderNameStep() : <></>}
      </div>
    </Modal>
  );
};

export default CreateDashboardModal;
