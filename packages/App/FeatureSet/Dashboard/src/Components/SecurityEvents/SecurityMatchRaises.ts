import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A SECURITY MATCH RAISES: ONE CHOICE.
 *
 * A detection rule and a threat intel feed each had two switches on their
 * On Match step, Create Alert on Match (on) and Create Incident on Match
 * (off), the second explaining itself: "Incidents are the heavier machinery
 * - on-call escalation, SLAs, status pages. Off by default; alerts usually
 * suffice." It is one question now, worded as a burn rate rule's own alert
 * or incident choice words it (Create an alert, Declare an incident, Both),
 * with the answer a security match also has: neither - the case and the
 * detection finding are its record (a rule added from the Rule Library
 * starts there).
 *
 * The answer is written into the two columns as before (shouldCreateAlert,
 * shouldCreateIncident), read with the defaults the evaluators use (an
 * alert unless it is off, an incident only when it is on): the API,
 * Terraform and every stored rule and feed are unchanged. A new rule or
 * feed starts on Create an alert, what the column defaults have always
 * made.
 *
 * React-free on purpose: App's tests read this without the pages.
 */

export enum SecurityMatchRaises {
  Alert = "alert",
  Incident = "incident",
  Both = "both",
  Neither = "neither",
}

// The form value the choice keeps; never sent (formOnly).
export const SECURITY_MATCH_RAISES_FIELD_KEY: string = "securityMatchRaises";

export interface SecurityMatchRaisesColumns {
  shouldCreateAlert: boolean;
  shouldCreateIncident: boolean;
}

export const SECURITY_MATCH_RAISES_COLUMNS: Record<
  SecurityMatchRaises,
  SecurityMatchRaisesColumns
> = {
  [SecurityMatchRaises.Alert]: {
    shouldCreateAlert: true,
    shouldCreateIncident: false,
  },
  [SecurityMatchRaises.Incident]: {
    shouldCreateAlert: false,
    shouldCreateIncident: true,
  },
  [SecurityMatchRaises.Both]: {
    shouldCreateAlert: true,
    shouldCreateIncident: true,
  },
  [SecurityMatchRaises.Neither]: {
    shouldCreateAlert: false,
    shouldCreateIncident: false,
  },
};

// In the order the form offers them: the default first.
export const SECURITY_MATCH_RAISES_ANSWERS: ReadonlyArray<SecurityMatchRaises> =
  [
    SecurityMatchRaises.Alert,
    SecurityMatchRaises.Incident,
    SecurityMatchRaises.Both,
    SecurityMatchRaises.Neither,
  ];

export interface SecurityMatchRaisesCopy {
  title: string;
  description: string;
}

export const SECURITY_MATCH_RAISES_COPY: Record<
  SecurityMatchRaises,
  SecurityMatchRaisesCopy
> = {
  [SecurityMatchRaises.Alert]: {
    title: translationKey("Create an alert"),
    description: translationKey(
      "For teams that work security matches alongside their other alerts.",
    ),
  },
  [SecurityMatchRaises.Incident]: {
    title: translationKey("Declare an incident"),
    description: translationKey(
      "With on-call escalation, SLAs and status pages.",
    ),
  },
  [SecurityMatchRaises.Both]: {
    title: translationKey("Both"),
    description: translationKey("An alert and an incident."),
  },
  [SecurityMatchRaises.Neither]: {
    title: translationKey("Neither"),
    description: translationKey(
      "No alert or incident: the case and the detection finding record the match.",
    ),
  },
};

export const SECURITY_MATCH_RAISES_FIELD_TITLE: string = translationKey(
  "Alerts and Incidents",
);

export function isSecurityMatchRaises(
  value: unknown,
): value is SecurityMatchRaises {
  return (
    typeof value === "string" &&
    (Object.values(SecurityMatchRaises) as Array<string>).includes(value)
  );
}

type Values = Record<string, unknown>;

const asValues: (values: unknown) => Values = (values: unknown): Values => {
  return values && typeof values === "object" ? (values as Values) : {};
};

/**
 * The answer a rule's or feed's two columns make, read as the evaluators
 * read them: an alert unless shouldCreateAlert is false, an incident only
 * when shouldCreateIncident is true.
 */
export function getSecurityMatchRaises(values: unknown): SecurityMatchRaises {
  const record: Values = asValues(values);
  const raisesAlert: boolean = record["shouldCreateAlert"] !== false;
  const raisesIncident: boolean = record["shouldCreateIncident"] === true;

  if (raisesAlert && raisesIncident) {
    return SecurityMatchRaises.Both;
  }

  if (raisesIncident) {
    return SecurityMatchRaises.Incident;
  }

  if (raisesAlert) {
    return SecurityMatchRaises.Alert;
  }

  return SecurityMatchRaises.Neither;
}

/**
 * The form values an answer makes: its two columns, everything else as it
 * was.
 */
export function getValuesForSecurityMatchRaises<TValues>(data: {
  values: TValues;
  raises: SecurityMatchRaises;
}): TValues {
  return {
    ...asValues(data.values),
    ...SECURITY_MATCH_RAISES_COLUMNS[data.raises],
  } as unknown as TValues;
}

// Whether the answer raises an alert, or an incident: its severity is asked.
export function raisesAlert(values: unknown): boolean {
  return asValues(values)["shouldCreateAlert"] !== false;
}

export function raisesIncident(values: unknown): boolean {
  return asValues(values)["shouldCreateIncident"] === true;
}

/*
 * THE NAME A DETECTION RULE STARTS WITH: ITS SIGMA RULE'S TITLE.
 *
 * Every Sigma rule carries a `title:` (the Rule Library adds rules named
 * after it). The form names a new rule after it until a name of one's own
 * is typed. Read line by line, without a regular expression: the YAML is
 * pasted text of any length.
 *
 * A correlation's YAML holds several documents (`---` between them): the
 * rule is the correlation's, so its document's title names it, wherever in
 * the file it is.
 */
export function getSigmaRuleTitle(yaml: unknown): string {
  if (typeof yaml !== "string") {
    return "";
  }

  const documents: Array<Array<string>> = [[]];

  for (const line of yaml.split("\n")) {
    if (line.trimEnd() === "---") {
      documents.push([]);
      continue;
    }

    documents[documents.length - 1]!.push(line);
  }

  const correlation: Array<string> | undefined = documents.find(
    (lines: Array<string>): boolean => {
      return lines.some((line: string): boolean => {
        return line.startsWith("correlation:");
      });
    },
  );

  for (const document of correlation ? [correlation] : documents) {
    const title: string = readTopLevelTitle(document);

    if (title) {
      return title;
    }
  }

  return "";
}

// The first top-level `title:` of a YAML document's lines, or "".
function readTopLevelTitle(lines: Array<string>): string {
  for (const line of lines) {
    // A top-level key only: an indented title belongs to something else.
    if (!line.startsWith("title:")) {
      continue;
    }

    let title: string = line.slice("title:".length).trim();

    // A trailing comment is not part of the title.
    const comment: number = title.indexOf(" #");

    if (comment !== -1) {
      title = title.slice(0, comment).trim();
    }

    const quote: string = title.charAt(0);

    if (
      title.length >= 2 &&
      (quote === '"' || quote === "'") &&
      title.endsWith(quote)
    ) {
      title = title.slice(1, -1).trim();
    }

    return title;
  }

  return "";
}

/**
 * The rule's name once its Sigma rule changes: the new title while the
 * name is still the form's own - empty, or the title the rule had before.
 * Null when the name stays: somebody typed their own, or the title is the
 * same.
 */
export function getDetectionRuleNameAfterYamlChange(data: {
  name: unknown;
  previousYaml: unknown;
  nextYaml: unknown;
}): string | null {
  const name: string = typeof data.name === "string" ? data.name.trim() : "";
  const previous: string = getSigmaRuleTitle(data.previousYaml);
  const next: string = getSigmaRuleTitle(data.nextYaml);

  if (!next || name === next) {
    return null;
  }

  if (name === "" || name === previous) {
    return next;
  }

  return null;
}

export const DETECTION_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after the Sigma rule's title until you type a name of your own.",
);

/*
 * HOW ONEUPTIME SIGNS IN TO A TAXII SERVER: ONE CHOICE.
 *
 * A new feed's Authentication step showed an API Token, a Basic Auth
 * Username and a Basic Auth Password at once, each "Leave empty for
 * anonymous access". It asks which first now, and then only that one's
 * fields - with the answers the feed's Update Credentials dialog already
 * offers, in the same words. Form-only: the columns are the token, the
 * username and the password, as before.
 */
export enum TaxiiSignIn {
  Anonymous = "anonymous",
  ApiToken = "api-token",
  BasicAuth = "basic-auth",
}

// The form value the choice keeps; never sent (formOnly).
export const TAXII_SIGN_IN_FIELD_KEY: string = "taxiiSignIn";

export const TAXII_SIGN_IN_ANSWERS: ReadonlyArray<TaxiiSignIn> = [
  TaxiiSignIn.Anonymous,
  TaxiiSignIn.ApiToken,
  TaxiiSignIn.BasicAuth,
];

export const TAXII_SIGN_IN_COPY: Record<TaxiiSignIn, SecurityMatchRaisesCopy> =
  {
    [TaxiiSignIn.Anonymous]: {
      title: translationKey("No sign-in"),
      description: translationKey("For collections anyone may read."),
    },
    [TaxiiSignIn.ApiToken]: {
      title: translationKey("Bearer token"),
      description: translationKey("A token from the TAXII server's operator."),
    },
    [TaxiiSignIn.BasicAuth]: {
      title: translationKey("Username and password"),
      description: translationKey("HTTP basic authentication."),
    },
  };

export const TAXII_SIGN_IN_FIELD_TITLE: string = translationKey("Sign-in");

// What clearing the credentials does, in the Update Credentials dialog.
export const TAXII_SIGN_IN_CLEAR_DESCRIPTION: string = translationKey(
  "Clears the stored token, username and password.",
);

export function isTaxiiSignIn(value: unknown): value is TaxiiSignIn {
  return (
    typeof value === "string" &&
    (Object.values(TaxiiSignIn) as Array<string>).includes(value)
  );
}

/*
 * The sign-in a form picked, or null where the form asks none - an
 * existing feed's Edit form, whose credentials Update Credentials changes.
 */
export function getTaxiiSignIn(values: unknown): TaxiiSignIn | null {
  const value: unknown = asValues(values)[TAXII_SIGN_IN_FIELD_KEY];

  return isTaxiiSignIn(value) ? value : null;
}
