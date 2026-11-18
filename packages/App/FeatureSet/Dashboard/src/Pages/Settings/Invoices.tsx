import PageComponentProps from "../PageComponentProps";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { Green, Yellow } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Text from "Common/Types/Text";
import { VoidFunction } from "Common/Types/FunctionTypes";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, BILLING_PUBLIC_KEY } from "Common/UI/Config";
import BaseAPI from "Common/UI/Utils/API/API";
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
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import Project from "Common/Models/DatabaseModels/Project";
import {
  getBillingActionLockedReason,
  getPayInvoiceGate,
} from "../../Components/Billing/BillingActionGates";
import { formatInvoiceAmount } from "Common/Utils/Billing/InvoiceAmount";
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
  "Your bank is still processing a payment for this invoice, which can take up to 2 days. You do not need to pay again.";

/*
 * An invoice that is settled, not yet issued, or cancelled has nothing left to
 * pay. Every other status - open, uncollectible, even a missing one - may
 * still owe money, so it gets the Pay Invoice action.
 */
const NOT_PAYABLE_INVOICE_STATUSES: Array<InvoiceStatus> = [
  InvoiceStatus.Paid,
  InvoiceStatus.Draft,
  InvoiceStatus.Void,
  InvoiceStatus.Deleted,
];

/*
 * An invoice's status in words - Stripe's "uncollectible" read as
 * "Uncollectible" - keys of the Dashboard's locales: the Invoice Status
 * filter's menu, its chip and each row's pill read them alike, each looked
 * up once, where it is drawn, in the reader's language.
 *
 * "Open" alone is every Open button's verb, and every language words it so
 * ("Abrir", "Öffnen"), so an open invoice's status has a key of its own,
 * "Open (invoice status)", worded as the state: German "Offen", Spanish
 * "Pendiente". English reads it "Open", as Stripe words it
 * (Common/Types/MeaningKeys).
 *
 * Every status agrees with the invoice, which Spanish, French, Italian,
 * Portuguese and Arabic make feminine: "Pagada", "Anulada". The bare
 * "Deleted" and "Undefined" are words the whole Dashboard shares, worded
 * masculine ("Eliminado", "Supprimé"), so a deleted invoice read
 * "Eliminado" under a paid one's "Pagada" (#8181). They have keys of their
 * own as well, worded for an invoice ("Eliminada", "Supprimée",
 * "Indefinida"), which English reads "Deleted" and "Undefined".
 */
const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  [InvoiceStatus.Paid]: translationKey("Paid"),
  [InvoiceStatus.Draft]: translationKey("Draft"),
  [InvoiceStatus.Void]: translationKey("Void"),
  [InvoiceStatus.Uncollectible]: translationKey("Uncollectible"),
  [InvoiceStatus.Deleted]: translationKey("Deleted (invoice status)"),
  [InvoiceStatus.Open]: translationKey("Open (invoice status)"),
  [InvoiceStatus.Undefined]: translationKey("Undefined (invoice status)"),
};

type GetInvoiceStatusLabelFunction = (status: string | undefined) => string;

/*
 * A status's words, for its pill to look up. One a newer server added reads
 * as it is stored, with a capital.
 */
const getInvoiceStatusLabel: GetInvoiceStatusLabelFunction = (
  status: string | undefined,
): string => {
  return (
    INVOICE_STATUS_LABELS[(status || "") as InvoiceStatus] ||
    Text.uppercaseFirstLetter(status || "")
  );
};

// The Invoice Status filter: every status in the words its pill draws.
const INVOICE_STATUS_OPTIONS: Array<DropdownOption> = Object.values(
  InvoiceStatus,
).map((status: InvoiceStatus): DropdownOption => {
  return { value: status, label: INVOICE_STATUS_LABELS[status] };
});

type IsInvoicePayableFunction = (invoice: BillingInvoice) => boolean;

const isInvoicePayable: IsInvoicePayableFunction = (
  invoice: BillingInvoice,
): boolean => {
  return !NOT_PAYABLE_INVOICE_STATUSES.includes(
    invoice["status"] as InvoiceStatus,
  );
};

const Settings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPaymentProcessing, setIsPaymentProcessing] =
    useState<boolean>(false);

  /*
   * Paying an invoice charges the card, so it stays with a project owner
   * and Manage Billing: the billing roles read the invoices and see Pay
   * Invoice locked, saying why (Components/Billing/BillingActionGates).
   * Downloading one needs its download link, which the table only asks
   * for from people who may read it - Billing Viewer reads the list
   * without it.
   */
  const payInvoiceLockedReason: string | undefined =
    getBillingActionLockedReason(getPayInvoiceGate());

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
      {isLoading ? <PageSkeleton shape="table" /> : <></>}

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
            description:
              "This project's invoices, as they are issued. Download one for your records, or pay one that is still open.",
          }}
          noItemsMessage={"No invoices so far."}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          showRefreshButton={true}
          selectMoreFields={{
            currencyCode: true,
            /*
             * No column shows the link any more - the Download action reads
             * it - so it has to be asked for here or every row would lose
             * its Download.
             */
            downloadableLink: true,
            paymentProviderCustomerId: true,
            paymentProviderInvoiceId: true,
          }}
          actionButtons={[
            {
              title: "Download",
              icon: IconProp.Download,
              buttonStyleType: ButtonStyleType.NORMAL,
              isVisible: (item: BillingInvoice): boolean => {
                return Boolean(item["downloadableLink"]);
              },
              onClick: (
                item: BillingInvoice,
                onCompleteAction: VoidFunction,
              ) => {
                Navigation.navigate(item["downloadableLink"] as URL);
                onCompleteAction();
              },
            },
            {
              title: "Pay Invoice",
              icon: IconProp.Billing,
              buttonStyleType: ButtonStyleType.NORMAL,
              disabled: Boolean(payInvoiceLockedReason),
              tooltip: payInvoiceLockedReason,
              /*
               * An invoice that still owes money is the one thing on this
               * page that needs doing, so paying it is the row's button and
               * Download waits in the ⋯ menu. Settled invoices have no Pay
               * Invoice, and Download takes the button back.
               */
              placement: ActionButtonPlacement.Primary,
              isVisible: isInvoicePayable,
              onClick: async (
                item: BillingInvoice,
                onCompleteAction: VoidFunction,
              ) => {
                /*
                 * payInvoice reports its own failures in the page's error
                 * dialog, and swaps the whole table for the page loader
                 * while it runs - that loader is this action's spinner.
                 */
                await payInvoice(
                  item["paymentProviderCustomerId"] as string,
                  item["paymentProviderInvoiceId"] as string,
                );
                onCompleteAction();
              },
            },
          ]}
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
              filterDropdownOptions: INVOICE_STATUS_OPTIONS,
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
                  <span>
                    {formatInvoiceAmount({
                      amount: item.amount,
                      currencyCode: item.currencyCode,
                    })}
                  </span>
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
                // In the words the Invoice Status filter offers it in.
                const text: string = getInvoiceStatusLabel(item["status"]);

                if (item["status"] === InvoiceStatus.Paid) {
                  return <Pill text={text} color={Green} />;
                }
                return <Pill text={text} color={Yellow} />;
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
