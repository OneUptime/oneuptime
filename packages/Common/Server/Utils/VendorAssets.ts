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
 * so the page renders unstyled or not at all. The code editor's old Monaco
 * runtime had the same bug, loading from cdn.jsdelivr.net: the fix is to stop
 * reaching off-box for anything the page cannot render without.
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
 * OneUptime's own brand images, served under the same prefix.
 *
 * Not third-party, so they do not belong in Static/Vendor, but they have the
 * identical problem: the server-rendered pages that carry the logo (the on-call
 * acknowledge page, the SSO message page) come out of the App container, and
 * `/img/...` is served by Home. nginx sends "/" to App on every install with
 * billing off - which is every self-hosted install - so the logo those pages
 * asked for 404'd and rendered as a broken image.
 * See https://github.com/OneUptime/oneuptime/issues/3457.
 */
export const BrandAssetsRouteSegment: string = "brand";

export const BrandAssetsPath: string = path.resolve(
  __dirname,
  "..",
  "Static",
  "Brand",
);

/** Host-relative URL of the OneUptime wordmark, for use in a view's <img src>. */
export const OneUptimeLogoUrl: string = `${VendorAssetsRoute}/${BrandAssetsRouteSegment}/oneuptime-logo.svg`;

/** Cache-versioned, contrast-safe `Up.` mark used by browser tabs. */
export const OneUptimeFaviconUrl: string = `${VendorAssetsRoute}/${BrandAssetsRouteSegment}/favicons/oneuptime-up-v1.svg`;

/**
 * mermaid, for the docs and the blog. Not a committed copy and not mermaid's
 * own dist bundles, which carry their own copies of its dependencies: a build
 * of mermaid's ES module source with the dependencies npm installed for
 * Common, katex among them. Common/Scripts/build-mermaid-browser.js writes it
 * here when the App and Home images are built (Common/UI/esbuild-mermaid.js
 * has the details). A service whose image does not build it - the probe, the
 * workers - answers 404, as it would for any other missing asset.
 */
export const MermaidBuildPath: string = path.resolve(
  __dirname,
  "..",
  "..",
  "build",
  "mermaid-browser",
);

export const MermaidRouteSegment: string = "mermaid";

/** The module the docs and the blog import. Its chunks sit under chunks/. */
export const MermaidEntryFilename: string = "mermaid.mjs";

/** What a view imports to draw diagrams. */
export const MermaidEntryUrl: string = `${VendorAssetsRoute}/${MermaidRouteSegment}/${MermaidEntryFilename}`;

/*
 * A year, for paths that cannot change meaning: tailwind and highlight name
 * their version in the filename, and mermaid's chunks are content-hashed.
 */
const IMMUTABLE_CACHE_MAX_AGE_MILLISECONDS: number = 365 * 24 * 60 * 60 * 1000;

/*
 * An hour, for mermaid's entry. Its name is stable while everything it imports
 * is content-hashed, so a year-old cached copy would go on asking for chunk
 * filenames that a mermaid upgrade has already replaced - and the diagrams
 * would stay broken, for that one visitor, until the cache entry aged out.
 */
const REVALIDATE_CACHE_MAX_AGE_MILLISECONDS: number = 60 * 60 * 1000;

/* Where the build puts its content-hashed chunks, relative to its mount. */
const MERMAID_CHUNK_PREFIX: string = "/chunks/";

/*
 * The only paths a mermaid build has: the entry, and its chunks one directory
 * down. Anything else - another extension, a dot segment, a hidden file, a
 * second directory level - is not looked up at all, so a non-canonical path
 * cannot reach a file under another path's cache rules.
 */
const MERMAID_ASSET_PATH: RegExp =
  /^\/(?:chunks\/)?[A-Za-z0-9_-][A-Za-z0-9._-]*\.mjs$/;

export type CreateMermaidAssetsHandlerFunction = (
  directory: string,
) => RequestHandler;

/**
 * Serves a mermaid build from `directory`: the entry for an hour, its chunks
 * for a year, and only .mjs files. Anything else - mermaid's prebuilt bundle
 * names, sourcemaps, type definitions, a missing chunk, or every path when no
 * build is there - falls through to the 404 that terminates the prefix.
 */
export const createMermaidAssetsHandler: CreateMermaidAssetsHandlerFunction = (
  directory: string,
): RequestHandler => {
  const serveImmutable: RequestHandler = ExpressStatic(directory, {
    maxAge: IMMUTABLE_CACHE_MAX_AGE_MILLISECONDS,
    index: false,
    redirect: false,
  }) as RequestHandler;

  const serveRevalidating: RequestHandler = ExpressStatic(directory, {
    maxAge: REVALIDATE_CACHE_MAX_AGE_MILLISECONDS,
    index: false,
    redirect: false,
  }) as RequestHandler;

  return (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    if (!MERMAID_ASSET_PATH.test(req.path)) {
      return next();
    }

    /* Express has already stripped the mount path, so this is "/chunks/...". */
    if (req.path.startsWith(MERMAID_CHUNK_PREFIX)) {
      return serveImmutable(req, res, next);
    }

    return serveRevalidating(req, res, next);
  };
};

export type MountVendorAssetsFunction = (app: ExpressApplication) => void;

const mountVendorAssets: MountVendorAssetsFunction = (
  app: ExpressApplication,
): void => {
  if (fs.existsSync(VendorAssetsPath)) {
    app.use(
      VendorAssetsRoute,
      ExpressStatic(VendorAssetsPath, {
        maxAge: IMMUTABLE_CACHE_MAX_AGE_MILLISECONDS,
        index: false,
        redirect: false,
      }) as RequestHandler,
    );
  } else {
    /*
     * Nothing to serve is worth shouting about: every page that references
     * these paths is about to render without its stylesheet.
     */
    logger.error(
      `Vendored browser assets are missing at ${VendorAssetsPath}. Server-rendered pages will render unstyled.`,
    );
  }

  if (fs.existsSync(BrandAssetsPath)) {
    /*
     * Revalidating rather than immutable: the filename carries no version, so
     * a rebrand must not be stuck behind a year-old cache entry.
     */
    app.use(
      `${VendorAssetsRoute}/${BrandAssetsRouteSegment}`,
      ExpressStatic(BrandAssetsPath, {
        maxAge: REVALIDATE_CACHE_MAX_AGE_MILLISECONDS,
        index: false,
        redirect: false,
      }) as RequestHandler,
    );
  } else {
    logger.error(
      `OneUptime brand images are missing at ${BrandAssetsPath}. Server-rendered pages will render without a logo.`,
    );
  }

  app.use(
    `${VendorAssetsRoute}/${MermaidRouteSegment}`,
    createMermaidAssetsHandler(MermaidBuildPath),
  );

  /*
   * Terminates the prefix. Registered unconditionally, and last, because the
   * alternative is worse than a 404: express static falls through on a miss,
   * and the next thing to see the request is the frontend catch-all, which
   * answers with the dashboard's index page - HTTP 200, Content-Type
   * text/html. A <script> handed HTML fires onload, not onerror, so the docs'
   * lazy grammar loader would count it as loaded and highlight nothing, with
   * no error anywhere. Better to say plainly that the asset is not here.
   */
  app.use(VendorAssetsRoute, (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).send("Not found");
  });
};

export default mountVendorAssets;
