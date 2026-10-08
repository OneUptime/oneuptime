import ToolImportResourceKind from "./ToolImportResourceKind";

/*
 * HOW MUCH ONE IMPORT MAY READ AND CREATE.
 *
 * An import acts for a person, with their permissions, and every record it
 * creates goes through the same checks as one they create by hand - so the
 * caps are not about trust. They keep one import a size a person can review
 * on one page, that a worker finishes well inside its time limit, and that
 * cannot flood a project (or its members' inboxes, for invitations) by
 * mistake. Whatever is over a cap is listed as skipped, with the cap, and
 * running the import again brings over the next ones: what the first run
 * created is found by its source id and left alone.
 */

// Records of each kind one import creates at most.
export const TOOL_IMPORT_MAX_ITEMS_PER_KIND: Record<
  ToolImportResourceKind,
  number
> = {
  [ToolImportResourceKind.Person]: 500,
  [ToolImportResourceKind.Team]: 200,
  [ToolImportResourceKind.Service]: 500,
  [ToolImportResourceKind.IncidentSeverity]: 25,
  [ToolImportResourceKind.IncidentState]: 25,
  [ToolImportResourceKind.IncidentRole]: 25,
  [ToolImportResourceKind.IncidentCustomField]: 100,
  [ToolImportResourceKind.OnCallSchedule]: 200,
  [ToolImportResourceKind.OnCallPolicy]: 200,
};

// Records one import creates at most, of every kind together.
export const TOOL_IMPORT_MAX_ITEMS: number = 2000;

// Layers of one OneUptime schedule, and levels of one policy, at most.
export const TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE: number = 20;
export const TOOL_IMPORT_MAX_LEVELS_PER_POLICY: number = 25;

// Choices of one dropdown custom field at most.
export const TOOL_IMPORT_MAX_CUSTOM_FIELD_OPTIONS: number = 200;

/*
 * The read: requests one read makes at most (pagination included), the
 * records of one kind it collects at most, and how long it may take.
 */
export const TOOL_IMPORT_MAX_REQUESTS: number = 2000;
export const TOOL_IMPORT_MAX_RECORDS_PER_KIND: number = 5000;
export const TOOL_IMPORT_READ_TIMEOUT_MS: number = 15 * 60 * 1000;
export const TOOL_IMPORT_REQUEST_TIMEOUT_MS: number = 30 * 1000;

// The largest response one request may return.
export const TOOL_IMPORT_MAX_RESPONSE_BYTES: number = 20 * 1024 * 1024;

/*
 * The longest an import's preview waits to be started. The preview is a
 * picture of the other tool when it was read; past this the person reads
 * it again (which needs the key again), so a stale picture is never
 * imported.
 */
export const TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS: number = 24 * 60 * 60 * 1000;

// Names and descriptions are cut to the columns they are stored in.
export const TOOL_IMPORT_MAX_NAME_LENGTH: number = 100;
export const TOOL_IMPORT_MAX_DESCRIPTION_LENGTH: number = 500;

// An API key is a token: anything longer than this is not one.
export const TOOL_IMPORT_MAX_API_KEY_LENGTH: number = 512;
