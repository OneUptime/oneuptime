import {
  getNumberLocale,
  getReaderNumberLocale,
} from "Common/Types/DateLanguage";
import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import {
  BillingPeriod,
  isSamePlanChoice,
} from "Common/Types/Billing/SubscriptionPlanPricing";
import ProjectBalanceType from "Common/Types/Billing/ProjectBalanceType";
import BalanceAdjustmentType from "Common/Types/Billing/BalanceAdjustmentType";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ActiveMonitorLimitUtil from "Common/Types/Monitor/ActiveMonitorLimit";
import ObjectID from "Common/Types/ObjectID";
import { Amber600 } from "Common/Types/BrandColors";
import Project from "Common/Models/DatabaseModels/Project";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import PlanPicker from "Common/UI/Components/Billing/PlanPicker/PlanPicker";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, BILLING_ENABLED, getAllEnvVars } from "Common/UI/Config";
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

/*
 * Mirrors MAX_BALANCE_ADJUSTMENT_IN_USD_CENTS on the server, for the same
 * reason the trial length is mirrored: catch the fat-fingered amount in the
 * form rather than in the API response.
 */
const MAX_BALANCE_ADJUSTMENT_IN_USD: number = 10000;

const ProjectSubscription: FunctionComponent = (): ReactElement => {
  const { t, i18n } = useTranslation();

  // A count the way the admin's language writes it: 2881 is "2,881".
  const formatCount: (value: number) => string = (value: number): string => {
    try {
      return value.toLocaleString(getNumberLocale(i18n.language || undefined));
    } catch {
      return value.toLocaleString(getReaderNumberLocale());
    }
  };

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
  const [showChangePlanModal, setShowChangePlanModal] =
    useState<boolean>(false);
  const [isChangingPlan, setIsChangingPlan] = useState<boolean>(false);
  const [showExtendTrialModal, setShowExtendTrialModal] =
    useState<boolean>(false);
  const [isExtending, setIsExtending] = useState<boolean>(false);
  const [showAdjustBalanceModal, setShowAdjustBalanceModal] =
    useState<boolean>(false);
  const [isAdjustingBalance, setIsAdjustingBalance] = useState<boolean>(false);
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

  // The plans this server sells, in their order (the customer's own picker's).
  const plans: Array<SubscriptionPlan> = useMemo(() => {
    return SubscriptionPlan.getSubscriptionPlans(getAllEnvVars());
  }, []);

  /*
   * Staff move a project to another plan through a master-admin route of
   * its own (issue #6771): the customer's change-plan route is held to the
   * caller's own project and billing permissions in it, which staff acting
   * from here do not have. The move behind it is the customer's own.
   */
  const changePlanApiUrl: URL = URL.fromString(APP_API_URL.toString())
    .addRoute(projectCrudRoute!)
    .addRoute(`/${modelId.toString()}/admin-change-plan`);

  type ChangePlanFunction = (paymentProviderPlanId: string) => Promise<void>;

  const changePlan: ChangePlanFunction = async (
    paymentProviderPlanId: string,
  ): Promise<void> => {
    setIsChangingPlan(true);
    setError("");
    setSuccess("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.put({
          url: changePlanApiUrl,
          data: {
            data: {
              paymentProviderPlanId: paymentProviderPlanId,
            },
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (response.isFailure()) {
        throw new Error(t("pages.projectSubscription.changePlanFailure"));
      }

      setSuccess(
        t("pages.projectSubscription.changePlanSuccess", {
          // A plan's name is its name in every language, as on the invoice.
          plan:
            SubscriptionPlan.getSubscriptionPlanById(
              paymentProviderPlanId,
              getAllEnvVars(),
            )?.getName() || paymentProviderPlanId,
        }),
      );

      setShowChangePlanModal(false);

      // Pull the project back down so the card shows the plan it is now on.
      setRefresher(!refresher);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsChangingPlan(false);
    }
  };

  /*
   * The plan picked is not one to move to: none, or the plan the project is
   * already on (isSamePlanChoice - the same price, or the other period of a
   * plan that costs nothing either way). Said under the plans, as the
   * customer's own Change Plan says it, rather than sent: the server would
   * refuse it too.
   */
  const getChangePlanError: (pickedPlanId: string) => string | null = (
    pickedPlanId: string,
  ): string | null => {
    if (!pickedPlanId) {
      return t("pages.projectSubscription.planRequired");
    }

    if (isSamePlanChoice(plans, project?.paymentProviderPlanId, pickedPlanId)) {
      return t("pages.projectSubscription.samePlan");
    }

    return null;
  };

  type OnChangePlanSubmitFunction = (values: JSONObject) => Promise<void>;

  const onChangePlanSubmit: OnChangePlanSubmitFunction = async (
    values: JSONObject,
  ): Promise<void> => {
    const pickedPlanId: string = String(
      values["paymentProviderPlanId"] || "",
    ).trim();

    const pickError: string | null = getChangePlanError(pickedPlanId);

    if (pickError) {
      setError(pickError);
      return;
    }

    await changePlan(pickedPlanId);
  };

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

  const adjustBalanceApiUrl: URL = URL.fromString(APP_API_URL.toString())
    .addRoute(projectCrudRoute!)
    .addRoute(`/${modelId.toString()}/adjust-balance`);

  const balanceTypeOptions: Array<DropdownOption> = [
    {
      label: t("pages.projectSubscription.balanceTypeSmsOrCall"),
      value: ProjectBalanceType.SmsOrCall,
    },
    {
      label: t("pages.projectSubscription.balanceTypeAi"),
      value: ProjectBalanceType.AI,
    },
  ];

  const adjustmentTypeOptions: Array<DropdownOption> = [
    {
      label: t("pages.projectSubscription.adjustmentTypeAdd"),
      value: BalanceAdjustmentType.Add,
    },
    {
      label: t("pages.projectSubscription.adjustmentTypeDeduct"),
      value: BalanceAdjustmentType.Deduct,
    },
    {
      label: t("pages.projectSubscription.adjustmentTypeSet"),
      value: BalanceAdjustmentType.Set,
    },
  ];

  type AdjustBalanceFunction = (values: {
    balanceType: ProjectBalanceType;
    adjustmentType: BalanceAdjustmentType;
    amountInUSD: number;
    reason: string;
  }) => Promise<void>;

  const adjustBalance: AdjustBalanceFunction = async (values: {
    balanceType: ProjectBalanceType;
    adjustmentType: BalanceAdjustmentType;
    amountInUSD: number;
    reason: string;
  }): Promise<void> => {
    setIsAdjustingBalance(true);
    setError("");
    setSuccess("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.put({
          url: adjustBalanceApiUrl,
          data: {
            data: {
              balanceType: values.balanceType,
              adjustmentType: values.adjustmentType,
              amountInUSD: values.amountInUSD,
              reason: values.reason,
            },
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (response.isFailure()) {
        throw new Error(t("pages.projectSubscription.adjustFailure"));
      }

      const newBalanceInUSDCents: number = Number(
        (response.data as JSONObject)["newBalanceInUSDCents"] ?? 0,
      );

      setSuccess(
        t("pages.projectSubscription.adjustSuccess", {
          balance: (newBalanceInUSDCents / 100).toFixed(2),
        }),
      );

      setShowAdjustBalanceModal(false);

      // Pull the project back down so the card shows the balance we just wrote.
      setRefresher(!refresher);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsAdjustingBalance(false);
    }
  };

  type OnAdjustBalanceSubmitFunction = (values: JSONObject) => Promise<void>;

  /*
   * Same split as the extend-trial form above: the schema can only say a
   * field is present, so everything about what the numbers MEAN is checked
   * here, and a failure only sets the error - the modal stays open with what
   * the admin typed still in it.
   */
  const onAdjustBalanceSubmit: OnAdjustBalanceSubmitFunction = async (
    values: JSONObject,
  ): Promise<void> => {
    const balanceType: string = String(values["balanceType"] || "").trim();

    if (
      !Object.values(ProjectBalanceType).includes(
        balanceType as ProjectBalanceType,
      )
    ) {
      setError(t("pages.projectSubscription.balanceTypeRequired"));
      return;
    }

    const adjustmentType: string = String(
      values["adjustmentType"] || "",
    ).trim();

    if (
      !Object.values(BalanceAdjustmentType).includes(
        adjustmentType as BalanceAdjustmentType,
      )
    ) {
      setError(t("pages.projectSubscription.adjustmentTypeRequired"));
      return;
    }

    const amountValue: string = String(values["amountInUSD"] ?? "").trim();

    if (!amountValue) {
      setError(t("pages.projectSubscription.amountRequired"));
      return;
    }

    const amountInUSD: number = Number(amountValue);

    if (!isFinite(amountInUSD)) {
      setError(t("pages.projectSubscription.amountInvalid"));
      return;
    }

    if (amountInUSD < 0) {
      setError(t("pages.projectSubscription.amountNegative"));
      return;
    }

    /*
     * Adding or deducting nothing is a no-op; setting to zero is a real
     * instruction, so only the relative adjustments require a positive amount.
     */
    if (amountInUSD === 0 && adjustmentType !== BalanceAdjustmentType.Set) {
      setError(t("pages.projectSubscription.amountNotPositive"));
      return;
    }

    if (amountInUSD > MAX_BALANCE_ADJUSTMENT_IN_USD) {
      setError(
        t("pages.projectSubscription.amountTooLarge", {
          max: MAX_BALANCE_ADJUSTMENT_IN_USD,
        }),
      );
      return;
    }

    /*
     * Cents are the storage unit, so a third decimal place has nowhere to go.
     * Reject it rather than rounding silently - the admin should see the
     * number they are actually applying. The tolerance is there because
     * 20.15 * 100 is 2014.9999999999998 in binary floating point, which is a
     * representation artefact and not a fraction of a cent.
     */
    const amountInUSDCents: number = amountInUSD * 100;

    if (Math.abs(amountInUSDCents - Math.round(amountInUSDCents)) > 1e-6) {
      setError(t("pages.projectSubscription.amountTooPrecise"));
      return;
    }

    const reason: string = String(values["reason"] || "").trim();

    if (!reason) {
      setError(t("pages.projectSubscription.reasonRequired"));
      return;
    }

    await adjustBalance({
      balanceType: balanceType as ProjectBalanceType,
      adjustmentType: adjustmentType as BalanceAdjustmentType,
      amountInUSD: amountInUSD,
      reason: reason,
    });
  };

  const breadcrumbLinks: Array<Link> = [
    {
      title: t("breadcrumbs.adminDashboard"),
      isTitleTranslated: true,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: t("breadcrumbs.projects"),
      isTitleTranslated: true,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECTS] as Route),
    },
    {
      title: t("breadcrumbs.project"),
      isTitleTranslated: true,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_VIEW] as Route,
        { modelId: modelId },
      ),
    },
    {
      title: t("breadcrumbs.projectSubscription"),
      isTitleTranslated: true,
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
                title: t("pages.projectSubscription.changePlanTitle"),
                icon: IconProp.Upgrade,
                onClick: () => {
                  setError("");
                  setSuccess("");
                  setShowChangePlanModal(true);
                },
              },
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
            /*
             * What Change Plan opens on: the price the project is subscribed
             * to, which its picker marks, and the cloud marketplace that
             * bills it, which bills month to month only.
             */
            selectMoreFields: {
              paymentProviderPlanId: true,
              billingMarketplace: true,
            },
            fields: [
              {
                field: {
                  planName: true,
                },
                title: t("pages.projectSubscription.fieldPlan"),
                fieldType: FieldType.Text,
              },
              {
                field: {
                  trialEndsAt: true,
                },
                title: t("pages.projectSubscription.fieldTrialEndsAt"),
                fieldType: FieldType.DateTime,
                placeholder: t("pages.projectSubscription.noTrial"),
                isPlaceholderTranslated: true,
              },
              {
                field: {
                  paymentProviderSubscriptionStatus: true,
                },
                title: t("pages.projectSubscription.fieldSubscriptionStatus"),
                fieldType: FieldType.Text,
              },
              {
                field: {
                  paymentProviderMeteredSubscriptionStatus: true,
                },
                title: t(
                  "pages.projectSubscription.fieldMeteredSubscriptionStatus",
                ),
                fieldType: FieldType.Text,
              },
              {
                field: {
                  paymentProviderSubscriptionId: true,
                },
                title: t("pages.projectSubscription.fieldSubscriptionId"),
                fieldType: FieldType.Text,
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
                opts: {
                  isCopyable: true,
                },
              },
            ],
            modelId: modelId,
          }}
        />

        {/*
         * What the plan lets the project have in active monitors - every
         * monitor but a Manual one (Common/Server/Utils/Billing/
         * ActiveMonitorLimit). A plan bought from a reseller writes the limit;
         * staff see how many the project has beside it and can change it
         * here. The count is the one the bill reports
         * (Project.currentActiveMonitorsCount).
         */}
        <CardModelDetail<Project>
          name="Project Active Monitors"
          modelAPI={AdminModelAPI}
          refresher={refresher}
          cardProps={{
            title: t("pages.projectSubscription.monitorLimitCardTitle"),
            description: t(
              "pages.projectSubscription.monitorLimitCardDescription",
            ),
          }}
          isEditable={true}
          editButtonText={t("pages.projectSubscription.monitorLimitEditButton")}
          editModalTitle={t("pages.projectSubscription.monitorLimitEditButton")}
          formFields={[
            {
              field: {
                activeMonitorsLimit: true,
              },
              title: t("pages.projectSubscription.fieldMonitorLimit"),
              description: t(
                "pages.projectSubscription.fieldMonitorLimitDescription",
              ),
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: t("pages.projectSubscription.noMonitorLimit"),
              isPlaceholderTranslated: true,
              validation: {
                minValue: 1,
              },
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-active-monitors",
            fields: [
              {
                field: {
                  currentActiveMonitorsCount: true,
                },
                title: t("pages.projectSubscription.fieldActiveMonitors"),
                fieldType: FieldType.Element,
                /*
                 * The count, and how it stands against the project's own
                 * limit: a project past it (the support report's, 2,881 on
                 * a limit of 500) says by how many at a glance.
                 */
                getElement: (item: Project): ReactElement => {
                  const count: number = Number(
                    item.currentActiveMonitorsCount || 0,
                  );
                  const limit: number | null =
                    ActiveMonitorLimitUtil.getProjectLimit(
                      item.activeMonitorsLimit,
                    );

                  return (
                    <div
                      className="flex flex-wrap items-center gap-2"
                      data-testid="project-active-monitors-count"
                    >
                      <span>{formatCount(count)}</span>
                      {limit !== null && count > limit ? (
                        <Pill
                          text={t(
                            "pages.projectSubscription.overMonitorLimit",
                            {
                              over: formatCount(count - limit),
                            },
                          )}
                          isUserContent={true}
                          color={Amber600}
                          size={PillSize.Normal}
                        />
                      ) : (
                        <></>
                      )}
                      {limit !== null && count === limit ? (
                        <Pill
                          text={t("pages.projectSubscription.atMonitorLimit")}
                          isUserContent={true}
                          color={Amber600}
                          size={PillSize.Normal}
                        />
                      ) : (
                        <></>
                      )}
                    </div>
                  );
                },
              },
              {
                field: {
                  activeMonitorsLimit: true,
                },
                title: t("pages.projectSubscription.fieldMonitorLimit"),
                fieldType: FieldType.Element,
                // Nothing, or 0, is no limit (ActiveMonitorLimitUtil).
                getElement: (item: Project): ReactElement => {
                  const limit: number | null =
                    ActiveMonitorLimitUtil.getProjectLimit(
                      item.activeMonitorsLimit,
                    );

                  return limit === null ? (
                    <PlaceholderText
                      text={t("pages.projectSubscription.noMonitorLimit")}
                      isTextTranslated={true}
                    />
                  ) : (
                    <span data-testid="project-active-monitor-limit">
                      {formatCount(limit)}
                    </span>
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />

        {/*
         * Prepaid balances live next to the subscription because they are the
         * other half of what the customer owes: the plan is invoiced, these
         * are drawn down. Staff correct them here when a charge was wrong or
         * a credit was promised out of band.
         */}
        <CardModelDetail<Project>
          name="Project Balances"
          modelAPI={AdminModelAPI}
          refresher={refresher}
          cardProps={{
            title: t("pages.projectSubscription.balancesCardTitle"),
            description: t("pages.projectSubscription.balancesCardDescription"),
            buttons: [
              {
                title: t("pages.projectSubscription.adjustBalanceTitle"),
                icon: IconProp.Billing,
                onClick: () => {
                  setError("");
                  setSuccess("");
                  setShowAdjustBalanceModal(true);
                },
              },
            ],
          }}
          isEditable={false}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-balances",
            fields: [
              {
                field: {
                  smsOrCallCurrentBalanceInUSDCents: true,
                },
                title: t("pages.projectSubscription.fieldSmsOrCallBalance"),
                description: t(
                  "pages.projectSubscription.fieldSmsOrCallBalanceDescription",
                ),
                fieldType: FieldType.USDCents,
                placeholder: "0 USD",
              },
              {
                field: {
                  aiCurrentBalanceInUSDCents: true,
                },
                title: t("pages.projectSubscription.fieldAiBalance"),
                description: t(
                  "pages.projectSubscription.fieldAiBalanceDescription",
                ),
                fieldType: FieldType.USDCents,
                placeholder: "0 USD",
              },
            ],
            modelId: modelId,
          }}
        />

        {showAdjustBalanceModal ? (
          <BasicFormModal
            title={t("pages.projectSubscription.adjustBalanceTitle")}
            description={t(
              "pages.projectSubscription.adjustBalanceDescription",
            )}
            isLoading={isAdjustingBalance}
            submitButtonText={t(
              "pages.projectSubscription.adjustBalanceSubmitButton",
            )}
            onClose={() => {
              setShowAdjustBalanceModal(false);
              setError("");
            }}
            onSubmit={onAdjustBalanceSubmit}
            formProps={{
              id: "adjust-balance-form",
              name: "Adjust Balance",
              // See the note on the extend-trial form: one error, on the form.
              error: error,
              initialValues: {
                balanceType: ProjectBalanceType.SmsOrCall,
                adjustmentType: BalanceAdjustmentType.Add,
                amountInUSD: "",
                reason: "",
              },
              // Which balance and which way, then by how much and why.
              steps: [
                {
                  title: t(
                    "pages.projectSubscription.adjustBalanceStepBalance",
                  ),
                  id: "balance",
                },
                {
                  title: t("pages.projectSubscription.adjustBalanceStepAmount"),
                  id: "amount",
                },
              ],
              fields: [
                {
                  field: {
                    balanceType: true,
                  },
                  title: t("pages.projectSubscription.balanceTypeLabel"),
                  stepId: "balance",
                  description: t(
                    "pages.projectSubscription.balanceTypeDescription",
                  ),
                  required: true,
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownOptions: balanceTypeOptions,
                },
                {
                  field: {
                    adjustmentType: true,
                  },
                  title: t("pages.projectSubscription.adjustmentTypeLabel"),
                  stepId: "balance",
                  description: t(
                    "pages.projectSubscription.adjustmentTypeDescription",
                  ),
                  required: true,
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownOptions: adjustmentTypeOptions,
                },
                {
                  field: {
                    amountInUSD: true,
                  },
                  title: t("pages.projectSubscription.amountLabel"),
                  stepId: "amount",
                  description: t(
                    "pages.projectSubscription.amountDescription",
                    {
                      max: MAX_BALANCE_ADJUSTMENT_IN_USD,
                    },
                  ),
                  required: true,
                  fieldType: FormFieldSchemaType.Number,
                  placeholder: "20",
                },
                {
                  field: {
                    reason: true,
                  },
                  title: t("pages.projectSubscription.reasonLabel"),
                  stepId: "amount",
                  description: t("pages.projectSubscription.reasonDescription"),
                  required: true,
                  fieldType: FormFieldSchemaType.Text,
                  placeholder: t("pages.projectSubscription.reasonPlaceholder"),
                  isPlaceholderTranslated: true,
                },
              ],
            }}
          />
        ) : (
          <></>
        )}

        {showChangePlanModal ? (
          /*
           * The customer's own Change Plan picker (PlanPicker): it opens on
           * the plan the project is on, marked Current plan, offers no
           * trial - a change keeps a running one and never starts another -
           * and shows a project a cloud marketplace bills the monthly
           * prices alone. Keyed on that plan, as the trial form below is on
           * its date, so a project that finishes loading while the dialog is
           * open still opens on its plan.
           *
           * isSubmitting, not isLoading: a refused change keeps the plan
           * the admin picked on screen, with why under it.
           */
          <BasicFormModal
            key={project?.paymentProviderPlanId || "no-plan"}
            title={t("pages.projectSubscription.changePlanTitle")}
            description={t("pages.projectSubscription.changePlanDescription")}
            modalWidth={ModalWidth.Medium}
            isSubmitting={isChangingPlan}
            submitButtonText={t(
              "pages.projectSubscription.changePlanSubmitButton",
            )}
            onClose={() => {
              setShowChangePlanModal(false);
              setError("");
            }}
            onSubmit={onChangePlanSubmit}
            formProps={{
              id: "change-plan-form",
              name: "Change Plan",
              // See the note on the extend-trial form: one error, on the form.
              error: error,
              initialValues: {
                paymentProviderPlanId: project?.paymentProviderPlanId || "",
              },
              fields: [
                {
                  field: {
                    paymentProviderPlanId: true,
                  },
                  title: t("pages.projectSubscription.fieldPlan"),
                  fieldType: FormFieldSchemaType.CustomComponent,
                  // The picker draws "Plan" itself, with the Monthly | Yearly switch beside it.
                  customElementDrawsOwnLabel: true,
                  required: true,
                  customValidation: (
                    values: FormValues<JSONObject>,
                  ): string | null => {
                    return getChangePlanError(
                      String(values["paymentProviderPlanId"] || "").trim(),
                    );
                  },
                  getCustomElement: (
                    _values: FormValues<JSONObject>,
                    props: CustomElementProps,
                  ): ReactElement => {
                    return (
                      <PlanPicker
                        plans={plans}
                        value={(props.initialValue as string) || ""}
                        isPlanChange={true}
                        currentPlanId={
                          project?.paymentProviderPlanId || undefined
                        }
                        periods={
                          project?.billingMarketplace
                            ? [BillingPeriod.Monthly]
                            : undefined
                        }
                        error={props.error}
                        dataTestId="admin-change-plan-picker"
                        onChange={(planId: string) => {
                          props.onChange?.(planId);
                        }}
                      />
                    );
                  },
                },
              ],
            }}
          />
        ) : (
          <></>
        )}

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
