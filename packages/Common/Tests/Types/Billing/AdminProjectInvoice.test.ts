import { describe, expect, test } from "@jest/globals";
import {
  AdminProjectInvoice,
  InvoiceBilledFor,
  VOIDABLE_INVOICE_STATUSES,
  isInvoiceVoidable,
  readAdminProjectInvoice,
  toAdminProjectInvoiceJSON,
} from "../../../Types/Billing/AdminProjectInvoice";
import { InvoiceStatus } from "../../../Models/DatabaseModels/BillingInvoice";
import { JSONObject } from "../../../Types/JSON";

/*
 * A project's invoice as the Admin Dashboard's Invoices page lists it: which
 * may be voided, and the shape the admin route answers and the page reads
 * back. The server and the page both hold an invoice to the same voidable
 * statuses, so the page never offers Void on one the server would refuse.
 */

describe("isInvoiceVoidable", () => {
  test("an invoice still owed can be voided", () => {
    expect(isInvoiceVoidable(InvoiceStatus.Open)).toBe(true);
    expect(isInvoiceVoidable(InvoiceStatus.Uncollectible)).toBe(true);
  });

  test.each([
    InvoiceStatus.Paid,
    InvoiceStatus.Void,
    InvoiceStatus.Draft,
    InvoiceStatus.Deleted,
    InvoiceStatus.Undefined,
  ])("a %p invoice cannot be voided", (status: InvoiceStatus) => {
    expect(isInvoiceVoidable(status)).toBe(false);
  });

  test("no status, or one a newer provider added, cannot be voided", () => {
    expect(isInvoiceVoidable(undefined)).toBe(false);
    expect(isInvoiceVoidable(null)).toBe(false);
    expect(isInvoiceVoidable("Unknown")).toBe(false);
    expect(isInvoiceVoidable("OPEN")).toBe(false);
  });

  test("the voidable statuses are open and uncollectible, and only those", () => {
    expect([...VOIDABLE_INVOICE_STATUSES].sort()).toEqual(
      [InvoiceStatus.Open, InvoiceStatus.Uncollectible].sort(),
    );
  });
});

describe("an invoice through the admin route and back", () => {
  const invoice: AdminProjectInvoice = {
    id: "in_123",
    invoiceNumber: "ACME-0007",
    invoiceDate: "2026-11-13T20:31:00.000Z",
    amount: 2200,
    currencyCode: "usd",
    status: InvoiceStatus.Open,
    downloadableLink: "https://pay.stripe.com/invoice/acct_1/in_123/pdf",
    billedFor: InvoiceBilledFor.Plan,
  };

  test("reads back as it was written", () => {
    expect(readAdminProjectInvoice(toAdminProjectInvoiceJSON(invoice))).toEqual(
      invoice,
    );
  });

  test("what an invoice does not have is left out of its JSON", () => {
    const json: JSONObject = toAdminProjectInvoiceJSON({
      id: "in_456",
      invoiceDate: "2026-11-01T00:00:00.000Z",
      amount: 0,
      currencyCode: "usd",
      status: InvoiceStatus.Draft,
    });

    expect(json).toEqual({
      id: "in_456",
      invoiceDate: "2026-11-01T00:00:00.000Z",
      amount: 0,
      currencyCode: "usd",
      status: InvoiceStatus.Draft,
    });
    expect("invoiceNumber" in json).toBe(false);
    expect("downloadableLink" in json).toBe(false);
    expect("billedFor" in json).toBe(false);
  });

  test.each([null, undefined, "in_123", 42, true, ["in_123"]])(
    "%p is not an invoice",
    (value: unknown) => {
      expect(readAdminProjectInvoice(value as never)).toBeNull();
    },
  );

  test("an invoice with no id, or no date, is not drawn", () => {
    expect(
      readAdminProjectInvoice({ invoiceDate: "2026-11-01T00:00:00.000Z" }),
    ).toBeNull();
    expect(readAdminProjectInvoice({ id: "in_1" })).toBeNull();
    expect(readAdminProjectInvoice({ id: "  ", invoiceDate: "x" })).toBeNull();
  });

  test("a billed-for this page does not know reads as none", () => {
    expect(
      readAdminProjectInvoice({
        ...toAdminProjectInvoiceJSON(invoice),
        billedFor: "seats",
      })?.billedFor,
    ).toBeUndefined();
  });

  test("an amount that is not a number reads as nothing owed, a missing currency as dollars", () => {
    const read: AdminProjectInvoice | null = readAdminProjectInvoice({
      id: "in_1",
      invoiceDate: "2026-11-01T00:00:00.000Z",
      amount: "lots",
      status: InvoiceStatus.Paid,
    });

    expect(read?.amount).toBe(0);
    expect(read?.currencyCode).toBe("usd");
  });

  test("an amount the server sent as text still reads as that amount", () => {
    expect(
      readAdminProjectInvoice({
        id: "in_1",
        invoiceDate: "2026-11-01T00:00:00.000Z",
        amount: "125050",
      })?.amount,
    ).toBe(125050);
  });
});
