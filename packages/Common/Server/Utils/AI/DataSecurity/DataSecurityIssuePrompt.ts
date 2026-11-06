import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { AIPromptOmissions } from "../../../../Types/AI/AIChatTypes";
import {
  CheckRemediation,
  DataSecurityCheckInfo,
  fillRemediationText,
  getCheckRemediation,
  getDataSecurityCheck,
  isTelemetryFindingCheck,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { getBuiltInDataType } from "../../../../Types/DataSecurity/DataTypeCatalog";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import PromptText from "../../../../Utils/AI/PromptText";

/*
 * WHAT ONEUPTIME AI IS TOLD ABOUT A DATA SECURITY ISSUE.
 *
 * Explain and Fix with AI (Server/API/DataSecurityAPI) send OneUptime AI
 * the issue as a check saw it: its title and severity, the store's name,
 * kind, region and cloud id, its sensitivity, the data types found in it,
 * the evidence, why the check matters and how to fix it on the store's
 * cloud. Never a finding's samples: what the store holds goes in by the
 * names of its data types only.
 *
 * A telemetry issue is fixed in the code that writes the data, not in
 * infrastructure code: OneUptime AI is told where each kind of data was
 * found - the data type and the attribute, the log body or the prompt it
 * sits in, which is what the code writes - and asked for a change to the
 * service's own code (issue #5594). Still never a sample, nor a record.
 *
 * The check's words are OneUptime's own (DataSecurityCheckCatalog). The
 * store's name, its cloud id, the evidence and a finding's location are not
 * - a cloud, a person or a service's code named them, and evidence quotes
 * what a cloud answered - so each goes in as a field, held to a length with
 * embedded data left out.
 */

// The most one of the store's own values takes in the prompt.
export const MAX_ISSUE_VALUE_LENGTH: number = 500;
// The most the evidence takes.
export const MAX_ISSUE_EVIDENCE_LENGTH: number = 2_000;

// The most places a telemetry issue names, and the most one location takes.
export const MAX_ISSUE_FINDINGS_FOR_AI: number = 20;
export const MAX_FINDING_LOCATION_LENGTH: number = 300;

export const DATA_SECURITY_EXPLAIN_SYSTEM_PROMPT: string =
  "You are a data security engineer. Explain the issue to the store's owner in plain words: what is wrong, what could happen, and the exact steps to fix it on their cloud. Be brief and concrete. Never invent facts that are not in the issue.";

export const DATA_SECURITY_TELEMETRY_EXPLAIN_SYSTEM_PROMPT: string =
  "You are a data security engineer. Explain the issue to the service's owner in plain words: what sensitive data reaches their telemetry, where it sits in it, what could happen, and the exact steps to stop it - scrub it at ingest, then change the code that writes it. Be brief and concrete. Never invent facts that are not in the issue.";

export const DATA_SECURITY_FIX_INSTRUCTION: string =
  "Fix this data security issue in the infrastructure code (Terraform, CloudFormation, Bicep or similar), with the smallest change that makes the check pass. Open a pull request.";

export const DATA_SECURITY_TELEMETRY_FIX_INSTRUCTION: string =
  "Fix this data security issue in the code of the service that writes this data to its telemetry: find where it logs the value, or sets it on a span, an exception or an AI call, at each place listed, and stop sending it - leave it out, or mask or hash it first - with the smallest change. Open a pull request.";

/*
 * One place a telemetry issue's data was found (a DataStoreFinding): what
 * the code writes there, never a sample of what it wrote.
 */
export interface DataSecurityFindingForAi {
  dataTypeId?: string | undefined;
  dataTypeName?: string | undefined;
  location?: string | undefined;
  locationKind?: string | undefined;
}

// What OneUptime AI is told when it explains an issue.
export function getDataSecurityExplainSystemPrompt(
  checkId: string | undefined,
): string {
  return isTelemetryFindingCheck(checkId)
    ? DATA_SECURITY_TELEMETRY_EXPLAIN_SYSTEM_PROMPT
    : DATA_SECURITY_EXPLAIN_SYSTEM_PROMPT;
}

function value(
  text: string | null | undefined,
  maxLength: number,
  omissions: AIPromptOmissions | undefined,
): string {
  return PromptText.field(text, { maxLength, omissions });
}

/*
 * A value that goes on a line of its own - a finding's location, a type's
 * name - on one line: an attribute key the service's code chose can hold a
 * line break, which would read as a line of the prompt.
 */
function lineValue(
  text: string | null | undefined,
  maxLength: number,
  omissions: AIPromptOmissions | undefined,
): string {
  return value(
    (text || "")
      .slice(0, maxLength * 2)
      .replace(/\s+/g, " ")
      .trim(),
    maxLength,
    omissions,
  );
}

/*
 * The issue in words for OneUptime AI, one fact a line: no samples, only
 * what a check saw. A fact nobody recorded is left out, never guessed.
 */
export function describeDataSecurityIssueForAi(
  issue: DataSecurityIssue,
  omissions?: AIPromptOmissions | undefined,
  findings: ReadonlyArray<DataSecurityFindingForAi> = [],
): string {
  const check: DataSecurityCheckInfo | undefined = getDataSecurityCheck(
    issue.checkId || "",
  );
  const kind: DataStoreKind | undefined = issue.dataStore?.kind as
    | DataStoreKind
    | undefined;
  const remediation: CheckRemediation | undefined =
    check && kind ? getCheckRemediation(check, kind) : undefined;
  const name: string = value(
    issue.dataStore?.name,
    MAX_ISSUE_VALUE_LENGTH,
    omissions,
  );
  const region: string = value(
    issue.dataStore?.region,
    MAX_ISSUE_VALUE_LENGTH,
    omissions,
  );
  const cloudId: string = value(
    issue.dataStore?.providerResourceId,
    MAX_ISSUE_VALUE_LENGTH,
    omissions,
  );
  const values: { name: string; region?: string | undefined } = {
    name: name || "<store>",
    region: region || undefined,
  };
  const dataTypes: Array<string> = (issue.dataTypeIds || []).map(
    (id: string): string => {
      return getBuiltInDataType(id)?.name || id;
    },
  );
  const where: Array<string> = [kind || "", region].filter(
    (part: string): boolean => {
      return part.length > 0;
    },
  );
  const store: string = [
    name || "unknown",
    where.length > 0 ? `(${where.join(", ")})` : "",
  ]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" ");
  const evidence: string = value(
    issue.evidence,
    MAX_ISSUE_EVIDENCE_LENGTH,
    omissions,
  );
  // Where a telemetry issue's data sits: what the service's code writes.
  const places: Array<string> = findings
    .slice(0, MAX_ISSUE_FINDINGS_FOR_AI)
    .map((finding: DataSecurityFindingForAi): string => {
      const location: string = lineValue(
        finding.location,
        MAX_FINDING_LOCATION_LENGTH,
        omissions,
      );
      const name: string =
        getBuiltInDataType(finding.dataTypeId || "")?.name ||
        lineValue(finding.dataTypeName, MAX_ISSUE_VALUE_LENGTH, omissions) ||
        lineValue(finding.dataTypeId, MAX_ISSUE_VALUE_LENGTH, omissions);
      const kind: string = lineValue(finding.locationKind, 40, omissions);

      return location && name
        ? `- ${name} in ${location}${kind ? ` (${kind})` : ""}`
        : "";
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    });
  const fix: Array<string> = remediation
    ? [
        "Suggested fix:",
        ...remediation.steps.map((step: string, index: number): string => {
          return `Step ${index + 1}: ${fillRemediationText(step, values)}`;
        }),
        remediation.cli
          ? `CLI: ${fillRemediationText(remediation.cli, values)}`
          : "",
        remediation.terraform
          ? `Terraform:\n${fillRemediationText(remediation.terraform, values)}`
          : "",
      ]
    : [];

  return [
    `Issue: ${issue.title || check?.title || issue.checkId || "unknown"}`,
    `Severity: ${issue.severity || "unknown"}`,
    `Store: ${store}`,
    cloudId ? `Cloud id: ${cloudId}` : "",
    `Sensitivity: ${issue.dataStore?.sensitivity || "unknown"}`,
    dataTypes.length > 0 ? `Data types found: ${dataTypes.join(", ")}` : "",
    `Evidence: ${evidence || "none recorded"}`,
    ...(places.length > 0 ? ["Where it was found:", ...places] : []),
    check ? `Why it matters: ${check.whyItMatters}` : "",
    ...fix,
  ]
    .filter((line: string): boolean => {
      return line.length > 0;
    })
    .join("\n");
}

/*
 * What Fix with AI asks the coding agent to do: the instruction - in the
 * service's code for a telemetry issue, in infrastructure code for any
 * other - then the issue, with the places a telemetry issue's data sits.
 */
export function buildDataSecurityFixRequest(
  issue: DataSecurityIssue,
  findings: ReadonlyArray<DataSecurityFindingForAi> = [],
): string {
  const instruction: string = isTelemetryFindingCheck(issue.checkId)
    ? DATA_SECURITY_TELEMETRY_FIX_INSTRUCTION
    : DATA_SECURITY_FIX_INSTRUCTION;

  return `${instruction}\n\n${describeDataSecurityIssueForAi(issue, undefined, findings)}`;
}
