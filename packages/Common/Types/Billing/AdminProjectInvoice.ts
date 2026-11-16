import { InvoiceStatus } from "../../Models/DatabaseModels/BillingInvoice";
import { JSONObject, JSONValue } from "../JSON";

/*
 * A project's invoice as the Admin Dashboard lists it (Projects > the
 * project > Invoices), read live from the payment provider for OneUptime
 * staff - who may void one the customer should no longer pay.
 */

// Which of the project's two subscriptions raised the invoice.
export enum InvoiceBilledFor {
  // The flat-fee subscription: the plan, billed in advance.
  Plan = "plan",
  // The metered subscription: usage, billed in arrears.
  Usage = "usage",
}

export interface AdminProjectInvoice {
  // The payment provider's id for the invoice.
  id: string;
  invoiceNumber?: string | undefined;
  // When the invoice was raised, as an ISO 8601 date.
  invoiceDate: string;
  // In the currency's minor units (cents).
  amount: number;
  currencyCode: string;
  status: string;
  downloadableLink?: string | undefined;
  /*
   * Left out for an invoice of neither subscription the project has now: one
   * a plan change replaced, say.
   */
  billedFor?: InvoiceBilledFor | undefined;
}

/*
 * The statuses an invoice can be voided from: issued and still owed. A draft
 * has not been issued yet, and a paid or void invoice has nothing left to
 * cancel - the payment provider refuses those, so the Admin Dashboard offers
 * Void for these alone, and the server holds a request to them too.
 */
export const VOIDABLE_INVOICE_STATUSES: ReadonlyArray<InvoiceStatus> = [
  InvoiceStatus.Open,
  InvoiceStatus.Uncollectible,
];

export function isInvoiceVoidable(status: string | null | undefined): boolean {
  return VOIDABLE_INVOICE_STATUSES.includes(status as InvoiceStatus);
}

// An invoice as the admin route answers it: what it does not have, left out.
export function toAdminProjectInvoiceJSON(
  invoice: AdminProjectInvoice,
): JSONObject {
  const json: JSONObject = {
    id: invoice.id,
    invoiceDate: invoice.invoiceDate,
    amount: invoice.amount,
    currencyCode: invoice.currencyCode,
    status: invoice.status,
  };

  if (invoice.invoiceNumber) {
    json["invoiceNumber"] = invoice.invoiceNumber;
  }

  if (invoice.downloadableLink) {
    json["downloadableLink"] = invoice.downloadableLink;
  }

  if (invoice.billedFor) {
    json["billedFor"] = invoice.billedFor;
  }

  return json;
}

const readString: (value: JSONValue | undefined) => string | undefined = (
  value: JSONValue | undefined,
): string | undefined => {
  return typeof value === "string" && value.trim() ? value : undefined;
};

/*
 * An invoice as the admin route answers it, read back. Anything that is not
 * an invoice - no id, no date - is left out rather than drawn as a blank row.
 */
export function readAdminProjectInvoice(
  json: JSONValue | undefined,
): AdminProjectInvoice | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }

  const invoice: JSONObject = json as JSONObject;
  const id: string | undefined = readString(invoice["id"]);
  const invoiceDate: string | undefined = readString(invoice["invoiceDate"]);

  if (!id || !invoiceDate) {
    return null;
  }

  const amount: number = Number(invoice["amount"]);
  const billedFor: string | undefined = readString(invoice["billedFor"]);

  return {
    id: id,
    invoiceNumber: readString(invoice["invoiceNumber"]),
    invoiceDate: invoiceDate,
    amount: Number.isFinite(amount) ? amount : 0,
    currencyCode: readString(invoice["currencyCode"]) || "usd",
    status: readString(invoice["status"]) || InvoiceStatus.Undefined,
    downloadableLink: readString(invoice["downloadableLink"]),
    billedFor: Object.values(InvoiceBilledFor).includes(
      billedFor as InvoiceBilledFor,
    )
      ? (billedFor as InvoiceBilledFor)
      : undefined,
  };
}
