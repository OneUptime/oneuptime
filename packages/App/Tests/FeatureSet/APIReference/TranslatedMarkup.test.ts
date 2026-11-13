import { MasterAdminApis } from "../../../FeatureSet/APIReference/Service/MasterAdminApis";
import {
  DocsLanguageDirection,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/APIReference/Utils/I18n";
import {
  DATA_TYPE_PAGE,
  PAGE_FIXTURES,
  PageFixture,
  renderPage,
  VIEWS_ROOT,
} from "./ReferenceFixtures";
import {
  RenderedElement,
  RenderedPage,
  attributeOf,
  listTemplates,
  only,
  parsePage,
  textOf,
} from "Common/Tests/RenderedMarkup";
import {
  LEFTWARDS_ARROW,
  PathArrow,
  RIGHTWARDS_ARROW,
  getPathArrows,
  withArrowsDecoded,
} from "Common/Tests/Helpers/PathArrows";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Translated strings that hold markup are drawn as markup.
 *
 * Some of the reference's strings carry <code>, <strong>, <em> or <a>: its
 * prose names commands, paths and headers, and links out. A template that
 * draws one with <%=, which escapes it, shows the reader the tags as text.
 * The Master admin APIs page's GET /logs entry read "use <code>kubectl
 * logs</code> or <code>docker logs</code> for that" in every language
 * (#7562). Every string comes from the reference's own locale files, so the
 * templates draw those with <%- instead, and a string drawn that way must
 * hold nothing a browser would take for markup it is not.
 *
 * These render every page in every language and read every template, so a
 * string drawn either way by mistake fails here.
 */

/*
 * The Master admin APIs page lists the service's own endpoints, /doctor
 * among them. The service's module reads the model registry when it loads,
 * and the pages here are rendered against fixtures, so the registry is
 * left empty.
 */
jest.mock("../../../FeatureSet/APIReference/Utils/Resources", () => {
  return {
    __esModule: true,
    default: {
      getResources: (): Array<never> => {
        return [];
      },
    },
  };
});

const LOCALES_ROOT: string = path.join(VIEWS_ROOT, "..", "Locales");

const BASE_PATH: string = "/api/admin/health";

const MASTER_ADMIN_APIS_PAGE: PageFixture = {
  page: "master-admin-apis",
  slug: "master-admin-apis",
  pageData: {
    hostUrl: "https://oneuptime.com/",
    basePath: BASE_PATH,
    endpoints: MasterAdminApis,
  },
};

// The guide to the query operators reads nothing but its code samples.
const DATA_TYPES_PAGE: PageFixture = {
  page: "data-types",
  slug: "data-types",
  pageData: Object.fromEntries(
    [
      "select",
      "sort",
      "equalTo",
      "notEqualTo",
      "isNull",
      "notNull",
      "greaterThan",
      "greaterThanOrEqual",
      "lessThan",
      "lessThanOrEqual",
      "includes",
    ].map((sample: string): [string, string] => {
      return [`${sample}Code`, '{ "query": {} }'];
    }),
  ),
};

// One of each page there is; the first test below holds that.
const PAGES: Array<[string, PageFixture]> = [
  ...Object.entries(PAGE_FIXTURES),
  ["dataType", DATA_TYPE_PAGE],
  ["dataTypes", DATA_TYPES_PAGE],
  ["masterAdminApis", MASTER_ADMIN_APIS_PAGE],
];

// Every string of a locale, by the dot path a template asks for it by.
function stringsOf(
  node: unknown,
  prefix: string = "",
  strings: Map<string, string> = new Map<string, string>(),
): Map<string, string> {
  if (typeof node === "string") {
    strings.set(prefix, node);
    return strings;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    stringsOf(value, prefix ? `${prefix}.${key}` : key, strings);
  }

  return strings;
}

// Every language a reader can pick, with its strings as its file has them.
const LOCALES: Array<[string, Map<string, string>]> =
  SUPPORTED_DOCS_LANGUAGE_CODES.map(
    (code: string): [string, Map<string, string>] => {
      return [
        code,
        stringsOf(
          JSON.parse(
            fs.readFileSync(path.join(LOCALES_ROOT, `${code}.json`), "utf8"),
          ),
        ),
      ];
    },
  );

const ENGLISH: Map<string, string> = LOCALES.find(
  ([code]: [string, Map<string, string>]): boolean => {
    return code === "en";
  },
)![1];

/*
 * The inline markup a translated string may hold. The reference's strings
 * use <a>, <code>, <em> and <strong> today.
 */
const TAG_NAMES: string = "a|b|br|code|em|i|kbd|strong";

// A tag in a string, before it is drawn.
const TAG_IN_STRING: RegExp = new RegExp(`<\\/?(?:${TAG_NAMES})(?=[\\s/>])`);

// A tag a string may hold, or a character it spells as an entity (&rarr;).
const MARKUP_AT_START: RegExp = new RegExp(
  `^(?:<\\/?(?:${TAG_NAMES})(?:\\s[^<>]*)?\\/?>|&(?:[a-zA-Z][a-zA-Z0-9]*|#\\d+|#x[0-9a-fA-F]+);)`,
);

// Whether every < and & in a string starts one.
function holdsOnlyMarkup(text: string): boolean {
  return Array.from(text.matchAll(/[<&]/g)).every(
    (match: RegExpMatchArray): boolean => {
      return MARKUP_AT_START.test(text.slice(match.index ?? 0));
    },
  );
}

/*
 * A tag drawn as text: &lt;code&gt;, &lt;/strong&gt;, &lt;a href="...
 * A type is drawn that way too, and rightly - Array&lt;MonitorStep&gt; - so
 * only the names of tags count.
 */
const TAG_DRAWN_AS_TEXT: RegExp = new RegExp(
  `&lt;\\/?(?:${TAG_NAMES})(?=[\\s/]|&gt;)`,
  "g",
);

function tagsDrawnAsText(html: string): Array<string> {
  return Array.from(html.matchAll(TAG_DRAWN_AS_TEXT)).map(
    (match: RegExpMatchArray): string => {
      return match[0];
    },
  );
}

interface EndpointEntry {
  path: string;
  // The description as the page sends it, markup and all.
  description: string;
  descriptionElement: RenderedElement;
}

/*
 * Each endpoint the page lists, in order: its path, and the description its
 * entry ends with.
 */
function endpointEntries(page: RenderedPage): Array<EndpointEntry> {
  return page.elements
    .filter((element: RenderedElement): boolean => {
      return element.tagName === "dl";
    })
    .map((entry: RenderedElement): EndpointEntry => {
      const items: Array<RenderedElement> = page.elements.filter(
        (element: RenderedElement): boolean => {
          return element.tagName === "dd" && element.ancestors[0] === entry;
        },
      );
      const pathElement: RenderedElement | undefined = page.elements.find(
        (element: RenderedElement): boolean => {
          return (
            element.tagName === "code" &&
            element.ancestors[1] === entry &&
            textOf(page, element).startsWith(BASE_PATH)
          );
        },
      );
      const description: RenderedElement = items[items.length - 1]!;

      return {
        path: pathElement ? textOf(page, pathElement) : "",
        description: page.html.slice(
          description.contentStart,
          description.contentEnd,
        ),
        descriptionElement: description,
      };
    });
}

describe.each(LOCALES)(
  "the Master admin APIs page in %s",
  (code: string, strings: Map<string, string>) => {
    let page: RenderedPage;
    let entries: Array<EndpointEntry>;

    beforeAll(async () => {
      page = parsePage(
        await renderPage(MASTER_ADMIN_APIS_PAGE, {
          lang: code,
          // Self-hosted, with billing off: the only build that has the page.
          showMasterAdminApis: true,
        }),
      );
      entries = endpointEntries(page);
    });

    it("shows the logs entry's commands as code, not as tags", () => {
      const logs: Array<EndpointEntry> = entries.filter(
        (entry: EndpointEntry): boolean => {
          return entry.path === `${BASE_PATH}/logs`;
        },
      );

      expect(logs).toHaveLength(1);

      const commands: Array<string> = page.elements
        .filter((element: RenderedElement): boolean => {
          return (
            element.tagName === "code" &&
            element.ancestors[0] === logs[0]!.descriptionElement
          );
        })
        .map((element: RenderedElement): string => {
          return textOf(page, element);
        });

      expect(commands).toEqual(["kubectl logs", "docker logs"]);
      expect(tagsDrawnAsText(logs[0]!.description)).toEqual([]);
    });

    it("lists every endpoint, /doctor too, with its description in this language, drawn as markup", () => {
      expect(
        entries.map((entry: EndpointEntry): [string, string] => {
          return [entry.path, entry.description];
        }),
      ).toEqual(
        MasterAdminApis.map(
          (api: {
            path: string;
            key: string;
          }): [string, string | undefined] => {
            return [
              `${BASE_PATH}${api.path}`,
              strings.get(`pages.masterAdminApis.${api.key}Desc`),
            ];
          },
        ),
      );
    });

    /*
     * The first step of making a master API key names a path: Admin
     * Dashboard, then Settings, then API Key. A browser draws "→" as it is
     * written on a page read from the right, so the Persian step's arrows
     * pointed back at the step before each (#7585): laid out the way the
     * page says it reads, every arrow points on, "←" in Persian.
     */
    it("points the master API key path's arrows the way the page reads", () => {
      const heading: RenderedElement = only(
        page,
        (element: RenderedElement): boolean => {
          return (
            element.tagName === "h2" &&
            attributeOf(element, "id") === "master-api-key"
          );
        },
      );
      const steps: RenderedElement | undefined = page.elements
        .slice(page.elements.indexOf(heading))
        .find((element: RenderedElement): boolean => {
          return element.tagName === "ol";
        });
      const firstStep: RenderedElement | undefined = page.elements.find(
        (element: RenderedElement): boolean => {
          return element.tagName === "li" && element.ancestors[0] === steps;
        },
      );
      const direction: DocsLanguageDirection = getDocsLanguageDirection(code);
      const words: string = withArrowsDecoded(textOf(page, firstStep!));
      const onward: string =
        direction === "rtl" ? LEFTWARDS_ARROW : RIGHTWARDS_ARROW;

      expect(
        attributeOf(
          only(page, (element: RenderedElement): boolean => {
            return element.tagName === "html";
          }),
          "dir",
        ),
      ).toBe(direction);
      expect(
        getPathArrows(words, direction).map(
          (arrow: PathArrow): [string, boolean] => {
            return [arrow.arrow, arrow.pointsBack];
          },
        ),
      ).toEqual([
        [onward, false],
        [onward, false],
      ]);
      // No arrow on the step points the other way, between its steps or not.
      expect(words).not.toContain(
        onward === LEFTWARDS_ARROW ? RIGHTWARDS_ARROW : LEFTWARDS_ARROW,
      );
    });
  },
);

describe("every page, in every language", () => {
  it("leaves no page template out", () => {
    expect(
      PAGES.map(([, fixture]: [string, PageFixture]): string => {
        return fixture.page;
      }).sort(),
    ).toEqual(
      listTemplates(path.join(VIEWS_ROOT, "main"))
        .map((template: string): string => {
          return path.basename(template, ".ejs");
        })
        .sort(),
    );
  });

  it.each(PAGES)(
    "the %s page shows no tag as text",
    async (_name: string, fixture: PageFixture) => {
      const shown: Array<string> = [];

      for (const [code] of LOCALES) {
        const html: string = await renderPage(fixture, { lang: code });

        for (const match of html.matchAll(TAG_DRAWN_AS_TEXT)) {
          const at: number = match.index ?? 0;
          shown.push(
            `${code}: ${html
              .slice(Math.max(0, at - 40), at + 60)
              .replace(/\s+/g, " ")}`,
          );
        }
      }

      expect(shown).toEqual([]);
    },
  );

  it("control: the sweep sees the tags the logs entry used to show, and none in a type", () => {
    expect(
      tagsDrawnAsText(
        "Container stdout is not included — use &lt;code&gt;kubectl logs&lt;/code&gt; or &lt;code&gt;docker logs&lt;/code&gt; for that.",
      ),
    ).toEqual(["&lt;code", "&lt;/code", "&lt;code", "&lt;/code"]);
    expect(
      tagsDrawnAsText(
        'Go to &lt;strong&gt;Project Settings&lt;/strong&gt; &lt;a href="https://editor.swagger.io"&gt; &lt;em&gt;now&lt;/em&gt;&lt;br/&gt;',
      ),
    ).toEqual([
      "&lt;strong",
      "&lt;/strong",
      "&lt;a",
      "&lt;em",
      "&lt;/em",
      "&lt;br",
    ]);
    expect(
      tagsDrawnAsText(
        '<span dir="ltr">Array&lt;MonitorStep&gt;</span> Dictionary&lt;string&gt; Array&lt;any&gt; Promise&lt;Array&lt;ObjectID&gt;&gt;',
      ),
    ).toEqual([]);
  });
});

/*
 * The templates, read rather than rendered, so a draw in a branch none of the
 * fixtures takes is checked too.
 */
interface TranslatedDraw {
  // Template and line.
  at: string;
  raw: boolean;
  // The key it asks for, or each key that fits one built by concatenation.
  keys: Array<string>;
}

// An output tag: <%= escapes what it draws, <%- does not.
const OUTPUT_TAG: RegExp = /<%([=-])([\s\S]*?)[-_]?%>/g;

/*
 * A call to t(), with the key it asks for: a literal, or literals and values
 * joined by + ('pages.masterAdminApis.' + endpoint.key + 'Desc').
 */
const TRANSLATE_CALL: RegExp =
  /^t\(\s*((?:'[^']*'|"[^"]*"|[\w.]+)(?:\s*\+\s*(?:'[^']*'|"[^"]*"|[\w.]+))*)\s*[,)]/;

const QUOTED: RegExp = /^['"]/;

/*
 * What a partial is handed, the partial draws; what is serialised for a
 * script is not drawn at all. The rendered pages above cover both.
 */
const DRAWN_ELSEWHERE: RegExp = /\binclude\(|JSON\.stringify\(/;

function keysAskedFor(expression: string): Array<string> {
  // A literal stands for itself, a value for any one segment of a key.
  const source: string = expression
    .split(/\s*\+\s*/)
    .map((part: string): string => {
      return QUOTED.test(part) ? escapeRegExp(part.slice(1, -1)) : "[^.]+";
    })
    .join("");
  const pattern: RegExp = new RegExp(`^${source}$`);

  return Array.from(ENGLISH.keys()).filter((key: string): boolean => {
    return pattern.test(key);
  });
}

function translatedDraws(
  template: string,
  source: string,
): Array<TranslatedDraw> {
  const draws: Array<TranslatedDraw> = [];

  for (const tag of source.matchAll(OUTPUT_TAG)) {
    const expression: string = tag[2]!;

    if (DRAWN_ELSEWHERE.test(expression)) {
      continue;
    }

    // A call it cannot read asks for no key, and the first test below fails.
    for (const call of expression.matchAll(/\bt\(/g)) {
      const key: RegExpMatchArray | null = expression
        .slice(call.index)
        .match(TRANSLATE_CALL);

      draws.push({
        at: `${template}:${source.slice(0, tag.index).split("\n").length}`,
        raw: tag[1] === "-",
        keys: key ? keysAskedFor(key[1]!) : [],
      });
    }
  }

  return draws;
}

// Each string a draw escapes although it holds a tag, in each language.
function markupDrawnEscaped(
  draws: Array<TranslatedDraw>,
  locales: Array<[string, Map<string, string>]>,
): Array<string> {
  const found: Array<string> = [];

  for (const draw of draws.filter((candidate: TranslatedDraw): boolean => {
    return !candidate.raw;
  })) {
    for (const key of draw.keys) {
      for (const [code, strings] of locales) {
        if (TAG_IN_STRING.test(strings.get(key) ?? "")) {
          found.push(`${draw.at} ${key} (${code})`);
        }
      }
    }
  }

  return found;
}

/*
 * Each string a draw sends raw that holds a < or an & that starts no tag and
 * no entity. Drawn raw, "Replace <name> with yours" reads "Replace with
 * yours": a browser takes <name> for a tag. Such a string spells &lt; and
 * &amp; instead.
 */
function textDrawnRaw(
  draws: Array<TranslatedDraw>,
  locales: Array<[string, Map<string, string>]>,
): Array<string> {
  const found: Array<string> = [];

  for (const draw of draws.filter((candidate: TranslatedDraw): boolean => {
    return candidate.raw;
  })) {
    for (const key of draw.keys) {
      for (const [code, strings] of locales) {
        if (!holdsOnlyMarkup(strings.get(key) ?? "")) {
          found.push(`${draw.at} ${key} (${code})`);
        }
      }
    }
  }

  return found;
}

describe("the templates", () => {
  const draws: Array<TranslatedDraw> = listTemplates(VIEWS_ROOT).flatMap(
    (template: string): Array<TranslatedDraw> => {
      return translatedDraws(
        path.relative(VIEWS_ROOT, template),
        fs.readFileSync(template, "utf8"),
      );
    },
  );

  it("are all read, the endpoint list's key built by concatenation too", () => {
    expect(draws.length).toBeGreaterThan(300);
    expect(
      draws.filter((draw: TranslatedDraw): boolean => {
        return draw.keys.length === 0;
      }),
    ).toEqual([]);
    expect(
      draws
        .filter((draw: TranslatedDraw): boolean => {
          return (
            draw.at.startsWith("main/master-admin-apis.ejs") &&
            draw.keys.length > 1
          );
        })
        .map((draw: TranslatedDraw): Array<string> => {
          return [...draw.keys].sort();
        }),
    ).toEqual([
      MasterAdminApis.map((api: { key: string }): string => {
        return `pages.masterAdminApis.${api.key}Desc`;
      }).sort(),
    ]);
  });

  it("draw every string that holds a tag raw, in every language", () => {
    expect(markupDrawnEscaped(draws, LOCALES)).toEqual([]);
  });

  it("draw raw only strings that hold nothing but markup and text, in every language", () => {
    expect(textDrawnRaw(draws, LOCALES)).toEqual([]);
  });

  it("control: the sweeps catch the endpoint list as it was, and text a browser would take for a tag", () => {
    const before: Array<TranslatedDraw> = translatedDraws(
      "main/master-admin-apis.ejs",
      `<dd class="w-full flex-none text-sm text-ink-muted mt-1"><%= t('pages.masterAdminApis.' + endpoint.key + 'Desc') %></dd>`,
    );

    expect(markupDrawnEscaped(before, LOCALES)).toEqual(
      LOCALES.map(([code]: [string, Map<string, string>]): string => {
        return `main/master-admin-apis.ejs:1 pages.masterAdminApis.logsDesc (${code})`;
      }),
    );

    const raw: Array<TranslatedDraw> = translatedDraws(
      "main/master-admin-apis.ejs",
      "<dd><%- t('pages.masterAdminApis.queuesDesc') %></dd>",
    );
    const withText: (text: string) => Array<[string, Map<string, string>]> = (
      text: string,
    ): Array<[string, Map<string, string>]> => {
      return [
        [
          "en",
          new Map<string, string>([["pages.masterAdminApis.queuesDesc", text]]),
        ],
      ];
    };

    expect(textDrawnRaw(raw, withText("Replace <name> with yours"))).toEqual([
      "main/master-admin-apis.ejs:1 pages.masterAdminApis.queuesDesc (en)",
    ]);
    expect(
      textDrawnRaw(raw, withText("Queues with fewer than <5 jobs")),
    ).toEqual([
      "main/master-admin-apis.ejs:1 pages.masterAdminApis.queuesDesc (en)",
    ]);
    expect(textDrawnRaw(raw, withText("Jobs & queues"))).toEqual([
      "main/master-admin-apis.ejs:1 pages.masterAdminApis.queuesDesc (en)",
    ]);
    expect(
      textDrawnRaw(
        raw,
        withText(
          'Use <code>kubectl logs</code> &amp; <a href="https://editor.swagger.io" target="_blank">the editor</a>: <strong>Settings &rarr; API Key</strong>, Settings > API Keys.',
        ),
      ),
    ).toEqual([]);
  });
});
