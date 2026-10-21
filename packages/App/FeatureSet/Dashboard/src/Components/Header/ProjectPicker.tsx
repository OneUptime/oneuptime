import ProjectUtil from "Common/UI/Utils/Project";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONValue } from "Common/Types/JSON";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ProjectPicker from "Common/UI/Components/Header/ProjectPicker/ProjectPicker";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { getCreateProjectFormFields } from "Common/UI/Components/Project/CreateProjectFormFields";
import { BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import UiAnalytics from "Common/UI/Utils/Analytics";
import Analytics, { PurchaseData } from "Common/Utils/Analytics";
import {
  RevenueEventName,
  RevenueFunnelStage,
} from "Common/Types/Analytics/RevenueEvent";
import GlobalConfigUtil from "Common/UI/Utils/GlobalConfig";
import User from "Common/UI/Utils/User";
import Project from "Common/Models/DatabaseModels/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
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

  const [canCreateProject, setCanCreateProject] = useState<boolean>(true);

  /*
   * A promo code that came with the sign-up link (Accounts keeps it from
   * ?promoCode=) is filled in each time the dialog opens. It can be edited
   * or cleared: it used to be locked, so a code that no longer applied
   * stopped every project from being created until the browser forgot it.
   */
  const initialValues: FormValues<Project> = useMemo(() => {
    if (!showModal) {
      return {};
    }

    const promoCode: JSONValue = LocalStorage.getItem("promoCode");

    return promoCode
      ? ({
          paymentProviderPromoCode: promoCode.toString(),
        } as FormValues<Project>)
      : {};
  }, [showModal]);

  // Name, plan and promo code (CreateProjectFormFields); the name alone without billing.
  const fields: Array<Field<Project>> = useMemo(() => {
    return getCreateProjectFormFields({
      isBillingEnabled: BILLING_ENABLED,
      plans: BILLING_ENABLED
        ? SubscriptionPlan.getSubscriptionPlans(getAllEnvVars())
        : [],
    });
  }, []);

  useEffect(() => {
    if (User.isMasterAdmin()) {
      setCanCreateProject(true);
      return;
    }

    GlobalConfigUtil.fetchVars()
      .then((vars: { disableUserProjectCreation: boolean }) => {
        setCanCreateProject(!vars.disableUserProjectCreation);
      })
      .catch(() => {
        setCanCreateProject(true);
      });
  }, []);

  useEffect(() => {
    if (props.showProjectModal) {
      setShowModal(true);
    }
  }, [props.showProjectModal]);

  useEffect(() => {
    /*
     * The project list is still loading at this point. Fall back to the cached
     * copy of the project the user was last on so the dashboard can start
     * rendering it right away instead of waiting for the list. The effect below
     * corrects this once the list arrives (e.g. if the user no longer has
     * access to that project).
     */
    if (props.selectedProject) {
      return;
    }

    const currentProject: Project | null = ProjectUtil.getCurrentProject();

    if (currentProject && props.onProjectSelected) {
      props.onProjectSelected(currentProject);
    }
  }, []);

  useEffect(() => {
    /*
     * The project list has loaded (or reloaded). Open the project in the URL,
     * else the last project this user opened on this browser, else their first
     * project - and always one they still have access to.
     */
    const projectToSelect: Project | null =
      ProjectUtil.getProjectToSelectOnProjectsLoaded({
        projects: props.projects,
        selectedProject: props.selectedProject,
      });

    if (projectToSelect) {
      props.onProjectSelected(projectToSelect);
    }
  }, [props.projects]);

  return (
    <>
      {props.projects.length !== 0 && (
        <ProjectPicker
          selectedProjectName={props.selectedProject?.name || ""}
          selectedProjectIcon={IconProp.Folder}
          projects={props.projects}
          hideCreateProjectButton={!canCreateProject}
          onCreateProjectButtonClicked={() => {
            setShowModal(true);
            props.onProjectModalClose();
          }}
          onProjectSelected={(project: Project) => {
            props.onProjectSelected(project);
          }}
        />
      )}
      {showModal && canCreateProject ? (
        <ModelFormModal<Project>
          modelType={Project}
          initialValues={initialValues}
          name="Create New Project"
          title="Create New Project"
          description="A project holds your monitors, incidents, status pages and team."
          modalWidth={BILLING_ENABLED ? ModalWidth.Medium : ModalWidth.Normal}
          onClose={() => {
            setShowModal(false);
            props.onProjectModalClose();
          }}
          submitButtonText="Create Project"
          onSuccess={(project: Project | null) => {
            LocalStorage.removeItem("promoCode");
            if (project) {
              UiAnalytics.captureRevenueEvent(
                RevenueEventName.WorkspaceCreated,
                {
                  funnel_stage: RevenueFunnelStage.Activation,
                  project_id: project.id?.toString() || "",
                  plan_id: project.paymentProviderPlanId || "",
                },
              );

              /*
               * A project created straight onto a paid plan is a revenue
               * conversion, not just an activation — and it never reaches the
               * plan-change path in Settings > Billing that reports the rest.
               * The server emits the authoritative event; this is the browser
               * mirror GA4 and Google Ads can bid on.
               */
              const planId: string = project.paymentProviderPlanId || "";
              const plan: SubscriptionPlan | undefined = planId
                ? SubscriptionPlan.getSubscriptionPlanById(
                    planId,
                    getAllEnvVars(),
                  )
                : undefined;

              if (plan) {
                const monthlyAmountInUSD: number | null = plan.isCustomPricing()
                  ? null
                  : plan.getYearlyPlanId() === planId
                    ? plan.getYearlySubscriptionAmountInUSD()
                    : plan.getMonthlySubscriptionAmountInUSD();

                const planIsPaid: boolean =
                  plan.isCustomPricing() ||
                  (monthlyAmountInUSD !== null && monthlyAmountInUSD > 0);

                if (planIsPaid) {
                  UiAnalytics.captureRevenueEvent(
                    RevenueEventName.SubscriptionStarted,
                    {
                      funnel_stage: RevenueFunnelStage.Revenue,
                      plan: plan.getName(),
                      project_id: project.id?.toString() || "",
                      is_paid_conversion: true,
                      has_custom_pricing: plan.isCustomPricing(),
                      ...(monthlyAmountInUSD !== null
                        ? {
                            value: monthlyAmountInUSD,
                            currency: "USD",
                          }
                        : {}),
                    },
                  );

                  const purchase: PurchaseData | null =
                    Analytics.purchaseForNewProject({
                      projectId: project.id?.toString() || "",
                      planName: plan.getName(),
                      monthlyAmountInUSD: monthlyAmountInUSD,
                    });

                  if (purchase) {
                    UiAnalytics.capturePurchase(purchase);
                  }
                }
              }
            }
            if (project && props.onProjectSelected) {
              props.onProjectSelected(project);
            }
            setShowModal(false);
            props.onProjectModalClose();
          }}
          formProps={{
            name: "Create New Project",
            saveRequestOptions: {
              isMultiTenantRequest: true, // because this is a tenant request, we do not have to include the header in the request
            },
            modelType: Project,
            id: "create-project-from",
            fields: fields,
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
