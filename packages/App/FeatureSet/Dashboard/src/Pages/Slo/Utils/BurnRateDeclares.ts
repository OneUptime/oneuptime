import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A BURN RATE RULE DOES WHEN IT FIRES: ONE CHOICE.
 *
 * "What It Declares" was two switches, Create Alert and Declare Incident,
 * whose help said "A rule must create an alert, declare an incident, or
 * both" - and turning the first off without the second stopped the form on
 * "This rule would do nothing". It is one question with three answers now,
 * each saying in a line what it opens, and no answer that does nothing.
 * The answers are worded as the monitor recommendations' own alert or
 * incident choice words them (Create an alert, Declare an incident, Both).
 *
 * The answer is written into the rule's two columns as before
 * (shouldCreateAlert, shouldCreateIncident), read with the same defaults the
 * worker uses (willCreateAlert / willDeclareIncident): the API, Terraform
 * and every stored rule are unchanged. A new rule starts on Create an alert,
 * what the two column defaults have always made.
 *
 * React-free on purpose: App's tests read this without the page.
 */

export enum BurnRateDeclares {
  Alert = "alert",
  Incident = "incident",
  Both = "both",
}

// The form value the choice keeps; never sent (formOnly).
export const BURN_RATE_DECLARES_FIELD_KEY: string = "burnRateDeclares";

export interface BurnRateDeclaresColumns {
  shouldCreateAlert: boolean;
  shouldCreateIncident: boolean;
}

export const BURN_RATE_DECLARES_COLUMNS: Record<
  BurnRateDeclares,
  BurnRateDeclaresColumns
> = {
  [BurnRateDeclares.Alert]: {
    shouldCreateAlert: true,
    shouldCreateIncident: false,
  },
  [BurnRateDeclares.Incident]: {
    shouldCreateAlert: false,
    shouldCreateIncident: true,
  },
  [BurnRateDeclares.Both]: {
    shouldCreateAlert: true,
    shouldCreateIncident: true,
  },
};

// In the order the form offers them: the default first.
export const BURN_RATE_DECLARES_ANSWERS: ReadonlyArray<BurnRateDeclares> = [
  BurnRateDeclares.Alert,
  BurnRateDeclares.Incident,
  BurnRateDeclares.Both,
];

export interface BurnRateDeclaresCopy {
  title: string;
  description: string;
}

export const BURN_RATE_DECLARES_COPY: Record<
  BurnRateDeclares,
  BurnRateDeclaresCopy
> = {
  [BurnRateDeclares.Alert]: {
    title: translationKey("Create an alert"),
    description: translationKey("Opens an alert for the team to look at."),
  },
  [BurnRateDeclares.Incident]: {
    title: translationKey("Declare an incident"),
    description: translationKey(
      "Opens an incident. Burn rate incidents never reach status pages.",
    ),
  },
  [BurnRateDeclares.Both]: {
    title: translationKey("Both"),
    description: translationKey(
      "Opens an alert and an incident, each set up on the next steps.",
    ),
  },
};

export const BURN_RATE_DECLARES_FIELD_TITLE: string =
  translationKey("When it fires");

export const BURN_RATE_DECLARES_REQUIRED: string = translationKey(
  "Pick what this rule opens when it fires.",
);

export function isBurnRateDeclares(value: unknown): value is BurnRateDeclares {
  return (
    typeof value === "string" &&
    (Object.values(BurnRateDeclares) as Array<string>).includes(value)
  );
}

type Values = Record<string, unknown>;

const asValues: (values: unknown) => Values = (values: unknown): Values => {
  return values && typeof values === "object" ? (values as Values) : {};
};

/**
 * The answer a rule's two columns make, read with the worker's defaults: a
 * column left out counts as its default (an alert, no incident). Null for
 * a rule that would open nothing - which the server refuses, so only a
 * form whose columns were both switched off by hand can hold one.
 */
export function getBurnRateDeclares(values: unknown): BurnRateDeclares | null {
  const record: Values = asValues(values);
  const createsAlert: boolean = record["shouldCreateAlert"] !== false;
  const createsIncident: boolean = record["shouldCreateIncident"] === true;

  if (createsAlert && createsIncident) {
    return BurnRateDeclares.Both;
  }

  if (createsIncident) {
    return BurnRateDeclares.Incident;
  }

  if (createsAlert) {
    return BurnRateDeclares.Alert;
  }

  return null;
}

/**
 * The form values an answer makes: its two columns, everything else as it
 * was.
 */
export function getValuesForBurnRateDeclares<TValues>(data: {
  values: TValues;
  declares: BurnRateDeclares;
}): TValues {
  return {
    ...asValues(data.values),
    ...BURN_RATE_DECLARES_COLUMNS[data.declares],
  } as unknown as TValues;
}
