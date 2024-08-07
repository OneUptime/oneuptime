import DashboardNavigation from "../../Utils/Navigation";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectPicker from "Common/UI/Components/Header/ProjectPicker/ProjectPicker";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import ProjectUtil from "Common/UI/Utils/Project";
import Project from "Common/Models/DatabaseModels/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  projects: Array<Project>;
  onProjectSelected: (project: Project) => void;
  showProjectModal: boolean;
  onProjectModalClose: () => void;
  selectedProject: Project | null;
}

const DashboardProjectPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [initialValues, setInitialValues] = useState<any>({});

  useEffect(() => {
    // check if promocode exists in localstorage and if it does, add it to initialValues.
    const promoCode: JSONValue = LocalStorage.getItem("promoCode");

    if (promoCode) {
      setInitialValues({
        paymentProviderPromoCode: promoCode,
      });
    }
  }, []);

  useEffect(() => {
    refreshFields();
  }, [initialValues]);

  const getFooter: GetReactElementFunction = (): ReactElement => {
    if (!BILLING_ENABLED) {
      return <></>;
    }

    return (
      <Toggle
        title="Yearly Plan"
        value={isSubscriptionPlanYearly}
        description="(Save 20%)"
        onChange={(value: boolean) => {
          setIsSubscriptionPlanYearly(value);
        }}
      />
    );
  };

  const [isSubscriptionPlanYearly, setIsSubscriptionPlanYearly] =
    useState<boolean>(true);

  const [fields, setFields] = useState<Array<Field<Project>>>([]);

  useEffect(() => {
    if (props.showProjectModal) {
      setShowModal(true);
    }
  }, [props.showProjectModal]);

  type GetCurrentProjectFunction = () => Project | null;

  const getCurrentProject: GetCurrentProjectFunction = (): Project | null => {
    // see nav params first, then local storage, then default to first project.
    const projectId: ObjectID | null = DashboardNavigation.getProjectId();

    if (projectId) {
      // check if this project is in the list.

      const project: Project | undefined = props.projects.find(
        (project: Project) => {
          return project._id?.toString() === projectId.toString();
        },
      );

      if (project) {
        return project;
      }
    }

    const currentProject: Project | null = ProjectUtil.getCurrentProject();

    if (currentProject) {
      return currentProject;
    }

    if (props.projects.length > 0) {
      return props.projects[0] || null;
    }

    return null;
  };

  useEffect(() => {
    const currentProject: Project | null = getCurrentProject();

    if (currentProject && props.onProjectSelected) {
      props.onProjectSelected(currentProject);
    }
  }, []);

  useEffect(() => {
    if (
      props.projects &&
      props.projects.length > 0 &&
      !props.selectedProject &&
      props.projects[0]
    ) {
      const currentProject: Project | null = getCurrentProject();

      if (!currentProject) {
        props.onProjectSelected(props.projects[0]);
      } else if (
        props.projects.filter((project: Project) => {
          return project._id === currentProject._id;
        }).length > 0
      ) {
        props.onProjectSelected(
          props.projects.filter((project: Project) => {
            return project._id === currentProject._id;
          })[0] as Project,
        );
      } else {
        props.onProjectSelected(props.projects[0]);
      }
    }
  }, [props.projects]);

  useEffect(() => {
    refreshFields();
  }, [isSubscriptionPlanYearly]);

  const refreshFields: VoidFunction = (): void => {
    let formFields: Array<Field<Project>> = [
      {
        field: {
          name: true,
        },
        validation: {
          minLength: 4,
        },
        fieldType: FormFieldSchemaType.Text,
        placeholder: "My Project",
        description: "Pick a friendly name.",
        title: "Project Name",
        required: true,
        stepId: BILLING_ENABLED ? "basic" : undefined,
      },
    ];

    if (BILLING_ENABLED) {
      formFields = [
        ...formFields,
        {
          field: {
            paymentProviderPlanId: true,
          },
          stepId: "plan",
          validation: {
            minLength: 6,
          },
          footerElement: getFooter(),
          fieldType: FormFieldSchemaType.RadioButton,
          radioButtonOptions: SubscriptionPlan.getSubscriptionPlans(
            getAllEnvVars(),
          ).map((plan: SubscriptionPlan): RadioButton => {
            let description: string = plan.isCustomPricing()
              ? `Our sales team will contact you soon.`
              : `Billed ${isSubscriptionPlanYearly ? "yearly" : "monthly"}. ${
                  plan.getTrialPeriod() > 0
                    ? `Free ${plan.getTrialPeriod()} days trial.`
                    : ""
                }`;

            if (
              isSubscriptionPlanYearly &&
              plan.getYearlySubscriptionAmountInUSD() === 0
            ) {
              description = "This plan is free, forever. ";
            }

            if (
              !isSubscriptionPlanYearly &&
              plan.getMonthlySubscriptionAmountInUSD() === 0
            ) {
              description = "This plan is free, forever. ";
            }

            return {
              value: isSubscriptionPlanYearly
                ? plan.getYearlyPlanId()
                : plan.getMonthlyPlanId(),
              title: plan.getName(),
              description: description,
              sideTitle: plan.isCustomPricing()
                ? "Custom Price"
                : isSubscriptionPlanYearly
                  ? "$" +
                    plan.getYearlySubscriptionAmountInUSD().toString() +
                    "/mo billed yearly"
                  : "$" + plan.getMonthlySubscriptionAmountInUSD().toString(),
              sideDescription: plan.isCustomPricing()
                ? ""
                : isSubscriptionPlanYearly
                  ? `~ $${
                      plan.getYearlySubscriptionAmountInUSD() * 12
                    } per user / year`
                  : `/month per user`,
            };
          }),
          title: "Please select a plan.",
          required: true,
        },
        {
          field: {
            paymentProviderPromoCode: true,
          },
          fieldType: FormFieldSchemaType.Text,
          placeholder: "Promo Code (Optional)",
          description: "If you have a coupon code, enter it here.",
          title: "Promo Code",
          required: false,
          stepId: "plan",
          disabled: Boolean(initialValues.paymentProviderPromoCode),
        },
      ];
    }

    setFields(formFields);
  };

  return (
    <>
      {props.projects.length !== 0 && (
        <ProjectPicker
          selectedProjectName={props.selectedProject?.name || ""}
          selectedProjectIcon={IconProp.Folder}
          projects={props.projects}
          onCreateProjectButtonClicked={() => {
            setShowModal(true);
            props.onProjectModalClose();
          }}
          onProjectSelected={(project: Project) => {
            props.onProjectSelected(project);
          }}
        />
      )}
      {showModal ? (
        <ModelFormModal<Project>
          modelType={Project}
          initialValues={initialValues}
          name="Create New Project"
          title="Create New Project"
          description="Please create a new OneUptime project to get started."
          onClose={() => {
            setShowModal(false);
            props.onProjectModalClose();
          }}
          submitButtonText="Create Project"
          onSuccess={(project: Project | null) => {
            LocalStorage.removeItem("promoCode");
            if (project && props.onProjectSelected) {
              props.onProjectSelected(project);
            }
            if (project && props.onProjectSelected) {
              props.onProjectSelected(project);
            }
            setShowModal(false);
            props.onProjectModalClose();
          }}
          formProps={{
            name: "Create New Project",
            steps: BILLING_ENABLED
              ? [
                  {
                    title: "Basic",
                    id: "basic",
                  },
                  {
                    title: "Select Plan",
                    id: "plan",
                  },
                ]
              : undefined,
            saveRequestOptions: {
              isMultiTenantRequest: true, // because this is a tenant request, we do not have to include the header in the request
            },
            modelType: Project,
            id: "create-project-from",
            fields: [...fields],
            formType: FormType.Create,
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DashboardProjectPicker;
