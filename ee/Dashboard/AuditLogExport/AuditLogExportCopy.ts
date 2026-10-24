import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the audit log export screens say - the project's (Settings > Audit
 * Logs > Export) and the instance's (Admin Dashboard > Settings > Audit Log
 * Export) - kept free of React so the components and the tests read the
 * same words. The sentences are English keys: both frontends' locale files
 * hold them in every language, and the shared components translate them
 * where they are shown.
 *
 * The destinations' own words (titles, fields, options) are the catalog's
 * (Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog), drawn as
 * written there and translated the same way.
 */

// Whose audit log an export sends: one project's, or every project's.
export enum AuditLogExportScope {
  Project = "project",
  Instance = "instance",
}

export interface AuditLogExportScopeCopy {
  cardTitle: string;
  cardDescription: string;
  // The route a test of this scope's exports is sent to (ee/Server/AuditLogExport/API).
  testRoute: string;
}

export const AUDIT_LOG_EXPORT_SCOPE_COPY: Record<
  AuditLogExportScope,
  AuditLogExportScopeCopy
> = {
  [AuditLogExportScope.Project]: {
    cardTitle: translationKey("Export Audit Logs"),
    cardDescription: translationKey(
      "Send this project's audit log to storage or a service you choose, as it is recorded. Each entry is sent once, in order, as JSON.",
    ),
    testRoute: "/audit-log-export/test",
  },
  [AuditLogExportScope.Instance]: {
    cardTitle: translationKey("Export Audit Logs"),
    cardDescription: translationKey(
      "Send the audit log of every project on this instance to storage or a service you choose, as it is recorded. Each entry is sent once, in order, as JSON. A project records audit logs while audit logging is on in its settings.",
    ),
    testRoute: "/audit-log-export/instance/test",
  },
};

export const AuditLogExportCopy: {
  addButton: string;
  emptyTitle: string;
  emptyDescription: string;
  // The form.
  createTitle: string;
  createDescription: string;
  editTitle: string;
  editDescription: string;
  createButton: string;
  saveButton: string;
  destinationStep: string;
  connectionStep: string;
  exportStep: string;
  destinationField: string;
  destinationFieldDescription: string;
  testField: string;
  nameField: string;
  nameFieldDescription: string;
  namePlaceholder: string;
  startsAtField: string;
  startsAtCreateDescription: string;
  startsAtEditDescription: string;
  enabledField: string;
  enabledFieldDescription: string;
  unchangedPlaceholder: string;
  // The test.
  testFilesButton: string;
  testStreamButton: string;
  testFilesHint: string;
  testStreamHint: string;
  testSucceeded: string;
  testFailed: string;
  testModalTitle: string;
  testModalDescription: string;
  testAgainButton: string;
  testSending: string;
  testRowAction: string;
  testRowActionTooltip: string;
  testChooseDestinationFirst: string;
  testFillSettingsFirst: string;
  testPasteCredentialsFirst: string;
  // The table.
  statusColumn: string;
  lastExported: string;
  failingSince: string;
  viewErrorAction: string;
  errorTitle: string;
  errorDescription: string;
  copyError: string;
  fullErrorLabel: string;
  nextTry: string;
  licenseRequired: string;
} = {
  addButton: translationKey("Add export"),
  emptyTitle: translationKey("Nothing is exported yet"),
  emptyDescription: translationKey(
    "Amazon S3, S3-compatible storage, Google Cloud Storage, Azure Blob Storage, webhooks and syslog are supported.",
  ),
  createTitle: translationKey("Export audit logs"),
  createDescription: translationKey(
    "Choose where the audit log goes and how to reach it, then send a test before saving.",
  ),
  editTitle: translationKey("Edit {{name}}"),
  editDescription: translationKey(
    "Change how the export reaches its destination. Credentials stay unless you paste new ones.",
  ),
  createButton: translationKey("Start exporting"),
  saveButton: translationKey("Save changes"),
  destinationStep: translationKey("Destination"),
  connectionStep: translationKey("Connection"),
  exportStep: translationKey("Export"),
  destinationField: translationKey("Destination"),
  destinationFieldDescription: translationKey(
    "Where the audit log is sent. It cannot be changed later.",
  ),
  testField: translationKey("Test before saving"),
  nameField: translationKey("Name"),
  nameFieldDescription: translationKey(
    "How this export appears in the list. Left empty, it is the destination's name.",
  ),
  namePlaceholder: translationKey("e.g. Compliance archive"),
  startsAtField: translationKey("Export from"),
  startsAtCreateDescription: translationKey(
    "Leave empty to send what is recorded from now on. An earlier date also sends the entries still kept since then.",
  ),
  startsAtEditDescription: translationKey(
    "Change it to send again every entry kept since this date, then carry on. Entries already delivered may arrive twice.",
  ),
  enabledField: translationKey("Export"),
  enabledFieldDescription: translationKey(
    "Turned off, nothing is sent. The export keeps its place: turned back on, it sends what was recorded meanwhile.",
  ),
  unchangedPlaceholder: translationKey("Unchanged"),
  testFilesButton: translationKey("Write a test file"),
  testStreamButton: translationKey("Send a test entry"),
  testFilesHint: translationKey(
    "Writes one file holding one test entry, under the folder. Nothing is saved.",
  ),
  testStreamHint: translationKey(
    "Sends one entry whose action is Test. Nothing is saved.",
  ),
  testSucceeded: translationKey("The test was delivered."),
  testFailed: translationKey("The test was not delivered."),
  testModalTitle: translationKey("Send a test: {{name}}"),
  testModalDescription: translationKey(
    "One test entry, sent with the saved settings.",
  ),
  testAgainButton: translationKey("Send again"),
  testSending: translationKey("Sending a test…"),
  testRowAction: translationKey("Send a test"),
  testRowActionTooltip: translationKey(
    "Send one test entry with the saved settings.",
  ),
  testChooseDestinationFirst: translationKey("Choose a destination first."),
  testFillSettingsFirst: translationKey(
    "Fill in the settings above to send a test.",
  ),
  testPasteCredentialsFirst: translationKey(
    "Paste the credentials above to send a test.",
  ),
  statusColumn: translationKey("Status"),
  lastExported: translationKey("Last exported {{time}}"),
  failingSince: translationKey("Failing since {{time}}"),
  viewErrorAction: translationKey("View Error"),
  errorTitle: translationKey("Last Error"),
  errorDescription: translationKey(
    "What the destination answered the last time OneUptime tried to deliver to it. Credentials are never shown.",
  ),
  copyError: translationKey("Copy Error"),
  fullErrorLabel: translationKey("Full error message"),
  nextTry: translationKey("Next try: {{time}}"),
  licenseRequired: translationKey(
    "Needs a valid Enterprise license that includes audit logs.",
  ),
};

// What only a project's page says (Settings > Audit Logs > Export).
export const AuditLogExportProjectCopy: {
  auditLoggingOffTitle: string;
  auditLoggingOffDescription: string;
} = {
  auditLoggingOffTitle: translationKey(
    "Audit logging is off for this project.",
  ),
  auditLoggingOffDescription: translationKey(
    "Nothing new is recorded, so nothing new is exported. Turn it on in Audit Logs > Settings.",
  ),
};

// How an export is doing, as its Status column says.
export enum AuditLogExportHealth {
  Paused = "Paused",
  Failing = "Failing",
  Exporting = "Exporting",
  // Tried, nothing to send yet.
  Waiting = "Waiting for entries",
  // Saved, the first delivery not run yet.
  Starting = "Starting",
}

export const AUDIT_LOG_EXPORT_HEALTH_COPY: Record<
  AuditLogExportHealth,
  { title: string; description: string }
> = {
  [AuditLogExportHealth.Paused]: {
    title: translationKey("Paused"),
    description: translationKey(
      "Nothing is sent while it is turned off. It keeps its place: turned back on, it sends what was recorded meanwhile.",
    ),
  },
  [AuditLogExportHealth.Failing]: {
    title: translationKey("Failing"),
    description: translationKey(
      "The last delivery failed. Open View Error to see why. It is tried again with a growing wait, up to an hour, and no entry is skipped.",
    ),
  },
  [AuditLogExportHealth.Exporting]: {
    title: translationKey("Exporting"),
    description: translationKey(
      "Entries are reaching the destination. New ones are sent every minute.",
    ),
  },
  [AuditLogExportHealth.Waiting]: {
    title: translationKey("Waiting for entries"),
    description: translationKey(
      "Working, with nothing to send yet. Entries are sent as soon as there are some.",
    ),
  },
  [AuditLogExportHealth.Starting]: {
    title: translationKey("Starting"),
    description: translationKey("The first delivery runs within a minute."),
  },
};

/*
 * Above the table when the Enterprise license has stopped exporting, or is
 * about to (self-hosted only: on OneUptime Cloud the plan decides).
 */
export const AuditLogExportLicenseCopy: {
  lapsedTitle: string;
  lapsedDescription: string;
  notIncludedTitle: string;
  notIncludedDescription: string;
  graceTitle: string;
  graceDescription: string;
} = {
  lapsedTitle: translationKey(
    "Enterprise license required: audit logs are not exported.",
  ),
  lapsedDescription: translationKey(
    "Without a valid Enterprise license nothing is recorded or exported, whatever these settings say. Exports keep their place and carry on from there once a license is activated in the Admin Dashboard.",
  ),
  notIncludedTitle: translationKey(
    "Your Enterprise license does not include audit logs: audit logs are not exported.",
  ),
  notIncludedDescription: translationKey(
    "The installed license leaves audit logs out, so nothing is recorded or exported. Exports keep their place and carry on from there once a license that includes audit logs is activated in the Admin Dashboard.",
  ),
  graceTitle: translationKey(
    "No valid Enterprise license: exporting stops when the trial or grace period ends.",
  ),
  graceDescription: translationKey(
    "Audit logs are recorded and exported during the trial or the grace period. When it ends, nothing more is exported until an Enterprise license is activated in the Admin Dashboard.",
  ),
};

// Test ids.
export const AUDIT_LOG_EXPORT_TABLE_ID: string = "audit-log-exports-table";
