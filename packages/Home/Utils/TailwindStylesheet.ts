import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/*
 * The marketing site's compiled Tailwind stylesheet (tailwind.config.ts,
 * Scripts/BuildTailwindCss.ts).
 *
 * The image build writes exactly one file into TailwindStylesheetDirectory,
 * named for the first twelve hex digits of the SHA-256 of its content, and
 * every page links it by that name: a new build is a new URL, so the file can
 * be cached for a year without a browser or CDN ever holding a stale copy.
 *
 * When there is no build (`npm run dev` never runs one), the pages load the
 * Tailwind Play CDN runtime instead, exactly as they did before the build
 * existed - see Views/head-basic.ejs. The server looks once, when it starts,
 * and logs which it found. A build made by hand on a development machine
 * (to see the production CSS) is used until it is deleted - delete
 * build/tailwind, or run `npm test`, which clears build/, and restart, to
 * go back to the runtime that picks up every class as it is written.
 */

export const TailwindStylesheetDirectory: string = path.join(
  __dirname,
  "..",
  "build",
  "tailwind",
);

const HASH_LENGTH: number = 12;

export const TailwindStylesheetFileNamePattern: RegExp = new RegExp(
  `^tailwind\\.[0-9a-f]{${HASH_LENGTH}}\\.css$`,
);

// Every URL a compiled stylesheet can have, whichever build made it.
export const TailwindStylesheetRoutePattern: RegExp = new RegExp(
  `^/css/tailwind\\.[0-9a-f]{${HASH_LENGTH}}\\.css$`,
);

const ONE_YEAR_IN_SECONDS: number = 365 * 24 * 60 * 60;

export interface TailwindStylesheet {
  // tailwind.<hash>.css
  fileName: string;
  filePath: string;
  // What a page links: /css/tailwind.<hash>.css
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

/*
 * The build in `directory`, or null when there is none. The build script
 * replaces the directory whole, so it never holds two; two means files were
 * copied in by hand, and rather than guess which one the pages should name,
 * they fall back to the runtime.
 */
export const findTailwindStylesheet: (
  directory?: string,
) => TailwindStylesheet | null = (
  directory: string = TailwindStylesheetDirectory,
): TailwindStylesheet | null => {
  let names: Array<string>;

  try {
    names = fs.readdirSync(directory);
  } catch {
    return null;
  }

  const builds: Array<string> = names.filter((name: string): boolean => {
    return TailwindStylesheetFileNamePattern.test(name);
  });

  if (builds.length !== 1) {
    return null;
  }

  const fileName: string = builds[0]!;

  return {
    fileName: fileName,
    filePath: path.join(directory, fileName),
    href: `/css/${fileName}`,
  };
};

/*
 * Serves the stylesheet at every /css/tailwind.<hash>.css.
 *
 * The current build's own URL is cached for a year. Any other hash comes
 * from a page another build rendered: during a rolling deploy, HTML from a
 * new pod can ask an old pod for its stylesheet, or the other way round. A
 * 404 would leave that page unstyled. This build's stylesheet is right for
 * that one page view, but it must not be kept under a URL that names another
 * build - a year-long cache in the browser or a CDN would pin the wrong file
 * to it - so it goes out no-store.
 */
export const serveTailwindStylesheet: (
  stylesheet: TailwindStylesheet | null,
) => RequestHandler = (
  stylesheet: TailwindStylesheet | null,
): RequestHandler => {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    if (!stylesheet || !TailwindStylesheetRoutePattern.test(req.path)) {
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
        if (error && !res.headersSent) {
          // The file went away under the server: answer as for any missing page.
          next();
        }
      },
    );
  };
};
