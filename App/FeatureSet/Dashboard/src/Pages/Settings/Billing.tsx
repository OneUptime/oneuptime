import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import CheckoutForm from "./BillingPaymentMethodForm";
import { Elements } from "@stripe/react-stripe-js";
import { Stripe, loadStripe } from "@stripe/stripe-js";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Text from "Common/Types/Text";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Modal from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
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
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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

export type ComponentProps = PageComponentProps;

const Settings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
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

  const formRef: any = useRef<any>(null);

  const currentProjectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectCrudRoute: Route | null = new Project().getCrudApiPath();
  const changePlanApiUrl: URL | undefined =
    currentProjectId && projectCrudRoute
      ? URL.fromString(APP_API_URL.toString())
          .addRoute(projectCrudRoute)
          .addRoute(`/${currentProjectId.toString()}/change-plan`)
      : undefined;

  useAsyncEffect(async () => {
    setIsModalLoading(true);
    setStripe(await loadStripe(BILLING_PUBLIC_KEY));
    setIsModalLoading(false);

    setIsLoading(true);

    try {
      const project: Project | null = await ModelAPI.getItem<Project>({
        modelType: Project,
        id: ProjectUtil.getCurrentProjectId()!,
        select: {
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

  const fetchSetupIntent: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsModalLoading(true);

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
                description: "Here is the plan this project is subscribed to.",
              }}
              isEditable={true}
              editButtonText={"Change Plan"}
              createOrUpdateApiUrl={changePlanApiUrl}
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
                        description = "This plan is free, forever. ";
                      }

                      if (
                        !isYearlyPlan &&
                        plan.getMonthlySubscriptionAmountInUSD() === 0
                      ) {
                        description = "This plan is free, forever. ";
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
            isDeleteable={true}
            isEditable={false}
            isCreateable={false}
            isViewable={false}
            name="Settings > Billing > Add Payment Method"
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
                "Here is a list of payment methods attached to this project.",
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
                  return <span>{`*****${item["last4Digits"]}`}</span>;
                },
              },
            ]}
          />

          {showPaymentMethodModal ? (
            <Modal
              title={`Add Payment Method`}
              onSubmit={async () => {
                setIsModalSubmitButtonLoading(true);
                formRef.current.click();
              }}
              isLoading={isModalSubmitButtonLoading}
              onClose={() => {
                setShowPaymentMethodModal(false);
              }}
              submitButtonText={`Save`}
              error={modalError || ""}
              isBodyLoading={isModalLoading}
              submitButtonType={ButtonType.Submit}
            >
              {setupIntent && !modalError && stripe ? (
                <Elements
                  stripe={stripe}
                  options={{
                    // passing the client secret obtained in step 3
                    clientSecret: setupIntent,
                  }}
                >
                  <CheckoutForm
                    onSuccess={() => {
                      setIsModalSubmitButtonLoading(false);
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
                  "Invoices, receipts and billing notifications will be sent here (optional).",
                required: false,
                placeholder: "finance@yourcompany.com",
                fieldType: FormFieldSchemaType.Email,
                validation: {
                  minLength: 3,
                  maxLength: 200,
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
                  fieldType: FieldType.Email,
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
