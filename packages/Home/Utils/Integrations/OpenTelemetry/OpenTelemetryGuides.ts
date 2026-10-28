import {
  OPEN_TELEMETRY_GUIDES,
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  OpenTelemetryGuideEntry,
  OpenTelemetryGuideLanguageGroup,
  getOpenTelemetryGuide,
  getOpenTelemetryGuideLanguageGroup,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import type { PageSEOData } from "../../PageSEO";
import { OpenTelemetryGuide } from "./GuideTypes";
import { ExpressGuide } from "./Guides/Express";
import { NodeJsGuide } from "./Guides/NodeJs";
import { NestJsGuide } from "./Guides/NestJs";
import { NextJsGuide } from "./Guides/NextJs";
import { FastifyGuide } from "./Guides/Fastify";
import { KoaGuide } from "./Guides/Koa";
import { HapiGuide } from "./Guides/Hapi";
import { BunGuide } from "./Guides/Bun";
import { DenoGuide } from "./Guides/Deno";
import { BrowserGuide } from "./Guides/Browser";
import { ReactGuide } from "./Guides/React";
import { AngularGuide } from "./Guides/Angular";
import { PythonGuide } from "./Guides/Python";
import { DjangoGuide } from "./Guides/Django";
import { FlaskGuide } from "./Guides/Flask";
import { FastApiGuide } from "./Guides/FastApi";
import { CeleryGuide } from "./Guides/Celery";
import { JavaGuide } from "./Guides/Java";
import { SpringBootGuide } from "./Guides/SpringBoot";
import { QuarkusGuide } from "./Guides/Quarkus";
import { MicronautGuide } from "./Guides/Micronaut";
import { KtorGuide } from "./Guides/Ktor";

/*
 * Every OpenTelemetry guide the website publishes, in the catalog's order
 * (Common/Types/Telemetry/OpenTelemetryGuides.ts names them; each page's
 * content is in Guides/). Tests/OpenTelemetryGuides holds the two lists to
 * each other: a catalog entry with no page, or a page with no entry, fails.
 */
export const OPEN_TELEMETRY_GUIDE_PAGES: ReadonlyArray<OpenTelemetryGuide> = [
  NodeJsGuide,
  ExpressGuide,
  NestJsGuide,
  NextJsGuide,
  FastifyGuide,
  KoaGuide,
  HapiGuide,
  BunGuide,
  DenoGuide,
  BrowserGuide,
  ReactGuide,
  AngularGuide,
  PythonGuide,
  DjangoGuide,
  FlaskGuide,
  FastApiGuide,
  CeleryGuide,
  JavaGuide,
  SpringBootGuide,
  QuarkusGuide,
  MicronautGuide,
  KtorGuide,
];

export const INTEGRATIONS_INDEX_TITLE: string = "Integrations";

export function getGuidePage(slug: string): OpenTelemetryGuide | undefined {
  return OPEN_TELEMETRY_GUIDE_PAGES.find((guide: OpenTelemetryGuide) => {
    return guide.slug === slug;
  });
}

// The guide's catalog entry; every page has one (the tests hold them together).
export function getGuideEntry(slug: string): OpenTelemetryGuideEntry {
  const entry: OpenTelemetryGuideEntry | undefined =
    getOpenTelemetryGuide(slug);

  if (!entry) {
    throw new Error(`No catalog entry for the OpenTelemetry guide ${slug}`);
  }

  return entry;
}

// The guides in the catalog's order, each with its page.
export function getPublishedGuides(): Array<{
  entry: OpenTelemetryGuideEntry;
  guide: OpenTelemetryGuide;
}> {
  const published: Array<{
    entry: OpenTelemetryGuideEntry;
    guide: OpenTelemetryGuide;
  }> = [];

  for (const entry of OPEN_TELEMETRY_GUIDES) {
    const guide: OpenTelemetryGuide | undefined = getGuidePage(entry.slug);

    if (guide) {
      published.push({ entry: entry, guide: guide });
    }
  }

  return published;
}

export function getGuideLanguageGroup(
  slug: string,
): OpenTelemetryGuideLanguageGroup {
  return getOpenTelemetryGuideLanguageGroup(getGuideEntry(slug).language);
}

/*
 * The search result of each guide: its own title and description, a
 * breadcrumb trail through the index, and the page type that lists it in
 * llms.txt.
 */
export function getGuideSEO(guide: OpenTelemetryGuide): PageSEOData {
  const entry: OpenTelemetryGuideEntry = getGuideEntry(guide.slug);
  const pagePath: string = getOpenTelemetryGuidePath(guide.slug);

  return {
    title: guide.seo.title,
    description: guide.seo.description,
    canonicalPath: pagePath,
    ogType: "article",
    twitterCard: "summary_large_image",
    pageType: "integration",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: INTEGRATIONS_INDEX_TITLE, url: OPEN_TELEMETRY_GUIDES_INDEX_PATH },
      { name: `${entry.name} OpenTelemetry`, url: pagePath },
    ],
  };
}

export const INTEGRATIONS_INDEX_SEO: PageSEOData = {
  title: "OpenTelemetry Integrations for Every Framework | OneUptime",
  description:
    "Step-by-step OpenTelemetry guides for Node.js, Express, NestJS, Next.js, React and more: send traces, metrics and logs from your framework to OneUptime.",
  canonicalPath: OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  twitterCard: "summary_large_image",
  pageType: "integration",
  breadcrumbs: [
    { name: "Home", url: "/" },
    { name: INTEGRATIONS_INDEX_TITLE, url: OPEN_TELEMETRY_GUIDES_INDEX_PATH },
  ],
};

// Every page the guides add to the site's SEO register, by path.
export function getOpenTelemetryGuideSEOEntries(): Record<string, PageSEOData> {
  const entries: Record<string, PageSEOData> = {
    [OPEN_TELEMETRY_GUIDES_INDEX_PATH]: INTEGRATIONS_INDEX_SEO,
  };

  for (const { guide } of getPublishedGuides()) {
    entries[getOpenTelemetryGuidePath(guide.slug)] = getGuideSEO(guide);
  }

  return entries;
}
