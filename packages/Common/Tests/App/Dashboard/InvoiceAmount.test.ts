import { describe, expect, test } from "@jest/globals";
import { formatInvoiceAmount } from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/InvoiceAmount";

/*
 * An invoice's amount as Project Settings > Invoices lists it. The payment
 * provider keeps amounts in minor units (cents); the list used to divide by
 * 100 and print the result, so 125050 read "1250.5 USD" and 2200 read
 * "22 USD". Money reads with two decimals, grouped thousands and the
 * currency, the way the dashboard's other amounts do.
 *
 * The API answers the amount as a JSON number since #4719 (Postgres hands
 * the decimal column back as text, which the API used to answer as it
 * was); the text an older server answers reads the same.
 */

describe("formatInvoiceAmount", () => {
  test.each([
    [2200, "22.00 USD"],
    [125050, "1,250.50 USD"],
    [999, "9.99 USD"],
    [5, "0.05 USD"],
    [0, "0.00 USD"],
    [12345678, "123,456.78 USD"],
  ])("%p cents read %p", (amount: number, text: string) => {
    expect(formatInvoiceAmount({ amount: amount, currencyCode: "usd" })).toBe(
      text,
    );
  });

  test("a credit reads as a negative amount", () => {
    expect(formatInvoiceAmount({ amount: -500, currencyCode: "usd" })).toBe(
      "-5.00 USD",
    );
  });

  test.each([
    ["2200", "22.00 USD"],
    ["125050", "1,250.50 USD"],
    ["0", "0.00 USD"],
    [" 999 ", "9.99 USD"],
  ])(
    "the decimal column's text %p, as servers before #4719 answered it, reads %p",
    (amount: string, text: string) => {
      expect(formatInvoiceAmount({ amount: amount, currencyCode: "usd" })).toBe(
        text,
      );
    },
  );

  test.each([
    ["usd", "USD"],
    ["eur", "EUR"],
    [" gbp ", "GBP"],
  ])("the currency %p is named %p", (currencyCode: string, name: string) => {
    expect(
      formatInvoiceAmount({ amount: 1000, currencyCode: currencyCode }),
    ).toBe(`10.00 ${name}`);
  });

  test.each([[undefined], [null], [""], ["   "]])(
    "an invoice without a currency (%p) is in dollars, as its email assumes",
    (currencyCode: string | null | undefined) => {
      expect(
        formatInvoiceAmount({ amount: 1000, currencyCode: currencyCode }),
      ).toBe("10.00 USD");
    },
  );

  test.each([[undefined], [null], [""], ["  "], ["abc"], [NaN], [Infinity]])(
    "%p is no amount, and reads as nothing rather than NaN",
    (amount: number | string | null | undefined) => {
      expect(formatInvoiceAmount({ amount: amount, currencyCode: "usd" })).toBe(
        "",
      );
    },
  );
});
