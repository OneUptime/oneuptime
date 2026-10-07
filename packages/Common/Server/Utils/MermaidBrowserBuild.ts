import Execute from "./Execute";
import logger from "./Logger";
import path from "path";

/**
 * mermaid for the server-rendered pages that draw diagrams - the docs and the
 * blog. It is built from mermaid's ES module source with the frontends' own
 * esbuild setup (Common/UI/esbuild-mermaid.js), so katex and every other
 * dependency is the copy npm installed, with Common's overrides applied.
 * mermaid's prebuilt dist bundles each embed their own copies, which is why
 * they are no longer served. VendorAssets.ts serves the result under
 * /oneuptime-assets/mermaid/.
 *
 * Built on the first request for it, not at startup: every service mounts the
 * vendor assets, and only the ones serving the docs and the blog are ever
 * asked. The build runs in a child node process, so esbuild never loads into
 * the server; it takes about a second, and its output (about 3.5 MB of
 * JavaScript) stays in memory for the life of the process. Nothing is written
 * to disk, so a read-only container filesystem is fine.
 */

/*
 * The module the docs and the blog import. Its name is stable; every chunk it
 * imports is content-hashed.
 */
export const MermaidBrowserEntry: string = "mermaid.mjs";

export interface MermaidBrowserBuild {
  entry: string;
  // Every servable file by its path under the mount, the entry included.
  files: Map<string, Buffer>;
}

export type MermaidBrowserBuildFunction = () => Promise<MermaidBrowserBuild>;

export type RunMermaidBrowserBuildFunction = (
  script?: string,
) => Promise<MermaidBrowserBuild>;

export const MermaidBrowserBuildScript: string = path.resolve(
  __dirname,
  "..",
  "..",
  "UI",
  "esbuild-mermaid.js",
);

// A minute, then a failed build may be tried again.
export const MermaidBuildRetryAfterSeconds: number = 60;

const BUILD_TIMEOUT_MILLISECONDS: number = 2 * 60 * 1000;

// The output is about 3.6 MB of JSON; leave room for mermaid to grow.
const MAX_BUILD_OUTPUT_BYTES: number = 64 * 1024 * 1024;

/*
 * A path the build may name: relative, forward slashes, no "..", ending in
 * .mjs. The files map is the only thing a request is looked up in, so this is
 * what keeps a malformed build from naming something odd.
 */
const SERVABLE_PATH: RegExp =
  /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.mjs$/;

/*
 * The child gets what esbuild needs to find its binary, and nothing of the
 * server's own environment: no database passwords, no secrets, and no
 * NODE_OPTIONS (which would load ts-node or a large heap into a plain script).
 */
export const getMermaidBuildEnvironment: () => NodeJS.ProcessEnv =
  (): NodeJS.ProcessEnv => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };

    for (const name of ["PATH", "ESBUILD_BINARY_PATH", "TMPDIR"]) {
      const value: string | undefined = process.env[name];

      if (value) {
        environment[name] = value;
      }
    }

    return environment;
  };

/**
 * Reads what `node esbuild-mermaid.js` prints. Refuses anything that is not
 * exactly a build: a non-JSON line, a path outside the mount, an entry the
 * pages do not import.
 */
export const parseMermaidBrowserBuild: (
  output: string,
) => MermaidBrowserBuild = (output: string): MermaidBrowserBuild => {
  const parsed: unknown = JSON.parse(output);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The mermaid build printed something other than a build.");
  }

  const { entry, files } = parsed as { entry?: unknown; files?: unknown };

  if (entry !== MermaidBrowserEntry) {
    throw new Error(
      `The mermaid build's entry is ${String(entry)}, not ${MermaidBrowserEntry}.`,
    );
  }

  if (!Array.isArray(files)) {
    throw new Error("The mermaid build listed no files.");
  }

  const servable: Map<string, Buffer> = new Map<string, Buffer>();

  for (const file of files) {
    const { path: filePath, text } = (file || {}) as {
      path?: unknown;
      text?: unknown;
    };

    if (
      typeof filePath !== "string" ||
      typeof text !== "string" ||
      !SERVABLE_PATH.test(filePath)
    ) {
      throw new Error(
        `The mermaid build named a file that cannot be served: ${String(filePath)}.`,
      );
    }

    servable.set(filePath, Buffer.from(text, "utf8"));
  }

  if (!servable.has(MermaidBrowserEntry)) {
    throw new Error(`The mermaid build has no ${MermaidBrowserEntry}.`);
  }

  return { entry: MermaidBrowserEntry, files: servable };
};

/**
 * Runs the build in a child node process (Execute.executeCommandFile: no
 * shell, a hard timeout, a capped output, and the environment above in place
 * of the server's). `script` is for tests; it defaults to esbuild-mermaid.js.
 */
export const runMermaidBrowserBuild: RunMermaidBrowserBuildFunction = async (
  script: string = MermaidBrowserBuildScript,
): Promise<MermaidBrowserBuild> => {
  let output: string;

  try {
    output = await Execute.executeCommandFile({
      command: process.execPath,
      args: [script],
      cwd: path.dirname(script),
      maxBuffer: MAX_BUILD_OUTPUT_BYTES,
      timeoutInMS: BUILD_TIMEOUT_MILLISECONDS,
      env: getMermaidBuildEnvironment(),
    });
  } catch (error) {
    throw new Error(
      `mermaid could not be built for the docs and the blog: ${
        (error as Error).message
      }`,
    );
  }

  return parseMermaidBrowserBuild(output);
};

export interface MermaidBrowserBuildCacheOptions {
  build: MermaidBrowserBuildFunction;
  retryAfterFailureMilliseconds: number;
  now: () => number;
}

/**
 * One build per process, shared by every request that arrives while it runs.
 * A failed build answers every request with the same failure until
 * retryAfterFailureMilliseconds has passed, so a broken install cannot be made
 * to start a build per request.
 */
export const createMermaidBrowserBuildCache: (
  options: MermaidBrowserBuildCacheOptions,
) => MermaidBrowserBuildFunction = (
  options: MermaidBrowserBuildCacheOptions,
): MermaidBrowserBuildFunction => {
  let current: Promise<MermaidBrowserBuild> | null = null;
  let failedAt: number | null = null;

  return (): Promise<MermaidBrowserBuild> => {
    const canRetry: boolean =
      failedAt !== null &&
      options.now() - failedAt >= options.retryAfterFailureMilliseconds;

    if (current && !canRetry) {
      return current;
    }

    failedAt = null;

    const attempt: Promise<MermaidBrowserBuild> = options.build();
    current = attempt;

    attempt.catch((): void => {
      if (current === attempt) {
        failedAt = options.now();
      }
    });

    return attempt;
  };
};

export const getMermaidBrowserBuild: MermaidBrowserBuildFunction =
  createMermaidBrowserBuildCache({
    build: async (): Promise<MermaidBrowserBuild> => {
      const startedAt: number = Date.now();

      try {
        const build: MermaidBrowserBuild = await runMermaidBrowserBuild();

        logger.debug(
          `Built mermaid for the docs and the blog: ${build.files.size} files in ${
            Date.now() - startedAt
          } ms.`,
        );

        return build;
      } catch (error) {
        logger.error(
          "mermaid could not be built. Diagrams in the docs and blog posts will not render.",
        );
        logger.error(error);
        throw error;
      }
    },
    retryAfterFailureMilliseconds: MermaidBuildRetryAfterSeconds * 1000,
    now: (): number => {
      return Date.now();
    },
  });
