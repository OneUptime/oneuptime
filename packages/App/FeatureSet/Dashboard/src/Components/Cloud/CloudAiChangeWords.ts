import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import Route from "Common/Types/API/Route";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getResourceAiLogsFixAnchor } from "../ResourceAiAgent/ResourceAiLogs";
import { CloudAiChange } from "./CloudChangesScope";

/*
 * THE WORDS OF A CHANGE ONEUPTIME AI MADE, ON A CLOUD CHANGES LIST.
 *
 * The cloud recorded the change under the Cloud AI agent's role; the list
 * says OneUptime AI made it and who approved it or that it ran on its own
 * (its By column), and links it to its fix: the incident or alert it fixed
 * (by its number when the reader may read it) and its entry in the
 * account's AI Logs. Whole phrases, each a key of its own, so every
 * language words them its way. Pure on purpose (no React), so the suites
 * read it without a page.
 */

// Who made it, in the By column and, where that is not drawn, on its line.
export const CLOUD_AI_CHANGE_BY: string = translationKey("OneUptime AI");

// Where the fix and every command of it are listed.
export const CLOUD_AI_CHANGE_LOGS: string = translationKey("AI Logs");

// The fix's approver, and a fix that ran without one.
export const CLOUD_AI_CHANGE_APPROVED_BY: string = translationKey(
  "Approved by {{name}}",
);
export const CLOUD_AI_CHANGE_APPLIED_AUTOMATICALLY: string = translationKey(
  "Applied automatically",
);

/*
 * The record the change fixed, as its link reads: the fix or its rollback,
 * for an incident or an alert, by its number when the reader may read it.
 */
export const CLOUD_AI_CHANGE_SUBJECTS: {
  readonly fix: {
    readonly incident: string;
    readonly alert: string;
    readonly anIncident: string;
    readonly anAlert: string;
  };
  readonly rollback: {
    readonly incident: string;
    readonly alert: string;
    readonly anIncident: string;
    readonly anAlert: string;
  };
} = {
  fix: {
    incident: translationKey("Fix for incident {{number}}"),
    alert: translationKey("Fix for alert {{number}}"),
    anIncident: translationKey("Fix for an incident"),
    anAlert: translationKey("Fix for an alert"),
  },
  rollback: {
    incident: translationKey("Rollback of the fix for incident {{number}}"),
    alert: translationKey("Rollback of the fix for alert {{number}}"),
    anIncident: translationKey("Rollback of a fix for an incident"),
    anAlert: translationKey("Rollback of a fix for an alert"),
  },
};

// The fix of a change, as the reader's read of it says.
export interface CloudAiChangeFix {
  id: string;
  status: string | null;
  // Who approved it: their name, or their email without one.
  approvedByName: string | null;
  incidentId: string | null;
  // "INC-42", or "#42" when the project numbers incidents without a prefix.
  incidentNumber: string | null;
  alertId: string | null;
  alertNumber: string | null;
}

function text(value: unknown): string | null {
  const read: string =
    value === undefined || value === null ? "" : String(value).trim();

  return read ? read : null;
}

function numberLabel(withPrefix: unknown, plain: unknown): string | null {
  return (
    text(withPrefix) ||
    (typeof plain === "number" && Number.isFinite(plain) ? `#${plain}` : null)
  );
}

// One fix as the list read it, or null for a row it cannot place.
export function readCloudAiChangeFix(
  suggestion: AutoRemediationSuggestion,
): CloudAiChangeFix | null {
  const id: string | null = text(suggestion._id || suggestion.id);

  if (!id) {
    return null;
  }

  return {
    id: id.toLowerCase(),
    status: text(suggestion.status),
    approvedByName:
      text(suggestion.approvedByUser?.name) ||
      text(suggestion.approvedByUser?.email),
    incidentId: text(suggestion.incidentId)?.toLowerCase() || null,
    incidentNumber: suggestion.incident
      ? numberLabel(
          suggestion.incident.incidentNumberWithPrefix,
          suggestion.incident.incidentNumber,
        )
      : null,
    alertId: text(suggestion.alertId)?.toLowerCase() || null,
    alertNumber: suggestion.alert
      ? numberLabel(
          suggestion.alert.alertNumberWithPrefix,
          suggestion.alert.alertNumber,
        )
      : null,
  };
}

// The record a change fixed, as its link names it.
export interface CloudAiChangeSubject {
  kind: "incident" | "alert";
  recordId: string;
  // The phrase (a translation key) and what fills it.
  template: string;
  values: Record<string, string>;
}

/*
 * The incident or alert the change fixed, by the change's own event first
 * (it holds the record's id for everyone who may read the list) and by
 * the fix the reader read; its number only from that read, so a private
 * incident's number never reaches someone who may not read it. Null when
 * the change names no record.
 */
export function describeCloudAiChangeSubject(data: {
  change: CloudAiChange;
  fix: CloudAiChangeFix | null;
}): CloudAiChangeSubject | null {
  const fix: CloudAiChangeFix | null = data.fix;
  const words: (typeof CLOUD_AI_CHANGE_SUBJECTS)["fix"] = data.change.isRollback
    ? CLOUD_AI_CHANGE_SUBJECTS.rollback
    : CLOUD_AI_CHANGE_SUBJECTS.fix;
  const incidentId: string | null =
    data.change.incidentId || fix?.incidentId || null;
  const alertId: string | null = data.change.alertId || fix?.alertId || null;

  if (incidentId) {
    const number: string | null =
      fix && fix.incidentId === incidentId ? fix.incidentNumber : null;

    return {
      kind: "incident",
      recordId: incidentId,
      template: number ? words.incident : words.anIncident,
      values: number ? { number } : {},
    };
  }

  if (alertId) {
    const number: string | null =
      fix && fix.alertId === alertId ? fix.alertNumber : null;

    return {
      kind: "alert",
      recordId: alertId,
      template: number ? words.alert : words.anAlert,
      values: number ? { number } : {},
    };
  }

  return null;
}

// Who let a change run: the phrase (a translation key) and the approver.
export interface CloudAiChangeApproval {
  template: string;
  // The approver's name, for "Approved by {{name}}"; null for a fix that ran on its own.
  name: string | null;
}

/*
 * How the fix came to run: who approved it, or that it ran on its own
 * (the account lets safe fixes run without asking). Null while the reader
 * could not read the fix, for a fix in any other state, and for a
 * rollback: the rollback arm runs it on its own once the fix did not help,
 * so nobody approved it - the fix's approver beside it read as if they had.
 */
export function describeCloudAiChangeApproval(data: {
  change: CloudAiChange;
  fix: CloudAiChangeFix | null;
}): CloudAiChangeApproval | null {
  const fix: CloudAiChangeFix | null = data.fix;

  if (!fix || data.change.isRollback) {
    return null;
  }

  if (
    fix.status === AutoRemediationSuggestionStatus.Approved &&
    fix.approvedByName
  ) {
    return { template: CLOUD_AI_CHANGE_APPROVED_BY, name: fix.approvedByName };
  }

  if (fix.status === AutoRemediationSuggestionStatus.AutoExecuted) {
    return { template: CLOUD_AI_CHANGE_APPLIED_AUTOMATICALLY, name: null };
  }

  return null;
}

/*
 * Where a change's AI Logs entry is: the account's AI Logs page, at its
 * fix's entry when the change names one. Null without an account to name.
 */
export function getCloudAiChangeLogsRoute(data: {
  aiLogsRoute: Route | null;
  suggestionId: string | null;
}): Route | null {
  if (!data.aiLogsRoute) {
    return null;
  }

  return data.suggestionId && ObjectID.isValidUUID(data.suggestionId)
    ? new Route(
        `${data.aiLogsRoute.toString()}#${getResourceAiLogsFixAnchor(data.suggestionId)}`,
      )
    : data.aiLogsRoute;
}
