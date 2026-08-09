import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  NextFunction,
  RequestHandler,
} from "./Express";
import logger from "./Logger";
import fs from "fs";
import path from "path";

/**
 * Serves the browser libraries our server-rendered pages need, from this
 * install rather than from a public CDN.
 *
 * An air-gapped deployment has no route to cdn.tailwindcss.com or
 * cdnjs.cloudflare.com, and a `<script src>` pointed at one does not fail
 * fast - the browser waits out the connect timeout with the parser blocked,
 * so the page renders unstyled or not at all. Same class of bug as the Monaco
 * loader (see CodeEditor/MonacoLoader.ts): the fix is to stop reaching off-box
 * for anything the page cannot render without.
 *
 * Mounted by every service, because there is no single service that serves
 * every one of these pages: Docs, the API reference and the SSO/on-call
 * message views all come out of the App container, the marketing site out of
 * Home, and nginx sends `/` to whichever of the two the install has (App when
 * billing is off, which is every self-hosted install). A path only one of them
 * answers would 404 for the other.
 */

/**
 * Absolute, host-relative. Views hard-code this rather than take it as a
 * render variable - the mount point is fixed, and threading a variable through
 * every Response.render call site would be a lot of ceremony for a constant.
 */
export const VendorAssetsRoute: string = "/oneuptime-assets";

/** Where the committed assets live on disk. */
export const VendorAssetsPath: string = path.resolve(
  __dirname,
  "..",
  "Static",
  "Vendor",
);

/**
 * Mermaid is a dependency of Common already (Common/UI renders diagrams in
 * markdown with it), so it is on disk in every image and there is no reason to
 * commit a second copy. Resolved rather than hard-coded because npm may hoist
 * it above Common's own node_modules.
 */
export function getMermaidDistPath(): string | null {
  try {
    return path.join(
      path.dirname(require.resolve("mermaid/package.json")),
      "dist",
    );
  } catch (error) {
    logger.error(
      "mermaid could not be resolved. Diagrams in docs and blog posts will not render.",
    );
    logger.error(error);
    return null;
  }
}

/*
 * Mermaid's dist directory also carries type definitions, sourcemaps and its
 * own docs. Only the code the browser actually imports gets served - the
 * entrypoint plus the diagram chunks it lazily pulls in.
 */
const MERMAID_SERVABLE_EXTENSIONS: Array<string> = [".js", ".mjs"];

/*
 * A year. Every path under here names a version, either in the filename
 * (tailwind-3.4.5.js) or by way of the pinned package that produced it, so a
 * stale cache entry cannot serve the wrong thing.
 */
const CACHE_MAX_AGE_MILLISECONDS: number = 365 * 24 * 60 * 60 * 1000;

export type MountVendorAssetsFunction = (app: ExpressApplication) => void;

const mountVendorAssets: MountVendorAssetsFunction = (
  app: ExpressApplication,
): void => {
  if (!fs.existsSync(VendorAssetsPath)) {
    /*
     * Nothing to serve is worth shouting about: every page that references
     * these paths is about to render without its stylesheet.
     */
    logger.error(
      `Vendored browser assets are missing at ${VendorAssetsPath}. Server-rendered pages will render unstyled.`,
    );
    return;
  }

  app.use(
    VendorAssetsRoute,
    ExpressStatic(VendorAssetsPath, {
      maxAge: CACHE_MAX_AGE_MILLISECONDS,
      index: false,
      redirect: false,
    }) as RequestHandler,
  );

  const mermaidDistPath: string | null = getMermaidDistPath();

  if (!mermaidDistPath) {
    return;
  }

  const mermaidStaticHandler: RequestHandler = ExpressStatic(mermaidDistPath, {
    maxAge: CACHE_MAX_AGE_MILLISECONDS,
    index: false,
    redirect: false,
  }) as RequestHandler;

  app.use(
    `${VendorAssetsRoute}/mermaid`,
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      const extension: string = path.extname(req.path).toLowerCase();

      if (!MERMAID_SERVABLE_EXTENSIONS.includes(extension)) {
        return next();
      }

      return mermaidStaticHandler(req, res, next);
    },
  );
};

export default mountVendorAssets;
