import { createHmac, randomBytes } from "crypto";
import { Readable } from "stream";
import Dictionary from "Common/Types/Dictionary";
import {
  BackupHttpRequest,
  BackupHttpResponse,
  BackupHttpTransport,
} from "../../../../Server/Backup/Storage/BackupHttp";

/*
 * A FAITHFUL FAKE OF AZURE BLOB STORAGE, for the backups' Azure storage:
 * every call the backups make - Put Blob, Put Block, Put Block List, Get
 * Blob, Get Blob Properties (HEAD), List Blobs (with a prefix, a delimiter
 * and markers) and Delete Blob - answered as the Blob service answers it,
 * after the checks it makes, with its own code:
 *
 *   - the account from the host, the container and the blob from the path
 *     (ContainerNotFound, BlobNotFound);
 *   - Shared Key: the signature recomputed here, by the string-to-sign
 *     Azure documents - the canonicalized resource with every query
 *     parameter (AuthenticationFailed);
 *   - a SAS token: one the account issued (its sig stands for a real
 *     signature), not expired (AuthenticationFailed), whose permissions
 *     allow the call - r to read, a/c/w to write, l to list, d to delete
 *     (AuthorizationPermissionMismatch);
 *   - a block list naming only blocks that were put, their ids all of one
 *     length (InvalidBlockList) - nothing of a blob is visible before its
 *     list commits.
 *
 * Errors are the XML documents the service answers with. Not a test file.
 */

export const FAKE_AZURE_ACCOUNT: string = "acmebackups";
export const FAKE_AZURE_ACCOUNT_KEY: string =
  randomBytes(64).toString("base64");

export interface FakeAzureBlob {
  body: Buffer;
  contentType: string;
  lastModified: Date;
}

export interface FakeAzureRecordedRequest {
  method: string;
  url: string;
  operation: string;
  headers: Dictionary<string>;
  bodyLength: number;
}

export interface FakeBackupAzure {
  transport: BackupHttpTransport;
  // "<container>/<blob>" -> the committed blob.
  blobs: Map<string, FakeAzureBlob>;
  // Blocks put and not committed yet, per blob.
  uncommitted: Map<string, Map<string, Buffer>>;
  requests: Array<FakeAzureRecordedRequest>;
  issueSasToken: (data: { permissions: string; expiresAt: Date }) => string;
  failNext: (status: number, code: string) => void;
  blobNames: (container: string) => Array<string>;
}

function xmlError(status: number, code: string): BackupHttpResponse {
  const body: Buffer = Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?><Error><Code>${code}</Code><Message>${code} from the fake Blob service.\nRequestId:fake</Message></Error>`,
    "utf8",
  );

  return {
    statusCode: status,
    headers: {
      "content-length": String(body.length),
      "content-type": "application/xml",
      "x-ms-error-code": code,
    },
    body: Readable.from([body]),
  };
}

function answer(
  status: number,
  body: Buffer | string = "",
  headers: Dictionary<string> = {},
): BackupHttpResponse {
  const bytes: Buffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body, "utf8");

  return {
    statusCode: status,
    headers: { "content-length": String(bytes.length), ...headers },
    body: Readable.from(bytes.length > 0 ? [bytes] : []),
  };
}

function lowerHeaders(headers: Dictionary<string>): Dictionary<string> {
  const lowered: Dictionary<string> = {};

  for (const name of Object.keys(headers || {})) {
    lowered[name.toLowerCase()] = String(headers[name]);
  }

  return lowered;
}

function escapeXml(value: string): string {
  return value.split("&").join("&amp;").split("<").join("&lt;");
}

// The Shared Key signature Azure expects for the request as it arrived.
function expectedSharedKey(data: {
  method: string;
  url: URL;
  headers: Dictionary<string>;
}): string {
  const headers: Dictionary<string> = data.headers;
  const contentLength: string =
    headers["content-length"] && headers["content-length"] !== "0"
      ? headers["content-length"]
      : "";
  const canonicalHeaders: string = Object.keys(headers)
    .filter((name: string): boolean => {
      return name.startsWith("x-ms-");
    })
    .sort()
    .map((name: string): string => {
      return `${name}:${(headers[name] || "").trim()}\n`;
    })
    .join("");
  const parameters: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const [name, value] of data.url.searchParams.entries()) {
    const lower: string = name.toLowerCase();
    parameters.set(lower, [...(parameters.get(lower) || []), value]);
  }

  const canonicalQuery: string = Array.from(parameters.keys())
    .sort()
    .map((name: string): string => {
      return `\n${name}:${(parameters.get(name) || []).sort().join(",")}`;
    })
    .join("");

  const stringToSign: string = [
    data.method,
    headers["content-encoding"] || "",
    headers["content-language"] || "",
    contentLength,
    headers["content-md5"] || "",
    headers["content-type"] || "",
    "",
    headers["if-modified-since"] || "",
    headers["if-match"] || "",
    headers["if-none-match"] || "",
    headers["if-unmodified-since"] || "",
    headers["range"] || "",
    `${canonicalHeaders}/${FAKE_AZURE_ACCOUNT}${data.url.pathname}${canonicalQuery}`,
  ].join("\n");

  return createHmac("sha256", Buffer.from(FAKE_AZURE_ACCOUNT_KEY, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
}

export function createFakeBackupAzure(options: {
  containers: Array<string>;
}): FakeBackupAzure {
  const blobs: Map<string, FakeAzureBlob> = new Map<string, FakeAzureBlob>();
  const uncommitted: Map<string, Map<string, Buffer>> = new Map<
    string,
    Map<string, Buffer>
  >();
  const requests: Array<FakeAzureRecordedRequest> = [];
  const failures: Array<{ status: number; code: string }> = [];
  const sasTokens: Map<string, { permissions: string; expiresAt: Date }> =
    new Map<string, { permissions: string; expiresAt: Date }>();
  let issued: number = 0;

  const operationOf: (method: string, url: URL, blob: string) => string = (
    method: string,
    url: URL,
    blob: string,
  ): string => {
    const comp: string | null = url.searchParams.get("comp");

    if (!blob) {
      return method === "GET" && comp === "list" ? "ListBlobs" : "Unknown";
    }

    if (method === "PUT") {
      return comp === "block"
        ? "PutBlock"
        : comp === "blocklist"
          ? "PutBlockList"
          : "PutBlob";
    }

    return method === "GET"
      ? "GetBlob"
      : method === "HEAD"
        ? "GetBlobProperties"
        : method === "DELETE"
          ? "DeleteBlob"
          : "Unknown";
  };

  const permissionFor: Record<string, string> = {
    PutBlob: "cw",
    PutBlock: "w",
    PutBlockList: "w",
    GetBlob: "r",
    GetBlobProperties: "r",
    ListBlobs: "l",
    DeleteBlob: "d",
  };

  const handle: (
    request: BackupHttpRequest,
    url: URL,
    operation: string,
    container: string,
    blob: string,
  ) => BackupHttpResponse = (
    request: BackupHttpRequest,
    url: URL,
    operation: string,
    container: string,
    blob: string,
  ): BackupHttpResponse => {
    const headers: Dictionary<string> = lowerHeaders(request.headers);
    const body: Buffer = request.body || Buffer.alloc(0);

    if (url.hostname !== `${FAKE_AZURE_ACCOUNT}.blob.core.windows.net`) {
      return xmlError(400, "InvalidUri");
    }

    if (!headers["x-ms-version"] || !headers["x-ms-date"]) {
      return xmlError(400, "MissingRequiredHeader");
    }

    const sig: string | null = url.searchParams.get("sig");

    if (sig) {
      const token: { permissions: string; expiresAt: Date } | undefined =
        sasTokens.get(sig);

      if (!token || token.expiresAt.getTime() < Date.now()) {
        return xmlError(403, "AuthenticationFailed");
      }

      const needed: string = permissionFor[operation] || "?";

      if (
        !needed.split("").some((letter: string): boolean => {
          return token.permissions.includes(letter);
        })
      ) {
        return xmlError(403, "AuthorizationPermissionMismatch");
      }
    } else {
      const authorization: string = headers["authorization"] || "";

      if (
        authorization !==
        `SharedKey ${FAKE_AZURE_ACCOUNT}:${expectedSharedKey({ method: request.method, url, headers })}`
      ) {
        return xmlError(403, "AuthenticationFailed");
      }
    }

    if (!options.containers.includes(container)) {
      return xmlError(404, "ContainerNotFound");
    }

    const blobKey: string = `${container}/${blob}`;

    switch (operation) {
      case "PutBlob": {
        if (headers["x-ms-blob-type"] !== "BlockBlob") {
          return xmlError(400, "MissingRequiredHeader");
        }

        blobs.set(blobKey, {
          body: Buffer.from(body),
          contentType: headers["content-type"] || "",
          lastModified: new Date(),
        });
        uncommitted.delete(blobKey);

        return answer(201);
      }

      case "PutBlock": {
        const blockId: string = url.searchParams.get("blockid") || "";
        const blocks: Map<string, Buffer> =
          uncommitted.get(blobKey) || new Map<string, Buffer>();

        if (!blockId || Buffer.from(blockId, "base64").length > 64) {
          return xmlError(400, "InvalidQueryParameterValue");
        }

        for (const existing of blocks.keys()) {
          if (existing.length !== blockId.length) {
            return xmlError(400, "InvalidBlobOrBlock");
          }
        }

        blocks.set(blockId, Buffer.from(body));
        uncommitted.set(blobKey, blocks);

        return answer(201);
      }

      case "PutBlockList": {
        const blocks: Map<string, Buffer> =
          uncommitted.get(blobKey) || new Map<string, Buffer>();
        const xml: string = body.toString("utf8");
        const ids: Array<string> = [];
        let from: number = 0;

        for (;;) {
          const start: number = xml.indexOf("<Latest>", from);

          if (start < 0) {
            break;
          }

          const end: number = xml.indexOf("</Latest>", start);
          ids.push(xml.slice(start + "<Latest>".length, end));
          from = end;
        }

        if (
          ids.length === 0 ||
          ids.some((id: string): boolean => {
            return !blocks.has(id);
          })
        ) {
          return xmlError(400, "InvalidBlockList");
        }

        blobs.set(blobKey, {
          body: Buffer.concat(
            ids.map((id: string): Buffer => {
              return blocks.get(id)!;
            }),
          ),
          contentType: headers["x-ms-blob-content-type"] || "",
          lastModified: new Date(),
        });
        uncommitted.delete(blobKey);

        return answer(201);
      }

      case "GetBlob": {
        const stored: FakeAzureBlob | undefined = blobs.get(blobKey);

        return stored
          ? answer(200, stored.body, {
              "content-type": stored.contentType,
              "last-modified": stored.lastModified.toUTCString(),
            })
          : xmlError(404, "BlobNotFound");
      }

      case "GetBlobProperties": {
        const stored: FakeAzureBlob | undefined = blobs.get(blobKey);

        if (!stored) {
          return {
            statusCode: 404,
            headers: { "x-ms-error-code": "BlobNotFound" },
            body: Readable.from([]),
          };
        }

        return {
          statusCode: 200,
          headers: {
            "content-length": String(stored.body.length),
            "last-modified": stored.lastModified.toUTCString(),
          },
          body: Readable.from([]),
        };
      }

      case "DeleteBlob": {
        if (!blobs.has(blobKey)) {
          return xmlError(404, "BlobNotFound");
        }

        blobs.delete(blobKey);

        return answer(202);
      }

      case "ListBlobs": {
        if (url.searchParams.get("restype") !== "container") {
          return xmlError(400, "InvalidQueryParameterValue");
        }

        const prefix: string = url.searchParams.get("prefix") || "";
        const delimiter: string = url.searchParams.get("delimiter") || "";
        const marker: string = url.searchParams.get("marker") || "";
        const maxResults: number = Math.min(
          Number(url.searchParams.get("maxresults") || 5000),
          2,
        );
        const entries: Array<{ name: string; isPrefix: boolean }> = [];
        const seen: Set<string> = new Set<string>();

        for (const key of Array.from(blobs.keys()).sort()) {
          if (!key.startsWith(`${container}/`)) {
            continue;
          }

          const name: string = key.slice(container.length + 1);

          if (!name.startsWith(prefix) || (marker && name < marker)) {
            continue;
          }

          if (delimiter) {
            const rest: string = name.slice(prefix.length);
            const at: number = rest.indexOf(delimiter);

            if (at >= 0) {
              const folder: string = `${prefix}${rest.slice(0, at + delimiter.length)}`;

              if (!seen.has(folder) && (!marker || folder >= marker)) {
                seen.add(folder);
                entries.push({ name: folder, isPrefix: true });
              }

              continue;
            }
          }

          entries.push({ name, isPrefix: false });
        }

        const page: Array<{ name: string; isPrefix: boolean }> = entries.slice(
          0,
          maxResults,
        );
        const next: { name: string } | undefined = entries[maxResults];
        const items: string = page
          .map((entry: { name: string; isPrefix: boolean }): string => {
            if (entry.isPrefix) {
              return `<BlobPrefix><Name>${escapeXml(entry.name)}</Name></BlobPrefix>`;
            }

            const stored: FakeAzureBlob = blobs.get(
              `${container}/${entry.name}`,
            )!;

            return `<Blob><Name>${escapeXml(entry.name)}</Name><Properties><Last-Modified>${stored.lastModified.toUTCString()}</Last-Modified><Content-Length>${stored.body.length}</Content-Length><BlobType>BlockBlob</BlobType></Properties></Blob>`;
          })
          .join("");

        return answer(
          200,
          `<?xml version="1.0" encoding="utf-8"?><EnumerationResults ServiceEndpoint="https://${FAKE_AZURE_ACCOUNT}.blob.core.windows.net/" ContainerName="${container}"><Prefix>${escapeXml(prefix)}</Prefix><Marker>${escapeXml(marker)}</Marker><MaxResults>${maxResults}</MaxResults>${delimiter ? `<Delimiter>${delimiter}</Delimiter>` : ""}<Blobs>${items}</Blobs><NextMarker>${next ? escapeXml(next.name) : ""}</NextMarker></EnumerationResults>`,
          { "content-type": "application/xml" },
        );
      }

      default:
        return xmlError(400, "UnsupportedHttpVerb");
    }
  };

  const transport: BackupHttpTransport = async (
    request: BackupHttpRequest,
  ): Promise<BackupHttpResponse> => {
    const url: URL = new URL(request.url);
    const parts: Array<string> = url.pathname.slice(1).split("/");
    const container: string = decodeURIComponent(parts.shift() || "");
    const blob: string = parts
      .map((part: string): string => {
        return decodeURIComponent(part);
      })
      .join("/");
    const operation: string = operationOf(request.method, url, blob);

    requests.push({
      method: request.method,
      url: request.url,
      operation,
      headers: lowerHeaders(request.headers),
      bodyLength: request.body ? request.body.length : 0,
    });

    const failure: { status: number; code: string } | undefined =
      failures.shift();

    if (failure) {
      return xmlError(failure.status, failure.code);
    }

    return handle(request, url, operation, container, blob);
  };

  return {
    transport,
    blobs,
    uncommitted,
    requests,
    issueSasToken: (data: { permissions: string; expiresAt: Date }): string => {
      const sig: string = `fakesig${++issued}`;
      sasTokens.set(sig, data);

      return `sv=2022-11-02&ss=b&srt=co&sp=${data.permissions}&se=${encodeURIComponent(data.expiresAt.toISOString())}&spr=https&sig=${sig}`;
    },
    failNext: (status: number, code: string): void => {
      failures.push({ status, code });
    },
    blobNames: (container: string): Array<string> => {
      return Array.from(blobs.keys())
        .filter((key: string): boolean => {
          return key.startsWith(`${container}/`);
        })
        .map((key: string): string => {
          return key.slice(container.length + 1);
        })
        .sort();
    },
  };
}
