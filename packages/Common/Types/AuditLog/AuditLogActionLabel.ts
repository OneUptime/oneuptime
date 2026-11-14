import AuditLogAction from "./AuditLogAction";

/*
 * Marks an English text as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here
 * so this file stays free of the UI. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * How each action reads where people read the audit log: its table, its
 * filter and an entry's details. An entry, the API and an export carry the
 * action itself ("SignIn"); these are its words ("Sign In"), keys of the
 * Dashboard's locales (its extractor reads this file as a "keys" root),
 * looked up in the reader's language wherever they are drawn.
 */
export const AUDIT_LOG_ACTION_LABELS: Readonly<Record<AuditLogAction, string>> =
  {
    [AuditLogAction.Create]: translationKey("Create"),
    [AuditLogAction.Update]: translationKey("Update"),
    [AuditLogAction.Delete]: translationKey("Delete"),
    [AuditLogAction.Download]: translationKey("Download"),
    [AuditLogAction.SignIn]: translationKey("Sign In"),
    [AuditLogAction.SignOut]: translationKey("Sign Out"),
    [AuditLogAction.SessionTimeout]: translationKey("Session Timeout"),
    [AuditLogAction.SessionRevoked]: translationKey("Session Revoked"),
  };

// The words of an action, or the action as it is when it is not one this release knows.
export const getAuditLogActionLabel: (action: string | undefined) => string = (
  action: string | undefined,
): string => {
  if (!action) {
    return "Unknown";
  }

  return AUDIT_LOG_ACTION_LABELS[action as AuditLogAction] || action;
};
