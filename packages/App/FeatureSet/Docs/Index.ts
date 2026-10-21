import { ContentPath, StaticPath, ViewsPath } from "./Utils/Config";
import LlmsTxtUtil from "./Utils/LlmsTxt";
import DocsNav, { NavGroup, NavLink } from "./Utils/Nav";
import DocsRender from "./Utils/Render";
import DocsSearchIndex, {
  DocsSearchEntry,
  summarizeDocsPage,
} from "./Utils/SearchIndex";
import DocsSitemap from "./Utils/Sitemap";
import DocsTranslations from "./Utils/Translations";
import { DocsPageSeo, getDocsPageSeo } from "./Utils/Seo";
import {
  getDocsCategoryTarget,
  getLegacyDocsPageTarget,
  withQueryOf,
} from "./Utils/Redirects";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGES,
  getDocsLanguageDirection,
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
import DocsPlaceholders from "./Utils/Placeholders";
import Response from "Common/Server/Utils/Response";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import {
  SITEMAP_CONTENT_TYPE,
  getPublicOrigin,
} from "Common/Server/Utils/Sitemap";
import "ejs";
import { GoogleTagManagerEnabled } from "Common/Server/EnvironmentConfig";

interface DocsContent {
  markdown: string;
  // The copy's own language: English when the page is not translated yet.
  lang: string;
}

/*
 * Read a markdown file for the given language, falling back to English when
 * the translated copy does not exist. Returns null when no copy can be found.
 */
async function readContent(
  fullPath: string,
  lang: string,
): Promise<DocsContent | null> {
  const candidates: Array<{ path: string; lang: string }> = [
    { path: `${ContentPath}/${lang}/${fullPath}.md`, lang: lang },
    {
      path: `${ContentPath}/${DEFAULT_DOCS_LANGUAGE}/${fullPath}.md`,
      lang: DEFAULT_DOCS_LANGUAGE,
    },
    // Legacy layout before translations existed (Content/<path>.md)
    { path: `${ContentPath}/${fullPath}.md`, lang: DEFAULT_DOCS_LANGUAGE },
  ];

  for (const candidate of candidates) {
    if (await LocalFile.doesFileExist(candidate.path)) {
      return {
        markdown: await LocalFile.read(candidate.path),
        lang: candidate.lang,
      };
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

/*
 * The docs' own 404 page, in the given language: a 404 status, with the
 * sidebar and the search box, so the reader can find the page they were
 * after.
 */
function renderNotFound(
  req: ExpressRequest,
  res: ExpressResponse,
  lang: string,
): void {
  res.status(404);
  return res.render(`${ViewsPath}/NotFound`, {
    nav: getLocalizedNav(lang),
    t: makeT(lang),
    lang: lang,
    dir: getDocsLanguageDirection(lang),
    supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
    enableGoogleTagManager: GoogleTagManagerEnabled,
    link: null,
    currentPath: req.originalUrl,
  });
}

const DocsFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    // Root /docs — redirect to the best language's getting-started page.
    app.get("/docs", (req: ExpressRequest, res: ExpressResponse) => {
      // Where it goes depends on the reader's language: say so to caches.
      res.vary("Accept-Language");
      const lang: string = pickLanguage(req);
      res.redirect(`/docs/${lang}/introduction/getting-started`);
    });

    /*
     * The page as Markdown is the source of a page, for tools and AI
     * assistants, and never a search result of its own: every answer under
     * /docs/as-markdown - the Markdown, a redirect, a 404 - says so. Ahead
     * of every route that answers there.
     */
    app.get(
      "/docs/as-markdown/*",
      (_req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        res.setHeader("X-Robots-Tag", "noindex");
        return next();
      },
    );

    /*
     * The docs' sitemap: every page at the address it is its own canonical
     * page at (Utils/Sitemap.ts). The ingress serves it at the site's root
     * too, as /sitemap-docs.xml, which the sitemap index lists. Ahead of
     * /docs/:lang, which would take it for a language.
     */
    app.get(
      "/docs/sitemap.xml",
      async (
        _req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => {
        try {
          const xml: string = await DocsSitemap.getSitemapXml();
          res.setHeader("Content-Type", SITEMAP_CONTENT_TYPE);
          res.setHeader("Cache-Control", "public, max-age=600");
          return res.send(xml);
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    /*
     * LLM / agent discovery endpoints (llms.txt convention). Registered
     * before any parameterized /docs/:lang routes so they are never
     * shadowed by language handling or 404 fallbacks.
     */
    app.get(
      "/docs/llms.txt",
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const content: string = await LlmsTxtUtil.getLlmsTxt();
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=600");
          return Response.sendTextResponse(req, res, content);
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    app.get(
      "/docs/llms-full.txt",
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const content: string = await LlmsTxtUtil.getLlmsFullTxt();
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=600");
          return Response.sendTextResponse(req, res, content);
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    /*
     * The search index for one language: every page's title, group,
     * summary and section headings (Utils/SearchIndex.ts). The search box
     * fetches it the first time it opens. Registered before the two-segment
     * legacy redirect below, which would otherwise take the address for a
     * page called "<lang>.json".
     */
    app.get(
      "/docs/search-index/:lang.json",
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const lang: string = req.params["lang"] || "";
          if (!isSupportedDocsLanguage(lang)) {
            res.status(404);
            return res.json([]);
          }
          const index: Array<DocsSearchEntry> =
            await DocsSearchIndex.getIndex(lang);
          res.setHeader("Cache-Control", "public, max-age=600");
          return res.json(index);
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    /*
     * Backward-compat: the legacy Chinese code "zh" was renamed to "zh-CN"
     * when Traditional Chinese ("zh-TW") was added. Permanently redirect old
     * URLs so existing search-indexed and bookmarked links keep working.
     */
    app.get("/docs/zh", (_req: ExpressRequest, res: ExpressResponse) => {
      return res.redirect(301, "/docs/zh-CN");
    });
    app.get("/docs/zh/*", (req: ExpressRequest, res: ExpressResponse) => {
      const rest: string = req.path.slice("/docs/zh/".length);
      return res.redirect(301, `/docs/zh-CN/${rest}`);
    });
    app.get(
      "/docs/as-markdown/zh/*",
      (req: ExpressRequest, res: ExpressResponse) => {
        const rest: string = req.path.slice("/docs/as-markdown/zh/".length);
        return res.redirect(301, `/docs/as-markdown/zh-CN/${rest}`);
      },
    );

    /*
     * The former network guide now lives in each integration's setup page.
     * Send old HTML and markdown URLs to the catalog that links those guides.
     */
    for (const prefix of ["/docs/as-markdown", "/docs"]) {
      app.get(
        `${prefix}/:lang/self-hosted/integration-network-access`,
        (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
          const lang: string = req.params["lang"] || "";
          if (!isSupportedDocsLanguage(lang)) {
            return next();
          }
          return res.redirect(301, `${prefix}/${lang}/integrations/index`);
        },
      );
      // Without a language, like every old address: to the English page.
      app.get(
        `${prefix}/self-hosted/integration-network-access`,
        (_req: ExpressRequest, res: ExpressResponse) => {
          return res.redirect(
            301,
            `${prefix}/${DEFAULT_DOCS_LANGUAGE}/integrations/index`,
          );
        },
      );
    }

    /*
     * Backward-compat: the AI SRE page shipped on 2026-07-10 at
     * /docs/ai/sentinel, under the old "Sentinel" codename. The codename is
     * retired and the page now lives at /docs/ai/ai-sre — permanently redirect
     * the old URL (in every shape it was reachable: language-prefixed,
     * language-less, and the raw-markdown endpoints) so inbound links,
     * bookmarks and search-indexed results keep working instead of 404ing.
     */
    app.get(
      "/docs/as-markdown/:lang/ai/sentinel",
      (req: ExpressRequest, res: ExpressResponse) => {
        const lang: string = req.params["lang"] || DEFAULT_DOCS_LANGUAGE;
        return res.redirect(301, `/docs/as-markdown/${lang}/ai/ai-sre`);
      },
    );
    app.get(
      "/docs/as-markdown/ai/sentinel",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/as-markdown/ai/ai-sre");
      },
    );
    app.get(
      "/docs/:lang/ai/sentinel",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(301, `/docs/${lang}/ai/ai-sre`);
      },
    );
    app.get(
      "/docs/ai/sentinel",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/en/ai/ai-sre");
      },
    );

    /*
     * Backward-compat: the standalone SNMP Monitor guide was replaced by the
     * Network Device Monitor guide (the SNMP monitor type folded into the
     * Network Devices product). Permanently redirect the old URL in every
     * shape it was reachable so inbound links, bookmarks and search-indexed
     * results keep working instead of 404ing.
     */
    app.get(
      "/docs/as-markdown/:lang/monitor/snmp-monitor",
      (req: ExpressRequest, res: ExpressResponse) => {
        const lang: string = req.params["lang"] || DEFAULT_DOCS_LANGUAGE;
        return res.redirect(
          301,
          `/docs/as-markdown/${lang}/monitor/network-device-monitor`,
        );
      },
    );
    app.get(
      "/docs/as-markdown/monitor/snmp-monitor",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(
          301,
          "/docs/as-markdown/monitor/network-device-monitor",
        );
      },
    );
    app.get(
      "/docs/:lang/monitor/snmp-monitor",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(
          301,
          `/docs/${lang}/monitor/network-device-monitor`,
        );
      },
    );
    app.get(
      "/docs/monitor/snmp-monitor",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/en/monitor/network-device-monitor");
      },
    );

    /*
     * Backward-compat: RUM used to be a single page inside the Telemetry
     * section. It is now its own docs section (/docs/rum/...), with the old
     * page's content expanded across it. Permanently redirect the old URL in
     * every shape it was reachable so inbound links, bookmarks and
     * search-indexed results keep working instead of 404ing.
     */
    app.get(
      "/docs/as-markdown/:lang/telemetry/real-user-monitoring",
      (req: ExpressRequest, res: ExpressResponse) => {
        const lang: string = req.params["lang"] || DEFAULT_DOCS_LANGUAGE;
        return res.redirect(301, `/docs/as-markdown/${lang}/rum/index`);
      },
    );
    app.get(
      "/docs/as-markdown/telemetry/real-user-monitoring",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/as-markdown/rum/index");
      },
    );
    app.get(
      "/docs/:lang/telemetry/real-user-monitoring",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(301, `/docs/${lang}/rum/index`);
      },
    );
    app.get(
      "/docs/telemetry/real-user-monitoring",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/en/rum/index");
      },
    );

    /*
     * Backward-compat: incident forms had a page in the Incidents section
     * (/docs/incidents/forms). Forms are now a product of their own, with a
     * docs section of their own (/docs/forms/...). Permanently redirect the
     * old URL in every shape it was reachable, so inbound links, bookmarks
     * and search-indexed results keep working instead of 404ing.
     */
    app.get(
      "/docs/as-markdown/:lang/incidents/forms",
      (req: ExpressRequest, res: ExpressResponse) => {
        const lang: string = req.params["lang"] || DEFAULT_DOCS_LANGUAGE;
        return res.redirect(301, `/docs/as-markdown/${lang}/forms/index`);
      },
    );
    app.get(
      "/docs/as-markdown/incidents/forms",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/as-markdown/forms/index");
      },
    );
    app.get(
      "/docs/:lang/incidents/forms",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(301, `/docs/${lang}/forms/index`);
      },
    );
    app.get(
      "/docs/incidents/forms",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/en/forms/index");
      },
    );

    /*
     * Backward-compat: "Creating a Monitor" (/docs/monitor/create-monitor)
     * opens the Monitor section, and Getting Started links to it as the
     * monitors overview. /docs/monitor/monitor was never a page, but search
     * engines found it, so it redirects there in every shape it was
     * reachable in.
     */
    app.get(
      "/docs/as-markdown/:lang/monitor/monitor",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(
          301,
          `/docs/as-markdown/${lang}/monitor/create-monitor`,
        );
      },
    );
    app.get(
      "/docs/as-markdown/monitor/monitor",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/as-markdown/monitor/create-monitor");
      },
    );
    app.get(
      "/docs/:lang/monitor/monitor",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(301, `/docs/${lang}/monitor/create-monitor`);
      },
    );
    app.get(
      "/docs/monitor/monitor",
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/en/monitor/create-monitor");
      },
    );

    /*
     * Backward-compat: OneUptime Copilot had a docs section of its own
     * (/docs/copilot/...) until the feature was removed; its successor is the
     * AI Agent, which fixes exceptions with a pull request. Every page of the
     * old section - with or without a language, as HTML or as Markdown -
     * redirects permanently to the AI Agent's page.
     */
    app.get(
      ["/docs/as-markdown/:lang/copilot", "/docs/as-markdown/:lang/copilot/*"],
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(301, `/docs/as-markdown/${lang}/ai/ai-agent`);
      },
    );
    app.get(
      ["/docs/as-markdown/copilot", "/docs/as-markdown/copilot/*"],
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/as-markdown/ai/ai-agent");
      },
    );
    app.get(
      ["/docs/:lang/copilot", "/docs/:lang/copilot/*"],
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const lang: string = req.params["lang"] || "";
        if (!isSupportedDocsLanguage(lang)) {
          return next();
        }
        return res.redirect(301, `/docs/${lang}/ai/ai-agent`);
      },
    );
    app.get(
      ["/docs/copilot", "/docs/copilot/*"],
      (_req: ExpressRequest, res: ExpressResponse) => {
        return res.redirect(301, "/docs/en/ai/ai-agent");
      },
    );

    /*
     * /docs/<one name>. A language opens its getting-started page. A
     * category of the nav (/docs/terraform) is not a page, but the website,
     * old emails, search results and people typing an address ask for it: it
     * redirects permanently, like every address without a language, to the
     * English copy of the category's first page in the nav
     * (Utils/Redirects.ts), with the query it came with. Any other name is
     * the docs' 404 page.
     */
    app.get("/docs/:lang", (req: ExpressRequest, res: ExpressResponse) => {
      const name: string = req.params["lang"] || "";

      if (isSupportedDocsLanguage(name)) {
        return res.redirect(`/docs/${name}/introduction/getting-started`);
      }

      const target: string | null = getDocsCategoryTarget(
        name,
        DEFAULT_DOCS_LANGUAGE,
      );

      if (target !== null) {
        return res.redirect(301, withQueryOf(req, target));
      }

      return renderNotFound(req, res, DEFAULT_DOCS_LANGUAGE);
    });

    // Raw markdown endpoint, language-aware.
    app.get(
      "/docs/as-markdown/:lang/:categorypath/:pagepath",
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const lang: string = pickLanguage(req);
          const fullPath: string =
            `${req.params["categorypath"]}/${req.params["pagepath"]}`.toLowerCase();

          const content: DocsContent | null = await readContent(fullPath, lang);
          if (content === null) {
            res.status(404);
            return res.send("");
          }
          return Response.sendMarkdownResponse(
            req,
            res,
            DocsPlaceholders.render(content.markdown, lang),
          );
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
          const content: DocsContent | null = await readContent(
            fullPath,
            DEFAULT_DOCS_LANGUAGE,
          );
          if (content === null) {
            res.status(404);
            return res.send("");
          }
          return Response.sendMarkdownResponse(
            req,
            res,
            DocsPlaceholders.render(content.markdown, DEFAULT_DOCS_LANGUAGE),
          );
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

          const content: DocsContent | null = await readContent(fullPath, lang);

          if (content === null) {
            return renderNotFound(req, res, lang);
          }

          /*
           * Strip the first line (title) — it already shows up in the page
           * header chrome.
           */
          let contentInMarkdown: string = content.markdown
            .split("\n")
            .slice(1)
            .join("\n");

          contentInMarkdown = DocsPlaceholders.render(contentInMarkdown, lang);

          const renderedContent: string = await DocsRender.render(
            contentInMarkdown,
            { lang: lang, contentLang: content.lang },
          );

          /*
           * Match against the canonical English nav so we can find the
           * category/link regardless of which language is being rendered.
           * The match is exact: a substring match resolved a page to any
           * earlier link whose URL merely contained its path.
           */
          const pageUrl: string = `/docs/${fullPath}`;
          const isCurrentPage: (link: NavLink) => boolean = (
            link: NavLink,
          ): boolean => {
            return link.url.toLocaleLowerCase() === pageUrl;
          };

          const currentCategory: NavGroup | undefined = DocsNav.find(
            (category: NavGroup) => {
              return category.links.find(isCurrentPage);
            },
          );

          const currentNavLink: NavLink | undefined =
            currentCategory?.links.find(isCurrentPage);

          if (!currentCategory || !currentNavLink) {
            return renderNotFound(req, res, lang);
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
            return isCurrentPage(item.link);
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

          /*
           * The page's own address, and its translations': a page served in
           * English under another language's prefix names the English page
           * as canonical (Utils/Seo.ts).
           */
          const seo: DocsPageSeo = getDocsPageSeo({
            origin: getPublicOrigin(),
            pagePath: fullPath,
            lang: lang,
            translatedLanguages: await DocsTranslations.getLanguages(fullPath),
          });

          return res.render(`${ViewsPath}/Index`, {
            nav: localizedNav,
            t: t,
            lang: lang,
            dir: getDocsLanguageDirection(lang),
            supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
            content: renderedContent,
            /*
             * An untranslated page shows the English copy: the article is
             * marked as English, so it reads left to right inside a
             * right-to-left page and screen readers switch voice for it.
             */
            contentLang: content.lang,
            contentDir: getDocsLanguageDirection(content.lang),
            category: localizedCategory,
            link: localizedLink,
            pageDescription: summarizeDocsPage(content.markdown).description,
            markdownUrl: `/docs/as-markdown/${lang}/${fullPath}`,
            githubPath: fullPath,
            enableGoogleTagManager: GoogleTagManagerEnabled,
            prevLink: prevRaw ? translateFlatLink(prevRaw) : null,
            nextLink: nextRaw ? translateFlatLink(nextRaw) : null,
            currentPath: req.originalUrl,
            canonicalUrl: seo.canonicalUrl,
            alternateLinks: seo.alternateLinks,
          });
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    /*
     * Legacy URL without language prefix: /docs/:category/:page. It redirects
     * permanently to the English page, the address search engines should
     * keep (Utils/Redirects.ts), with the query it came with. The reader
     * picks another language from the page.
     *
     * Two names with a language first are a category's own address in that
     * language (/docs/de/terraform), never an old page: a category opens its
     * first page in the nav in that language, and any other name is the
     * docs' 404 page in that language.
     */
    app.get(
      "/docs/:categorypath/:pagepath",
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        const first: string = req.params["categorypath"] || "";

        if (isSupportedDocsLanguage(first)) {
          const categoryTarget: string | null = getDocsCategoryTarget(
            req.params["pagepath"] || "",
            first,
          );

          if (categoryTarget !== null) {
            return res.redirect(301, withQueryOf(req, categoryTarget));
          }

          return renderNotFound(req, res, first);
        }

        const target: string | null = getLegacyDocsPageTarget(
          req.params["categorypath"]!,
          req.params["pagepath"]!,
        );

        if (target === null) {
          return next();
        }

        return res.redirect(301, withQueryOf(req, target));
      },
    );

    /*
     * The installers under /docs/static/scripts (the host collector's
     * install.sh and install.ps1, the infrastructure agent's install.sh) are
     * served as text: Windows PowerShell's Invoke-RestMethod hands a .ps1
     * back as a string only when it is sent as text, which the one-line
     * Windows install command relies on.
     */
    app.use(
      "/docs/static",
      ExpressStatic(StaticPath, {
        setHeaders: (res: ExpressResponse, filePath: string): void => {
          if (filePath.endsWith(".ps1") || filePath.endsWith(".sh")) {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
          }
        },
      }),
    );
  },
};

export default DocsFeatureSet;
