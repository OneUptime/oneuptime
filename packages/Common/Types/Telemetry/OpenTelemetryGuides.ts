import ProviderLogo from "../ProviderLogo/ProviderLogo";

/*
 * THE OPENTELEMETRY GUIDES ONEUPTIME PUBLISHES, ONE PER LANGUAGE AND FRAMEWORK.
 *
 * Each guide is a page on the website, at /integrations/opentelemetry/<slug>:
 * how to send a framework's traces, metrics and logs to OneUptime, written
 * for that framework and checked end to end against the real OpenTelemetry
 * SDK. The pages themselves live in the website (packages/Home/Utils/
 * Integrations); this catalog is what everything else needs to link to them:
 * the slug, the name, the language group it is listed under and the logo it
 * is shown with. The Dashboard's telemetry guide reads it to open each
 * language's guides, and the website's index of integrations groups it by
 * language.
 *
 * A guide is added in two places that tests hold together: an entry here,
 * and its page in packages/Home/Utils/Integrations/OpenTelemetry/Guides.
 *
 * React-free and free of the pages' content, so a frontend can import it.
 */

// The languages the guides are grouped under, in the index's order.
export enum OpenTelemetryGuideLanguage {
  JavaScript = "javascript",
  Python = "python",
  Java = "java",
  Kotlin = "kotlin",
  DotNet = "dotnet",
  Go = "go",
  Ruby = "ruby",
  Php = "php",
  Rust = "rust",
  Elixir = "elixir",
}

/*
 * The languages the Dashboard's telemetry guide lets a reader pick (its
 * language buttons). Each guide below names the one it belongs to, so the
 * telemetry guide can open it for the language picked.
 */
export type TelemetryGuideLanguageKey =
  | "node"
  | "python"
  | "go"
  | "java"
  | "dotnet"
  | "rust"
  | "php"
  | "ruby"
  | "elixir"
  | "cpp"
  | "swift"
  | "react"
  | "angular";

/*
 * The same languages, in the order the telemetry guide's buttons show them
 * (its tests hold the buttons to this list).
 */
export const TELEMETRY_GUIDE_LANGUAGE_KEYS: ReadonlyArray<TelemetryGuideLanguageKey> =
  [
    "node",
    "python",
    "go",
    "java",
    "dotnet",
    "rust",
    "php",
    "ruby",
    "elixir",
    "cpp",
    "swift",
    "react",
    "angular",
  ];

export interface OpenTelemetryGuideLanguageGroup {
  language: OpenTelemetryGuideLanguage;
  // The group's heading on the index: "JavaScript & TypeScript".
  title: string;
  // One line under the heading.
  description: string;
  // The language's official logo, where the registry has one.
  logo?: ProviderLogo | undefined;
  /*
   * The other names people type for the language, lower case, beside the
   * words of its title: "dotnet", "c#" and "csharp" for .NET. The index's
   * search finds every guide of the group by them.
   */
  searchTerms?: ReadonlyArray<string> | undefined;
}

export const OPEN_TELEMETRY_GUIDE_LANGUAGE_GROUPS: ReadonlyArray<OpenTelemetryGuideLanguageGroup> =
  [
    {
      language: OpenTelemetryGuideLanguage.JavaScript,
      title: "JavaScript & TypeScript",
      description:
        "Node.js servers and their frameworks, the Bun and Deno runtimes, and code that runs in the browser.",
      logo: ProviderLogo.NodeJs,
      searchTerms: ["js", "ts"],
    },
    {
      language: OpenTelemetryGuideLanguage.Python,
      title: "Python",
      description:
        "Django, Flask, FastAPI and Celery, and any other Python program.",
      logo: ProviderLogo.Python,
    },
    {
      language: OpenTelemetryGuideLanguage.Java,
      title: "Java",
      description:
        "Any JVM app with the Java agent, and Spring Boot, Quarkus and Micronaut.",
      logo: ProviderLogo.Java,
      searchTerms: ["jvm"],
    },
    {
      language: OpenTelemetryGuideLanguage.Kotlin,
      title: "Kotlin",
      description: "Ktor and other Kotlin services on the JVM.",
      logo: ProviderLogo.Kotlin,
      searchTerms: ["jvm"],
    },
    {
      language: OpenTelemetryGuideLanguage.DotNet,
      title: ".NET",
      description: "ASP.NET Core, worker services and console apps.",
      logo: ProviderLogo.DotNet,
      searchTerms: ["dotnet", "c#", "csharp"],
    },
    {
      language: OpenTelemetryGuideLanguage.Go,
      title: "Go",
      description: "Go services and their HTTP routers.",
      logo: ProviderLogo.Go,
      searchTerms: ["golang"],
    },
    {
      language: OpenTelemetryGuideLanguage.Ruby,
      title: "Ruby",
      description: "Rails and other Ruby apps.",
      logo: ProviderLogo.Ruby,
    },
    {
      language: OpenTelemetryGuideLanguage.Php,
      title: "PHP",
      description: "Laravel, Symfony and plain PHP.",
      logo: ProviderLogo.Php,
    },
    {
      language: OpenTelemetryGuideLanguage.Rust,
      title: "Rust",
      description: "Rust services.",
      logo: ProviderLogo.Rust,
    },
    {
      language: OpenTelemetryGuideLanguage.Elixir,
      title: "Elixir",
      description: "Phoenix and other Elixir apps.",
      logo: ProviderLogo.Elixir,
    },
  ];

export type OpenTelemetryGuideKind =
  // A language's runtime itself: Node.js, Bun, Deno, Python, the JVM, .NET.
  | "runtime"
  // A server framework: Express, NestJS, Django.
  | "framework"
  // Work that no request starts: a task queue's worker, a background service.
  | "worker"
  // Code that runs in the visitor's browser: plain JavaScript, React.
  | "browser";

export interface OpenTelemetryGuideEntry {
  // The guide's address: /integrations/opentelemetry/<slug>. Never changes.
  slug: string;
  // The framework or runtime, as its maker writes it: "Next.js".
  name: string;
  /*
   * How a sentence names it, where the name alone reads badly there: "a
   * Worker Service" ("Add OpenTelemetry to a Worker Service").
   */
  inSentence?: string | undefined;
  language: OpenTelemetryGuideLanguage;
  kind: OpenTelemetryGuideKind;
  // Its official logo, where the registry has one.
  logo?: ProviderLogo | undefined;
  /*
   * The Dashboard telemetry guide's language this guide belongs to. The
   * guide whose isLanguageGuide is set is that language's own page; the
   * others are listed as its frameworks.
   */
  telemetryGuideLanguage?: TelemetryGuideLanguageKey | undefined;
  isLanguageGuide?: boolean | undefined;
  /*
   * Shown on the website's telemetry product pages (traces, logs, metrics,
   * exceptions, RUM), in their row of frameworks: the ones most people look
   * for, at most MAX_FEATURED_OPEN_TELEMETRY_GUIDES of them and at least one
   * per language with a guide, in full rows of six where the count allows
   * (one row of six reads as a set; a seventh card alone on a second row
   * reads as an afterthought). The rest are a click away, on the index.
   */
  isFeatured?: boolean | undefined;
}

// How many guides the product pages' row of frameworks shows at most: two rows.
export const MAX_FEATURED_OPEN_TELEMETRY_GUIDES: number = 12;

export const OPEN_TELEMETRY_GUIDES: ReadonlyArray<OpenTelemetryGuideEntry> = [
  {
    slug: "nodejs",
    name: "Node.js",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "runtime",
    logo: ProviderLogo.NodeJs,
    telemetryGuideLanguage: "node",
    isLanguageGuide: true,
    isFeatured: true,
  },
  {
    slug: "express",
    name: "Express",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "framework",
    logo: ProviderLogo.Express,
    telemetryGuideLanguage: "node",
  },
  {
    slug: "nestjs",
    name: "NestJS",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "framework",
    logo: ProviderLogo.NestJs,
    telemetryGuideLanguage: "node",
  },
  {
    slug: "nextjs",
    name: "Next.js",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "framework",
    logo: ProviderLogo.NextJs,
    telemetryGuideLanguage: "node",
  },
  {
    slug: "fastify",
    name: "Fastify",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "framework",
    logo: ProviderLogo.Fastify,
    telemetryGuideLanguage: "node",
  },
  {
    slug: "koa",
    name: "Koa",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "framework",
    logo: ProviderLogo.Koa,
    telemetryGuideLanguage: "node",
  },
  {
    slug: "hapi",
    name: "hapi",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "framework",
    logo: ProviderLogo.Hapi,
    telemetryGuideLanguage: "node",
  },
  {
    slug: "bun",
    name: "Bun",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "runtime",
    logo: ProviderLogo.Bun,
    telemetryGuideLanguage: "node",
  },
  {
    slug: "deno",
    name: "Deno",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "runtime",
    logo: ProviderLogo.Deno,
    telemetryGuideLanguage: "node",
  },
  {
    // Plain JavaScript in the browser: a generic thing, with a generic mark.
    slug: "browser",
    name: "JavaScript in the browser",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "browser",
  },
  {
    slug: "react",
    name: "React",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "browser",
    logo: ProviderLogo.React,
    telemetryGuideLanguage: "react",
    isLanguageGuide: true,
    isFeatured: true,
  },
  {
    slug: "angular",
    name: "Angular",
    language: OpenTelemetryGuideLanguage.JavaScript,
    kind: "browser",
    logo: ProviderLogo.Angular,
    telemetryGuideLanguage: "angular",
    isLanguageGuide: true,
  },
  {
    // Any Python program: scripts, jobs, and frameworks with no guide of their own.
    slug: "python",
    name: "Python",
    language: OpenTelemetryGuideLanguage.Python,
    kind: "runtime",
    logo: ProviderLogo.Python,
    telemetryGuideLanguage: "python",
    isLanguageGuide: true,
  },
  {
    slug: "django",
    name: "Django",
    language: OpenTelemetryGuideLanguage.Python,
    kind: "framework",
    logo: ProviderLogo.Django,
    telemetryGuideLanguage: "python",
  },
  {
    slug: "flask",
    name: "Flask",
    language: OpenTelemetryGuideLanguage.Python,
    kind: "framework",
    logo: ProviderLogo.Flask,
    telemetryGuideLanguage: "python",
  },
  {
    slug: "fastapi",
    name: "FastAPI",
    language: OpenTelemetryGuideLanguage.Python,
    kind: "framework",
    logo: ProviderLogo.FastAPI,
    telemetryGuideLanguage: "python",
    isFeatured: true,
  },
  {
    slug: "celery",
    name: "Celery",
    language: OpenTelemetryGuideLanguage.Python,
    kind: "worker",
    logo: ProviderLogo.Celery,
    telemetryGuideLanguage: "python",
  },
  {
    // Any JVM app, with the Java agent.
    slug: "java",
    name: "Java",
    language: OpenTelemetryGuideLanguage.Java,
    kind: "runtime",
    logo: ProviderLogo.Java,
    telemetryGuideLanguage: "java",
    isLanguageGuide: true,
  },
  {
    slug: "spring-boot",
    name: "Spring Boot",
    language: OpenTelemetryGuideLanguage.Java,
    kind: "framework",
    logo: ProviderLogo.SpringBoot,
    telemetryGuideLanguage: "java",
    isFeatured: true,
  },
  {
    slug: "quarkus",
    name: "Quarkus",
    language: OpenTelemetryGuideLanguage.Java,
    kind: "framework",
    logo: ProviderLogo.Quarkus,
    telemetryGuideLanguage: "java",
  },
  {
    // No logo set the registry draws from has Micronaut's: its initials stand in.
    slug: "micronaut",
    name: "Micronaut",
    language: OpenTelemetryGuideLanguage.Java,
    kind: "framework",
    telemetryGuideLanguage: "java",
  },
  {
    // Kotlin runs on the JVM: the telemetry guide lists it with Java's.
    slug: "ktor",
    name: "Ktor",
    language: OpenTelemetryGuideLanguage.Kotlin,
    kind: "framework",
    logo: ProviderLogo.Ktor,
    telemetryGuideLanguage: "java",
    isFeatured: true,
  },
  {
    // Console apps, and any .NET app with the zero-code instrumentation.
    slug: "dotnet",
    name: ".NET",
    language: OpenTelemetryGuideLanguage.DotNet,
    kind: "runtime",
    logo: ProviderLogo.DotNet,
    telemetryGuideLanguage: "dotnet",
    isLanguageGuide: true,
  },
  {
    // Microsoft's ASP.NET Core is drawn with the .NET logo, as Microsoft draws it.
    slug: "aspnet-core",
    name: "ASP.NET Core",
    language: OpenTelemetryGuideLanguage.DotNet,
    kind: "framework",
    logo: ProviderLogo.DotNet,
    telemetryGuideLanguage: "dotnet",
    isFeatured: true,
  },
  {
    // The .NET template for background services: `dotnet new worker`.
    slug: "dotnet-worker-service",
    name: "Worker Service",
    inSentence: "a Worker Service",
    language: OpenTelemetryGuideLanguage.DotNet,
    kind: "worker",
    logo: ProviderLogo.DotNet,
    telemetryGuideLanguage: "dotnet",
  },
  {
    // Any Go service on the standard library's net/http.
    slug: "go",
    name: "Go",
    language: OpenTelemetryGuideLanguage.Go,
    kind: "runtime",
    logo: ProviderLogo.Go,
    telemetryGuideLanguage: "go",
    isLanguageGuide: true,
  },
  {
    slug: "gin",
    name: "Gin",
    language: OpenTelemetryGuideLanguage.Go,
    kind: "framework",
    telemetryGuideLanguage: "go",
  },
  {
    // No logo set the registry draws from has Echo's: its initials stand in.
    slug: "echo",
    name: "Echo",
    language: OpenTelemetryGuideLanguage.Go,
    kind: "framework",
    telemetryGuideLanguage: "go",
  },
  {
    // No logo set the registry draws from has Fiber's: its initials stand in.
    slug: "fiber",
    name: "Fiber",
    language: OpenTelemetryGuideLanguage.Go,
    kind: "framework",
    telemetryGuideLanguage: "go",
  },
  {
    // gRPC services and clients in Go.
    slug: "grpc",
    name: "gRPC",
    language: OpenTelemetryGuideLanguage.Go,
    kind: "framework",
    telemetryGuideLanguage: "go",
  },
  {
    // Any Ruby program: a script, a scheduled job, a worker.
    slug: "ruby",
    name: "Ruby",
    language: OpenTelemetryGuideLanguage.Ruby,
    kind: "runtime",
    logo: ProviderLogo.Ruby,
    telemetryGuideLanguage: "ruby",
    isLanguageGuide: true,
  },
  {
    slug: "rails",
    name: "Ruby on Rails",
    language: OpenTelemetryGuideLanguage.Ruby,
    kind: "framework",
    telemetryGuideLanguage: "ruby",
  },
  {
    // No logo set the registry draws from has Sinatra's: its initials stand in.
    slug: "sinatra",
    name: "Sinatra",
    language: OpenTelemetryGuideLanguage.Ruby,
    kind: "framework",
    telemetryGuideLanguage: "ruby",
  },
  {
    // Ruby's most used background job processor: Celery's counterpart.
    slug: "sidekiq",
    name: "Sidekiq",
    language: OpenTelemetryGuideLanguage.Ruby,
    kind: "worker",
    telemetryGuideLanguage: "ruby",
  },
];

// Where the guides are listed: the website's index of integrations.
export const OPEN_TELEMETRY_GUIDES_INDEX_PATH: string = "/integrations";

// Where every guide's address starts.
export const OPEN_TELEMETRY_GUIDE_PATH_PREFIX: string =
  "/integrations/opentelemetry/";

// The website the guides are published on. Self-hosted installs link here too.
export const OPEN_TELEMETRY_GUIDES_ORIGIN: string = "https://oneuptime.com";

// A guide's path on the website: "/integrations/opentelemetry/express".
export function getOpenTelemetryGuidePath(slug: string): string {
  return `${OPEN_TELEMETRY_GUIDE_PATH_PREFIX}${slug}`;
}

// A guide's full address, for links from outside the website.
export function getOpenTelemetryGuideUrl(slug: string): string {
  return `${OPEN_TELEMETRY_GUIDES_ORIGIN}${getOpenTelemetryGuidePath(slug)}`;
}

// The index's full address, for links from outside the website.
export function getOpenTelemetryGuidesIndexUrl(): string {
  return `${OPEN_TELEMETRY_GUIDES_ORIGIN}${OPEN_TELEMETRY_GUIDES_INDEX_PATH}`;
}

export function getOpenTelemetryGuide(
  slug: string,
): OpenTelemetryGuideEntry | undefined {
  return OPEN_TELEMETRY_GUIDES.find((guide: OpenTelemetryGuideEntry) => {
    return guide.slug === slug;
  });
}

// The guides the product pages show, in the catalog's order.
export function getFeaturedOpenTelemetryGuides(): Array<OpenTelemetryGuideEntry> {
  return OPEN_TELEMETRY_GUIDES.filter((guide: OpenTelemetryGuideEntry) => {
    return guide.isFeatured === true;
  });
}

export function getOpenTelemetryGuidesOfLanguage(
  language: OpenTelemetryGuideLanguage,
): Array<OpenTelemetryGuideEntry> {
  return OPEN_TELEMETRY_GUIDES.filter((guide: OpenTelemetryGuideEntry) => {
    return guide.language === language;
  });
}

export function getOpenTelemetryGuideLanguageGroup(
  language: OpenTelemetryGuideLanguage,
): OpenTelemetryGuideLanguageGroup {
  const group: OpenTelemetryGuideLanguageGroup | undefined =
    OPEN_TELEMETRY_GUIDE_LANGUAGE_GROUPS.find(
      (candidate: OpenTelemetryGuideLanguageGroup) => {
        return candidate.language === language;
      },
    );

  if (!group) {
    throw new Error(`No OpenTelemetry guide language group for ${language}`);
  }

  return group;
}

export interface TelemetryGuideLanguageGuides {
  // The language's own guide: Node.js for "node".
  languageGuide: OpenTelemetryGuideEntry;
  // Its frameworks' guides, in the catalog's order.
  frameworkGuides: Array<OpenTelemetryGuideEntry>;
}

/*
 * The guides the Dashboard's telemetry guide opens for a language it lets a
 * reader pick, or undefined while that language has no guide yet.
 */
export function getGuidesForTelemetryGuideLanguage(
  key: TelemetryGuideLanguageKey,
): TelemetryGuideLanguageGuides | undefined {
  const guides: Array<OpenTelemetryGuideEntry> = OPEN_TELEMETRY_GUIDES.filter(
    (guide: OpenTelemetryGuideEntry) => {
      return guide.telemetryGuideLanguage === key;
    },
  );

  const languageGuide: OpenTelemetryGuideEntry | undefined = guides.find(
    (guide: OpenTelemetryGuideEntry) => {
      return guide.isLanguageGuide === true;
    },
  );

  if (!languageGuide) {
    return undefined;
  }

  return {
    languageGuide: languageGuide,
    frameworkGuides: guides.filter((guide: OpenTelemetryGuideEntry) => {
      return guide !== languageGuide;
    }),
  };
}
