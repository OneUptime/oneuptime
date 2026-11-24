import { translationKey } from "../Translator";

/*
 * WHICH COST A FIGURE IS: BILLED, AMORTIZED OR NET.
 *
 * The same spend reads three ways, and a cost tool shows each (#11007):
 *
 *   - billed: each charge on the day the cloud billed it, before credits
 *     and refunds - what OneUptime showed before. A Savings Plan or a
 *     reservation paid up front is one large charge on the day it was
 *     bought, and the usage it covers looks free for the rest of its term;
 *   - amortized: commitment fees spread over the days and the usage they
 *     cover, upfront fees over the term - what each team's resources really
 *     used. Still before credits and refunds;
 *   - net: amortized, less credits, refunds and discounts - what the
 *     invoice comes to.
 *
 * Each cost row keeps all three (CloudCost: cost, amortizedCost, netCost),
 * each one the sum of its rows as the writer keeps it (CloudCostWriter). A
 * page reads the column of the basis it shows; a budget sums the summary
 * figures of its basis.
 *
 * Called a "basis", not a "view", so that "view" keeps meaning a cost
 * group view (#11006): a page can show a group view's spend in any basis.
 *
 * React-free and server-safe: the readers, the writer, budgets and the
 * Dashboard share it.
 */
export enum CloudCostBasis {
  Billed = "billed",
  Amortized = "amortized",
  Net = "net",
}

/*
 * The basis a project shows and budgets watch until someone picks another:
 * amortized, so a commitment bought up front does not make its month spike
 * and the months after it look free.
 */
export const CLOUD_COST_DEFAULT_BASIS: CloudCostBasis =
  CloudCostBasis.Amortized;

// Every basis, in the order the switch offers them.
export const CLOUD_COST_BASES: ReadonlyArray<CloudCostBasis> = [
  CloudCostBasis.Billed,
  CloudCostBasis.Amortized,
  CloudCostBasis.Net,
];

// The cost column a basis is read from.
export type CloudCostBasisColumn = "cost" | "amortizedCost" | "netCost";

export const CLOUD_COST_BASIS_COLUMNS: Readonly<
  Record<CloudCostBasis, CloudCostBasisColumn>
> = {
  [CloudCostBasis.Billed]: "cost",
  [CloudCostBasis.Amortized]: "amortizedCost",
  [CloudCostBasis.Net]: "netCost",
};

export function isCloudCostBasis(value: unknown): value is CloudCostBasis {
  return (
    typeof value === "string" &&
    (CLOUD_COST_BASES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * The cost column of a basis: the billed one for anything that is not a
 * basis, as every read was before the bases.
 */
export function getCloudCostBasisColumn(
  basis: unknown,
): CloudCostBasisColumn {
  return isCloudCostBasis(basis)
    ? CLOUD_COST_BASIS_COLUMNS[basis]
    : CLOUD_COST_BASIS_COLUMNS[CloudCostBasis.Billed];
}

/*
 * The basis that holds: the first of the choices that is one - a person's
 * own pick, then a budget's, then the project's - else the default.
 */
export function resolveCloudCostBasis(
  ...choices: Array<unknown>
): CloudCostBasis {
  for (const choice of choices) {
    if (isCloudCostBasis(choice)) {
      return choice;
    }
  }

  return CLOUD_COST_DEFAULT_BASIS;
}

// What each basis is called, in the reader's language.
export const CLOUD_COST_BASIS_LABELS: Readonly<Record<CloudCostBasis, string>> =
  {
    [CloudCostBasis.Billed]: translationKey("Billed"),
    [CloudCostBasis.Amortized]: translationKey("Amortized"),
    [CloudCostBasis.Net]: translationKey("Net"),
  };

// What each basis counts, in a sentence a person reads beside the switch.
export const CLOUD_COST_BASIS_DESCRIPTIONS: Readonly<
  Record<CloudCostBasis, string>
> = {
  [CloudCostBasis.Billed]: translationKey(
    "Each charge on the day it was billed, before credits and refunds. A commitment paid up front counts on the day it was bought.",
  ),
  [CloudCostBasis.Amortized]: translationKey(
    "Commitment fees spread over the days and resources they cover, before credits and refunds.",
  ),
  [CloudCostBasis.Net]: translationKey(
    "Amortized, less credits, refunds and discounts: what the invoice comes to.",
  ),
};

/*
 * The bases a read of costs brought, when it did not bring all three: an
 * Azure read between its daily reads of actual cost brings the amortized
 * figure (and so the net one) only. A basis a read did not bring keeps what
 * is stored for it (CloudCostWriter).
 */
export function readCloudCostBases(
  value: unknown,
): Array<CloudCostBasis> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const bases: Array<CloudCostBasis> = CLOUD_COST_BASES.filter(
    (basis: CloudCostBasis): boolean => {
      return (value as Array<unknown>).includes(basis);
    },
  );

  return bases.length > 0 ? bases : undefined;
}
