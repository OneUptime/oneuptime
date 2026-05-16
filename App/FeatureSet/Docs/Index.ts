import { ContentPath, StaticPath, ViewsPath } from "./Utils/Config";
import DocsNav, { NavGroup, NavLink } from "./Utils/Nav";
import DocsRender from "./Utils/Render";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGES,
  getLocalizedNav,
  isSupportedDocsLanguage,
  localizeDocsUrl,
  makeT,
  TranslateFn,
} from "./Utils/I18n";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import "ejs";
import { IsBillingEnabled, IpWhitelist } from "Common/Server/EnvironmentConfig";

/*
 * Read a markdown file for the given language, falling back to English when
 * the translated copy does not exist. Returns null when no copy can be found.
 */
async function readContent(
  fullPath: string,
  lang: string,
): Promise<string | null> {
  const candidates: Array<string> = [
    `${ContentPath}/${lang}/${fullPath}.md`,
    `${ContentPath}/${DEFAULT_DOCS_LANGUAGE}/${fullPath}.md`,
    // Legacy layout before translations existed (Content/<path>.md)
    `${ContentPath}/${fullPath}.md`,
  ];

  for (const candidate of candidates) {
    if (await LocalFile.doesFileExist(candidate)) {
      return LocalFile.read(candidate);
    }
  }
  return null;
}

/*
 * Pick the best language for a request based on the URL parameter, the
 * Accept-Language header, or fall back to English.
 */
function pickLanguage(req: ExpressRequest): string {
  const fromParam: string | undefined = req.params["lang"];
  if (fromParam && isSupportedDocsLanguage(fromParam)) {
    return fromParam;
  }
  const header: string | undefined = req.headers["accept-language"];
  if (header) {
    const codes: Array<string> = header
      .split(",")
      .map((part: string) => {
        return part.split(";")[0]!.trim().toLowerCase();
      })
      .filter((code: string) => {
        return code.length > 0;
      });
    for (const code of codes) {
      const primary: string = code.split("-")[0]!;
      if (isSupportedDocsLanguage(primary)) {
        return primary;
      }
    }
  }
  return DEFAULT_DOCS_LANGUAGE;
}

const DocsFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    // Root /docs — redirect to the best language's getting-started page.
    app.get("/docs", (req: ExpressRequest, res: ExpressResponse) => {
      const lang: string = pickLanguage(req);
      res.redirect(`/docs/${lang}/introduction/getting-started`);
    });

    // /docs/:lang — redirect to that language's getting-started page.
    app.get(
      "/docs/:lang",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          /*
           * Not a known language — let the next handler (legacy two-segment URL)
           * pick it up.
           */
          return next();
        }
        res.redirect(`/docs/${lang}/introduction/getting-started`);
      },
    );

    // Raw markdown endpoint, language-aware.
    app.get(
      "/docs/as-markdown/:lang/:categorypath/:pagepath",
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const lang: string = pickLanguage(req);
          const fullPath: string =
            `${req.params["categorypath"]}/${req.params["pagepath"]}`.toLowerCase();

          const content: string | null = await readContent(fullPath, lang);
          if (content === null) {
            res.status(404);
            return res.send("");
          }
          return Response.sendMarkdownResponse(req, res, content);
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    /*
     * Legacy raw markdown endpoint without a language — keep working by
     * assuming the default language.
     */
    app.get(
      "/docs/as-markdown/:categorypath/:pagepath",
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const fullPath: string =
            `${req.params["categorypath"]}/${req.params["pagepath"]}`.toLowerCase();
          const content: string | null = await readContent(
            fullPath,
            DEFAULT_DOCS_LANGUAGE,
          );
          if (content === null) {
            res.status(404);
            return res.send("");
          }
          return Response.sendMarkdownResponse(req, res, content);
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    // Language-aware doc page: /docs/:lang/:category/:page
    app.get(
      "/docs/:lang/:categorypath/:pagepath",
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const langParam: string = req.params["lang"] || "";

          /*
           * If :lang is not a known language code, this is probably a legacy
           * 3-segment URL like /docs/introduction/getting-started/<something>
           * which we no longer serve — render 404 in the default language.
           */
          if (!isSupportedDocsLanguage(langParam)) {
            return next();
          }

          const lang: string = langParam;
          const t: TranslateFn = makeT(lang);
          const localizedNav: ReturnType<typeof getLocalizedNav> =
            getLocalizedNav(lang);

          const fullPath: string =
            `${req.params["categorypath"]}/${req.params["pagepath"]}`.toLowerCase();

          let contentInMarkdown: string | null = await readContent(
            fullPath,
            lang,
          );

          if (contentInMarkdown === null) {
            res.status(404);
            return res.render(`${ViewsPath}/NotFound`, {
              nav: localizedNav,
              t: t,
              lang: lang,
              supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
              enableGoogleTagManager: IsBillingEnabled,
              link: null,
              currentPath: req.originalUrl,
            });
          }

          /*
           * Strip the first line (title) — it already shows up in the page
           * header chrome.
           */
          contentInMarkdown = contentInMarkdown.split("\n").slice(1).join("\n");

          if (contentInMarkdown.includes("{{IP_WHITELIST}}")) {
            const ipList: string = IpWhitelist
              ? IpWhitelist.split(",")
                  .map((ip: string) => {
                    return `- ${ip.trim()}`;
                  })
                  .filter((line: string) => {
                    return line.length > 2;
                  })
                  .join("\n")
              : "- No IP addresses configured.";
            contentInMarkdown = contentInMarkdown.replace(
              "{{IP_WHITELIST}}",
              ipList,
            );
          }

          const renderedContent: string =
            await DocsRender.render(contentInMarkdown);

          /*
           * Match against the canonical English nav so we can find the
           * category/link regardless of which language is being rendered.
           */
          const currentCategory: NavGroup | undefined = DocsNav.find(
            (category: NavGroup) => {
              return category.links.find((link: NavLink) => {
                return link.url.toLocaleLowerCase().includes(fullPath);
              });
            },
          );

          const currentNavLink: NavLink | undefined =
            currentCategory?.links.find((link: NavLink) => {
              return link.url.toLocaleLowerCase().includes(fullPath);
            });

          if (!currentCategory || !currentNavLink) {
            res.status(404);
            return res.render(`${ViewsPath}/NotFound`, {
              nav: localizedNav,
              t: t,
              lang: lang,
              supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
              enableGoogleTagManager: IsBillingEnabled,
              link: null,
              currentPath: req.originalUrl,
            });
          }

          /*
           * Build pagination over the canonical (English) nav, then translate
           * the resulting prev/next links to the current language.
           */
          interface FlatLink {
            link: NavLink;
            category: NavGroup;
          }
          const flatLinks: FlatLink[] = [];
          for (const cat of DocsNav) {
            for (const navLink of cat.links) {
              if (
                navLink.url.startsWith("http") &&
                !navLink.url.includes("/docs/")
              ) {
                continue;
              }
              flatLinks.push({ link: navLink, category: cat });
            }
          }

          const currentIndex: number = flatLinks.findIndex((item: FlatLink) => {
            return item.link.url.toLocaleLowerCase().includes(fullPath);
          });

          const prevRaw: FlatLink | null =
            currentIndex > 0 ? flatLinks[currentIndex - 1]! : null;
          const nextRaw: FlatLink | null =
            currentIndex >= 0 && currentIndex < flatLinks.length - 1
              ? flatLinks[currentIndex + 1]!
              : null;

          const translateFlatLink: (item: FlatLink) => {
            link: { title: string; url: string };
            category: { title: string };
          } = (item: FlatLink) => {
            return {
              link: {
                title: t(`navLinks.${item.link.title}`),
                url: localizeDocsUrl(item.link.url, lang),
              },
              category: {
                title: t(`navGroups.${item.category.title}`),
              },
            };
          };

          const localizedCategory: { title: string } = {
            title: t(`navGroups.${currentCategory.title}`),
          };
          const localizedLink: { title: string; url: string } = {
            title: t(`navLinks.${currentNavLink.title}`),
            url: localizeDocsUrl(currentNavLink.url, lang),
          };

          return res.render(`${ViewsPath}/Index`, {
            nav: localizedNav,
            t: t,
            lang: lang,
            supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
            content: renderedContent,
            category: localizedCategory,
            link: localizedLink,
            githubPath: fullPath,
            enableGoogleTagManager: IsBillingEnabled,
            prevLink: prevRaw ? translateFlatLink(prevRaw) : null,
            nextLink: nextRaw ? translateFlatLink(nextRaw) : null,
            currentPath: req.originalUrl,
          });
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    /*
     * Legacy URL without language prefix: /docs/:category/:page → redirect to
     * the user's best-fit language so old links keep working and bookmarks
     * upgrade naturally.
     */
    app.get(
      "/docs/:categorypath/:pagepath",
      (req: ExpressRequest, res: ExpressResponse) => {
        const lang: string = pickLanguage(req);
        const category: string = req.params["categorypath"]!;
        const page: string = req.params["pagepath"]!;
        return res.redirect(`/docs/${lang}/${category}/${page}`);
      },
    );

    app.use("/docs/static", ExpressStatic(StaticPath));
  },
};

export default DocsFeatureSet;
