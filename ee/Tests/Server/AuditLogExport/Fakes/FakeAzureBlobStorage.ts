import { createHmac, randomBytes } from "crypto";
import { gunzipSync } from "zlib";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import Dictionary from "Common/Types/Dictionary";
import { AuditLogExportHttpTransport } from "../../../../Server/AuditLogExport/Destinations/Types";

/*
 * A FAITHFUL FAKE OF AZURE BLOB STORAGE's Put Blob, for the Azure
 * destination's suite. It checks what the Blob service checks before it
 * stores a block blob, with its own code:
 *
 *   - the storage account from the host, the container and blob from the
 *     path (ContainerNotFound);
 *   - x-ms-blob-type: BlockBlob and an x-ms-version (MissingRequiredHeader);
 *   - Shared Key: the signature, recomputed here from the request as it
 *     arrived, by the string-to-sign Azure documents (AuthenticationFailed);
 *   - a SAS token: one the account issued (a fake's token stands for its
 *     signature), not expired (AuthenticationFailed), whose permissions let
 *     it create and write (AuthorizationPermissionMismatch).
 *
 * Errors are the XML documents the service answers with. Not a test file.
 */

export const ACCOUNT_NAME: string = "acmeaudit";
export const ACCOUNT_KEY: string = randomBytes(64).toString("base64");

export interface FakeBlob {
  container: string;
  name: string;
  body: Buffer;
  contentType: string;
}

export interface FakeAzure {
  transport: AuditLogExportHttpTransport;
  blobs: Map<string, FakeBlob>;
  requests: Array<DataSourceHttpRequest>;
  // A SAS token of the account, with these permissions, expiring then.
  issueSasToken: (data: { permissions: string; expiresAt: Date }) => string;
  failNext: (status: number, code: string) => void;
  readBlob: (container: string, name: string) => Array<Record<string, unknown>>;
}

function xmlError(status: number, code: string): DataSourceHttpResponse {
  return {
    statusCode: status,
    bodyText: `<?xml version="1.0" encoding="utf-8"?><Error><Code>${code}</Code><Message>${code} from the fake Blob service.</Message></Error>`,
    bodyJson: undefined,
  };
}

function asTransportAnswer(
  response: DataSourceHttpResponse,
): DataSourceHttpResponse {
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return response;
  }

  throw new Error(
    `Data source responded with HTTP ${response.statusCode}: ${response.bodyText}`,
  );
}

// The Shared Key string-to-sign, as Azure documents it, for a request as it arrived.
function stringToSign(data: {
  method: string;
  headers: Dictionary<string>;
  path: string;
}): string {
  const header: (name: string) => string = (name: string): string => {
    return data.headers[name] || "";
  };

  const msHeaders: string = Object.keys(data.headers)
    .filter((name: string): boolean => {
      return name.startsWith("x-ms-");
    })
    .sort()
    .map((name: string): string => {
      return `${name}:${header(name).trim()}\n`;
    })
    .join("");

  return [
    data.method,
    header("content-encoding"),
    header("content-language"),
    header("content-length") === "0" ? "" : header("content-length"),
    header("content-md5"),
    header("content-type"),
    header("date"),
    header("if-modified-since"),
    header("if-match"),
    header("if-none-match"),
    header("if-unmodified-since"),
    header("range"),
    `${msHeaders}/${ACCOUNT_NAME}${data.path}`,
  ].join("\n");
}

export function createFakeAzureBlobStorage(options: {
  containers: Array<string>;
}): FakeAzure {
  const blobs: Map<string, FakeBlob> = new Map<string, FakeBlob>();
  const requests: Array<DataSourceHttpRequest> = [];
  const failures: Array<{ status: number; code: string }> = [];
  const sasTokens: Map<string, { permissions: string; expiresAt: Date }> =
    new Map<string, { permissions: string; expiresAt: Date }>();

  const handle: (request: DataSourceHttpRequest) => DataSourceHttpResponse = (
    request: DataSourceHttpRequest,
  ): DataSourceHttpResponse => {
    const url: URL = new URL(request.url);
    const headers: Dictionary<string> = {};

    for (const name of Object.keys(request.headers || {})) {
      headers[name.toLowerCase()] = String((request.headers || {})[name]);
    }

    if (url.hostname !== `${ACCOUNT_NAME}.blob.core.windows.net`) {
      // No such account: the host does not resolve.
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${url.hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    if (request.method !== "PUT") {
      return xmlError(405, "UnsupportedHttpVerb");
    }

    if (headers["x-ms-blob-type"] !== "BlockBlob" || !headers["x-ms-version"]) {
      return xmlError(400, "MissingRequiredHeader");
    }

    const signature: string | null = url.searchParams.get("sig");

    if (signature) {
      const token: { permissions: string; expiresAt: Date } | undefined =
        sasTokens.get(signature);

      if (!token || token.expiresAt.getTime() < Date.now()) {
        return xmlError(403, "AuthenticationFailed");
      }

      if (
        !token.permissions.includes("c") ||
        !token.permissions.includes("w")
      ) {
        return xmlError(403, "AuthorizationPermissionMismatch");
      }
    } else {
      const authorization: string = headers["authorization"] || "";
      const expected: string = `SharedKey ${ACCOUNT_NAME}:${createHmac(
        "sha256",
        Buffer.from(ACCOUNT_KEY, "base64"),
      )
        .update(
          stringToSign({
            method: request.method,
            headers,
            path: url.pathname,
          }),
          "utf8",
        )
        .digest("base64")}`;

      if (authorization !== expected) {
        return xmlError(403, "AuthenticationFailed");
      }
    }

    const parts: Array<string> = url.pathname.slice(1).split("/");
    const container: string = decodeURIComponent(parts.shift() || "");
    const name: string = parts
      .map((part: string): string => {
        return decodeURIComponent(part);
      })
      .join("/");

    if (!options.containers.includes(container)) {
      return xmlError(404, "ContainerNotFound");
    }

    const body: Buffer = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(String(request.body ?? ""), "utf8");

    if (
      headers["content-length"] &&
      Number(headers["content-length"]) !== body.length
    ) {
      return xmlError(400, "InvalidHeaderValue");
    }

    blobs.set(`${container}/${name}`, {
      container,
      name,
      body,
      contentType: headers["content-type"] || "",
    });

    return { statusCode: 201, bodyText: "", bodyJson: undefined };
  };

  return {
    blobs,
    requests,
    issueSasToken: (data: { permissions: string; expiresAt: Date }): string => {
      const signature: string = randomBytes(24).toString("base64");

      sasTokens.set(signature, data);

      return `sv=2022-11-02&ss=b&srt=co&sp=${data.permissions}&se=${encodeURIComponent(
        data.expiresAt.toISOString(),
      )}&spr=https&sig=${encodeURIComponent(signature)}`;
    },
    failNext: (status: number, code: string): void => {
      failures.push({ status, code });
    },
    readBlob: (
      container: string,
      name: string,
    ): Array<Record<string, unknown>> => {
      const blob: FakeBlob | undefined = blobs.get(`${container}/${name}`);

      if (!blob) {
        throw new Error(`No blob ${name} in ${container}.`);
      }

      return gunzipSync(blob.body)
        .toString("utf8")
        .split("\n")
        .filter((line: string): boolean => {
          return line.length > 0;
        })
        .map((line: string): Record<string, unknown> => {
          return JSON.parse(line) as Record<string, unknown>;
        });
    },
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      const failure: { status: number; code: string } | undefined =
        failures.shift();

      if (failure) {
        return asTransportAnswer(xmlError(failure.status, failure.code));
      }

      return asTransportAnswer(handle(request));
    },
  };
}
