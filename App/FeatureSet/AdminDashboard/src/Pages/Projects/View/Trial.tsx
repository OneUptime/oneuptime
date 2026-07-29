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
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
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

const ProjectTrial: FunctionComponent = (): ReactElement => {
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
        throw new Error(t("pages.projectTrial.extendFailure"));
      }

      setSuccess(
        t("pages.projectTrial.extendSuccess", {
          date: OneUptimeDate.getDateAsLocalFormattedString(trialEndsAt),
        }),
      );

      // Pull the project back down so the card shows the trial date Stripe now has.
      setRefresher(!refresher);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsExtending(false);
    }
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
      title: t("breadcrumbs.projectTrial"),
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_TRIAL] as Route,
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
        title={t("pages.projectTrial.title")}
        breadcrumbLinks={breadcrumbLinks}
        sideMenu={<SideMenuComponent modelId={modelId} />}
      >
        <Alert
          type={AlertType.INFO}
          title={t("pages.projectTrial.billingDisabled")}
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
      title={t("pages.projectTrial.title")}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <div>
        <CardModelDetail<Project>
          name="Project Trial"
          modelAPI={AdminModelAPI}
          refresher={refresher}
          cardProps={{
            title: t("pages.projectTrial.cardTitle"),
            description: t("pages.projectTrial.cardDescription"),
          }}
          isEditable={false}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-trial",
            onItemLoaded: (item: Project) => {
              setProject(item);
            },
            refresher: refresher,
            fields: [
              {
                field: {
                  planName: true,
                },
                title: t("pages.projectTrial.fieldPlan"),
                fieldType: FieldType.Text,
                placeholder: "-",
              },
              {
                field: {
                  trialEndsAt: true,
                },
                title: t("pages.projectTrial.fieldTrialEndsAt"),
                fieldType: FieldType.DateTime,
                placeholder: t("pages.projectTrial.noTrial"),
              },
              {
                field: {
                  paymentProviderSubscriptionStatus: true,
                },
                title: t("pages.projectTrial.fieldSubscriptionStatus"),
                fieldType: FieldType.Text,
                placeholder: "-",
              },
              {
                field: {
                  paymentProviderMeteredSubscriptionStatus: true,
                },
                title: t("pages.projectTrial.fieldMeteredSubscriptionStatus"),
                fieldType: FieldType.Text,
                placeholder: "-",
              },
              {
                field: {
                  paymentProviderSubscriptionId: true,
                },
                title: t("pages.projectTrial.fieldSubscriptionId"),
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
                title: t("pages.projectTrial.fieldMeteredSubscriptionId"),
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

        <Card
          title={t("pages.projectTrial.extendCardTitle")}
          description={t("pages.projectTrial.extendCardDescription")}
        >
          {success ? (
            <Alert type={AlertType.SUCCESS} title={success} className="mb-4" />
          ) : (
            <></>
          )}

          {/*
           * Usage-based billing is not subject to proration, so moving the
           * billing cycle closes the metered subscription's current period and
           * invoices whatever usage it holds. A project that is still trialing
           * has none. One that has moved on to paying does, and the customer
           * would get that bill the moment staff tell them their trial was
           * extended - so say so before the admin submits.
           */}
          {project && !isCurrentlyTrialing ? (
            <Alert
              type={AlertType.WARNING}
              title={t("pages.projectTrial.notTrialingWarning")}
              className="mb-4"
            />
          ) : (
            <></>
          )}

          {/*
           * BasicForm freezes initialValues on mount, so the form only goes up
           * once the project is loaded - otherwise the current trial end date
           * never makes it into the field. The key remounts it after a
           * successful extension so the field shows the new date.
           */}
          {!project ? (
            <ComponentLoader />
          ) : (
            <BasicForm
              key={project.trialEndsAt?.toString() || "no-trial"}
              id="extend-trial-form"
              name="Extend Trial"
              isLoading={isExtending}
              error={error || ""}
              submitButtonText={t("pages.projectTrial.extendSubmitButton")}
              maxPrimaryButtonWidth={true}
              initialValues={{
                /*
                 * The raw Date, not a formatted string: BasicForm runs Date
                 * fields through asDateForDatabaseQuery itself, so formatting
                 * here would add a second timezone conversion on top.
                 */
                trialEndsAt: project.trialEndsAt || "",
              }}
              fields={[
                {
                  field: {
                    trialEndsAt: true,
                  },
                  title: t("pages.projectTrial.newTrialEndDate"),
                  description: t(
                    "pages.projectTrial.newTrialEndDateDescription",
                  ),
                  required: true,
                  fieldType: FormFieldSchemaType.Date,
                },
              ]}
              onSubmit={async (
                values: JSONObject,
                onSubmitSuccessful?: () => void,
              ) => {
                const trialEndsAtValue: string = String(
                  values["trialEndsAt"] || "",
                ).trim();

                if (!trialEndsAtValue) {
                  setSuccess("");
                  setError(t("pages.projectTrial.dateRequired"));
                  return;
                }

                const pickedDate: Date =
                  OneUptimeDate.fromString(trialEndsAtValue);

                if (isNaN(pickedDate.getTime())) {
                  setSuccess("");
                  setError(t("pages.projectTrial.dateInvalid"));
                  return;
                }

                /*
                 * The picker yields a date with no time, which would otherwise
                 * parse as midnight - ending the trial at the START of the day
                 * the admin picked, and putting "today" in the past. An admin
                 * who picks a date means the trial runs through the end of
                 * that day, in their own timezone rather than the browser's.
                 */
                const trialEndsAt: Date = OneUptimeDate.getEndOfDay(
                  pickedDate,
                  OneUptimeDate.getCurrentTimezone(),
                );

                if (!OneUptimeDate.isInTheFuture(trialEndsAt)) {
                  setSuccess("");
                  setError(t("pages.projectTrial.dateInPast"));
                  return;
                }

                if (
                  OneUptimeDate.isAfter(
                    trialEndsAt,
                    OneUptimeDate.getSomeDaysAfter(MAX_TRIAL_LENGTH_IN_DAYS),
                  )
                ) {
                  setSuccess("");
                  setError(t("pages.projectTrial.dateTooFar"));
                  return;
                }

                await extendTrial(trialEndsAt);

                if (onSubmitSuccessful) {
                  onSubmitSuccessful();
                }
              }}
            />
          )}
        </Card>
      </div>
    </ModelPage>
  );
};

export default ProjectTrial;
