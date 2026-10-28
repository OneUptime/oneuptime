import {
  MAX_FEATURED_OPEN_TELEMETRY_GUIDES,
  OPEN_TELEMETRY_GUIDES,
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  OPEN_TELEMETRY_GUIDES_ORIGIN,
  OPEN_TELEMETRY_GUIDE_LANGUAGE_GROUPS,
  OPEN_TELEMETRY_GUIDE_PATH_PREFIX,
  OpenTelemetryGuideEntry,
  OpenTelemetryGuideLanguage,
  OpenTelemetryGuideLanguageGroup,
  TELEMETRY_GUIDE_LANGUAGE_KEYS,
  TelemetryGuideLanguageGuides,
  TelemetryGuideLanguageKey,
  getFeaturedOpenTelemetryGuides,
  getGuidesForTelemetryGuideLanguage,
  getOpenTelemetryGuide,
  getOpenTelemetryGuideLanguageGroup,
  getOpenTelemetryGuidePath,
  getOpenTelemetryGuideUrl,
  getOpenTelemetryGuidesIndexUrl,
  getOpenTelemetryGuidesOfLanguage,
} from "../../../Types/Telemetry/OpenTelemetryGuides";
import { isProviderLogo } from "../../../Types/ProviderLogo/ProviderLogo";
import { describe, expect, test } from "@jest/globals";

/*
 * The catalog of the website's OpenTelemetry guides: what the Dashboard's
 * telemetry guide, the docs and the website link by. A guide's address
 * never changes once published (search results and links point at it), the
 * language groups and keys are held to the catalog, and the rules of the
 * product pages' row of featured guides hold for every guide added later.
 */

const SLUG: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugsOf(
  guides: ReadonlyArray<OpenTelemetryGuideEntry>,
): Array<string> {
  return guides.map((guide: OpenTelemetryGuideEntry): string => {
    return guide.slug;
  });
}

describe("the guides' addresses", () => {
  test("are unique, lower-case and hyphenated: a clean address per guide", () => {
    const slugs: Array<string> = slugsOf(OPEN_TELEMETRY_GUIDES);

    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect([slug, SLUG.test(slug)]).toEqual([slug, true]);
    }
  });

  test("keep the JavaScript and TypeScript guides where they were published", () => {
    expect(
      slugsOf(
        getOpenTelemetryGuidesOfLanguage(OpenTelemetryGuideLanguage.JavaScript),
      ),
    ).toEqual([
      "nodejs",
      "express",
      "nestjs",
      "nextjs",
      "fastify",
      "koa",
      "hapi",
      "bun",
      "deno",
      "browser",
      "react",
      "angular",
    ]);
  });

  test("keep the Python, Java, Kotlin and .NET guides where they were published", () => {
    expect(
      [
        OpenTelemetryGuideLanguage.Python,
        OpenTelemetryGuideLanguage.Java,
        OpenTelemetryGuideLanguage.Kotlin,
        OpenTelemetryGuideLanguage.DotNet,
      ].map((language: OpenTelemetryGuideLanguage): Array<string> => {
        return slugsOf(getOpenTelemetryGuidesOfLanguage(language));
      }),
    ).toEqual([
      ["python", "django", "flask", "fastapi", "celery"],
      ["java", "spring-boot", "quarkus", "micronaut"],
      ["ktor"],
      ["dotnet", "aspnet-core", "dotnet-worker-service"],
    ]);
  });

  test("are paths under /integrations/opentelemetry/ on the website", () => {
    expect(OPEN_TELEMETRY_GUIDES_INDEX_PATH).toBe("/integrations");
    expect(OPEN_TELEMETRY_GUIDE_PATH_PREFIX).toBe(
      "/integrations/opentelemetry/",
    );
    expect(getOpenTelemetryGuidePath("express")).toBe(
      "/integrations/opentelemetry/express",
    );
  });

  test("are full addresses on oneuptime.com from anywhere else, self-hosted installations included", () => {
    expect(OPEN_TELEMETRY_GUIDES_ORIGIN).toBe("https://oneuptime.com");
    expect(getOpenTelemetryGuideUrl("nextjs")).toBe(
      "https://oneuptime.com/integrations/opentelemetry/nextjs",
    );
    expect(getOpenTelemetryGuidesIndexUrl()).toBe(
      "https://oneuptime.com/integrations",
    );

    const url: URL = new URL(getOpenTelemetryGuideUrl("react"));
    expect(url.origin).toBe("https://oneuptime.com");
    expect(url.pathname).toBe("/integrations/opentelemetry/react");
  });
});

describe("a guide's entry", () => {
  test("is found by its slug, and nothing is found for a slug the catalog does not have", () => {
    expect(getOpenTelemetryGuide("nestjs")?.name).toBe("NestJS");
    expect(getOpenTelemetryGuide("no-such-framework")).toBeUndefined();
    expect(getOpenTelemetryGuide("")).toBeUndefined();
  });

  test("names its framework as its maker writes it", () => {
    expect(
      OPEN_TELEMETRY_GUIDES.map((guide: OpenTelemetryGuideEntry): string => {
        return guide.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Node.js",
        "Express",
        "NestJS",
        "Next.js",
        "hapi",
        "Bun",
        "Deno",
        "FastAPI",
        "Spring Boot",
        "Ktor",
        "ASP.NET Core",
      ]),
    );
    for (const guide of OPEN_TELEMETRY_GUIDES) {
      expect(guide.name.trim()).toBe(guide.name);
      expect(guide.name.length).toBeGreaterThan(0);
    }
  });

  test("names a logo the registry has, where it names one", () => {
    for (const guide of OPEN_TELEMETRY_GUIDES) {
      if (guide.logo !== undefined) {
        expect([guide.slug, isProviderLogo(guide.logo)]).toEqual([
          guide.slug,
          true,
        ]);
      }
    }
  });

  test("belongs to a language group the index lists", () => {
    const languages: Array<string> = OPEN_TELEMETRY_GUIDE_LANGUAGE_GROUPS.map(
      (group: OpenTelemetryGuideLanguageGroup): string => {
        return group.language;
      },
    );

    for (const guide of OPEN_TELEMETRY_GUIDES) {
      expect(languages).toContain(guide.language);
    }
  });
});

describe("the language groups", () => {
  test("are every language once, in the index's order", () => {
    expect(
      OPEN_TELEMETRY_GUIDE_LANGUAGE_GROUPS.map(
        (group: OpenTelemetryGuideLanguageGroup): string => {
          return group.language;
        },
      ),
    ).toEqual(Object.values(OpenTelemetryGuideLanguage));
  });

  test("each have a heading and a line under it", () => {
    for (const group of OPEN_TELEMETRY_GUIDE_LANGUAGE_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.description.endsWith(".")).toBe(true);
      if (group.logo !== undefined) {
        expect(isProviderLogo(group.logo)).toBe(true);
      }
    }
  });

  test("are found by language", () => {
    expect(
      getOpenTelemetryGuideLanguageGroup(OpenTelemetryGuideLanguage.JavaScript)
        .title,
    ).toBe("JavaScript & TypeScript");
    expect(
      getOpenTelemetryGuideLanguageGroup(OpenTelemetryGuideLanguage.DotNet)
        .title,
    ).toBe(".NET");
    expect(() => {
      return getOpenTelemetryGuideLanguageGroup(
        "cobol" as OpenTelemetryGuideLanguage,
      );
    }).toThrow("No OpenTelemetry guide language group for cobol");
  });
});

describe("the guides the Dashboard's telemetry guide opens", () => {
  test("are named by the languages its buttons offer, and no other", () => {
    for (const guide of OPEN_TELEMETRY_GUIDES) {
      if (guide.telemetryGuideLanguage !== undefined) {
        expect(TELEMETRY_GUIDE_LANGUAGE_KEYS).toContain(
          guide.telemetryGuideLanguage,
        );
      }
    }
    expect(new Set(TELEMETRY_GUIDE_LANGUAGE_KEYS).size).toBe(
      TELEMETRY_GUIDE_LANGUAGE_KEYS.length,
    );
  });

  test("give every language with guides exactly one guide of its own", () => {
    for (const key of TELEMETRY_GUIDE_LANGUAGE_KEYS) {
      const guides: Array<OpenTelemetryGuideEntry> =
        OPEN_TELEMETRY_GUIDES.filter(
          (guide: OpenTelemetryGuideEntry): boolean => {
            return guide.telemetryGuideLanguage === key;
          },
        );

      if (guides.length === 0) {
        continue;
      }

      const ownGuides: Array<string> = guides
        .filter((guide: OpenTelemetryGuideEntry): boolean => {
          return guide.isLanguageGuide === true;
        })
        .map((guide: OpenTelemetryGuideEntry): string => {
          return guide.slug;
        });

      expect([key, ownGuides.length]).toEqual([key, 1]);
    }
  });

  test("mark a guide as its language's own only when it names that language", () => {
    for (const guide of OPEN_TELEMETRY_GUIDES) {
      if (guide.isLanguageGuide) {
        expect([guide.slug, guide.telemetryGuideLanguage]).toEqual([
          guide.slug,
          expect.any(String),
        ]);
      }
    }
  });

  test("are Node.js's own guide and then its frameworks and runtimes, for Node.js", () => {
    const guides: TelemetryGuideLanguageGuides | undefined =
      getGuidesForTelemetryGuideLanguage("node");

    expect(guides?.languageGuide.slug).toBe("nodejs");
    expect(slugsOf(guides?.frameworkGuides || [])).toEqual([
      "express",
      "nestjs",
      "nextjs",
      "fastify",
      "koa",
      "hapi",
      "bun",
      "deno",
    ]);
  });

  test("are each language's own guide and then its frameworks, for Python, Java and .NET", () => {
    for (const [key, own, frameworks] of [
      ["python", "python", ["django", "flask", "fastapi", "celery"]],
      // Kotlin runs on the JVM: Ktor is listed with Java's frameworks.
      ["java", "java", ["spring-boot", "quarkus", "micronaut", "ktor"]],
      ["dotnet", "dotnet", ["aspnet-core", "dotnet-worker-service"]],
    ] as Array<[TelemetryGuideLanguageKey, string, Array<string>]>) {
      const guides: TelemetryGuideLanguageGuides | undefined =
        getGuidesForTelemetryGuideLanguage(key);

      expect([key, guides?.languageGuide.slug]).toEqual([key, own]);
      expect([key, slugsOf(guides?.frameworkGuides || [])]).toEqual([
        key,
        frameworks,
      ]);
    }
  });

  test("name a worker's guide by its phrase where a sentence needs one", () => {
    expect(getOpenTelemetryGuide("dotnet-worker-service")).toMatchObject({
      name: "Worker Service",
      inSentence: "a Worker Service",
      kind: "worker",
    });
    expect(getOpenTelemetryGuide("celery")?.kind).toBe("worker");
    for (const guide of OPEN_TELEMETRY_GUIDES) {
      if (guide.inSentence !== undefined) {
        expect(guide.inSentence).toContain(guide.name);
      }
    }
  });

  test("are React's and Angular's own guides, with no frameworks under them", () => {
    for (const [key, slug] of [
      ["react", "react"],
      ["angular", "angular"],
    ] as Array<[TelemetryGuideLanguageKey, string]>) {
      const guides: TelemetryGuideLanguageGuides | undefined =
        getGuidesForTelemetryGuideLanguage(key);

      expect(guides?.languageGuide.slug).toBe(slug);
      expect(guides?.frameworkGuides).toEqual([]);
    }
  });

  test("are none for a language with no guide", () => {
    expect(getGuidesForTelemetryGuideLanguage("swift")).toBeUndefined();
    expect(getGuidesForTelemetryGuideLanguage("cpp")).toBeUndefined();
  });

  test("leave out the plain browser guide, which no language button names", () => {
    for (const key of TELEMETRY_GUIDE_LANGUAGE_KEYS) {
      const guides: TelemetryGuideLanguageGuides | undefined =
        getGuidesForTelemetryGuideLanguage(key);
      const slugs: Array<string> = guides
        ? [guides.languageGuide.slug, ...slugsOf(guides.frameworkGuides)]
        : [];

      expect(slugs).not.toContain("browser");
    }
  });
});

describe("the guides the product pages feature", () => {
  const featured: Array<OpenTelemetryGuideEntry> =
    getFeaturedOpenTelemetryGuides();

  test("are the guides marked featured, in the catalog's order", () => {
    expect(featured).toEqual(
      OPEN_TELEMETRY_GUIDES.filter(
        (guide: OpenTelemetryGuideEntry): boolean => {
          return guide.isFeatured === true;
        },
      ),
    );
    // One row per language at most, room left for the languages to come.
    expect(slugsOf(featured)).toEqual([
      "nodejs",
      "nextjs",
      "react",
      "fastapi",
      "spring-boot",
      "ktor",
      "aspnet-core",
    ]);
  });

  test("fill two rows at most", () => {
    expect(MAX_FEATURED_OPEN_TELEMETRY_GUIDES).toBe(12);
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.length).toBeLessThanOrEqual(
      MAX_FEATURED_OPEN_TELEMETRY_GUIDES,
    );
  });

  test("name at least one guide of every language that has guides", () => {
    const languages: Set<string> = new Set(
      OPEN_TELEMETRY_GUIDES.map((guide: OpenTelemetryGuideEntry): string => {
        return guide.language;
      }),
    );

    for (const language of languages) {
      expect([
        language,
        featured.some((guide: OpenTelemetryGuideEntry): boolean => {
          return guide.language === language;
        }),
      ]).toEqual([language, true]);
    }
  });

  test("each have the framework's official logo: a row of brands on a product page", () => {
    for (const guide of featured) {
      expect([guide.slug, guide.logo !== undefined]).toEqual([
        guide.slug,
        true,
      ]);
    }
  });
});
