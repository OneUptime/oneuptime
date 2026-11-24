import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/TelemetryDsym";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ColumnLength from "../../Types/Database/ColumnLength";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  AppleSymbolFile,
  AppleSymbolTable,
  countStoredAppleSymbols,
  decodeAppleSymbols,
  encodeAppleSymbols,
  normalizeAppleDebugId,
} from "../../Utils/Telemetry/AppleSymbols";

/*
 * THE DSYMS OF A PROJECT'S IOS APPS (#9922), ONE ROW PER BUILD OF A BINARY.
 *
 * Written by the upload (Telemetry/API/DsymIngest), from a dSYM the CLI read
 * on the developer's machine or one sent as it is; read by ingest, by the
 * UUIDs a crash's frames name (AppleSymbolication). A UUID uploaded again
 * replaces its rows, so a CI re-run converges on one.
 *
 * Kept for DSYM_RETENTION_DAYS after upload: an app's release stays on
 * people's phones for months, and its crashes keep arriving, so far longer
 * than a web release's source maps. A dSYM uploaded again starts again.
 */
export const DSYM_RETENTION_DAYS: number = 400;

// The most a build's stored symbols may weigh, in bytes.
export const MAX_DSYM_SYMBOLS_SIZE_IN_BYTES: number = 64 * 1024 * 1024;

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("createdAt", DSYM_RETENTION_DAYS);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const debugId: string | null = normalizeAppleDebugId(createBy.data.debugId);

    if (!debugId) {
      throw new BadDataException(
        "The binary's UUID is required: 32 hexadecimal digits, with or without dashes.",
      );
    }

    createBy.data.debugId = debugId;

    const symbols: string | undefined = createBy.data.symbols;

    if (!symbols) {
      throw new BadDataException("The dSYM's symbols are required.");
    }

    const sizeInBytes: number = Buffer.byteLength(symbols, "utf8");

    if (sizeInBytes > MAX_DSYM_SYMBOLS_SIZE_IN_BYTES) {
      throw new BadDataException(
        `The dSYM's symbols are too large: at most ${
          MAX_DSYM_SYMBOLS_SIZE_IN_BYTES / (1024 * 1024)
        }\u00A0MB are kept per binary.`,
      );
    }

    if (!decodeAppleSymbols(symbols)) {
      throw new BadDataException(
        "The dSYM's symbols are not in the form OneUptime keeps them. Upload the dSYM itself, or what the OneUptime CLI reads from it.",
      );
    }

    if (!createBy.data.binaryName || !createBy.data.binaryName.trim()) {
      throw new BadDataException("The binary's name is required.");
    }

    createBy.data.binaryName = createBy.data.binaryName
      .trim()
      .slice(0, ColumnLength.ShortText);
    createBy.data.architecture = (createBy.data.architecture || "")
      .trim()
      .slice(0, ColumnLength.ShortText);

    if (!createBy.data.architecture) {
      throw new BadDataException("The binary's architecture is required.");
    }

    if (createBy.data.appName) {
      createBy.data.appName = createBy.data.appName
        .trim()
        .slice(0, ColumnLength.ShortText);
    }

    createBy.data.sizeInBytes = sizeInBytes;
    createBy.data.symbolCount = countStoredAppleSymbols(symbols);

    return { createBy, carryForward: null };
  }

  /*
   * Store a build's symbols, replacing what was uploaded for its UUID
   * before. Hard deletes: a replaced dSYM has no restore story, and
   * soft-deleted rows would hold megabytes until a sweep. Used by the
   * authenticated upload, hence isRoot.
   */
  @CaptureSpan()
  public async replaceSymbolFile(data: {
    projectId: ObjectID;
    file: AppleSymbolFile;
    appName?: string | undefined;
  }): Promise<Model> {
    const debugId: string | null = normalizeAppleDebugId(data.file.debugId);

    if (!debugId) {
      throw new BadDataException(
        `${data.file.binaryName || "A binary"} has no UUID to match its crashes by.`,
      );
    }

    await this.hardDeleteBy({
      query: {
        projectId: data.projectId,
        debugId: debugId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const dsym: Model = new Model();
    dsym.projectId = data.projectId;
    dsym.debugId = debugId;
    dsym.binaryName = data.file.binaryName;
    dsym.architecture = data.file.architecture;
    dsym.symbols = encodeAppleSymbols({
      symbols: data.file.symbols,
      textEndOffset: data.file.textEndOffset,
    });

    if (data.appName) {
      dsym.appName = data.appName;
    }

    return this.create({
      data: dsym,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The symbol tables of the builds a crash's frames name, by UUID; a UUID
   * with no dSYM is not in the map. Reads as root: callers are ingest, for
   * the project the telemetry was sent to.
   */
  @CaptureSpan()
  public async getSymbolTables(data: {
    projectId: ObjectID;
    debugIds: Array<string>;
  }): Promise<Map<string, AppleSymbolTable>> {
    const tables: Map<string, AppleSymbolTable> = new Map<
      string,
      AppleSymbolTable
    >();

    const debugIds: Array<string> = [];

    for (const value of data.debugIds) {
      const debugId: string | null = normalizeAppleDebugId(value);

      if (debugId && !debugIds.includes(debugId)) {
        debugIds.push(debugId);
      }
    }

    if (debugIds.length === 0) {
      return tables;
    }

    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        debugId: QueryHelper.any(debugIds),
      },
      select: {
        _id: true,
        debugId: true,
        symbols: true,
        createdAt: true,
      },
      // The newest first: a racing double upload's newer rows win.
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: debugIds.length * 2,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const row of rows) {
      const debugId: string | null = normalizeAppleDebugId(row.debugId);

      if (!debugId || tables.has(debugId) || !row.symbols) {
        continue;
      }

      const table: AppleSymbolTable | null = decodeAppleSymbols(row.symbols);

      if (table) {
        tables.set(debugId, table);
      }
    }

    return tables;
  }
}

export default new Service();
