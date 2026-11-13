import AuditLogAction from "./AuditLogAction";

/*
 * How each action reads where people read the audit log: its table, its
 * filter and an entry's details. An entry, the API and an export carry the
 * action itself ("SignIn"); these are its words ("Sign In").
 */
export const AUDIT_LOG_ACTION_LABELS: Readonly<Record<AuditLogAction, string>> =
  {
    [AuditLogAction.Create]: "Create",
    [AuditLogAction.Update]: "Update",
    [AuditLogAction.Delete]: "Delete",
    [AuditLogAction.Download]: "Download",
    [AuditLogAction.SignIn]: "Sign In",
    [AuditLogAction.SignOut]: "Sign Out",
    [AuditLogAction.SessionTimeout]: "Session Timeout",
    [AuditLogAction.SessionRevoked]: "Session Revoked",
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
