import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * Stripe refuses a trial_end more than two years out, and the server rejects
 * it before calling Stripe. Mirror the limit here so the admin finds out while
 * filling the form instead of after submitting.
 */
const MAX_TRIAL_LENGTH_IN_DAYS: number = 730;

const ProjectSubscription: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const modelIdString: string = Navigation.getLastParamAsString(1);

  /*
   * ModelDetail refetches whenever the modelId it is handed changes by
   * identity, and this page lifts the loaded project into state to prefill the
   * form. A fresh ObjectID per render would therefore refetch on every render,
   * forever - so the id is memoized on the route param it came from.
   */
  const modelId: ObjectID = useMemo(() => {
    return new ObjectID(modelIdString);
  }, [modelIdString]);

  const [project, setProject] = useState<Project | null>(null);
  const [showExtendTrialModal, setShowExtendTrialModal] =
    useState<boolean>(false);
  const [isExtending, setIsExtending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);

  /*
   * Only a project whose metered subscription is still trialing can be
   * extended with no bill at all - see the warning rendered below.
   */
  const isCurrentlyTrialing: boolean =
    project?.paymentProviderMeteredSubscriptionStatus ===
    SubscriptionStatus.Trialing;

  const projectCrudRoute: Route | null = new Project().getCrudApiPath();

  const extendTrialApiUrl: URL = URL.fromString(APP_API_URL.toString())
    .addRoute(projectCrudRoute!)
    .addRoute(`/${modelId.toString()}/extend-trial`);

  type ExtendTrialFunction = (trialEndsAt: Date) => Promise<void>;

  const extendTrial: ExtendTrialFunction = async (
    trialEndsAt: Date,
  ): Promise<void> => {
    setIsExtending(true);
    setError("");
    setSuccess("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.put({
          url: extendTrialApiUrl,
          data: {
            data: {
              trialEndsAt: OneUptimeDate.toString(trialEndsAt),
            },
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (response.isFailure()) {
        throw new Error(t("pages.projectSubscription.extendFailure"));
      }

      setSuccess(
        t("pages.projectSubscription.extendSuccess", {
          date: OneUptimeDate.getDateAsLocalFormattedString(trialEndsAt),
        }),
      );

      setShowExtendTrialModal(false);

      // Pull the project back down so the card shows the trial date Stripe now has.
      setRefresher(!refresher);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsExtending(false);
    }
  };

  type OnExtendTrialSubmitFunction = (values: JSONObject) => Promise<void>;

  /*
   * Validation lives here rather than in the form schema because every rule
   * below is about the date the admin picked as a moment in time, not about
   * the shape of the field. Failing one only sets the error - the modal has to
   * stay open with the form mounted, which is why isExtending is left alone.
   */
  const onExtendTrialSubmit: OnExtendTrialSubmitFunction = async (
    values: JSONObject,
  ): Promise<void> => {
    const trialEndsAtValue: string = String(values["trialEndsAt"] || "").trim();

    if (!trialEndsAtValue) {
      setError(t("pages.projectSubscription.dateRequired"));
      return;
    }

    const pickedDate: Date = OneUptimeDate.fromString(trialEndsAtValue);

    if (isNaN(pickedDate.getTime())) {
      setError(t("pages.projectSubscription.dateInvalid"));
      return;
    }

    /*
     * The picker yields a date with no time, which would otherwise parse as
     * midnight - ending the trial at the START of the day the admin picked,
     * and putting "today" in the past. An admin who picks a date means the
     * trial runs through the end of that day, in their own timezone rather
     * than the browser's.
     */
    const trialEndsAt: Date = OneUptimeDate.getEndOfDay(
      pickedDate,
      OneUptimeDate.getCurrentTimezone(),
    );

    if (!OneUptimeDate.isInTheFuture(trialEndsAt)) {
      setError(t("pages.projectSubscription.dateInPast"));
      return;
    }

    if (
      OneUptimeDate.isAfter(
        trialEndsAt,
        OneUptimeDate.getSomeDaysAfter(MAX_TRIAL_LENGTH_IN_DAYS),
      )
    ) {
      setError(t("pages.projectSubscription.dateTooFar"));
      return;
    }

    await extendTrial(trialEndsAt);
  };

  const breadcrumbLinks: Array<{ title: string; to: Route }> = [
    {
      title: t("breadcrumbs.adminDashboard"),
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: t("breadcrumbs.projects"),
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECTS] as Route),
    },
    {
      title: t("breadcrumbs.project"),
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_VIEW] as Route,
        { modelId: modelId },
      ),
    },
    {
      title: t("breadcrumbs.projectSubscription"),
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_SUBSCRIPTION] as Route,
        { modelId: modelId },
      ),
    },
  ];

  if (!BILLING_ENABLED) {
    return (
      <ModelPage<Project>
        modelId={modelId}
        modelNameField="name"
        modelType={Project}
        modelAPI={AdminModelAPI}
        title={t("pages.projectSubscription.title")}
        breadcrumbLinks={breadcrumbLinks}
        sideMenu={<SideMenuComponent modelId={modelId} />}
      >
        <Alert
          type={AlertType.INFO}
          title={t("pages.projectSubscription.billingDisabled")}
        />
      </ModelPage>
    );
  }

  return (
    <ModelPage<Project>
      modelId={modelId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectSubscription.title")}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <div>
        {success ? (
          <Alert type={AlertType.SUCCESS} title={success} className="mb-5" />
        ) : (
          <></>
        )}

        {/*
         * Usage-based billing is not subject to proration, so moving the
         * billing cycle closes the metered subscription's current period and
         * invoices whatever usage it holds. A project that is still trialing
         * has none. One that has moved on to paying does, and the customer
         * would get that bill the moment staff tell them their trial was
         * extended - so say so before the admin opens the form.
         */}
        {project && !isCurrentlyTrialing ? (
          <Alert
            type={AlertType.WARNING}
            title={t("pages.projectSubscription.notTrialingWarning")}
            className="mb-5"
          />
        ) : (
          <></>
        )}

        <CardModelDetail<Project>
          name="Project Subscription"
          modelAPI={AdminModelAPI}
          refresher={refresher}
          cardProps={{
            title: t("pages.projectSubscription.cardTitle"),
            description: t("pages.projectSubscription.cardDescription"),
            buttons: [
              {
                title: t("pages.projectSubscription.extendTitle"),
                icon: IconProp.Clock,
                onClick: () => {
                  setError("");
                  setSuccess("");
                  setShowExtendTrialModal(true);
                },
              },
            ],
          }}
          isEditable={false}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-subscription",
            onItemLoaded: (item: Project) => {
              setProject(item);
            },
            refresher: refresher,
            fields: [
              {
                field: {
                  planName: true,
                },
                title: t("pages.projectSubscription.fieldPlan"),
                fieldType: FieldType.Text,
                placeholder: "-",
              },
              {
                field: {
                  trialEndsAt: true,
                },
                title: t("pages.projectSubscription.fieldTrialEndsAt"),
                fieldType: FieldType.DateTime,
                placeholder: t("pages.projectSubscription.noTrial"),
              },
              {
                field: {
                  paymentProviderSubscriptionStatus: true,
                },
                title: t("pages.projectSubscription.fieldSubscriptionStatus"),
                fieldType: FieldType.Text,
                placeholder: "-",
              },
              {
                field: {
                  paymentProviderMeteredSubscriptionStatus: true,
                },
                title: t(
                  "pages.projectSubscription.fieldMeteredSubscriptionStatus",
                ),
                fieldType: FieldType.Text,
                placeholder: "-",
              },
              {
                field: {
                  paymentProviderSubscriptionId: true,
                },
                title: t("pages.projectSubscription.fieldSubscriptionId"),
                fieldType: FieldType.Text,
                placeholder: "-",
                opts: {
                  isCopyable: true,
                },
              },
              {
                field: {
                  paymentProviderMeteredSubscriptionId: true,
                },
                title: t(
                  "pages.projectSubscription.fieldMeteredSubscriptionId",
                ),
                fieldType: FieldType.Text,
                placeholder: "-",
                opts: {
                  isCopyable: true,
                },
              },
            ],
            modelId: modelId,
          }}
        />

        {showExtendTrialModal ? (
          /*
           * BasicForm freezes initialValues on mount, so the modal is keyed on
           * the trial date it opened with - otherwise a project that finishes
           * loading while the modal is already up would keep the empty field
           * it started with.
           */
          <BasicFormModal
            key={project?.trialEndsAt?.toString() || "no-trial"}
            title={t("pages.projectSubscription.extendTitle")}
            description={t("pages.projectSubscription.extendDescription")}
            isLoading={isExtending}
            submitButtonText={t("pages.projectSubscription.extendSubmitButton")}
            onClose={() => {
              setShowExtendTrialModal(false);
              setError("");
            }}
            onSubmit={onExtendTrialSubmit}
            formProps={{
              id: "extend-trial-form",
              name: "Extend Trial",
              /*
               * The error rides on the form and not on the modal: the modal
               * renders its own copy above the form's, so putting it here
               * leaves a single message.
               */
              error: error,
              initialValues: {
                /*
                 * The raw Date, not a formatted string: BasicForm runs Date
                 * fields through asDateForDatabaseQuery itself, so formatting
                 * here would add a second timezone conversion on top.
                 */
                trialEndsAt: project?.trialEndsAt || "",
              },
              fields: [
                {
                  field: {
                    trialEndsAt: true,
                  },
                  title: t("pages.projectSubscription.newTrialEndDate"),
                  description: t(
                    "pages.projectSubscription.newTrialEndDateDescription",
                  ),
                  required: true,
                  fieldType: FormFieldSchemaType.Date,
                },
              ],
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </ModelPage>
  );
};

export default ProjectSubscription;
