import "../API/BlogAPI";
import { onBlogPostFileSent } from "../Utils/BlogPostFile";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import os from "os";
import path from "path";

/*
 * A blog post's files (/blog/post/<post>/<file>, API/BlogAPI.ts): its images
 * and diagrams, served from the blog's checkout.
 *
 * An address with no file behind it used to answer 500: Express handed the
 * missing file to the server's error handler, which answers every error it
 * does not know with 500. Google Search Console listed seven such addresses
 * under "Server error (5xx)" - /blog/post/<post>/view-15 and the like.
 *
 * The route is registered on a real Express app here and asked over HTTP,
 * with a stand-in for the server's error handler that answers 500 and
 * records what reached it, as the real one does for an error it does not
 * know. Templates are not rendered: the view engine records which one a
 * page asked for.
 */

jest.setTimeout(60 * 1000);

jest.mock("Common/Server/Utils/Express", () => {
  const actual: { createExpressApp: () => unknown } = jest.requireActual(
    "Common/Server/Utils/Express",
  );
  const mockState: { app: unknown } = { app: actual.createExpressApp() };

  return {
    __esModule: true,
    mockState: mockState,
    default: {
      getExpressApp: (): unknown => {
        return mockState.app;
      },
    },
  };
});

// The blog's checkout is a folder this test writes; the views are this checkout's.
jest.mock("../Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path");
  const nodeOs: typeof os = jest.requireActual("os");
  const homeFolder: string = nodePath.join(__dirname, "..");

  return {
    __esModule: true,
    ViewsPath: nodePath.join(homeFolder, "Views"),
    StaticPath: nodePath.join(homeFolder, "Static"),
    BlogRootPath: nodePath.join(
      nodeOs.tmpdir(),
      `oneuptime-blog-post-files-${process.pid}`,
    ),
  };
});

jest.mock("../Utils/BlogPost", () => {
  return {
    __esModule: true,
    default: {
      getBlogPost: jest.fn().mockResolvedValue(null),
      getBlogPostList: jest.fn().mockResolvedValue([]),
      getTags: jest.fn().mockResolvedValue([]),
      getTagBySlug: jest.fn().mockResolvedValue(null),
      getValidationSummaryHtml: jest.fn().mockResolvedValue(null),
    },
  };
});

const BLOG_ROOT: string = path.join(
  os.tmpdir(),
  `oneuptime-blog-post-files-${process.pid}`,
);
const VIEWS_FOLDER: string = path.join(__dirname, "..", "Views");

// Two of the posts Search Console named, with a diagram each.
const DATADOG_POST: string =
  "2026-03-17-datadog-bill-shock-real-cost-observability-2026";
const OPENTOFU_POST: string = "2026-03-20-secure-opentofu-state-files";
const DIAGRAM: Buffer = Buffer.from("not really a png, but bytes all the same");

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface Booted {
  renders: Array<string>;
  errorsHandled: Array<Error>;
  get: (url: string, headers?: Record<string, string>) => Promise<Answer>;
  close: () => Promise<void>;
}

async function boot(): Promise<Booted> {
  const app: ExpressApplication = Express.getExpressApp();
  const renders: Array<string> = [];
  const errorsHandled: Array<Error> = [];

  app.set("view engine", "ejs");
  app.engine(
    "ejs",
    (
      filePath: string,
      _options: unknown,
      callback: (error: Error | null, html?: string) => void,
    ): void => {
      renders.push(path.relative(VIEWS_FOLDER, filePath));
      callback(null, `<html>${path.basename(filePath)}</html>`);
    },
  );

  // After BlogAPI's routes, as the server's error handler answers an error it does not know.
  app.use(
    (
      err: Error,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      errorsHandled.push(err);
      res.status(500).send({ error: "Server Error" });
    },
  );

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (server.address() as AddressInfo).port;

  const get: (
    url: string,
    headers?: Record<string, string>,
  ) => Promise<Answer> = (
    url: string,
    headers?: Record<string, string>,
  ): Promise<Answer> => {
    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            method: "GET",
            path: url,
            headers: headers || {},
            agent: false,
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve({
                status: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks),
              });
            });
          },
        );

        request.on("error", reject);
        request.end();
      },
    );
  };

  return {
    renders: renders,
    errorsHandled: errorsHandled,
    get: get,
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

describe("a blog post's files, over HTTP", () => {
  let home: Booted;

  beforeAll(async () => {
    for (const post of [DATADOG_POST, OPENTOFU_POST]) {
      fs.mkdirSync(path.join(BLOG_ROOT, "posts", post, "images"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(BLOG_ROOT, "posts", post, "diagram.png"),
        DIAGRAM,
      );
    }

    // Beside the posts, where no address under a post may reach.
    fs.writeFileSync(path.join(BLOG_ROOT, "secret.txt"), "not for readers");

    home = await boot();
  });

  afterAll(async () => {
    await home.close();
    fs.rmSync(BLOG_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    home.renders.length = 0;
    home.errorsHandled.length = 0;
  });

  test("serves a file the post has", async () => {
    const answer: Answer = await home.get(
      `/blog/post/${DATADOG_POST}/diagram.png`,
    );

    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("image/png");
    expect(answer.body.equals(DIAGRAM)).toBe(true);
    expect(home.errorsHandled).toEqual([]);
  });

  test.each([
    `/blog/post/${DATADOG_POST}/view-15`,
    `/blog/post/${DATADOG_POST}/view-13`,
    `/blog/post/${OPENTOFU_POST}/view-13`,
    `/blog/post/${OPENTOFU_POST}/view-0`,
    `/blog/post/${OPENTOFU_POST}/v`,
  ])(
    "answers %s, an address Search Console listed as a 5xx, with the 404 page",
    async (url: string) => {
      const answer: Answer = await home.get(url);

      expect(answer.status).toBe(404);
      expect(home.renders).toEqual(["not-found.ejs"]);
      expect(home.errorsHandled).toEqual([]);
    },
  );

  test("answers a file of a post that does not exist with the 404 page", async () => {
    const answer: Answer = await home.get(
      "/blog/post/2026-01-01-no-such-post/diagram.png",
    );

    expect(answer.status).toBe(404);
    expect(home.renders).toEqual(["not-found.ejs"]);
    expect(home.errorsHandled).toEqual([]);
  });

  test("answers a folder of the post with the 404 page, not its listing", async () => {
    const answer: Answer = await home.get(`/blog/post/${DATADOG_POST}/images`);

    expect(answer.status).toBe(404);
    expect(home.renders).toEqual(["not-found.ejs"]);
    expect(home.errorsHandled).toEqual([]);
  });

  test("answers a name that climbs out of the post's folder with the 404 page", async () => {
    const answer: Answer = await home.get(
      `/blog/post/${DATADOG_POST}/..%2F..%2Fsecret.txt`,
    );

    expect(answer.status).toBe(404);
    expect(answer.body.toString()).not.toContain("not for readers");
    expect(home.renders).toEqual(["not-found.ejs"]);
    expect(home.errorsHandled).toEqual([]);
  });

  test("answers a range past the end of a file with 416, as the send chose", async () => {
    const answer: Answer = await home.get(
      `/blog/post/${DATADOG_POST}/diagram.png`,
      { Range: `bytes=${DIAGRAM.length + 100}-` },
    );

    expect(answer.status).toBe(416);
    expect(answer.headers["content-range"]).toBe(`bytes */${DIAGRAM.length}`);
    expect(home.renders).toEqual([]);
    expect(home.errorsHandled).toEqual([]);
  });

  test("still answers the post's own page route, ahead of the file route", async () => {
    // getBlogPost finds nothing here, so the post's page is the 404 page too.
    const answer: Answer = await home.get(`/blog/post/${DATADOG_POST}/view`);

    expect(answer.status).toBe(404);
    expect(home.renders).toEqual(["not-found.ejs"]);
    expect(home.errorsHandled).toEqual([]);
  });
});

describe("onBlogPostFileSent", () => {
  interface FakeResponse {
    headersSent: boolean;
    statusCode: number | null;
    headers: Record<string, string>;
    ended: boolean;
    rendered: string | null;
  }

  const fakeResponse: (headersSent?: boolean) => {
    res: ExpressResponse;
    state: FakeResponse;
  } = (
    headersSent?: boolean,
  ): { res: ExpressResponse; state: FakeResponse } => {
    const state: FakeResponse = {
      headersSent: Boolean(headersSent),
      statusCode: null,
      headers: {},
      ended: false,
      rendered: null,
    };

    const res: unknown = {
      get headersSent(): boolean {
        return state.headersSent;
      },
      status: (code: number): unknown => {
        state.statusCode = code;
        return res;
      },
      set: (headers: Record<string, string>): unknown => {
        Object.assign(state.headers, headers);
        return res;
      },
      end: (): void => {
        state.ended = true;
      },
      render: (view: string): void => {
        state.rendered = path.basename(view);
      },
    };

    return { res: res as ExpressResponse, state: state };
  };

  const sendError: (props: Record<string, unknown>) => Error = (
    props: Record<string, unknown>,
  ): Error => {
    return Object.assign(new Error("could not send"), props);
  };

  test("does nothing once the file is sent", () => {
    const { res, state } = fakeResponse();
    const next: jest.Mock = jest.fn();

    onBlogPostFileSent(res, next)();

    expect(state.statusCode).toBeNull();
    expect(state.rendered).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ["missing", { code: "ENOENT", status: 404, statusCode: 404 }],
    ["a name too long", { code: "ENAMETOOLONG", status: 404 }],
    ["under a file, not a folder", { code: "ENOTDIR", status: 404 }],
    ["above the post's folder", { status: 403 }],
    ["a name that does not decode", { status: 400 }],
    ["a folder", { code: "EISDIR" }],
  ])(
    "answers a file that is %s with the 404 page",
    (_what: string, props: Record<string, unknown>) => {
      const { res, state } = fakeResponse();
      const next: jest.Mock = jest.fn();

      onBlogPostFileSent(res, next)(sendError(props));

      expect(state.statusCode).toBe(404);
      expect(state.rendered).toBe("not-found.ejs");
      expect(next).not.toHaveBeenCalled();
    },
  );

  test("answers a failed precondition with its own status", () => {
    const { res, state } = fakeResponse();
    const next: jest.Mock = jest.fn();

    onBlogPostFileSent(res, next)(sendError({ status: 412 }));

    expect(state.statusCode).toBe(412);
    expect(state.ended).toBe(true);
    expect(state.rendered).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ["went away", { code: "ECONNABORTED" }],
    ["stopped reading", { syscall: "write", code: "EPIPE" }],
  ])(
    "does not answer a reader who %s",
    (_what: string, props: Record<string, unknown>) => {
      const { res, state } = fakeResponse();
      const next: jest.Mock = jest.fn();

      onBlogPostFileSent(res, next)(sendError(props));

      expect(state.statusCode).toBeNull();
      expect(state.rendered).toBeNull();
      expect(next).not.toHaveBeenCalled();
    },
  );

  test("hands a failure that is not about the file to the error handler", () => {
    const { res, state } = fakeResponse();
    const next: jest.Mock = jest.fn();
    const error: Error = sendError({ code: "EACCES", status: 500 });

    onBlogPostFileSent(res, next)(error);

    expect(next).toHaveBeenCalledWith(error);
    expect(state.statusCode).toBeNull();
    expect(state.rendered).toBeNull();
  });

  test("hands a failure after the headers went out to the error handler", () => {
    const { res, state } = fakeResponse(true);
    const next: jest.Mock = jest.fn();
    const error: Error = sendError({ code: "ENOENT", status: 404 });

    onBlogPostFileSent(res, next)(error);

    expect(next).toHaveBeenCalledWith(error);
    expect(state.rendered).toBeNull();
  });
});
