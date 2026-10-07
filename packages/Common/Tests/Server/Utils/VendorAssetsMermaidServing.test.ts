import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import http, { IncomingMessage, Server, createServer } from "http";
import { AddressInfo } from "net";
import os from "os";
import path from "path";
import {
  ExpressRequest,
  ExpressResponse,
  createExpressApp,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import { createMermaidAssetsHandler } from "../../../Server/Utils/VendorAssets";

/*
 * How the /oneuptime-assets/mermaid mount answers, against a small known
 * build, so bytes and headers can be checked exactly, and against a directory
 * with no build at all: what every image that does not build mermaid (the
 * probe, the workers) serves. VendorAssets.test.ts serves the real build
 * through the real mount.
 */

const INDEX_PAGE: string = "<html>index</html>";
const NOT_FOUND: string = "Not found";

const ENTRY_TEXT: string =
  'import{a}from"./chunks/chunk-ABCDEFGH.mjs";export{a as default};';
const CHUNK_TEXT: string = "var a=1;export{a};";

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

interface Mount {
  server: Server;
  port: number;
}

/*
 * The handler on its prefix, then the same 404 terminator and SPA catch-all
 * order mountVendorAssets and a frontend service give it.
 */
async function mount(directory: string): Promise<Mount> {
  const app: ReturnType<typeof createExpressApp> = createExpressApp();

  app.use("/oneuptime-assets/mermaid", createMermaidAssetsHandler(directory));
  app.use("/oneuptime-assets", (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).send(NOT_FOUND);
  });
  app.all("/*", (_req: ExpressRequest, res: ExpressResponse) => {
    res.send(INDEX_PAGE);
  });

  const server: Server = createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return { server, port: (server.address() as AddressInfo).port };
}

function ask(
  port: number,
  urlPath: string,
  method: string = "GET",
  headers: Record<string, string> = {},
): Promise<Answer> {
  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = http.request(
        { host: "127.0.0.1", port, path: urlPath, method, headers },
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

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
}

describe("the mermaid mount, with a build", () => {
  let scratch: string;
  let served: Mount;

  beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-diagrams-"));
    fs.mkdirSync(path.join(scratch, "chunks", "nested"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "mermaid.mjs"), ENTRY_TEXT);
    fs.writeFileSync(
      path.join(scratch, "chunks", "chunk-ABCDEFGH.mjs"),
      CHUNK_TEXT,
    );
    // Files no mermaid build has, which must not be served if one appears.
    fs.writeFileSync(path.join(scratch, "mermaid.mjs.map"), "{}");
    fs.writeFileSync(path.join(scratch, "notes.txt"), "notes");
    fs.writeFileSync(path.join(scratch, ".hidden.mjs"), "hidden");
    fs.writeFileSync(path.join(scratch, "mermaid.min.js"), "prebuilt");
    fs.writeFileSync(
      path.join(scratch, "chunks", "nested", "deep-ABCDEFGH.mjs"),
      "deep",
    );

    served = await mount(scratch);
  });

  afterAll(async () => {
    await close(served.server);
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test("serves the entry's bytes as JavaScript that revalidates hourly", async () => {
    const answer: Answer = await ask(
      served.port,
      "/oneuptime-assets/mermaid/mermaid.mjs",
    );

    expect(answer.status).toBe(200);
    expect(answer.text).toBe(ENTRY_TEXT);
    expect(answer.headers["content-type"]).toContain("javascript");
    expect(answer.headers["cache-control"]).toBe("public, max-age=3600");
  });

  test("serves a chunk for a year", async () => {
    const answer: Answer = await ask(
      served.port,
      "/oneuptime-assets/mermaid/chunks/chunk-ABCDEFGH.mjs",
    );

    expect(answer.status).toBe(200);
    expect(answer.text).toBe(CHUNK_TEXT);
    expect(answer.headers["cache-control"]).toBe("public, max-age=31536000");
  });

  test("answers a HEAD request without a body", async () => {
    const answer: Answer = await ask(
      served.port,
      "/oneuptime-assets/mermaid/mermaid.mjs",
      "HEAD",
    );

    expect(answer.status).toBe(200);
    expect(answer.text).toBe("");
  });

  test("answers a repeat request with 304 when the browser has it", async () => {
    const url: string = "/oneuptime-assets/mermaid/chunks/chunk-ABCDEFGH.mjs";
    const first: Answer = await ask(served.port, url);

    expect(first.headers["etag"]).toBeDefined();

    const repeat: Answer = await ask(served.port, url, "GET", {
      "If-None-Match": first.headers["etag"] as string,
    });

    expect(repeat.status).toBe(304);
    expect(repeat.text).toBe("");
  });

  test.each([
    ["a module the build does not have", "chunks/chunk-ZZZZZZZZ.mjs"],
    ["a path that climbs out", "chunks/../mermaid.mjs"],
    ["a doubled slash", "chunks//chunk-ABCDEFGH.mjs"],
    ["a second directory level", "chunks/nested/deep-ABCDEFGH.mjs"],
    ["a hidden file", ".hidden.mjs"],
    ["a different case", "MERMAID.mjs"],
    ["a sourcemap", "mermaid.mjs.map"],
    ["another kind of file", "notes.txt"],
    ["a prebuilt bundle's name", "mermaid.min.js"],
    ["the bare mount", ""],
  ])(
    "is a 404 for %s, never the index page",
    async (_label: string, rest: string) => {
      const answer: Answer = await ask(
        served.port,
        `/oneuptime-assets/mermaid/${rest}`,
      );

      expect(answer.status).toBe(404);
      expect(answer.text).toBe(NOT_FOUND);
    },
  );

  test.each([["POST"], ["PUT"], ["DELETE"]])(
    "does not answer a %s",
    async (method: string) => {
      const answer: Answer = await ask(
        served.port,
        "/oneuptime-assets/mermaid/mermaid.mjs",
        method,
      );

      expect(answer.status).toBe(404);
      expect(answer.text).toBe(NOT_FOUND);
    },
  );
});

describe("the mermaid mount, with no build", () => {
  /*
   * Only the App and Home images build mermaid. Everywhere else the mount is
   * a 404, as for any missing asset - nothing is built on request.
   */
  let served: Mount;
  let missing: string;

  beforeAll(async () => {
    missing = path.join(os.tmpdir(), `oneuptime-no-diagrams-${process.pid}`);
    fs.rmSync(missing, { recursive: true, force: true });
    served = await mount(missing);
  });

  afterAll(async () => {
    await close(served.server);
  });

  test.each([["mermaid.mjs"], ["chunks/chunk-ABCDEFGH.mjs"]])(
    "answers %s with a 404 and writes nothing",
    async (rest: string) => {
      const answer: Answer = await ask(
        served.port,
        `/oneuptime-assets/mermaid/${rest}`,
      );

      expect(answer.status).toBe(404);
      expect(answer.text).toBe(NOT_FOUND);
      expect(fs.existsSync(missing)).toBe(false);
    },
  );
});

describe("the mermaid mount says when it has no build", () => {
  /*
   * A server run without the build (outside Docker, before anyone ran the
   * script) draws no diagrams on the docs or the blog. It says so in its log,
   * once, when the first diagram is asked for - not when it starts, since
   * every service mounts this and only the App and Home images build it.
   */
  let logged: Array<string>;
  let scratch: string;

  beforeEach(() => {
    logged = [];
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-diagrams-"));
    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      logged.push(String(message));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test("once, naming the directory and the script that builds it", async () => {
    const missing: string = path.join(scratch, "mermaid-browser");
    const served: Mount = await mount(missing);

    try {
      expect(logged).toEqual([]);

      await ask(served.port, "/oneuptime-assets/mermaid/mermaid.mjs");
      await ask(
        served.port,
        "/oneuptime-assets/mermaid/chunks/chunk-ABCDEFGH.mjs",
      );
      await ask(served.port, "/oneuptime-assets/mermaid/mermaid.mjs");

      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(missing);
      expect(logged[0]).toContain("Common/Scripts/build-mermaid-browser.js");
    } finally {
      await close(served.server);
    }
  });

  test("not for a path no build would have", async () => {
    const served: Mount = await mount(path.join(scratch, "mermaid-browser"));

    try {
      for (const rest of ["mermaid.min.js", "notes.txt", "", "a/b/c.mjs"]) {
        expect(
          (await ask(served.port, `/oneuptime-assets/mermaid/${rest}`)).status,
        ).toBe(404);
      }

      expect(logged).toEqual([]);
    } finally {
      await close(served.server);
    }
  });

  test("nothing at all when the build is there", async () => {
    fs.writeFileSync(path.join(scratch, "mermaid.mjs"), ENTRY_TEXT);

    const served: Mount = await mount(scratch);

    try {
      expect(
        (await ask(served.port, "/oneuptime-assets/mermaid/mermaid.mjs"))
          .status,
      ).toBe(200);
      expect(
        (
          await ask(
            served.port,
            "/oneuptime-assets/mermaid/chunks/chunk-ZZZZZZZZ.mjs",
          )
        ).status,
      ).toBe(404);
      expect(logged).toEqual([]);
    } finally {
      await close(served.server);
    }
  });
});
