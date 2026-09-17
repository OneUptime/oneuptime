import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import CheckoutForm, {
  getSetupIntentPaymentMethodId,
  SETUP_NOT_COMPLETED_ERROR_MESSAGE,
} from "./BillingPaymentMethodForm";
import { Elements } from "@stripe/react-stripe-js";
import { SetupIntent, SetupIntentResult, Stripe } from "@stripe/stripe-js";
/*
 * The default entrypoint injects a <script src="https://js.stripe.com/v3">
 * the moment the module is imported - not when loadStripe is called. This page
 * is part of the dashboard bundle, so that request went out on every page load
 * of every install, including the self-hosted ones that have billing turned
 * off and the air-gapped ones with no route to Stripe at all. /pure defers the
 * injection to the first loadStripe call, which is guarded below.
 */
import { loadStripe } from "@stripe/stripe-js/pure";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import { Green } from "Common/Types/BrandColors";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Email from "Common/Types/Email";
import Text from "Common/Types/Text";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Modal from "Common/UI/Components/Modal/Modal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  APP_API_URL,
  BILLING_ENABLED,
  BILLING_PUBLIC_KEY,
  getAllEnvVars,
} from "Common/UI/Config";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import BaseAPI from "Common/UI/Utils/API/API";
import UiAnalytics from "Common/UI/Utils/Analytics";
import {
  RevenueEventName,
  RevenueFunnelStage,
} from "Common/Types/Analytics/RevenueEvent";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import BillingPaymentMethod from "Common/Models/DatabaseModels/BillingPaymentMethod";
import Project from "Common/Models/DatabaseModels/Project";
import Reseller from "Common/Models/DatabaseModels/Reseller";
import ResellerPlan from "Common/Models/DatabaseModels/ResellerPlan";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import Countries from "Common/UI/Utils/Countries";
import ObjectID from "Common/Types/ObjectID";
import { Theme, useTheme } from "Common/UI/Utils/Theme";

export type ComponentProps = PageComponentProps;

const Settings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const theme: Theme = useTheme();
  const [isSubscriptionPlanYearly, setIsSubscriptionPlanYearly] =
    useState<boolean>(true);
  const [showPaymentMethodModal, setShowPaymentMethodModal] =
    useState<boolean>(false);
  const [isModalLoading, setIsModalLoading] = useState<boolean>(false);
  const [isModalSubmitButtonLoading, setIsModalSubmitButtonLoading] =
    useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [setupIntent, setSetupIntent] = useState<string>("");
  const [stripe, setStripe] = useState<Stripe | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string | null>(null);

  const [reseller, setReseller] = useState<Reseller | null>(null);

  const [resellerPlan, setResellerPlan] = useState<ResellerPlan | null>(null);

  const [balance, setBalance] = useState<number>(0);

  const [paymentMethodsCount, setPaymentMethodsCount] = useState<number | null>(
    null,
  );
  const [paymentMethodsRefresh, setPaymentMethodsRefresh] = useState<number>(0);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(
    null,
  );
  const [showNoPaymentMethodModal, setShowNoPaymentMethodModal] =
    useState<boolean>(false);

  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);

  const formRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  const currentProjectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectCrudRoute: Route | null = new Project().getCrudApiPath();
  const changePlanApiUrl: URL | undefined =
    currentProjectId && projectCrudRoute
      ? URL.fromString(APP_API_URL.toString())
          .addRoute(projectCrudRoute)
          .addRoute(`/${currentProjectId.toString()}/change-plan`)
      : undefined;

  const fetchPaymentMethodsCount: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        const result: ListResult<BillingPaymentMethod> =
          await ModelAPI.getList<BillingPaymentMethod>({
            modelType: BillingPaymentMethod,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: 1,
            skip: 0,
            select: {
              _id: true,
            },
            sort: {},
          });
        setPaymentMethodsCount(result.count);
      } catch {
        setPaymentMethodsCount(null);
      }
    };

  const countSyncedPaymentMethods: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        // Listing again would replace the row IDs already held by the table.
        const count: number = await ModelAPI.count<BillingPaymentMethod>({
          modelType: BillingPaymentMethod,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
        });
        setPaymentMethodsCount(count);
      } catch {
        setPaymentMethodsCount(null);
      }
    };

  const refreshPaymentMethodsTable: VoidFunction = (): void => {
    /*
     * Let the table re-list itself: listing from here would replace the row
     * IDs the table already holds (see countSyncedPaymentMethods).
     */
    setPaymentMethodsRefresh((value: number) => {
      return value + 1;
    });
  };

  type SetDefaultPaymentMethodFunction = (
    paymentProviderPaymentMethodId: string,
  ) => Promise<void>;

  /*
   * Autopay charges the customer's default payment method. Before this
   * existed a customer had no way to choose it: adding a card never made it
   * the default, so a replacement for a declining card was never charged.
   * The server also clears any card pinned on the subscriptions themselves,
   * which Stripe would otherwise charge ahead of the customer default.
   */
  const setDefaultPaymentMethod: SetDefaultPaymentMethodFunction = async (
    paymentProviderPaymentMethodId: string,
  ): Promise<void> => {
    const response: HTTPResponse<JSONObject> = await BaseAPI.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `/billing-payment-methods/set-default`,
      ),
      data: {
        data: {
          paymentProviderPaymentMethodId: paymentProviderPaymentMethodId,
        },
      },
      headers: ModelAPI.getCommonHeaders(),
    });

    if (response.isFailure()) {
      throw response;
    }
  };

  type PaymentMethodRowActionFunction = (
    item: BillingPaymentMethod,
    onCompleteAction: VoidFunction,
  ) => Promise<void>;

  /*
   * Shared by "Set as Default" and "Re-sync Autopay": both ask the server for
   * the same thing, and the server does the same two things for both - write
   * the customer default, then clear any card pinned on the subscriptions.
   *
   * Failures go to this page's own error modal rather than the table's, so a
   * card added through the form and a card picked here report the same way.
   */
  const makeRowTheDefaultPaymentMethod: PaymentMethodRowActionFunction = async (
    item: BillingPaymentMethod,
    onCompleteAction: VoidFunction,
  ): Promise<void> => {
    try {
      await setDefaultPaymentMethod(
        item.paymentProviderPaymentMethodId as string,
      );
      onCompleteAction();
      refreshPaymentMethodsTable();
    } catch (err) {
      onCompleteAction();
      setPaymentMethodError(BaseAPI.getFriendlyMessage(err));
    }
  };

  type GetNotDefaultMessageFunction = (err: unknown) => string;

  /*
   * Deliberately says "automatic payments could not be switched to it" rather
   * than "it could not be made the default": the server writes the default
   * first and then moves the subscriptions off any card pinned on them, so a
   * failure at the second step leaves the card as the default with autopay
   * still on the old one. Telling the customer nothing happened would send
   * them to do again the thing they just did.
   */
  const getSavedButNotDefaultMessage: GetNotDefaultMessageFunction = (
    err: unknown,
  ): string => {
    return `Your payment method was saved, but automatic payments could not be switched to it. You can try again with "Set as Default" in the payment methods table. Reason: ${BaseAPI.getFriendlyMessage(
      err,
    )}`;
  };

  type CompleteRedirectedSetupFunction = (
    loadedStripe: Stripe | null,
  ) => Promise<void>;

  /*
   * Card setups finish on this page (BillingPaymentMethodForm confirms with
   * redirect: "if_required"), but redirect-based payment methods and some
   * bank authentications leave the page and come back to it with the
   * SetupIntent in the query string. Make that payment method the default
   * too, so every way of adding one behaves the same.
   */
  const completeRedirectedPaymentMethodSetup: CompleteRedirectedSetupFunction =
    async (loadedStripe: Stripe | null): Promise<void> => {
      const setupIntentClientSecret: string | null =
        Navigation.getQueryStringByName("setup_intent_client_secret");

      if (!setupIntentClientSecret) {
        return;
      }

      const redirectStatus: string | null =
        Navigation.getQueryStringByName("redirect_status");

      /*
       * Strip the parameters before doing anything else, so a reload - or a
       * failure below - never replays this and overrides a default the
       * customer picked afterwards.
       */
      Navigation.setQueryString({
        setup_intent: null,
        setup_intent_client_secret: null,
        redirect_status: null,
      });

      if (redirectStatus === "failed") {
        setPaymentMethodError(SETUP_NOT_COMPLETED_ERROR_MESSAGE);
        return;
      }

      if (redirectStatus !== "succeeded" || !loadedStripe) {
        return;
      }

      try {
        const result: SetupIntentResult =
          await loadedStripe.retrieveSetupIntent(setupIntentClientSecret);

        if (result.error) {
          throw new Error(
            result.error.message ||
              "The payment provider could not load your payment method.",
          );
        }

        const setupIntent: SetupIntent | undefined = result.setupIntent;

        // A processing method is not attached to the customer yet.
        if (!setupIntent || setupIntent.status !== "succeeded") {
          return;
        }

        const paymentMethodId: string | null =
          getSetupIntentPaymentMethodId(setupIntent);

        if (!paymentMethodId) {
          return;
        }

        await setDefaultPaymentMethod(paymentMethodId);
      } catch (err) {
        setPaymentMethodError(getSavedButNotDefaultMessage(err));
      }
    };

  useAsyncEffect(async () => {
    let loadedStripe: Stripe | null = null;

    /*
     * Nothing on this page can talk to Stripe when billing is off, so there is
     * no reason to reach for js.stripe.com and hang until it times out.
     */
    if (BILLING_ENABLED) {
      setIsModalLoading(true);
      loadedStripe = await loadStripe(BILLING_PUBLIC_KEY);
      setStripe(loadedStripe);
      setIsModalLoading(false);
    }

    setIsLoading(true);

    if (BILLING_ENABLED) {
      // Before the table first lists, so it already shows the new default.
      await completeRedirectedPaymentMethodSetup(loadedStripe);
    }

    try {
      await fetchPaymentMethodsCount();

      const project: Project | null = await ModelAPI.getItem<Project>({
        modelType: Project,
        id: ProjectUtil.getCurrentProjectId()!,
        select: {
          paymentProviderPlanId: true,
          reseller: {
            name: true,
            description: true,
            _id: true,
            changePlanLink: true,
          },
          resellerPlan: {
            name: true,
            description: true,
            _id: true,
            monitorLimit: true,
            teamMemberLimit: true,
            planType: true,
            otherFeatures: true,
          },
        },
      });

      if (project?.paymentProviderPlanId) {
        setCurrentPlanId(project.paymentProviderPlanId);
      }

      if (project?.reseller) {
        setReseller(project.reseller);
      }

      if (project?.resellerPlan) {
        setResellerPlan(project.resellerPlan);
      }

      // Fetch customer balance
      try {
        const balanceResponse: HTTPResponse<JSONObject> =
          await BaseAPI.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/billing/customer-balance`,
            ),
            headers: ModelAPI.getCommonHeaders(), // headers
          });
        const balanceData: JSONObject = balanceResponse.data;
        setBalance(balanceData["balance"] as number);
      } catch {
        // Balance might not be available, set to 0
        setBalance(0);
      }
    } catch (err) {
      setError(BaseAPI.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, []);

  type GetPlanMonthlyAmountFunction = (planId: string | null) => number | null;

  // Per-month amount, or null when unknown (custom pricing / unknown plan).
  const getPlanMonthlyAmountInUSD: GetPlanMonthlyAmountFunction = (
    planId: string | null,
  ): number | null => {
    if (!planId) {
      return null;
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(planId, getAllEnvVars());

    if (!plan || plan.isCustomPricing()) {
      return null;
    }

    return SubscriptionPlan.isYearlyPlan(planId, getAllEnvVars())
      ? plan.getYearlySubscriptionAmountInUSD()
      : plan.getMonthlySubscriptionAmountInUSD();
  };

  /*
   * The paid-conversion events for ad platforms. The change-plan API returns
   * an empty response, so refetch the project's plan and diff against the
   * plan we loaded when the page opened. Events reach both PostHog and the
   * GTM dataLayer (where Google Ads conversion tags can trigger on them).
   *
   * Upgrade/downgrade is classified by plan tier (getPlanOrder), not price:
   * monthly<->yearly switches of the same tier and custom-pricing plans
   * (amount sentinel -1) would misclassify on price comparison. The value
   * matches the server event: per-month amount times subscription seats.
   */
  const capturePlanChangeEvents: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        const project: Project | null = await ModelAPI.getItem<Project>({
          modelType: Project,
          id: ProjectUtil.getCurrentProjectId()!,
          select: {
            paymentProviderPlanId: true,
            paymentProviderSubscriptionSeats: true,
          },
        });

        const newPlanId: string | null = project?.paymentProviderPlanId || null;

        if (!newPlanId || newPlanId === currentPlanId) {
          return;
        }

        const newPlan: SubscriptionPlan | undefined =
          SubscriptionPlan.getSubscriptionPlanById(newPlanId, getAllEnvVars());

        const oldPlan: SubscriptionPlan | undefined = currentPlanId
          ? SubscriptionPlan.getSubscriptionPlanById(
              currentPlanId,
              getAllEnvVars(),
            )
          : undefined;

        const seats: number = project?.paymentProviderSubscriptionSeats || 1;

        const oldMonthlyAmountInUSD: number | null =
          getPlanMonthlyAmountInUSD(currentPlanId);
        const newMonthlyAmountInUSD: number | null =
          getPlanMonthlyAmountInUSD(newPlanId);

        const oldPlanOrder: number | null = oldPlan
          ? oldPlan.getPlanOrder()
          : null;
        const newPlanOrder: number | null = newPlan
          ? newPlan.getPlanOrder()
          : null;

        const newPlanIsPaid: boolean = Boolean(
          newPlan?.isCustomPricing() ||
            (newMonthlyAmountInUSD !== null && newMonthlyAmountInUSD > 0),
        );

        UiAnalytics.capture("dashboard/billing/plan-changed", {
          old_plan: oldPlan?.getName() || "",
          new_plan: newPlan?.getName() || "",
          seats: seats,
          is_interval_change:
            oldPlanOrder !== null &&
            newPlanOrder !== null &&
            oldPlanOrder === newPlanOrder,
        });

        if (
          oldPlanOrder !== null &&
          newPlanOrder !== null &&
          newPlanOrder > oldPlanOrder
        ) {
          // GA4/Google Ads friendly conversion event.
          UiAnalytics.captureRevenueEvent(
            RevenueEventName.SubscriptionUpgraded,
            {
              funnel_stage: RevenueFunnelStage.Revenue,
              plan: newPlan?.getName() || "",
              ...(newMonthlyAmountInUSD !== null
                ? {
                    value: newMonthlyAmountInUSD * seats,
                    currency: "USD",
                  }
                : {}),
              is_paid_conversion: oldMonthlyAmountInUSD === 0 && newPlanIsPaid,
            },
          );
        } else if (
          oldPlanOrder !== null &&
          newPlanOrder !== null &&
          newPlanOrder < oldPlanOrder
        ) {
          UiAnalytics.captureRevenueEvent(
            RevenueEventName.SubscriptionDowngraded,
            {
              funnel_stage: RevenueFunnelStage.Revenue,
              plan: newPlan?.getName() || "",
            },
          );
        }

        setCurrentPlanId(newPlanId);
      } catch {
        // Analytics must never break the billing page.
      }
    };

  const fetchSetupIntent: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsModalLoading(true);
      setIsModalSubmitButtonLoading(false);
      setModalError(null);
      setSetupIntent("");

      const response: HTTPResponse<JSONObject> = await BaseAPI.post<JSONObject>(
        {
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/billing-payment-methods/setup`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        },
      );
      const data: JSONObject = response.data;

      setSetupIntent(data["setupIntent"] as string);
      setIsModalLoading(false);
    } catch (err) {
      setModalError(BaseAPI.getFriendlyMessage(err));
      setIsModalLoading(false);
    }
  };

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

  return (
    <Fragment>
      {isLoading ? <PageLoader isVisible={true} /> : <></>}

      {error ? <ErrorMessage message={error} /> : <></>}

      {!isLoading && !error ? (
        <div>
          {!reseller && (
            <CardModelDetail<Project>
              name="Plan Details"
              cardProps={{
                title: "Current Plan",
                description:
                  "Your subscription plan controls included features. Pay as you go usage is billed separately.",
              }}
              isEditable={paymentMethodsCount !== null}
              editButtonText={"Change Plan"}
              onBeforeEdit={() => {
                if (paymentMethodsCount === 0) {
                  setShowNoPaymentMethodModal(true);
                  return false;
                }
                return true;
              }}
              createOrUpdateApiUrl={changePlanApiUrl}
              onSaveSuccess={() => {
                capturePlanChangeEvents().catch(() => {
                  // Analytics must never break the billing page.
                });
              }}
              formFields={[
                {
                  field: {
                    paymentProviderPlanId: true,
                  },
                  validation: {
                    minLength: 6,
                  },
                  fieldType: FormFieldSchemaType.OptionChooserButton,
                  radioButtonOptions: SubscriptionPlan.getSubscriptionPlans(
                    getAllEnvVars(),
                  ).map((plan: SubscriptionPlan): RadioButton => {
                    let description: string = plan.isCustomPricing()
                      ? `Our sales team will contact you soon.`
                      : `Billed ${
                          isSubscriptionPlanYearly ? "yearly" : "monthly"
                        }. ${
                          plan.getTrialPeriod() > 0
                            ? `Free ${plan.getTrialPeriod()} days trial.`
                            : ""
                        }`;

                    if (
                      isSubscriptionPlanYearly &&
                      plan.getYearlySubscriptionAmountInUSD() === 0
                    ) {
                      description =
                        "$0 subscription. Paid features are billed separately when pay as you go is enabled.";
                    }

                    if (
                      !isSubscriptionPlanYearly &&
                      plan.getMonthlySubscriptionAmountInUSD() === 0
                    ) {
                      description =
                        "$0 subscription. Paid features are billed separately when pay as you go is enabled.";
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
                          : "$" +
                            plan.getMonthlySubscriptionAmountInUSD().toString(),
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
                  footerElement: getFooter(),
                },
              ]}
              modelDetailProps={{
                modelType: Project,
                id: "model-detail-project",
                fields: [
                  {
                    field: {
                      paymentProviderPlanId: true,
                    },
                    title: "Current Plan",
                    getElement: (item: Project): ReactElement => {
                      const plan: SubscriptionPlan | undefined =
                        SubscriptionPlan.getSubscriptionPlanById(
                          item["paymentProviderPlanId"] as string,
                          getAllEnvVars(),
                        );

                      if (!plan) {
                        return <p>No plan selected for this project</p>;
                      }

                      const isYearlyPlan: boolean =
                        SubscriptionPlan.isYearlyPlan(
                          item["paymentProviderPlanId"] as string,
                          getAllEnvVars(),
                        );

                      let description: string = plan.isCustomPricing()
                        ? `Custom Pricing based on your needs. Our sales team will contact you shortly.`
                        : `$${
                            isYearlyPlan
                              ? plan.getYearlySubscriptionAmountInUSD()
                              : plan.getMonthlySubscriptionAmountInUSD()
                          } / month per user. Billed ${
                            isYearlyPlan ? "yearly" : "monthly"
                          }.`;

                      if (
                        isYearlyPlan &&
                        plan.getYearlySubscriptionAmountInUSD() === 0
                      ) {
                        description =
                          "$0 subscription. Paid features are billed separately when pay as you go is enabled.";
                      }

                      if (
                        !isYearlyPlan &&
                        plan.getMonthlySubscriptionAmountInUSD() === 0
                      ) {
                        description =
                          "$0 subscription. Paid features are billed separately when pay as you go is enabled.";
                      }

                      return (
                        <div>
                          <div className="bold">{plan.getName()}</div>
                          <div>{description}</div>
                        </div>
                      );
                    },
                  },
                  {
                    field: {
                      paymentProviderSubscriptionSeats: true,
                    },
                    title: "Seats",
                    description:
                      "These are current users in this project. To change this you need to add or remove them.",
                    getElement: (item: Project): ReactElement => {
                      return (
                        <div>
                          <div className="bold">
                            {item["paymentProviderSubscriptionSeats"]} users in
                            this project.
                          </div>
                        </div>
                      );
                    },
                  },
                ],
                modelId: ProjectUtil.getCurrentProjectId()!,
              }}
            />
          )}

          {reseller && (
            <Card
              title={`You have purchased this plan from ${reseller.name}`}
              description={`If you would like to change the plan, please contact ${reseller.name} at ${reseller.description}`}
              buttons={
                reseller.changePlanLink
                  ? [
                      {
                        title: `Change Plan`,
                        onClick: () => {
                          Navigation.navigate(reseller.changePlanLink!);
                        },
                        icon: IconProp.Edit,
                      },
                    ]
                  : []
              }
            >
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-500">
                  The plan you purchased from {reseller.name} is{" "}
                  {resellerPlan?.name}
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-500 mt-10">
                    With the following features:
                  </span>

                  <ul className="space-y-1 mt-2">
                    <li className="text-sm font-medium text-gray-500">
                      {" "}
                      <span className="text-gray-700 flex">
                        <Icon
                          icon={IconProp.CheckCircle}
                          className="h-5 w-5 mr-1"
                        />{" "}
                        {resellerPlan?.monitorLimit} Monitors
                      </span>
                    </li>
                    <li className="text-sm font-medium text-gray-500">
                      {" "}
                      <span className="text-gray-700 flex">
                        <Icon
                          icon={IconProp.CheckCircle}
                          className="h-5 w-5 mr-1"
                        />{" "}
                        {resellerPlan?.teamMemberLimit} Team Members
                      </span>
                    </li>

                    {resellerPlan?.otherFeatures ? (
                      resellerPlan.otherFeatures
                        .split(",")
                        .map((item: string, i: number) => {
                          return (
                            <li
                              key={i}
                              className="text-sm font-medium text-gray-500"
                            >
                              {" "}
                              <span className="text-gray-700 flex">
                                <Icon
                                  icon={IconProp.CheckCircle}
                                  className="h-5 w-5 mr-1"
                                />{" "}
                                {item}
                              </span>
                            </li>
                          );
                        })
                    ) : (
                      <></>
                    )}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          <ModelTable<BillingPaymentMethod>
            modelType={BillingPaymentMethod}
            id="payment-methods-table"
            userPreferencesKey="billing-payment-methods-table"
            saveFilterProps={{
              tableId: "settings-payment-methods-table",
            }}
            isDeleteable={true}
            isEditable={false}
            isCreateable={false}
            isViewable={false}
            refreshToggle={paymentMethodsRefresh.toString()}
            onItemDeleted={countSyncedPaymentMethods}
            // Table filters can hide saved methods; plan controls need the unfiltered count.
            onFetchSuccess={countSyncedPaymentMethods}
            name="Settings > Billing > Add Payment Method"
            selectMoreFields={{
              isDefault: true,
              paymentProviderPaymentMethodId: true,
            }}
            actionButtons={[
              {
                title: "Set as Default",
                buttonStyleType: ButtonStyleType.NORMAL,
                icon: IconProp.Check,
                isVisible: (item: BillingPaymentMethod): boolean => {
                  return (
                    !item.isDefault &&
                    Boolean(item.paymentProviderPaymentMethodId)
                  );
                },
                onClick: makeRowTheDefaultPaymentMethod,
              },
              {
                /*
                 * The card that already is the default needs this too, and it
                 * is the row where it is easiest to leave out.
                 *
                 * isDefault says only that the card is the customer's default
                 * at Stripe. A subscription carrying its own pinned card is
                 * charged ahead of that default, and that is the incident
                 * state: the right card is the customer default, every
                 * renewal still goes to the card it replaced. This route
                 * clears those pins, and it is idempotent - writing the same
                 * default again changes nothing. Without a button here the
                 * only way to reach the repair would be to make some other
                 * card the default, or to delete one.
                 */
                title: "Re-sync Autopay",
                buttonStyleType: ButtonStyleType.NORMAL,
                icon: IconProp.Refresh,
                isVisible: (item: BillingPaymentMethod): boolean => {
                  return (
                    Boolean(item.isDefault) &&
                    Boolean(item.paymentProviderPaymentMethodId)
                  );
                },
                onClick: makeRowTheDefaultPaymentMethod,
              },
            ]}
            cardProps={{
              buttons: [
                {
                  title: "Add Payment Method",
                  icon: IconProp.Add,
                  onClick: async () => {
                    setShowPaymentMethodModal(true);
                    await fetchSetupIntent();
                  },
                  buttonStyle: ButtonStyleType.NORMAL,
                },
              ],
              title: "Payment Methods",
              description:
                "Invoices are charged automatically to the default payment method. A payment method you add becomes the default. Adding a payment method enables paid usage. It does not upgrade your subscription plan.",
            }}
            noItemsMessage={"No payment methods found."}
            query={{
              projectId: ProjectUtil.getCurrentProjectId()!,
            }}
            showRefreshButton={true}
            filters={[
              {
                field: {
                  paymentMethodType: true,
                },
                title: "Payment Method Type",
                type: FieldType.Text,
              },
              {
                field: {
                  last4Digits: true,
                },
                title: "Number",
                type: FieldType.Text,
              },
            ]}
            columns={[
              {
                field: {
                  paymentMethodType: true,
                },
                title: "Payment Method Type",
                type: FieldType.Text,

                getElement: (item: BillingPaymentMethod) => {
                  return (
                    <span>{`${Text.uppercaseFirstLetter(
                      item.paymentMethodType as string,
                    )}`}</span>
                  );
                },
              },
              {
                field: {
                  last4Digits: true,
                },
                title: "Number",
                type: FieldType.Text,

                getElement: (item: BillingPaymentMethod) => {
                  return (
                    <span className="inline-flex items-center gap-2">
                      <span>{`*****${item["last4Digits"]}`}</span>
                      {item.isDefault ? (
                        <Pill
                          text="Default"
                          color={Green}
                          /*
                           * Deliberately not a promise that autopay charges
                           * this card: a subscription can still carry a card
                           * of its own, which the payment provider charges
                           * first. "Re-sync Autopay" on this row clears that.
                           */
                          tooltip="New invoices are charged to this payment method. If a renewal still charges an older card, use Re-sync Autopay."
                        />
                      ) : (
                        <></>
                      )}
                    </span>
                  );
                },
              },
            ]}
          />

          {showNoPaymentMethodModal ? (
            <ConfirmModal
              title={`Add a Payment Method`}
              description={
                "You need a payment method before changing your subscription plan. Adding one also enables pay as you go usage at the published rates."
              }
              submitButtonText={"Add Payment Method"}
              onSubmit={async () => {
                setShowNoPaymentMethodModal(false);
                setShowPaymentMethodModal(true);
                await fetchSetupIntent();
              }}
              onClose={() => {
                setShowNoPaymentMethodModal(false);
              }}
            />
          ) : (
            <></>
          )}

          {paymentMethodError ? (
            <ConfirmModal
              title={`Something is not quite right...`}
              description={paymentMethodError}
              submitButtonText={"Close"}
              onSubmit={() => {
                setPaymentMethodError(null);
              }}
              submitButtonType={ButtonStyleType.NORMAL}
            />
          ) : (
            <></>
          )}

          {showPaymentMethodModal ? (
            <Modal
              title={`Add Payment Method`}
              onSubmit={async () => {
                if (!formRef.current) {
                  return;
                }
                setModalError(null);
                setIsModalSubmitButtonLoading(true);
                formRef.current.click();
              }}
              isLoading={isModalSubmitButtonLoading}
              disableSubmitButton={isModalLoading || !setupIntent || !stripe}
              onClose={() => {
                setShowPaymentMethodModal(false);
              }}
              submitButtonText={`Save payment method`}
              error={modalError || ""}
              isBodyLoading={isModalLoading}
              submitButtonType={ButtonType.Submit}
            >
              {setupIntent && stripe ? (
                <Elements
                  stripe={stripe}
                  options={{
                    // passing the client secret obtained in step 3
                    clientSecret: setupIntent,
                    appearance: {
                      theme: theme === Theme.Dark ? "night" : "stripe",
                      variables:
                        theme === Theme.Dark
                          ? {
                              colorBackground: "#111827",
                              colorText: "#f8fafc",
                              colorTextSecondary: "#cbd5e1",
                              colorPrimary: "#818cf8",
                              colorDanger: "#f87171",
                              colorIcon: "#cbd5e1",
                              colorIconTab: "#94a3b8",
                              colorIconTabSelected: "#a5b4fc",
                              colorIconTabHover: "#e2e8f0",
                            }
                          : {},
                    },
                  }}
                >
                  <CheckoutForm
                    onSuccess={async (paymentMethodId: string | null) => {
                      if (paymentMethodId) {
                        /*
                         * A customer adds a card because they want it charged
                         * - typically replacing one that is declining. Make
                         * it the default before re-listing so the table shows
                         * it as such.
                         */
                        try {
                          await setDefaultPaymentMethod(paymentMethodId);
                        } catch (err) {
                          // The card is saved either way; say what did not happen.
                          setPaymentMethodError(
                            getSavedButNotDefaultMessage(err),
                          );
                        }
                      }
                      setIsModalSubmitButtonLoading(false);
                      await fetchPaymentMethodsCount();
                      refreshPaymentMethodsTable();
                      setShowPaymentMethodModal(false);
                    }}
                    onError={(errorMessage: string) => {
                      setModalError(errorMessage);
                      setIsModalSubmitButtonLoading(false);
                    }}
                    formRef={formRef}
                  />
                </Elements>
              ) : (
                <></>
              )}
              {!modalError && !setupIntent && !stripe ? (
                <p>Loading...</p>
              ) : (
                <></>
              )}
            </Modal>
          ) : (
            <></>
          )}

          <CardModelDetail<Project>
            name="Business Details"
            cardProps={{
              title: "Business Details / Billing Address",
              description:
                "Enter your business legal name, address and optional tax info. This will appear on your invoices.",
            }}
            isEditable={true}
            editButtonText={"Update"}
            formFields={[
              {
                field: {
                  businessDetails: true,
                },
                title: "Business Details / Billing Address",
                description:
                  "This information will appear on invoices. Include company legal name, address, and tax / VAT ID if applicable.",
                required: false,
                fieldType: FormFieldSchemaType.LongText,
                validation: {
                  maxLength: 10000,
                },
              },
              {
                field: {
                  businessDetailsCountry: true,
                },
                title: "Country",
                description: "Required by Stripe. Select your billing country.",
                required: false,
                placeholder: "Select Country",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: Countries,
              },
              {
                field: {
                  financeAccountingEmail: true,
                },
                title: "Finance / Accounting Email",
                description:
                  "Invoices, receipts and billing notifications will be sent here (optional). Separate multiple emails with a comma.",
                required: false,
                placeholder:
                  "finance@yourcompany.com, accounting@yourcompany.com",
                fieldType: FormFieldSchemaType.Text,
                validation: {
                  minLength: 3,
                  maxLength: 500,
                },
                customValidation: (
                  values: FormValues<Project>,
                ): string | null => {
                  const raw: string =
                    typeof values.financeAccountingEmail === "string"
                      ? values.financeAccountingEmail
                      : "";
                  if (!raw.trim()) {
                    return null;
                  }
                  if (!Email.isValidList(raw)) {
                    return "Enter one or more valid emails separated by a comma.";
                  }
                  return null;
                },
              },
              {
                field: {
                  sendInvoicesByEmail: true,
                },
                title: "Send Invoices by Email",
                description:
                  "When enabled, invoices will be automatically sent to the finance/accounting email when they are generated.",
                required: false,
                fieldType: FormFieldSchemaType.Toggle,
              },
            ]}
            modelDetailProps={{
              modelType: Project,
              id: "model-detail-project-business-details",
              fields: [
                {
                  field: {
                    businessDetails: true,
                  },
                  title: "Business Details / Billing Address",
                  placeholder: "No business details added yet.",
                  fieldType: FieldType.LongText,
                },
                {
                  field: {
                    businessDetailsCountry: true,
                  },
                  title: "Country",
                  placeholder: "No country details added yet.",
                  fieldType: FieldType.Text,
                },
                {
                  field: {
                    financeAccountingEmail: true,
                  },
                  title: "Finance / Accounting Email",
                  placeholder: "No finance / accounting email added yet.",
                  fieldType: FieldType.Text,
                },
                {
                  field: {
                    sendInvoicesByEmail: true,
                  },
                  title: "Send Invoices by Email",
                  placeholder: "Disabled",
                  fieldType: FieldType.Boolean,
                },
              ],
              modelId: ProjectUtil.getCurrentProjectId()!,
            }}
          />

          {balance < 0 && (
            <Card
              title="Customer Balance"
              description={`Your current customer balance is $${balance * -1}. This balance will be applied to your next invoice.`}
            />
          )}

          {!reseller && (
            <Card
              title={`Cancel Plan`}
              description={`If you would like to cancel the plan, you need to delete the project.`}
              buttons={[
                {
                  title: `Delete Project`,
                  buttonStyle: ButtonStyleType.DANGER,
                  onClick: () => {
                    Navigation.navigate(
                      RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_DANGERZONE] as Route,
                      ),
                    );
                  },
                  icon: IconProp.Close,
                },
              ]}
            />
          )}

          {reseller && (
            <Card
              title={`Cancel Plan`}
              description={`If you would like to cancel the plan or delete the project, please contact ${reseller.name} at ${reseller.description}`}
            />
          )}
        </div>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default Settings;
