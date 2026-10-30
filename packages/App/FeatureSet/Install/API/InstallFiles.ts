import {
  INSTALL_SCRIPTS,
  INSTALL_SCRIPTS_ROUTE,
  InstallScriptEntry,
  getInstallScriptEntry,
  getInstallScriptFile,
} from "Common/Types/InstallScripts/InstallScripts";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import fs from "fs";
import path from "path";

/*
 * Serves the install scripts in Common/Types/InstallScripts, and the files
 * they download, from the App image:
 *
 *   GET /install/<name>          the entry's install script
 *   GET /install/<name>/<file>   one of its files
 *
 * These are piped into a root shell on customers' machines, so:
 *
 *   - the body is the file as the image holds it, byte for byte, read-only
 *     and owned by root (packages/App/Dockerfile.tpl): nothing a request
 *     says reaches it, and nothing is filled in;
 *   - a request picks an entry and a file by their exact names in the
 *     list, never a path on disk, so "../" and absolute paths are no file
 *     of any entry and answer 404;
 *   - every answer is plain text (a browser shows the script to read
 *     before it runs, and nothing sniffs it as anything else) and is never
 *     stored by a browser or a proxy, so the day OneUptime is upgraded every
 *     download is the new release's;
 *   - the release the files are from is in X-OneUptime-Version, so
 *     `curl -sI` says which script someone ran.
 *
 * The scripts tell an older OneUptime by its answer: one that does not
 * serve these answers 404 (or its own page, as HTML), and the scripts then
 * download their files from GitHub. So an entry or file this release lacks
 * is a 404, but a listed file this image cannot read is a 500: the scripts
 * stop there instead of quietly taking another release's files.
 */

export interface InstallFilesRouterOptions {
  /*
   * The folder each entry's sourceDirectory is in: /usr/src in the image,
   * where the Dockerfile copies agents/<Agent> to /usr/src/agents/<Agent>.
   */
  root: string;
  // The release the image is (APP_VERSION). Empty when unknown.
  version: string;
}

// The release, as X-OneUptime-Version carries it: none for "unknown".
export function getServedVersion(version: string | null | undefined): string {
  const trimmed: string = (version || "").trim();

  return trimmed && trimmed !== "unknown" ? trimmed : "";
}

function setCommonHeaders(
  res: ExpressResponse,
  options: InstallFilesRouterOptions,
): void {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const version: string = getServedVersion(options.version);

  if (version) {
    res.setHeader("X-OneUptime-Version", version);
  }
}

/*
 * What a request that names no entry or file of one is told: the scripts
 * this OneUptime serves. Nothing from the request is in it.
 */
export function getNotFoundText(): string {
  const lines: Array<string> = INSTALL_SCRIPTS.filter(
    (entry: InstallScriptEntry): boolean => {
      return Boolean(entry.script);
    },
  ).map((entry: InstallScriptEntry): string => {
    return `  ${INSTALL_SCRIPTS_ROUTE}/${entry.name}    the ${entry.title}`;
  });

  return [
    "Not found. This OneUptime serves these install scripts:",
    "",
    ...lines,
    "",
  ].join("\n");
}

function sendNotFound(
  res: ExpressResponse,
  options: InstallFilesRouterOptions,
): void {
  setCommonHeaders(res, options);
  res.status(404).send(getNotFoundText());
}

async function sendInstallFile(data: {
  res: ExpressResponse;
  entry: InstallScriptEntry;
  file: string;
  options: InstallFilesRouterOptions;
}): Promise<void> {
  const { res, entry, file, options } = data;
  let content: Buffer;

  try {
    content = await fs.promises.readFile(
      path.join(options.root, entry.sourceDirectory, file),
    );
  } catch (err) {
    logger.error(
      `Install scripts: cannot read ${entry.sourceDirectory}/${file} under ${options.root}, which ${INSTALL_SCRIPTS_ROUTE}/${entry.name} serves. The image should carry it (packages/App/Dockerfile.tpl).`,
    );
    logger.error(err);

    setCommonHeaders(res, options);
    res
      .status(500)
      .send(
        `This OneUptime cannot read ${INSTALL_SCRIPTS_ROUTE}/${entry.name}/${file}. Its logs say why.\n`,
      );
    return;
  }

  setCommonHeaders(res, options);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${path.posix.basename(file)}"`,
  );
  res.status(200).send(content);
}

export function createInstallFilesRouter(
  options: InstallFilesRouterOptions,
): ExpressRouter {
  const router: ExpressRouter = Express.getRouter();

  // An entry's install script: /install/proxmox-agent.
  router.get(
    "/:name",
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      const entry: InstallScriptEntry | null = getInstallScriptEntry(
        req.params["name"],
      );

      if (!entry || !entry.script) {
        return sendNotFound(res, options);
      }

      return sendInstallFile({
        res,
        entry,
        file: entry.script,
        options,
      });
    },
  );

  // One of its files: /install/database-agent/configs/postgresql.yaml.
  router.get(
    "/:name/*",
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      const entry: InstallScriptEntry | null = getInstallScriptEntry(
        req.params["name"],
      );
      const file: string | null = entry
        ? getInstallScriptFile(entry, req.params[0])
        : null;

      if (!entry || !file) {
        return sendNotFound(res, options);
      }

      return sendInstallFile({ res, entry, file, options });
    },
  );

  // Anything else under /install is no file either.
  router.get("*", (_req: ExpressRequest, res: ExpressResponse): void => {
    return sendNotFound(res, options);
  });

  return router;
}
