import type { Ionicons } from "@expo/vector-icons";

type IconName = keyof typeof Ionicons.glyphMap;

/*
 * THE WORDS A SECURITY CASE IS READ IN - the values the server stores and the
 * sentences the dashboard says of them (Common/Types/SecurityCase/
 * SecurityCaseVerdict, SecurityCaseAiVerdict and SecurityEntity), kept here
 * because the app is built without Common's runtime code. Common's
 * SecurityCaseMobileParity suite reads this file and holds every value and
 * sentence to Common's, so a verdict added or reworded there fails until it
 * is here too.
 */

/*
 * What a closed case turned out to be, in the order the close sheet offers
 * them, each with what it means.
 */
export type SecurityCaseVerdict =
  | "True Positive"
  | "Benign Positive"
  | "False Positive"
  | "Undetermined";

export interface SecurityCaseVerdictTerm {
  verdict: SecurityCaseVerdict;
  description: string;
}

export const SECURITY_CASE_VERDICTS: ReadonlyArray<SecurityCaseVerdictTerm> = [
  {
    verdict: "True Positive",
    description: "Malicious or unauthorized activity really happened.",
  },
  {
    verdict: "Benign Positive",
    description:
      "The activity was real but expected, such as a penetration test or an admin task.",
  },
  {
    verdict: "False Positive",
    description:
      "The detection was wrong: the rule or the data misread normal activity.",
  },
  {
    verdict: "Undetermined",
    description: "There was not enough information to tell.",
  },
];

export function isSecurityCaseVerdict(
  value: unknown,
): value is SecurityCaseVerdict {
  return SECURITY_CASE_VERDICTS.some((term: SecurityCaseVerdictTerm): boolean => {
    return term.verdict === value;
  });
}

/*
 * What OneUptime AI made of a case when it triaged it: its read, never the
 * case's verdict, which a person sets. Each read lines up with the verdict a
 * close starts on; Inconclusive suggests none.
 */
export type SecurityCaseAiVerdict =
  | "Likely Malicious"
  | "Likely Benign"
  | "Likely False Positive"
  | "Inconclusive";

export type SecurityCaseAiTone = "danger" | "warning" | "success" | "neutral";

export interface SecurityCaseAiVerdictTerm {
  verdict: SecurityCaseAiVerdict;
  description: string;
  suggestedCloseVerdict?: SecurityCaseVerdict | undefined;
  // The colour family of the verdict it suggests, as the dashboard draws it.
  tone: SecurityCaseAiTone;
}

// In the order a reader weighs them: the worst first.
export const SECURITY_CASE_AI_VERDICTS: ReadonlyArray<SecurityCaseAiVerdictTerm> =
  [
    {
      verdict: "Likely Malicious",
      description: "The evidence points at malicious or unauthorized activity.",
      suggestedCloseVerdict: "True Positive",
      tone: "danger",
    },
    {
      verdict: "Likely Benign",
      description:
        "The activity looks real but expected, such as an admin task or a scan your team runs.",
      suggestedCloseVerdict: "Benign Positive",
      tone: "warning",
    },
    {
      verdict: "Likely False Positive",
      description: "The detection looks like it misread normal activity.",
      suggestedCloseVerdict: "False Positive",
      tone: "success",
    },
    {
      verdict: "Inconclusive",
      description:
        "There was not enough evidence to tell. A person has to look.",
      tone: "neutral",
    },
  ];

export function getAiVerdictTerm(
  value: unknown,
): SecurityCaseAiVerdictTerm | undefined {
  return SECURITY_CASE_AI_VERDICTS.find(
    (term: SecurityCaseAiVerdictTerm): boolean => {
      return term.verdict === value;
    },
  );
}

/*
 * The kinds of things a case is about, as the server types them, each with
 * the icon the app draws it with and the words a reader sees.
 */
export type SecurityEntityType =
  | "User"
  | "Host"
  | "IP Address"
  | "Domain"
  | "URL"
  | "File Hash"
  | "Process"
  | "Other";

export interface SecurityEntityTerm {
  type: SecurityEntityType;
  label: string;
  icon: IconName;
}

export const SECURITY_ENTITY_TERMS: ReadonlyArray<SecurityEntityTerm> = [
  { type: "User", label: "User", icon: "person-outline" },
  { type: "Host", label: "Host", icon: "desktop-outline" },
  { type: "IP Address", label: "IP address", icon: "globe-outline" },
  { type: "Domain", label: "Domain", icon: "at-outline" },
  { type: "URL", label: "URL", icon: "link-outline" },
  { type: "File Hash", label: "File hash", icon: "document-outline" },
  { type: "Process", label: "Process", icon: "terminal-outline" },
  { type: "Other", label: "Other", icon: "ellipse-outline" },
];

export function getEntityTerm(type: unknown): SecurityEntityTerm {
  return (
    SECURITY_ENTITY_TERMS.find((term: SecurityEntityTerm): boolean => {
      return term.type === type;
    }) || SECURITY_ENTITY_TERMS[SECURITY_ENTITY_TERMS.length - 1]!
  );
}

export interface SecurityEntity {
  type: SecurityEntityType;
  value: string;
}

/*
 * A case's stored entities, read defensively: an entry without a value is
 * dropped, an unknown type reads as Other, and a value that appears twice
 * (whatever its case) is listed once, as the server merges them.
 */
export function readCaseEntities(value: unknown): Array<SecurityEntity> {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen: Set<string> = new Set();
  const entities: Array<SecurityEntity> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const entityValue: string =
      typeof record["value"] === "string" ? record["value"].trim() : "";

    if (!entityValue || seen.has(entityValue.toLowerCase())) {
      continue;
    }

    seen.add(entityValue.toLowerCase());
    entities.push({
      type: getEntityTerm(record["type"]).type,
      value: entityValue,
    });
  }

  return entities;
}

/*
 * What opened the case, as the server names its sources, in the words the
 * phone reads them in. A source this build does not know reads as stored.
 */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "Detection Rule": "A detection rule",
  "Threat Intel": "Threat intel",
  "Connected Product": "A connected product",
  "Entity Risk": "Entity risk",
  Manual: "Opened by hand",
};

export function describeCaseSource(source: unknown): string {
  if (typeof source !== "string" || !source.trim()) {
    return "";
  }

  return SOURCE_LABELS[source] || source;
}

/*
 * How the triage report's own heads-up starts, when the case's data held text
 * written to steer an AI (Common/Utils/AI/InvestigationReport,
 * SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX). The AI section says the same
 * first, as a warning, so the report is drawn without it.
 */
export const TRIAGE_INJECTION_LEAD_PREFIX: string =
  "**Heads up:** some text in this case's data reads like instructions to an AI";

/*
 * The triage report as the phone draws it, under its own "OneUptime AI"
 * heading: without the report's brand heading ("## 🧠 AI — Security Case
 * Triage") and without the runner's heads-up paragraph, which the section
 * shows as a warning instead. Anything the model wrote stays as written.
 */
export function getTriageReportBody(markdown: unknown): string {
  if (typeof markdown !== "string") {
    return "";
  }

  const lines: Array<string> = markdown.split("\n");
  const isFilled: (line: string) => boolean = (line: string): boolean => {
    return line.trim() !== "";
  };

  let index: number = lines.findIndex(isFilled);

  if (index !== -1 && lines[index]!.trim().startsWith("## ")) {
    lines.splice(index, 1);
    index = lines.findIndex(isFilled);
  }

  if (
    index !== -1 &&
    lines[index]!.trim().startsWith(TRIAGE_INJECTION_LEAD_PREFIX)
  ) {
    lines.splice(index, 1);
  }

  return lines.join("\n").trim();
}
