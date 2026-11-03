import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/*
 * A site's compiled Tailwind stylesheet: the docs' and the API reference's
 * (issue #5615), built when the App image is built
 * (scripts/build-docs-tailwind.ts), as the marketing site's is
 * (packages/Home/Utils/TailwindStylesheet.ts, which this follows).
 *
 * The build writes exactly one file into a site's directory, named for the
 * first twelve hex digits of the SHA-256 of its content, and every page links
 * it by that name: a new build is a new URL, so the file can be cached for a
 * year without a browser or CDN ever holding a stale copy.
 *
 * Where there is no build (`npm run dev` never runs one), the pages load the
 * Tailwind Play CDN runtime instead, exactly as they did before the build
 * existed. The server looks once, when it starts.
 */
const HASH_LENGTH: number = 12;

const FileNamePattern: RegExp = new RegExp(
  `^tailwind\\.[0-9a-f]{${HASH_LENGTH}}\\.css$`,
);

const ONE_YEAR_IN_SECONDS: number = 365 * 24 * 60 * 60;

export interface TailwindStylesheet {
  // tailwind.<hash>.css
  fileName: string;
  filePath: string;
  // What a page links, under the site's own path.
  href: string;
}

export const getTailwindStylesheetFileName: (css: string) => string = (
  css: string,
): string => {
  const hash: string = crypto
    .createHash("sha256")
    .update(css)
    .digest("hex")
    .slice(0, HASH_LENGTH);

  return `tailwind.${hash}.css`;
};

// The addresses a site's stylesheet can have, whichever build made it.
export const getTailwindStylesheetRoutePattern: (
  hrefPrefix: string,
) => RegExp = (hrefPrefix: string): RegExp => {
  const escaped: string = hrefPrefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

  return new RegExp(`^${escaped}tailwind\\.[0-9a-f]{${HASH_LENGTH}}\\.css$`);
};

/*
 * The build in `directory`, or null when there is none. The build replaces
 * the directory whole, so it never holds two; two means files were copied in
 * by hand, and rather than guess which one the pages should name, they fall
 * back to the runtime.
 */
export const findTailwindStylesheet: (data: {
  directory: string;
  hrefPrefix: string;
}) => TailwindStylesheet | null = (data: {
  directory: string;
  hrefPrefix: string;
}): TailwindStylesheet | null => {
  let names: Array<string>;

  try {
    names = fs.readdirSync(data.directory);
  } catch {
    return null;
  }

  const builds: Array<string> = names.filter((name: string): boolean => {
    return FileNamePattern.test(name);
  });

  if (builds.length !== 1) {
    return null;
  }

  const fileName: string = builds[0]!;

  return {
    fileName,
    filePath: path.join(data.directory, fileName),
    href: `${data.hrefPrefix}${fileName}`,
  };
};

/*
 * Serves the stylesheet at every address a build of it can have.
 *
 * The current build's own address is cached for a year. Any other hash comes
 * from a page another build rendered: during a rolling deploy, HTML from a
 * new pod can ask an old pod for its stylesheet, or the other way round. A
 * 404 would leave that page unstyled, so it gets this build's stylesheet,
 * no-store: it must not be kept under an address that names another build.
 */
export const serveTailwindStylesheet: (data: {
  stylesheet: TailwindStylesheet | null;
  hrefPrefix: string;
}) => RequestHandler = (data: {
  stylesheet: TailwindStylesheet | null;
  hrefPrefix: string;
}): RequestHandler => {
  const routePattern: RegExp = getTailwindStylesheetRoutePattern(
    data.hrefPrefix,
  );

  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    const stylesheet: TailwindStylesheet | null = data.stylesheet;

    if (!stylesheet || !routePattern.test(req.path)) {
      next();
      return;
    }

    const isThisBuild: boolean = req.path === stylesheet.href;

    res.sendFile(
      stylesheet.filePath,
      isThisBuild
        ? { maxAge: ONE_YEAR_IN_SECONDS * 1000, immutable: true }
        : { cacheControl: false, headers: { "Cache-Control": "no-store" } },
      (error: Error | undefined): void => {
        if (error) {
          next(error);
        }
      },
    );
  };
};

/*
 * Serves a site's stylesheet and tells the site's pages about it: every page
 * under `sitePath` gets res.locals.tailwindStylesheetHref, the address to link,
 * or null where nothing is built, and the page loads the runtime as before.
 * Mounted ahead of the site's own routes.
 */
export const mountTailwindStylesheet: (data: {
  app: ExpressApplication;
  name: string;
  directory: string;
  hrefPrefix: string;
  sitePath: string;
}) => TailwindStylesheet | null = (data: {
  app: ExpressApplication;
  name: string;
  directory: string;
  hrefPrefix: string;
  sitePath: string;
}): TailwindStylesheet | null => {
  const stylesheet: TailwindStylesheet | null = findTailwindStylesheet({
    directory: data.directory,
    hrefPrefix: data.hrefPrefix,
  });

  data.app.use(
    serveTailwindStylesheet({ stylesheet, hrefPrefix: data.hrefPrefix }),
  );
  data.app.use(
    data.sitePath,
    (_req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
      res.locals["tailwindStylesheetHref"] = stylesheet
        ? stylesheet.href
        : null;
      next();
    },
  );

  return stylesheet;
};
