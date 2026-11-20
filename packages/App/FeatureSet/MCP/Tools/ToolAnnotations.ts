/**
 * Tool Annotations
 *
 * The hints every tool carries, each one stated outright. Clients read them
 * to decide what to run without asking: Claude runs a read-only tool on its
 * own and always asks before a destructive one. MCP directories hold every
 * tool to them: the Claude Connectors Directory requires a readOnlyHint or a
 * destructiveHint on each tool, and ChatGPT's app directory requires
 * readOnlyHint, destructiveHint and openWorldHint, each set to true or false.
 *
 * Every tool that changes something is destructive. Most writes in OneUptime
 * overwrite or delete a record, move an incident or an alert to another
 * state, page someone on call, or post to a status page, and the directories
 * allow destructiveHint: false only for a write that adds and sends nothing.
 * So a client asks before each write, whatever model the tool was made for.
 *
 * A tool is open-world when it reaches past the caller's project. The public
 * status page tools read any public status page on the instance, without a
 * credential. A write is open-world when what it changes is published:
 * shown on a public status page and sent to the page's subscribers. A write
 * is open-world, too, when it points OneUptime at an address outside it: a
 * monitor checks the website or host it is given, and a data store or a BI
 * tool is reached with the connection it is given. And invite_people emails
 * addresses that need not be anyone in the project yet (#10041). Every
 * other tool works inside the one project its credential belongs to.
 */

import { ToolAnnotations } from "../Types/McpTypes";

/*
 * The resources whose writes are published, by table name. A status page is
 * the public page itself. Each of the others is shown on the status pages it
 * belongs to and sent to their subscribers by email, SMS or webhook
 * (Workers/Jobs/<resource>/SendNotificationToSubscribers). So creating,
 * changing or deleting one changes what people outside the caller's project
 * see or are sent, and its write tools are open-world. OpenAI's plugin review
 * flags such a tool marked closed-world.
 */
export const PUBLISHED_TABLE_NAMES: ReadonlySet<string> = new Set<string>([
  "StatusPage",
  "StatusPageAnnouncement",
  "Incident",
  "IncidentStateTimeline",
  "IncidentPublicNote",
  "ScheduledMaintenance",
  "ScheduledMaintenanceStateTimeline",
]);

export function isPublishedTable(tableName: string): boolean {
  return PUBLISHED_TABLE_NAMES.has(tableName);
}

/*
 * The resources that point OneUptime at an address outside it, by table
 * name. A monitor checks the website, API, host or port it is given, on a
 * schedule, from OneUptime's probes or the project's own. A data store is
 * reached with its connection string, and a BI tool at its address with its
 * credentials. So creating or changing one has OneUptime reach a system it
 * does not run, and those tools are open-world. Deleting one stops that and
 * reaches nothing, so its delete tool is not. OpenAI's plugin review flags
 * create_monitor and update_monitor marked closed-world.
 */
export const OUTSIDE_ADDRESS_TABLE_NAMES: ReadonlySet<string> = new Set<string>(
  ["Monitor", "DataStore", "DataBiConnection"],
);

export function isOutsideAddressTable(tableName: string): boolean {
  return OUTSIDE_ADDRESS_TABLE_NAMES.has(tableName);
}

// A tool that changes nothing.
export function readOnlyToolAnnotations(options?: {
  // It reads public status pages beyond the caller's project.
  openWorld?: boolean | undefined;
}): ToolAnnotations {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: options?.openWorld === true,
  };
}

// A tool that changes something in the caller's project.
export function writeToolAnnotations(options?: {
  // Calling it again with the same arguments changes nothing more.
  idempotent?: boolean | undefined;
  /*
   * What it changes is published - on a status page, and to its
   * subscribers - it points OneUptime at an address outside it, as a
   * monitor does, or it emails people outside the project.
   */
  openWorld?: boolean | undefined;
}): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: options?.openWorld === true,
    ...(options?.idempotent ? { idempotentHint: true } : {}),
  };
}
