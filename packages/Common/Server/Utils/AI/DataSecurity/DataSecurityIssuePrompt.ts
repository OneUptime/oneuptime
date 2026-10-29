import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { AIPromptOmissions } from "../../../../Types/AI/AIChatTypes";
import {
  CheckRemediation,
  DataSecurityCheckInfo,
  fillRemediationText,
  getCheckRemediation,
  getDataSecurityCheck,
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
 * The check's words are OneUptime's own (DataSecurityCheckCatalog). The
 * store's name, its cloud id and the evidence are not - a cloud or a person
 * named the store, and evidence quotes what a cloud answered - so each goes
 * in as a field, held to a length with embedded data left out.
 */

// The most one of the store's own values takes in the prompt.
export const MAX_ISSUE_VALUE_LENGTH: number = 500;
// The most the evidence takes.
export const MAX_ISSUE_EVIDENCE_LENGTH: number = 2_000;

export const DATA_SECURITY_EXPLAIN_SYSTEM_PROMPT: string =
  "You are a data security engineer. Explain the issue to the store's owner in plain words: what is wrong, what could happen, and the exact steps to fix it on their cloud. Be brief and concrete. Never invent facts that are not in the issue.";

export const DATA_SECURITY_FIX_INSTRUCTION: string =
  "Fix this data security issue in the infrastructure code (Terraform, CloudFormation, Bicep or similar), with the smallest change that makes the check pass. Open a pull request.";

function value(
  text: string | null | undefined,
  maxLength: number,
  omissions: AIPromptOmissions | undefined,
): string {
  return PromptText.field(text, { maxLength, omissions });
}

/*
 * The issue in words for OneUptime AI, one fact a line: no samples, only
 * what a check saw. A fact nobody recorded is left out, never guessed.
 */
export function describeDataSecurityIssueForAi(
  issue: DataSecurityIssue,
  omissions?: AIPromptOmissions | undefined,
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
  const store: string = [name || "unknown", where.length > 0 ? `(${where.join(", ")})` : ""]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" ");
  const evidence: string = value(
    issue.evidence,
    MAX_ISSUE_EVIDENCE_LENGTH,
    omissions,
  );
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
    check ? `Why it matters: ${check.whyItMatters}` : "",
    ...fix,
  ]
    .filter((line: string): boolean => {
      return line.length > 0;
    })
    .join("\n");
}

// What Fix with AI asks the coding agent to do: the instruction, then the issue.
export function buildDataSecurityFixRequest(
  issue: DataSecurityIssue,
): string {
  return `${DATA_SECURITY_FIX_INSTRUCTION}\n\n${describeDataSecurityIssueForAi(issue)}`;
}
