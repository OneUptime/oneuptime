import PageComponentProps from "../PageComponentProps";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { Green, Yellow } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Text from "Common/Types/Text";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, BILLING_PUBLIC_KEY } from "Common/UI/Config";
import BaseAPI from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import BillingInvoice, {
  InvoiceStatus,
} from "Common/Models/DatabaseModels/BillingInvoice";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ProjectUtil from "Common/UI/Utils/Project";
import Project from "Common/Models/DatabaseModels/Project";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import {
  PaymentIntentResult,
  Stripe,
  StripeError,
  loadStripe,
} from "@stripe/stripe-js";
import BillingPaymentMethod from "Common/Models/DatabaseModels/BillingPaymentMethod";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ListResult from "Common/Types/BaseDatabase/ListResult";

export type ComponentProps = PageComponentProps;

const Settings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  type PayInvoiceFunction = (
    customerId: string,
    invoiceId: string,
  ) => Promise<void>;

  const payInvoice: PayInvoiceFunction = async (
    customerId: string,
    invoiceId: string,
  ): Promise<void> => {
    try {
      setIsLoading(true);

      const result: HTTPResponse<JSONObject> = await BaseAPI.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `/billing-invoices/pay`,
        ),
        data: {
          data: {
            paymentProviderInvoiceId: invoiceId,
            paymentProviderCustomerId: customerId,
          },
        },
        headers: ModelAPI.getCommonHeaders(),
      });

      if (result.isFailure()) {
        throw result;
      }

      if (result.jsonData && (result.jsonData as JSONObject)["clientSecret"]) {
        // needs more authentication to pay the invoice with the payment intent.
        const clientSecret: string = (result.jsonData as JSONObject)[
          "clientSecret"
        ] as string;
        const stripe: Stripe | null = await loadStripe(BILLING_PUBLIC_KEY);

        if (!stripe) {
          setError("Payment provider cannot be loaded. Please try again later");
          return;
        }

        if (!clientSecret) {
          setError("Client secret is not available. Please try again later");
          return;
        }

        // get payment methods.
        const paymentMethodsResult: ListResult<BillingPaymentMethod> =
          await ModelAPI.getList({
            modelType: BillingPaymentMethod,
            select: {
              _id: true,
              paymentProviderPaymentMethodId: true,
              paymentProviderCustomerId: true,
              isDefault: true,
            },
            query: {
              paymentProviderCustomerId: customerId,
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        if (!paymentMethodsResult || paymentMethodsResult.data.length === 0) {
          setError(
            "Payment methods not found. Please add one in Project Settings -> Billing.",
          );
          return;
        }

        const paymentIntentResult: PaymentIntentResult =
          await stripe.confirmCardPayment(clientSecret || "", {
            payment_method:
              paymentMethodsResult.data[0]!.paymentProviderPaymentMethodId ||
              "",
          });

        if (paymentIntentResult.error) {
          // Display error.message in your UI.
          setError(
            (paymentIntentResult.error as StripeError).message ||
              "Something is not quite right. Please try again",
          );
          return;
        }
      }

      Navigation.reload();
    } catch (err) {
      setError(BaseAPI.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  return (
    <Fragment>
      {isLoading ? <ComponentLoader /> : <></>}

      {!isLoading ? (
        <ModelTable<BillingInvoice>
          modelType={BillingInvoice}
          id="invoices-table"
          userPreferencesKey="billing-invoices-table"
          isDeleteable={false}
          name="Settings > Billing > Invoices"
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          cardProps={{
            title: "Invoices",
            description: "Here is a list of invoices for this project.",
          }}
          noItemsMessage={"No invoices so far."}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          showRefreshButton={true}
          selectMoreFields={{
            currencyCode: true,
            paymentProviderCustomerId: true,
            paymentProviderInvoiceId: true,
          }}
          onFetchSuccess={async () => {
            if (ProjectUtil.isSubscriptionInactive()) {
              // fetch project and check subscription again.
              const project: Project | null = await ModelAPI.getItem({
                modelType: Project,
                id: ProjectUtil.getCurrentProjectId()!,
                select: {
                  paymentProviderMeteredSubscriptionStatus: true,
                  paymentProviderSubscriptionStatus: true,
                },
              });

              if (project) {
                const isSubscriptionInactive: boolean =
                  ProjectUtil.setIsSubscriptionInactiveOrOverdue({
                    paymentProviderMeteredSubscriptionStatus:
                      project.paymentProviderMeteredSubscriptionStatus ||
                      SubscriptionStatus.Active,
                    paymentProviderSubscriptionStatus:
                      project.paymentProviderSubscriptionStatus ||
                      SubscriptionStatus.Active,
                  });

                if (!isSubscriptionInactive) {
                  // if subscription is active then reload the page.
                  Navigation.reload();
                }
              }
            }
          }}
          filters={[
            {
              field: {
                invoiceNumber: true,
              },
              title: "Invoice ID",
              type: FieldType.Text,
            },
            {
              field: {
                amount: true,
              },
              title: "Amount",
              type: FieldType.Text,
            },
            {
              field: {
                status: true,
              },
              title: "Invoice Status",
              type: FieldType.Dropdown,
              filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
                InvoiceStatus,
              ).map((option: DropdownOption) => {
                return {
                  value: option.value,
                  label: Text.uppercaseFirstLetter(
                    (option.value as string) || "Undefined",
                  ),
                };
              }),
            },
          ]}
          columns={[
            {
              field: {
                invoiceNumber: true,
              },
              title: "Invoice Number",
              type: FieldType.Text,
            },
            {
              field: {
                invoiceDate: true,
              },
              title: "Invoice Date",
              type: FieldType.Date,
            },
            {
              field: {
                amount: true,
              },
              title: "Amount",
              type: FieldType.Text,

              getElement: (item: BillingInvoice) => {
                return (
                  <span>{`${(item["amount"] as number) / 100} ${item[
                    "currencyCode"
                  ]
                    ?.toString()
                    .toUpperCase()}`}</span>
                );
              },
            },
            {
              field: {
                status: true,
              },
              title: "Invoice Status",
              type: FieldType.Text,

              getElement: (item: BillingInvoice) => {
                if (item["status"] === InvoiceStatus.Paid) {
                  return (
                    <Pill
                      text={Text.uppercaseFirstLetter(item["status"] as string)}
                      color={Green}
                    />
                  );
                }
                return (
                  <Pill
                    text={Text.uppercaseFirstLetter(item["status"] as string)}
                    color={Yellow}
                  />
                );
              },
            },
            {
              field: {
                downloadableLink: true,
              },
              title: "Actions",
              type: FieldType.Text,

              getElement: (item: BillingInvoice) => {
                return (
                  <div>
                    {item["downloadableLink"] ? (
                      <Button
                        icon={IconProp.Download}
                        onClick={() => {
                          Navigation.navigate(item["downloadableLink"] as URL);
                        }}
                        title="Download"
                      />
                    ) : (
                      <></>
                    )}

                    {item["status"] !== InvoiceStatus.Paid &&
                    item["status"] !== InvoiceStatus.Draft &&
                    item["status"] !== InvoiceStatus.Void &&
                    item["status"] !== InvoiceStatus.Deleted ? (
                      <Button
                        icon={IconProp.Billing}
                        onClick={async () => {
                          await payInvoice(
                            item["paymentProviderCustomerId"] as string,
                            item["paymentProviderInvoiceId"] as string,
                          );
                        }}
                        title="Pay Invoice"
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      ) : (
        <></>
      )}

      {error ? (
        <ConfirmModal
          title={`Something is not quite right...`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            setError("");
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default Settings;
