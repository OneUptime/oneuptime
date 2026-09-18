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
import { PaymentIntentResult, Stripe, StripeError } from "@stripe/stripe-js";
/*
 * /pure, not the default entrypoint - see Billing.tsx. Importing the default
 * one fetches https://js.stripe.com/v3 at import time, which on an air-gapped
 * install is a request that never comes back.
 */
import { loadStripe } from "@stripe/stripe-js/pure";

export type ComponentProps = PageComponentProps;

/*
 * Some card debits are confirmed by the bank a day or more after they are
 * made (India e-mandate cards sit in "processing" until the pre-debit window
 * passes). Customers who saw an error here kept pressing Pay Invoice.
 */
const PAYMENT_PROCESSING_MESSAGE: string =
  "Your bank is still processing a payment for this invoice. Some banks (for example cards issued in India) take up to 2 days to confirm recurring card payments. You do not need to pay again - the invoice will update automatically once the bank confirms.";

const Settings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPaymentProcessing, setIsPaymentProcessing] =
    useState<boolean>(false);

  type PayInvoiceFunction = (
    customerId: string,
    invoiceId: string,
  ) => Promise<void>;

  const payInvoice: PayInvoiceFunction = async (
    customerId: string,
    invoiceId: string,
  ): Promise<void> => {
    /*
     * The table is hidden while loading. Every way out of this function has
     * to bring it back, except a reload, which replaces the page anyway.
     */
    let isReloading: boolean = false;

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

      const responseData: JSONObject = (result.jsonData as JSONObject) || {};

      if (responseData["paymentProcessing"]) {
        /*
         * A payment for this invoice is already with the bank. Paying again
         * would be refused, so there is nothing for the customer to do but
         * wait - which is not an error.
         */
        setIsPaymentProcessing(true);
        return;
      }

      if (responseData["clientSecret"]) {
        // needs more authentication to pay the invoice with the payment intent.
        const clientSecret: string = responseData["clientSecret"] as string;

        const stripe: Stripe | null = await loadStripe(BILLING_PUBLIC_KEY);

        if (!stripe) {
          setError("Payment provider cannot be loaded. Please try again later");
          return;
        }

        /*
         * No payment_method override: the PaymentIntent already carries the
         * card the server charged. Swapping in another card here confirmed
         * the invoice against whichever saved card happened to be listed
         * first, not the one the customer chose as default.
         */
        const paymentIntentResult: PaymentIntentResult =
          await stripe.confirmCardPayment(clientSecret);

        if (paymentIntentResult.error) {
          setError(
            (paymentIntentResult.error as StripeError).message ||
              "Something is not quite right. Please try again",
          );
          return;
        }

        if (paymentIntentResult.paymentIntent?.status === "processing") {
          setIsPaymentProcessing(true);
          return;
        }
      }

      isReloading = true;
      Navigation.reload();
    } catch (err) {
      setError(BaseAPI.getFriendlyMessage(err));
    } finally {
      if (!isReloading) {
        setIsLoading(false);
      }
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
          saveFilterProps={{
            tableId: "settings-invoices-table",
          }}
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

      {isPaymentProcessing ? (
        <ConfirmModal
          title={`Payment is processing`}
          description={PAYMENT_PROCESSING_MESSAGE}
          submitButtonText={"Close"}
          onSubmit={() => {
            setIsPaymentProcessing(false);
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
