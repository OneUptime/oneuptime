import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import http, { IncomingMessage, Server, createServer } from "http";
import { AddressInfo } from "net";
import { createExpressApp } from "../../../Server/Utils/Express";
import type {
  MermaidBrowserBuild,
  MermaidBrowserBuildFunction,
} from "../../../Server/Utils/MermaidBrowserBuild";

/*
 * How the /oneuptime-assets/mermaid mount answers, with the build replaced:
 * a build that failed, and a small known build whose bytes and headers can be
 * checked exactly. VendorAssets.test.ts serves the real build.
 */

const mockGetMermaidBrowserBuild: Mock<MermaidBrowserBuildFunction> =
  jest.fn<MermaidBrowserBuildFunction>();

jest.mock("../../../Server/Utils/MermaidBrowserBuild", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/MermaidBrowserBuild",
  ) as Record<string, unknown>;

  return {
    ...actual,
    getMermaidBrowserBuild: (): Promise<MermaidBrowserBuild> => {
      return mockGetMermaidBrowserBuild();
    },
  };
});

// Imported after the mock, which jest hoists above every import.
import mountVendorAssets, {
  MermaidEntryUrl,
} from "../../../Server/Utils/VendorAssets";

const INDEX_PAGE: string = "<html>index</html>";

const ENTRY_TEXT: string =
  'import{a}from"./chunks/chunk-ABCDEFGH.mjs";export{a as default};';
const CHUNK_TEXT: string = "var a=1;export{a};";

const SAMPLE_BUILD: MermaidBrowserBuild = {
  entry: "mermaid.mjs",
  files: new Map<string, Buffer>([
    ["mermaid.mjs", Buffer.from(ENTRY_TEXT, "utf8")],
    ["chunks/chunk-ABCDEFGH.mjs", Buffer.from(CHUNK_TEXT, "utf8")],
  ]),
};

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

describe("the mermaid mount", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app: ReturnType<typeof createExpressApp> = createExpressApp();

    mountVendorAssets(app);

    app.all("/*", (_request: unknown, response: { send: (body: string) => void }) => {
      return response.send(INDEX_PAGE);
    });

    server = createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    mockGetMermaidBrowserBuild.mockReset();
  });

  function ask(urlPath: string, method: string = "GET"): Promise<Answer> {
    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
        const request: http.ClientRequest = http.request(
          { host: "127.0.0.1", port, path: urlPath, method },
          (message: IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            message.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });

            message.on("end", () => {
              resolve({
                status: message.statusCode || 0,
                headers: message.headers,
                text: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );

        request.on("error", reject);
        request.end();
      },
    );
  }

  describe("with a build", () => {
    beforeEach(() => {
      mockGetMermaidBrowserBuild.mockResolvedValue(SAMPLE_BUILD);
    });

    test("serves the entry's bytes as JavaScript that revalidates hourly", async () => {
      const answer: Answer = await ask(MermaidEntryUrl);

      expect(answer.status).toBe(200);
      expect(answer.text).toBe(ENTRY_TEXT);
      expect(answer.headers["content-type"]).toBe(
        "text/javascript; charset=utf-8",
      );
      expect(answer.headers["cache-control"]).toBe("public, max-age=3600");
    });

    test("serves a chunk for a year", async () => {
      const answer: Answer = await ask(
        "/oneuptime-assets/mermaid/chunks/chunk-ABCDEFGH.mjs",
      );

      expect(answer.status).toBe(200);
      expect(answer.text).toBe(CHUNK_TEXT);
      expect(answer.headers["cache-control"]).toBe(
        "public, max-age=31536000",
      );
    });

    test("answers a HEAD request without a body", async () => {
      const answer: Answer = await ask(MermaidEntryUrl, "HEAD");

      expect(answer.status).toBe(200);
      expect(answer.text).toBe("");
    });

    test.each([
      ["a module the build does not have", "/oneuptime-assets/mermaid/chunks/chunk-ZZZZZZZZ.mjs"],
      ["a path that climbs out", "/oneuptime-assets/mermaid/chunks/../mermaid.mjs"],
      ["a different case", "/oneuptime-assets/mermaid/MERMAID.mjs"],
    ])("is a 404 for %s, never the index page", async (_label: string, urlPath: string) => {
      const answer: Answer = await ask(urlPath);

      expect(answer.status).toBe(404);
      expect(answer.text).not.toBe(INDEX_PAGE);
    });
  });

  describe("without a build", () => {
    beforeEach(() => {
      mockGetMermaidBrowserBuild.mockRejectedValue(
        new Error("esbuild could not be found"),
      );
    });

    test("says the diagrams are unavailable, for now, and when to retry", async () => {
      const answer: Answer = await ask(MermaidEntryUrl);

      expect(answer.status).toBe(503);
      expect(answer.headers["retry-after"]).toBe("60");
      expect(answer.headers["cache-control"]).toBe("no-store");
      expect(answer.text).toBe("Diagrams are not available right now.");
      // Nothing about the install leaks into the answer.
      expect(answer.text).not.toContain("esbuild");
    });
  });

  describe("only a GET or HEAD of a module waits for the build", () => {
    test.each([
      ["a prebuilt bundle's name", "GET", "/oneuptime-assets/mermaid/mermaid.min.js"],
      ["a sourcemap", "GET", "/oneuptime-assets/mermaid/mermaid.mjs.map"],
      ["a type definition", "GET", "/oneuptime-assets/mermaid/mermaid.d.ts"],
      ["the bare mount", "GET", "/oneuptime-assets/mermaid/"],
      ["a POST", "POST", MermaidEntryUrl],
      ["a DELETE", "DELETE", MermaidEntryUrl],
    ])("%s is a 404 without a build", async (_label: string, method: string, urlPath: string) => {
      const answer: Answer = await ask(urlPath, method);

      expect(answer.status).toBe(404);
      expect(answer.text).not.toBe(INDEX_PAGE);
      expect(mockGetMermaidBrowserBuild).not.toHaveBeenCalled();
    });
  });
});
