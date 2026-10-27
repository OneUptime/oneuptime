/*
 * A real Chromium, driven over the Chrome DevTools Protocol, for the few
 * things jsdom cannot be: a page the browser PRERENDERS and then activates,
 * a page that loads in a background tab and paints when it is shown, and a
 * page the back/forward cache restores (issue #5181).
 *
 * Not Playwright's page API: Playwright turns prerendering off for every
 * page it controls (Chromium reports PrerenderingDisabledByDevTools), so
 * the test launches the browser itself and speaks CDP over a WebSocket. A
 * page that is to be prerendered is opened without a DevTools session and
 * attached to only once the prerender exists - attaching first turns
 * prerendering off as well.
 *
 * The browser is the one Playwright installs (npx playwright install
 * chromium), found in its cache, or whatever CHROME_PATH names. @types/node
 * is deliberately absent from this package (see SourceHygiene.test.ts), so
 * the little of Node this needs is declared here.
 */

declare function require(id: string): unknown;
declare const process: {
  env: Record<string, string | undefined>;
  platform: string;
};

interface ChildProcess {
  stderr: { on: (event: "data", listener: (chunk: unknown) => void) => void };
  on: (event: "exit", listener: (code: number | null) => void) => void;
  kill: () => boolean;
}

interface ChildProcessModule {
  spawn: (command: string, args: Array<string>) => ChildProcess;
}

interface FileSystem {
  existsSync: (target: string) => boolean;
  readdirSync: (directory: string) => Array<string>;
  readFileSync: (file: string, encoding: string) => string;
  mkdtempSync: (prefix: string) => string;
  rmSync: (
    target: string,
    options: { recursive: boolean; force: boolean },
  ) => void;
}

interface PathModule {
  join: (...parts: Array<string>) => string;
}

interface OsModule {
  homedir: () => string;
  tmpdir: () => string;
}

interface IncomingMessage {
  url?: string;
  method?: string;
  headers?: Record<string, string | Array<string> | undefined>;
  resume?: () => void;
}

interface ServerResponse {
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
}

interface Server {
  listen: (port: number, host: string, callback: () => void) => void;
  address: () => { port: number };
  close: () => void;
}

interface HttpModule {
  createServer: (
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ) => Server;
}

const childProcess: ChildProcessModule =
  require("child_process") as ChildProcessModule;
const fs: FileSystem = require("fs") as FileSystem;
const nodePath: PathModule = require("path") as PathModule;
const os: OsModule = require("os") as OsModule;
const http: HttpModule = require("http") as HttpModule;

const DEVTOOLS_LISTENING: RegExp = /DevTools listening on (ws:\/\/\S+)/;
const COMMAND_TIMEOUT_MS: number = 15000;

/*
 * The Chromium to drive: CHROME_PATH, else the newest build in
 * Playwright's cache, else a system Chrome. null when there is none.
 */
export function findChromium(): string | null {
  const named: string | undefined = process.env["CHROME_PATH"];

  if (named) {
    return fs.existsSync(named) ? named : null;
  }

  const cache: string =
    process.env["PLAYWRIGHT_BROWSERS_PATH"] ||
    nodePath.join(os.homedir(), ".cache", "ms-playwright");

  if (fs.existsSync(cache)) {
    const builds: Array<string> = fs
      .readdirSync(cache)
      .filter((name: string): boolean => {
        return name.indexOf("chromium-") === 0;
      })
      .sort((a: string, b: string): number => {
        return (
          Number(b.slice("chromium-".length)) -
          Number(a.slice("chromium-".length))
        );
      });

    for (const build of builds) {
      for (const folder of ["chrome-linux64", "chrome-linux"]) {
        const executable: string = nodePath.join(
          cache,
          build,
          folder,
          "chrome",
        );

        if (fs.existsSync(executable)) {
          return executable;
        }
      }
    }
  }

  for (const candidate of [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export interface CdpReply {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
  sessionId?: string;
}

/* A browser-level CDP connection, with flattened sessions for targets. */
export class Cdp {
  private readonly socket: WebSocket;
  private nextId: number = 1;
  private readonly pending: Map<
    number,
    { resolve: (reply: CdpReply) => void; reject: (error: Error) => void }
  > = new Map();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener("message", (message: MessageEvent): void => {
      const reply: CdpReply = JSON.parse(String(message.data)) as CdpReply;
      const waiter:
        | { resolve: (reply: CdpReply) => void; reject: (error: Error) => void }
        | undefined =
        reply.id !== undefined ? this.pending.get(reply.id) : undefined;

      if (waiter && reply.id !== undefined) {
        this.pending.delete(reply.id);

        if (reply.error) {
          waiter.reject(new Error(reply.error.message));
        } else {
          waiter.resolve(reply);
        }
      }
    });
  }

  public static async connect(url: string): Promise<Cdp> {
    const socket: WebSocket = new WebSocket(url);

    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {
        socket.addEventListener("open", (): void => {
          resolve();
        });
        socket.addEventListener("error", (): void => {
          reject(new Error(`Could not connect to ${url}`));
        });
      },
    );

    return new Cdp(socket);
  }

  public send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const id: number = this.nextId++;

    return new Promise<Record<string, unknown>>(
      (
        resolve: (result: Record<string, unknown>) => void,
        reject: (error: Error) => void,
      ): void => {
        const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, COMMAND_TIMEOUT_MS);

        this.pending.set(id, {
          resolve: (reply: CdpReply): void => {
            clearTimeout(timer);
            resolve(reply.result || {});
          },
          reject: (error: Error): void => {
            clearTimeout(timer);
            reject(error);
          },
        });

        this.socket.send(
          JSON.stringify(
            sessionId
              ? { id: id, method: method, params: params, sessionId: sessionId }
              : { id: id, method: method, params: params },
          ),
        );
      },
    );
  }

  public close(): void {
    this.socket.close();
  }
}

/* A tab of the browser, and the session that drives it once attached. */
export class Tab {
  public readonly targetId: string;
  private readonly cdp: Cdp;
  private sessionId: string | null = null;

  public constructor(cdp: Cdp, targetId: string) {
    this.cdp = cdp;
    this.targetId = targetId;
  }

  /*
   * Opens a tab on url. A background tab loads hidden and stays so until
   * shown. No session is attached: see attach().
   */
  public static async open(
    cdp: Cdp,
    url: string,
    background: boolean = false,
  ): Promise<Tab> {
    const created: Record<string, unknown> = await cdp.send(
      "Target.createTarget",
      { url: url, background: background },
    );

    return new Tab(cdp, String(created["targetId"]));
  }

  /*
   * A DevTools session on the tab. Attached late on purpose: Chromium
   * will not prerender for a page a session is attached to.
   */
  public async attach(): Promise<void> {
    if (this.sessionId) {
      return;
    }

    const attached: Record<string, unknown> = await this.cdp.send(
      "Target.attachToTarget",
      { targetId: this.targetId, flatten: true },
    );

    this.sessionId = String(attached["sessionId"]);
  }

  /* Evaluates an expression in the page and returns its JSON value. */
  public async evaluate<T>(expression: string): Promise<T> {
    await this.attach();

    const answer: Record<string, unknown> = await this.cdp.send(
      "Runtime.evaluate",
      { expression: expression, returnByValue: true, awaitPromise: true },
      this.sessionId as string,
    );
    const result: Record<string, unknown> = (answer["result"] || {}) as Record<
      string,
      unknown
    >;

    if (answer["exceptionDetails"]) {
      throw new Error(
        `${expression} threw: ${JSON.stringify(answer["exceptionDetails"])}`,
      );
    }

    return result["value"] as T;
  }

  /*
   * Polls an expression until it is truthy, then returns its value. The
   * label says what was being waited for when it never came.
   */
  public async waitFor<T>(
    expression: string,
    label: string,
    timeoutMs: number = 15000,
  ): Promise<T> {
    const deadline: number = Date.now() + timeoutMs;
    let last: unknown = null;

    while (Date.now() < deadline) {
      try {
        last = await this.evaluate<unknown>(expression);

        if (last) {
          return last as T;
        }
      } catch (error) {
        /* The page may be between documents; ask again. */
        last = error;
      }

      await sleep(100);
    }

    throw new Error(
      `Timed out waiting for ${label} (${expression}; last: ${String(last)})`,
    );
  }

  /* A key press, as the visitor makes it: a trusted keydown and keyup. */
  public async pressKey(): Promise<void> {
    await this.attach();

    for (const type of ["keyDown", "keyUp"]) {
      await this.cdp.send(
        "Input.dispatchKeyEvent",
        {
          type: type,
          key: "Shift",
          code: "ShiftLeft",
          windowsVirtualKeyCode: 16,
        },
        this.sessionId as string,
      );
    }
  }

  public async bringToFront(): Promise<void> {
    await this.cdp.send("Target.activateTarget", { targetId: this.targetId });
  }

  public async close(): Promise<void> {
    try {
      await this.cdp.send("Target.closeTarget", { targetId: this.targetId });
    } catch {
      /* Already gone. */
    }
  }
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, milliseconds);
  });
}

/* A headless Chromium of its own, on a throwaway profile. */
export class Browser {
  public readonly cdp: Cdp;
  private readonly child: ChildProcess;
  private readonly profile: string;

  private constructor(cdp: Cdp, child: ChildProcess, profile: string) {
    this.cdp = cdp;
    this.child = child;
    this.profile = profile;
  }

  public static async launch(executable: string): Promise<Browser> {
    const profile: string = fs.mkdtempSync(
      nodePath.join(os.tmpdir(), "oneuptime-recorder-vitals-"),
    );
    const child: ChildProcess = childProcess.spawn(executable, [
      "--headless=new",
      /*
       * Root in a container cannot sandbox, and Ubuntu's AppArmor rules
       * stop the sandbox for unprivileged users on CI runners; Playwright
       * runs Chromium unsandboxed by default for the same reasons.
       */
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ]);

    const url: string = await new Promise<string>(
      (
        resolve: (url: string) => void,
        reject: (error: Error) => void,
      ): void => {
        let output: string = "";

        child.stderr.on("data", (chunk: unknown): void => {
          output += String(chunk);

          const match: RegExpMatchArray | null =
            output.match(DEVTOOLS_LISTENING);

          if (match) {
            resolve(match[1] as string);
          }
        });
        child.on("exit", (code: number | null): void => {
          reject(new Error(`Chromium exited (${code}): ${output}`));
        });
      },
    );

    return new Browser(await Cdp.connect(url), child, profile);
  }

  public close(): void {
    this.cdp.close();
    this.child.kill();

    try {
      fs.rmSync(this.profile, { recursive: true, force: true });
    } catch {
      /* The browser may still hold it for a moment; it is a temp dir. */
    }
  }
}

/* One request the site was sent, as it arrived. */
export interface SiteRequest {
  method: string;
  url: string;
  path: string;

  /*
   * The Sec-Purpose header: "prefetch;prerender" on what Chromium fetches
   * for a page it prerenders.
   */
  purpose: string;
  atMs: number;
}

/*
 * A local site serving fixed pages, on a port of its own. Every request is
 * logged, and a POST - a recording's upload - is taken and answered 202, as
 * OneUptime's ingest answers it.
 */
export class Site {
  public readonly origin: string;
  public readonly requests: Array<SiteRequest>;
  private readonly server: Server;

  private constructor(
    server: Server,
    origin: string,
    requests: Array<SiteRequest>,
  ) {
    this.server = server;
    this.origin = origin;
    this.requests = requests;
  }

  public static async serve(pages: Record<string, string>): Promise<Site> {
    const requests: Array<SiteRequest> = [];
    const server: Server = http.createServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        const pathname: string = (request.url || "/").split("?")[0] || "/";
        const purpose: string | Array<string> | undefined =
          request.headers?.["sec-purpose"];

        requests.push({
          method: request.method || "GET",
          url: request.url || "/",
          path: pathname,
          purpose: typeof purpose === "string" ? purpose : "",
          atMs: Date.now(),
        });

        if (request.method === "POST") {
          request.resume?.();
          response.writeHead(202, { "content-type": "text/plain" });
          response.end("");
          return;
        }

        const body: string | undefined = pages[pathname];

        if (body === undefined) {
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("not found");
          return;
        }

        response.writeHead(200, {
          "content-type": pathname.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/html; charset=utf-8",
        });
        response.end(body);
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", resolve);
    });

    return new Site(
      server,
      `http://127.0.0.1:${server.address().port}`,
      requests,
    );
  }

  public close(): void {
    this.server.close();
  }
}

/* Reads a file as text: for the bundles the test serves. */
export function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

export function packagePath(...parts: Array<string>): string {
  return nodePath.join(...parts);
}
