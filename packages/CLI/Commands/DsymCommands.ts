import { Command } from "commander";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  AppleSymbolFile,
  encodeAppleSymbols,
} from "Common/Utils/Telemetry/AppleSymbols";
import { readDsymSymbolFilesFromPath } from "Common/Server/Utils/Telemetry/AppleDebugSymbols/DsymFiles";
import {
  getResolvedIngestionKey,
  getResolvedInstanceUrl,
} from "../Core/ConfigManager";
import { handleError } from "../Core/ErrorHandler";
import {
  createJsonOption,
  createOutputOption,
  formatOutput,
  isJsonOutputRequested,
  printSuccess,
  printWarning,
  resolveOutputFormat,
} from "../Core/OutputFormatter";

/*
 * oneuptime dsym upload: send an iOS app's dSYMs after a build, from Xcode
 * or CI, so its crash and hang stacks in Exceptions read by function and
 * group by function across releases (#9922). It reads each dSYM on this
 * machine - a .dSYM bundle, a folder of them (an Xcode archive's dSYMs), a
 * zip of them (App Store Connect's "Download dSYMs"), or a DWARF file - and
 * sends only each binary's UUID, architecture and function symbols: a large
 * app's dSYM is hundreds of megabytes of DWARF, its symbols a few. It writes
 * with a telemetry ingestion key, as every other telemetry is written.
 */

export const DSYM_UPLOAD_PATH: string = "/dsyms/v1/upload";

// How much one request carries at most, well under the server's 50 MB cap.
export const MAX_DSYM_UPLOAD_BYTES: number = 32 * 1024 * 1024;

// How many binaries one request carries at most (the server takes 200).
export const MAX_DSYM_FILES_PER_UPLOAD: number = 100;

export interface DsymUploadOptions {
  app?: string | undefined;
  ingestionKey?: string | undefined;
}

// One binary, as the upload sends it: its table as OneUptime stores one.
export interface DsymUploadFile extends JSONObject {
  debugId: string;
  architecture: string;
  binaryName: string;
  symbols: string;
}

export interface DsymFilesRead {
  // The binaries to upload, each UUID once.
  files: Array<AppleSymbolFile>;
  // The binaries with no function symbols, stripped before their dSYM was made.
  withoutSymbols: Array<AppleSymbolFile>;
}

/*
 * The binaries the paths hold, each UUID once - the last path naming one
 * wins. One with no function symbols names no frame, so it is set aside to
 * be warned of; when every binary is such, there is nothing to upload.
 */
export function readDsymFiles(paths: Array<string>): DsymFilesRead {
  if (paths.length === 0) {
    throw new Error(
      "Name the dSYMs to upload: a .dSYM bundle, a folder or zip of them, or a dSYM's DWARF file.",
    );
  }

  const byDebugId: Map<string, AppleSymbolFile> = new Map<
    string,
    AppleSymbolFile
  >();

  for (const dsymPath of paths) {
    const files: Array<AppleSymbolFile> = readDsymSymbolFilesFromPath(dsymPath);

    if (files.length === 0) {
      throw new Error(
        `There is no dSYM in ${dsymPath}: no binary with a UUID and function symbols.`,
      );
    }

    for (const file of files) {
      byDebugId.delete(file.debugId);
      byDebugId.set(file.debugId, file);
    }
  }

  const read: DsymFilesRead = { files: [], withoutSymbols: [] };

  for (const file of byDebugId.values()) {
    (file.symbols.length > 0 ? read.files : read.withoutSymbols).push(file);
  }

  if (read.files.length === 0) {
    throw new Error(
      `There are no function symbols in ${describeBinaries(read.withoutSymbols)}: a binary stripped before its dSYM is made leaves none.`,
    );
  }

  return read;
}

// Binaries as a sentence names them: MyApp (arm64, 70B89F27-...).
function describeBinaries(
  binaries: Array<{
    binaryName: unknown;
    architecture: unknown;
    debugId: unknown;
  }>,
): string {
  return binaries
    .map(
      (binary: {
        binaryName: unknown;
        architecture: unknown;
        debugId: unknown;
      }): string => {
        return `${String(binary.binaryName || "")} (${String(
          binary.architecture || "",
        )}, ${String(binary.debugId || "")})`;
      },
    )
    .join(", ");
}

/*
 * The requests the binaries are sent in: as many binaries to a request as
 * fit MAX_DSYM_UPLOAD_BYTES and MAX_DSYM_FILES_PER_UPLOAD, one binary larger
 * than that alone in a request of its own.
 */
export function buildDsymUploads(
  files: Array<AppleSymbolFile>,
  limits: { maxBytes: number; maxFiles: number } = {
    maxBytes: MAX_DSYM_UPLOAD_BYTES,
    maxFiles: MAX_DSYM_FILES_PER_UPLOAD,
  },
): Array<Array<DsymUploadFile>> {
  const uploads: Array<Array<DsymUploadFile>> = [];
  let current: Array<DsymUploadFile> = [];
  let currentBytes: number = 0;

  for (const file of files) {
    const upload: DsymUploadFile = {
      debugId: file.debugId,
      architecture: file.architecture,
      binaryName: file.binaryName,
      symbols: encodeAppleSymbols({
        symbols: file.symbols,
        textEndOffset: file.textEndOffset,
      }),
    };
    const bytes: number = Buffer.byteLength(JSON.stringify(upload), "utf8");

    if (
      current.length > 0 &&
      (currentBytes + bytes > limits.maxBytes ||
        current.length >= limits.maxFiles)
    ) {
      uploads.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(upload);
    currentBytes += bytes;
  }

  if (current.length > 0) {
    uploads.push(current);
  }

  return uploads;
}

// What OneUptime stored, in one line.
export function describeDsymUpload(stored: Array<JSONObject>): string {
  if (stored.length === 0) {
    return "Uploaded no dSYM.";
  }

  return `Uploaded ${stored.length === 1 ? "1 dSYM" : `${stored.length} dSYMs`}: ${describeBinaries(
    stored.map((dsym: JSONObject) => {
      return {
        binaryName: dsym["binaryName"],
        architecture: dsym["architecture"],
        debugId: dsym["debugId"],
      };
    }),
  )}.`;
}

/*
 * Posts one request's binaries with the ingestion key; resolves to what
 * OneUptime stored. The key is in the headers, so a redirect is followed
 * only on the server it was sent to.
 */
export async function sendDsyms(data: {
  instanceUrl: string;
  ingestionKey: string;
  appName?: string | undefined;
  symbolFiles: Array<DsymUploadFile>;
}): Promise<Array<JSONObject>> {
  const url: URL = URL.fromString(data.instanceUrl);
  const requestUrl: URL = new URL(
    url.protocol,
    url.hostname,
    new Route(DSYM_UPLOAD_PATH),
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: requestUrl,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-oneuptime-token": data.ingestionKey,
      },
      data: {
        ...(data.appName ? { appName: data.appName } : {}),
        symbolFiles: data.symbolFiles as unknown as JSONArray,
      },
      options: {
        sameServerRedirectsOnly: true,
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw new Error(
      `API error (${response.statusCode}): ${response.message || "Unknown error"}`,
    );
  }

  const stored: unknown = response.data?.["dsyms"];

  return Array.isArray(stored) ? (stored as Array<JSONObject>) : [];
}

export function registerDsymCommands(program: Command): void {
  const dsym: Command = program
    .command("dsym")
    .description(
      "Send an iOS app's dSYMs, so its crashes and hangs read by function",
    );

  dsym
    .command("upload")
    .description(
      "Upload dSYMs after a build: .dSYM bundles, a folder or zip of them, or DWARF files",
    )
    .argument("<paths...>", "The dSYMs to upload")
    .option(
      "--app <name>",
      "The app they are for, as its service.name, kept beside them",
    )
    .option(
      "--ingestion-key <key>",
      "A telemetry ingestion key (default: ONEUPTIME_TELEMETRY_INGESTION_KEY)",
    )
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .action(
      async (
        paths: Array<string>,
        options: DsymUploadOptions,
        cmd: Command,
      ) => {
        try {
          const globals: Record<string, unknown> = program.opts();
          const instanceUrl: string = getResolvedInstanceUrl({
            url: globals["url"] as string | undefined,
            context: globals["context"] as string | undefined,
          });
          const ingestionKey: string = getResolvedIngestionKey(
            options.ingestionKey,
          );
          const read: DsymFilesRead = readDsymFiles(paths);
          const stored: Array<JSONObject> = [];

          if (read.withoutSymbols.length > 0) {
            printWarning(
              `Left out ${describeBinaries(read.withoutSymbols)}, with no function symbols: a binary stripped before its dSYM is made leaves none.`,
            );
          }

          for (const symbolFiles of buildDsymUploads(read.files)) {
            stored.push(
              ...(await sendDsyms({
                instanceUrl,
                ingestionKey,
                appName: options.app,
                symbolFiles,
              })),
            );
          }

          if (isJsonOutputRequested(cmd)) {
            // eslint-disable-next-line no-console
            console.log(
              formatOutput(
                { dsyms: stored as unknown as JSONArray },
                resolveOutputFormat(cmd),
              ),
            );
            return;
          }

          printSuccess(describeDsymUpload(stored));
        } catch (error) {
          handleError(error);
        }
      },
    );
}
