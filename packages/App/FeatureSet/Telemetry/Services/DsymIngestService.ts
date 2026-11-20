import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryDsymService from "Common/Server/Services/TelemetryDsymService";
import { readDsymSymbolFilesFromBytes } from "Common/Server/Utils/Telemetry/AppleDebugSymbols/DsymFiles";
import { ZipReadOptions } from "Common/Server/Utils/Telemetry/AppleDebugSymbols/ZipArchive";
import TelemetryDsym from "Common/Models/DatabaseModels/TelemetryDsym";
import BadDataException from "Common/Types/Exception/BadDataException";
import ColumnLength from "Common/Types/Database/ColumnLength";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  AppleSymbol,
  AppleSymbolFile,
  AppleSymbolTable,
  decodeAppleSymbols,
  normalizeAppleDebugId,
} from "Common/Utils/Telemetry/AppleSymbols";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";

/*
 * POST /dsyms/v1/upload (#9922): an iOS app's dSYMs, after a build, with a
 * telemetry ingestion key, so its crash and hang stacks read by function.
 *
 * Two ways in, one result:
 *
 *   - the OneUptime CLI (`oneuptime dsym upload`) reads the dSYMs on the
 *     build machine and sends only their symbol tables, as JSON:
 *     { appName, symbolFiles: [{ debugId, architecture, binaryName,
 *     symbols }] }, each table as Utils/Telemetry/AppleSymbols stores it. A
 *     large app's dSYM is hundreds of megabytes of DWARF; its symbols are a
 *     few;
 *   - curl sends the dSYMs as they are, as multipart file parts: each a
 *     dSYM's DWARF file (MyApp.app.dSYM/Contents/Resources/DWARF/MyApp) or
 *     a zip of .dSYM bundles, as Xcode archives and App Store Connect hand
 *     them out, with an optional appName field.
 *
 * Every file is read before any is saved, so a failed request leaves
 * nothing half uploaded; each UUID uploaded again replaces its rows, so a
 * CI re-run is safe. The answer lists every binary stored.
 */

// The most symbol files one request may hold.
export const MAX_DSYM_FILES_PER_REQUEST: number = 200;

/*
 * What an uploaded zip may inflate to, one DWARF file and all of them: an
 * upload is at most 50 MB a file, and a zip that inflates past these is
 * refused rather than read into memory. A larger app's dSYMs go through the
 * CLI, which reads them where they are and sends their symbols alone.
 */
export const DSYM_UPLOAD_ZIP_LIMITS: ZipReadOptions = {
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

interface UploadedFilePart {
  fieldname: string;
  originalname: string;
  buffer: Buffer;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default class DsymIngestService {
  /*
   * The symbol files a CLI upload holds, each checked: its UUID, its
   * architecture and binary, and a table as OneUptime stores one.
   */
  public static readSymbolFilesFromJson(body: unknown): Array<AppleSymbolFile> {
    const symbolFiles: unknown =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as JSONObject)["symbolFiles"]
        : undefined;

    if (!Array.isArray(symbolFiles) || symbolFiles.length === 0) {
      throw new BadDataException(
        "Send symbolFiles, as the OneUptime CLI reads them from your dSYMs, or the dSYMs themselves as multipart file parts.",
      );
    }

    if (symbolFiles.length > MAX_DSYM_FILES_PER_REQUEST) {
      throw new BadDataException(
        `At most ${MAX_DSYM_FILES_PER_REQUEST} symbol files can be uploaded in one request.`,
      );
    }

    return symbolFiles.map((raw: unknown, index: number): AppleSymbolFile => {
      const file: JSONObject =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as JSONObject)
          : {};
      const debugId: string | null = normalizeAppleDebugId(file["debugId"]);
      const binaryName: string = readText(file["binaryName"]);
      const architecture: string = readText(file["architecture"]);
      const table: AppleSymbolTable | null =
        typeof file["symbols"] === "string"
          ? decodeAppleSymbols(file["symbols"])
          : null;

      if (!debugId) {
        throw new BadDataException(
          `Symbol file ${index + 1} has no binary UUID: 32 hexadecimal digits, with or without dashes.`,
        );
      }

      if (!binaryName || !architecture) {
        throw new BadDataException(
          `Symbol file ${index + 1} needs its binaryName and architecture.`,
        );
      }

      if (!table) {
        throw new BadDataException(
          `The symbols of ${binaryName} (${debugId}) are not a table the OneUptime CLI writes. Upload them again with the CLI, or upload the dSYM itself.`,
        );
      }

      return {
        debugId,
        binaryName,
        architecture,
        textEndOffset: table.textEndOffset,
        symbols: table.offsets.map(
          (offset: number, symbolIndex: number): AppleSymbol => {
            return { offset, name: table.names[symbolIndex]! };
          },
        ),
      };
    });
  }

  // The symbol files a multipart upload's dSYMs hold, each read in full.
  public static readSymbolFilesFromParts(
    parts: Array<UploadedFilePart>,
  ): Array<AppleSymbolFile> {
    if (parts.length === 0) {
      throw new BadDataException(
        "No dSYM was uploaded. Attach each dSYM's DWARF file, or a zip of .dSYM bundles, as a multipart file part.",
      );
    }

    const files: Array<AppleSymbolFile> = [];

    for (const part of parts) {
      const name: string = part.originalname || part.fieldname || "dSYM";

      if (!part.buffer || part.buffer.length === 0) {
        throw new BadDataException(`${name} is empty.`);
      }

      let read: Array<AppleSymbolFile>;

      try {
        read = readDsymSymbolFilesFromBytes(
          part.buffer,
          name,
          DSYM_UPLOAD_ZIP_LIMITS,
        );
      } catch (err) {
        throw new BadDataException(
          err instanceof Error ? err.message : `${name} could not be read.`,
        );
      }

      if (read.length === 0) {
        throw new BadDataException(
          `${name} holds no binary with a UUID and function symbols. Upload the .dSYM's DWARF file, or a zip of .dSYM bundles.`,
        );
      }

      files.push(...read);
    }

    return files;
  }

  /*
   * Each UUID once - the last given wins, as a re-upload does - bounded,
   * and every name fitting its column. A binary with no function symbols
   * (stripped before its dSYM was made) names no frame, so it is left out;
   * the answer lists what was stored, so the upload shows it is missing.
   */
  public static normalizeSymbolFiles(
    files: Array<AppleSymbolFile>,
  ): Array<AppleSymbolFile> {
    const byDebugId: Map<string, AppleSymbolFile> = new Map<
      string,
      AppleSymbolFile
    >();
    let withoutSymbols: AppleSymbolFile | null = null;

    for (const file of files) {
      const debugId: string | null = normalizeAppleDebugId(file.debugId);

      if (!debugId) {
        continue;
      }

      if (file.symbols.length === 0) {
        withoutSymbols = withoutSymbols || { ...file, debugId };
        continue;
      }

      byDebugId.delete(debugId);
      byDebugId.set(debugId, {
        ...file,
        debugId,
        binaryName: file.binaryName.slice(0, ColumnLength.ShortText),
        architecture: file.architecture.slice(0, ColumnLength.ShortText),
      });
    }

    const normalized: Array<AppleSymbolFile> = Array.from(byDebugId.values());

    if (normalized.length === 0 && withoutSymbols) {
      throw new BadDataException(
        `There are no function symbols in ${withoutSymbols.binaryName} (${withoutSymbols.debugId}): a binary stripped before its dSYM is made leaves none.`,
      );
    }

    if (normalized.length > MAX_DSYM_FILES_PER_REQUEST) {
      throw new BadDataException(
        `At most ${MAX_DSYM_FILES_PER_REQUEST} binaries can be uploaded in one request. Split the upload across requests.`,
      );
    }

    return normalized;
  }

  @CaptureSpan()
  public static async uploadDsyms(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId: ObjectID | undefined = (req as TelemetryRequest)
        .projectId;

      if (!projectId) {
        throw new BadDataException(
          "Invalid request - projectId not found in request.",
        );
      }

      const body: JSONObject =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as JSONObject)
          : {};
      const appName: string = readText(body["appName"]).slice(
        0,
        ColumnLength.ShortText,
      );

      /*
       * The route's multipart middleware puts the parts on req.files, read
       * as what this service knows of them (as SourceMapIngestService does).
       */
      const uploaded: unknown = (req as ExpressRequest & { files?: unknown })
        .files;
      const parts: Array<UploadedFilePart> = Array.isArray(uploaded)
        ? (uploaded as Array<UploadedFilePart>)
        : [];

      const files: Array<AppleSymbolFile> =
        DsymIngestService.normalizeSymbolFiles(
          parts.length > 0
            ? DsymIngestService.readSymbolFilesFromParts(parts)
            : DsymIngestService.readSymbolFilesFromJson(body),
        );

      const stored: Array<JSONObject> = [];

      for (const file of files) {
        const dsym: TelemetryDsym =
          await TelemetryDsymService.replaceSymbolFile({
            projectId,
            file,
            appName: appName || undefined,
          });

        stored.push({
          _id: dsym.id?.toString() || "",
          debugId: file.debugId,
          architecture: file.architecture,
          binaryName: file.binaryName,
          symbolCount: dsym.symbolCount ?? file.symbols.length,
        });
      }

      logger.debug(
        `Stored ${stored.length} dSYM(s) in project ${projectId.toString()}`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        appName: appName,
        dsyms: stored,
      });
    } catch (err) {
      return next(err);
    }
  }
}
