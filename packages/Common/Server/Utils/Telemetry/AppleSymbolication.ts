import TelemetryDsymService from "../../Services/TelemetryDsymService";
import logger from "../Logger";
import CaptureSpan from "./CaptureSpan";
import ObjectID from "../../../Types/ObjectID";
import {
  AppleCrashReport,
  parseAppleCrashReport,
} from "../../../Utils/Telemetry/AppleCrashReport";
import { AppleSymbolTable } from "../../../Utils/Telemetry/AppleSymbols";
import {
  AppleSymbolicationResult,
  getAppleReportDebugIds,
  symbolicateAppleReport,
} from "../../../Utils/Telemetry/AppleSymbolicate";
import { toAppleSymbolDisplayName } from "../../../Utils/Telemetry/SwiftDemangle";

/*
 * AN IOS APP'S CRASH AND HANG STACKS, SYMBOLICATED AT INGEST (#9922).
 *
 * Ingest hands every mobile app fault's stack trace here before it is
 * grouped: an Apple crash report - MetricKit's drawn threads, KSCrash's
 * report - has each frame whose binary has an uploaded dSYM named by its
 * function (AppleSymbolicate), so the exception reads
 * "CartViewController.checkout()" and groups by function across releases
 * (ExceptionGrouping). Anything else, and a report no dSYM resolves, is
 * left as it was.
 *
 * One app's crashes come from the same few builds, so each build's table
 * is read once and kept in memory: up to CACHE_WEIGHT_LIMIT of them, the
 * least recently read dropped first, each for TABLE_TTL_MS. A build with no
 * dSYM is remembered as one for MISSING_TTL_MS only, so a dSYM uploaded after
 * its build's first crash names the crashes that follow within minutes.
 * Never throws: a read that fails leaves the stack as it was.
 */

const TABLE_TTL_MS: number = 30 * 60 * 1000;
const MISSING_TTL_MS: number = 2 * 60 * 1000;

// About how much memory the kept tables may take, in bytes.
export const CACHE_WEIGHT_LIMIT: number = 256 * 1024 * 1024;

interface CachedTable {
  table: AppleSymbolTable | null;
  expiresAt: number;
  weight: number;
}

// A table's rough size in memory: its offsets, and its names' characters.
function weightOf(table: AppleSymbolTable | null): number {
  if (!table) {
    return 64;
  }

  let characters: number = 0;

  for (const name of table.names) {
    characters += name.length;
  }

  return table.offsets.length * 16 + characters * 2;
}

export default class AppleSymbolication {
  private static cache: Map<string, CachedTable> = new Map<
    string,
    CachedTable
  >();

  private static cacheWeight: number = 0;

  public static clearCache(): void {
    this.cache.clear();
    this.cacheWeight = 0;
  }

  private static keyOf(projectId: ObjectID, debugId: string): string {
    return `${projectId.toString()}|${debugId}`;
  }

  private static remember(key: string, table: AppleSymbolTable | null): void {
    const existing: CachedTable | undefined = this.cache.get(key);

    if (existing) {
      this.cacheWeight -= existing.weight;
      this.cache.delete(key);
    }

    const weight: number = weightOf(table);

    // A table larger than the whole cache is read each time instead.
    if (weight > CACHE_WEIGHT_LIMIT) {
      return;
    }

    while (this.cacheWeight + weight > CACHE_WEIGHT_LIMIT) {
      const oldest: string | undefined = this.cache.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.cacheWeight -= this.cache.get(oldest)!.weight;
      this.cache.delete(oldest);
    }

    this.cache.set(key, {
      table,
      expiresAt: Date.now() + (table ? TABLE_TTL_MS : MISSING_TTL_MS),
      weight,
    });
    this.cacheWeight += weight;
  }

  // The tables of the builds named, by UUID: a build with no dSYM is absent.
  @CaptureSpan()
  public static async getTables(data: {
    projectId: ObjectID;
    debugIds: Array<string>;
  }): Promise<Map<string, AppleSymbolTable>> {
    const tables: Map<string, AppleSymbolTable> = new Map<
      string,
      AppleSymbolTable
    >();
    const toRead: Array<string> = [];
    const now: number = Date.now();

    for (const debugId of data.debugIds) {
      const key: string = this.keyOf(data.projectId, debugId);
      const cached: CachedTable | undefined = this.cache.get(key);

      if (cached && cached.expiresAt > now) {
        // Read again: the most recently read stays longest.
        this.cache.delete(key);
        this.cache.set(key, cached);

        if (cached.table) {
          tables.set(debugId, cached.table);
        }

        continue;
      }

      toRead.push(debugId);
    }

    if (toRead.length > 0) {
      const read: Map<string, AppleSymbolTable> =
        await TelemetryDsymService.getSymbolTables({
          projectId: data.projectId,
          debugIds: toRead,
        });

      for (const debugId of toRead) {
        const table: AppleSymbolTable | null = read.get(debugId) || null;

        this.remember(this.keyOf(data.projectId, debugId), table);

        if (table) {
          tables.set(debugId, table);
        }
      }
    }

    return tables;
  }

  /*
   * A stack trace with every frame a dSYM resolves named by its function,
   * or null when it is no Apple crash report or no frame of it resolved.
   */
  @CaptureSpan()
  public static async symbolicateStackTrace(data: {
    projectId: ObjectID;
    stackTrace: string;
  }): Promise<string | null> {
    try {
      const report: AppleCrashReport | null = parseAppleCrashReport(
        data.stackTrace,
      );

      if (!report) {
        return null;
      }

      const debugIds: Array<string> = getAppleReportDebugIds(report);

      if (debugIds.length === 0) {
        return null;
      }

      const tables: Map<string, AppleSymbolTable> = await this.getTables({
        projectId: data.projectId,
        debugIds,
      });

      if (tables.size === 0) {
        return null;
      }

      const result: AppleSymbolicationResult = symbolicateAppleReport({
        report,
        tables,
        displayName: toAppleSymbolDisplayName,
      });

      return result.resolvedFrames > 0 ? result.text : null;
    } catch (err) {
      logger.warn(
        `Could not symbolicate an iOS stack trace; it is kept as it was sent: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
