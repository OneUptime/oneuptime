import BadDataException from "../../../Types/Exception/BadDataException";
import ToolImportResourceKind from "../../../Types/ToolImport/ToolImportResourceKind";
import { ToolImportSnapshot } from "../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";
import { ToolImportSleep, ToolImportTransport } from "./ToolImportHttpClient";

/*
 * THE CONTRACT EVERY TOOL'S ADAPTER IMPLEMENTS.
 *
 * An adapter reads one tool's API with a person's key and returns what it
 * read as a ToolImportSnapshot - people, teams, schedules, escalation
 * policies, services, incident settings - in OneUptime's words. That is all
 * it does. It never writes to OneUptime: the planner decides what each item
 * becomes, the applier creates it through OneUptime's own services, and
 * neither knows which tool the snapshot came from.
 *
 * To add a tool:
 *   1. ToolImportSource: a value. ToolImportCatalog: its hosts, regions,
 *      docs links, the kinds it brings and its auth scheme.
 *   2. Adapters/<Tool>/<Tool>Adapter.ts implementing this interface, reading
 *      only through ToolImportHttpClient (built with createClient below, so
 *      it can only call the catalog's hosts and backs off on 429).
 *   3. Register it in ToolImportAdapterRegistry.
 *   4. The page's copy for it (Dashboard Components/ToolImport/
 *      ToolImportText: how to create the key) and a docs page.
 *   5. Fixture tests in the documented response shapes. Never a real API.
 *
 * Rules an adapter keeps:
 *  - Throw ToolImportReadError (or let a ToolImportHttpError through) only
 *    when nothing useful can be read: the key is refused, the tool is down.
 *    Anything narrower - a list the key may not read, one team that is gone
 *    - is a note on the snapshot or the item, and the rest is still read.
 *  - Collect at most TOOL_IMPORT_MAX_RECORDS_PER_KIND of each kind and say
 *    so with a ReadLimitReached note when there were more.
 *  - Normalise: emails lowercase, names trimmed, ids as strings, times ISO.
 *  - Never put the key, or anything derived from it, into the snapshot, a
 *    note or a message.
 */

export interface ToolImportReadSettings {
  source: ToolImportSource;
  // The key, decrypted. Server-only: never logged, returned or stored as is.
  apiKey: string;
  // The region's value from the catalog ("" for a tool with one API).
  region: string;
}

export interface ToolImportReadContext {
  transport: ToolImportTransport;
  sleep?: ToolImportSleep | undefined;
  now?: (() => number) | undefined;
  maxRequests: number;
  // Epoch ms the read must finish by.
  deadlineAt: number;
  requestTimeoutInMs?: number | undefined;
  // Told what the adapter reads next, for the progress line on the page.
  onProgress?: ((kind: ToolImportResourceKind) => Promise<void>) | undefined;
}

export interface ToolImportAdapter {
  source: ToolImportSource;

  /*
   * Read everything the tool's import brings over. Throws only when nothing
   * useful can be read (see the rules above).
   */
  read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot>;
}

/*
 * A read that cannot go on, with a message for the person: the key was
 * refused, the key may read nothing the import needs.
 */
export class ToolImportReadError extends BadDataException {
  public constructor(message: string) {
    super(message);
  }
}
