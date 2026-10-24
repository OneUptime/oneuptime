import DocsTranslations from "../../../FeatureSet/Docs/Utils/Translations";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  NAV_PAGES,
  TRANSLATED_LANGUAGES,
  anchorsOf,
  hasPage,
} from "./DocsContentSupport";
import {
  DocsAddress,
  DocsAddressTarget,
  docsAddressesIn,
  targetOfDocsAddress,
} from "Common/Tests/Helpers/DocsAddresses";
import { describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The README's links into the docs open real pages, in the reader's language.
 *
 * The README and its 16 translations (Docs/translations) leave the details
 * to the docs: each product they name, the Docker Compose guide, the
 * comparison of the editions and the local development guide are links to
 * https://oneuptime.com/docs/... . Every one must name a page the docs' nav
 * lists (the docs answer any other page with a 404), never a category's own
 * address, and only headings that page has. The English README names no
 * language, so it opens the English page. Each translation names its own,
 * and the page must be written in it: the docs serve a copy that is still
 * English too, but in English (Utils/Translations).
 *
 * Tests/Ops/ReadmeFacts holds the translations to the English layout, and
 * the rest of what the README says to the code that makes it true.
 */
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");
const WEBSITE: string = "https://oneuptime.com";

interface Readme {
  language: string;
  file: string;
  text: string;
}

interface ReadmeDocsLink {
  // Where it is written: "Docs/translations/README.de.md:41".
  where: string;
  address: DocsAddress;
  target: DocsAddressTarget;
  // Whether the address is written after https://oneuptime.com.
  onWebsite: boolean;
}

const readmeFileOf: (language: string) => string = (
  language: string,
): string => {
  return language === "en"
    ? "README.md"
    : `Docs/translations/README.${language}.md`;
};

const README_LANGUAGES: Array<string> = ["en", ...TRANSLATED_LANGUAGES];

const readmes: Array<Readme> = README_LANGUAGES.filter(
  (language: string): boolean => {
    return fs.existsSync(path.join(REPOSITORY, readmeFileOf(language)));
  },
).map((language: string): Readme => {
  const file: string = readmeFileOf(language);
  return {
    language: language,
    file: file,
    text: fs.readFileSync(path.join(REPOSITORY, file), "utf8"),
  };
});

const docsLinksOf: (readme: Readme) => Array<ReadmeDocsLink> = (
  readme: Readme,
): Array<ReadmeDocsLink> => {
  return docsAddressesIn(readme.text).map(
    (address: DocsAddress): ReadmeDocsLink => {
      return {
        where: `${readme.file}:${address.line}`,
        address: address,
        target: targetOfDocsAddress(address, SUPPORTED_DOCS_LANGUAGE_CODES),
        onWebsite:
          readme.text.slice(address.index - WEBSITE.length, address.index) ===
          WEBSITE,
      };
    },
  );
};

const pagesOf: (readme: Readme) => Array<string | null> = (
  readme: Readme,
): Array<string | null> => {
  return docsLinksOf(readme).map((link: ReadmeDocsLink): string | null => {
    return link.target.name;
  });
};

const english: Readme = readmes[0]!;

const byLanguage: Array<[string, Readme]> = readmes.map(
  (readme: Readme): [string, Readme] => {
    return [readme.language, readme];
  },
);

const translations: Array<[string, Readme]> = byLanguage.filter(
  ([language]: [string, Readme]): boolean => {
    return language !== "en";
  },
);

describe("the README's links into the docs", () => {
  it("are read from the English README and a translation for every docs language", () => {
    expect(english.file).toBe("README.md");
    expect(
      readmes.map((readme: Readme): string => {
        return readme.language;
      }),
    ).toEqual(README_LANGUAGES);
    expect(TRANSLATED_LANGUAGES).toHaveLength(16);
    // The products, the two guides and the comparison of the editions.
    expect(docsLinksOf(english).length).toBeGreaterThanOrEqual(10);
  });

  it.each(byLanguage)(
    "in %s are all on the docs site, written whole",
    (_language: string, readme: Readme) => {
      const elsewhere: Array<string> = docsLinksOf(readme)
        .filter((link: ReadmeDocsLink): boolean => {
          return !link.onWebsite || !link.address.writtenWhole;
        })
        .map((link: ReadmeDocsLink): string => {
          return `${link.where}: ${link.address.address}`;
        });

      expect(elsewhere).toEqual([]);
    },
  );

  it.each(byLanguage)(
    "in %s name pages, never a category's own address or the docs' root",
    (_language: string, readme: Readme) => {
      const notPages: Array<string> = docsLinksOf(readme)
        .filter((link: ReadmeDocsLink): boolean => {
          return link.target.kind !== "page";
        })
        .map((link: ReadmeDocsLink): string => {
          return `${link.where}: ${link.address.address} (${link.target.kind})`;
        });

      expect(notPages).toEqual([]);
    },
  );

  it.each(byLanguage)(
    "in %s name pages the docs' nav lists",
    (_language: string, readme: Readme) => {
      const unlisted: Array<string> = docsLinksOf(readme)
        .filter((link: ReadmeDocsLink): boolean => {
          return !NAV_PAGES.includes(link.target.name || "");
        })
        .map((link: ReadmeDocsLink): string => {
          return `${link.where}: ${link.address.address}`;
        });

      expect(unlisted).toEqual([]);
    },
  );

  it("in English name no language, so they open the English page", () => {
    const withLanguage: Array<string> = docsLinksOf(english)
      .filter((link: ReadmeDocsLink): boolean => {
        return link.target.lang !== null;
      })
      .map((link: ReadmeDocsLink): string => {
        return `${link.where}: ${link.address.address}`;
      });

    expect(withLanguage).toEqual([]);
  });

  it.each(translations)(
    "in %s name the translation's own language",
    (language: string, readme: Readme) => {
      const otherLanguage: Array<string> = docsLinksOf(readme)
        .filter((link: ReadmeDocsLink): boolean => {
          return link.target.lang !== language;
        })
        .map((link: ReadmeDocsLink): string => {
          return `${link.where}: ${link.address.address}`;
        });

      expect(otherLanguage).toEqual([]);
    },
  );

  it.each(translations)(
    "in %s open the pages the English README opens, in the same order",
    (_language: string, readme: Readme) => {
      expect(pagesOf(readme)).toEqual(pagesOf(english));
    },
  );

  it.each(byLanguage)(
    "in %s open pages written in that language",
    async (language: string, readme: Readme) => {
      const missing: Array<string> = [];

      for (const link of docsLinksOf(readme)) {
        const page: string = link.target.name || "";

        if (!hasPage(language, page)) {
          missing.push(`${link.where}: no ${language} copy of ${page}`);
        } else if (!(await DocsTranslations.isTranslated(page, language))) {
          missing.push(
            `${link.where}: the ${language} copy of ${page} is English`,
          );
        }
      }

      expect(missing).toEqual([]);
    },
  );

  it.each(byLanguage)(
    "in %s name only headings the page has in that language",
    (language: string, readme: Readme) => {
      const broken: Array<string> = docsLinksOf(readme)
        .filter((link: ReadmeDocsLink): boolean => {
          return (
            link.address.anchor !== null &&
            !anchorsOf(language, link.target.name || "").has(
              link.address.anchor,
            )
          );
        })
        .map((link: ReadmeDocsLink): string => {
          return `${link.where}: ${link.address.address}`;
        });

      expect(broken).toEqual([]);
    },
  );
});

describe("how a README docs link is read", () => {
  const linkIn: (text: string, language: string) => ReadmeDocsLink = (
    text: string,
    language: string,
  ): ReadmeDocsLink => {
    const [link]: Array<ReadmeDocsLink> = docsLinksOf({
      language: language,
      file: "README.md",
      text: text,
    });

    return link!;
  };

  it("finds the language and the page of a translated link", () => {
    const link: ReadmeDocsLink = linkIn(
      "See the [guide](https://oneuptime.com/docs/de/installation/docker-compose).",
      "de",
    );

    expect(link.onWebsite).toBe(true);
    expect(link.target).toEqual({
      kind: "page",
      lang: "de",
      name: "installation/docker-compose",
    });
  });

  it("tells a category's own address, a link that is not https and an anchor apart", () => {
    expect(
      linkIn("[Workflows](https://oneuptime.com/docs/fr/workflows)", "fr")
        .target.kind,
    ).toBe("category");
    expect(
      linkIn("[AI](http://oneuptime.com/docs/ai/ai-sre)", "en").onWebsite,
    ).toBe(false);
    expect(
      linkIn("[AI](https://www.oneuptime.com/docs/ai/ai-sre)", "en").onWebsite,
    ).toBe(false);
    expect(
      linkIn(
        "[Editions](https://oneuptime.com/docs/self-hosted/enterprise#licensing)",
        "en",
      ).address.anchor,
    ).toBe("licensing");
  });
});
