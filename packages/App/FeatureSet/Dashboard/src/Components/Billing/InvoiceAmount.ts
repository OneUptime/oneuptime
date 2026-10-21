/*
 * An invoice's amount as Project Settings > Billing and Invoices > Invoices
 * lists it: the payment provider's minor units (cents) as the currency's own
 * amount, always with two decimals, then the currency - "22.00 USD", "1,250.50
 * USD", "0.00 USD". Money reads the way the dashboard's other amounts do
 * (Detail's USD cents: two decimals, grouped thousands), never "1250.5 USD". An
 * invoice without a currency is in dollars, as its email assumes.
 *
 * The API answers the amount as a JSON number since #4719 (a decimal column
 * Postgres hands back as text). Text that spells a number still reads as
 * that number; anything else reads as nothing rather than "NaN USD".
 */
export function formatInvoiceAmount(data: {
  amount: number | string | null | undefined;
  currencyCode: string | null | undefined;
}): string {
  if (data.amount === null || data.amount === undefined) {
    return "";
  }

  if (typeof data.amount === "string" && data.amount.trim() === "") {
    return "";
  }

  const minorUnits: number = Number(data.amount);

  if (!Number.isFinite(minorUnits)) {
    return "";
  }

  const amount: string = (minorUnits / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const currency: string =
    data.currencyCode?.toString().trim().toUpperCase() || "USD";

  return `${amount} ${currency}`;
}
