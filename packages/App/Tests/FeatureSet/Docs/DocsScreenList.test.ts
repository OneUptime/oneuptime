import {
  DOCS_SCREENS,
  DOCS_SCREEN_FIXTURES,
  DOCS_SCREEN_LANGUAGES,
  DocsScreen,
  DocsScreenAction,
  DocsScreenFixture,
} from "../../../FeatureSet/Docs/Screens/DocsScreenList";
import {
  continuesFrom,
  SCREEN_NAME,
  screenNameOf,
} from "../../../FeatureSet/Docs/Screens/DocsScreenFiles";
import { DOCS_LANGUAGES, listPages, scanPage } from "./DocsContentSupport";
import PageMap from "../../../FeatureSet/Dashboard/src/Utils/PageMap";
import { beforeAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS' SHOT LIST (#6823, Docs/Screens/DocsScreenList.ts): every shot
 * names a fixture and a Dashboard page that exist, reaches its state with
 * the Dashboard's own words, and is shown by a docs page; every screenshot
 * a docs page shows is on the list.
 *
 * RouteMap is imported late, with a browser stub: it pulls in
 * Common/UI/Config, which reads `window` as it loads.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const E2E: string = path.join(REPO_ROOT, "packages", "E2E");
const ENGLISH_LOCALE: Record<string, unknown> = JSON.parse(
  fs.readFileSync(
    path.join(
      REPO_ROOT,
      "packages/App/FeatureSet/Dashboard/src/Locales/en.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

type RouteMapModule =
  typeof import("../../../FeatureSet/Dashboard/src/Utils/RouteMap");

let RouteMap: RouteMapModule["default"];

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op: nothing here navigates.
      },
    },
    addEventListener: (): void => {
      // no-op: nothing here listens.
    },
    removeEventListener: (): void => {
      // no-op
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  RouteMap = (await import("../../../FeatureSet/Dashboard/src/Utils/RouteMap"))
    .default;
});

// Each shot by its name, for the tests that run once per shot.
const SHOT_CASES: Array<[string, DocsScreen]> = DOCS_SCREENS.map(
  (shot: DocsScreen): [string, DocsScreen] => {
    return [shot.name, shot];
  },
);

// The Dashboard's English words an action finds on screen, to look up in a language.
function wordsOf(action: DocsScreenAction): Array<string> {
  if ("press" in action) {
    return [action.press];
  }
  if ("tick" in action) {
    return action.asWritten ? [] : [action.tick];
  }
  if ("type" in action) {
    return [action.type];
  }
  return [];
}

function fixtureOf(shot: DocsScreen): DocsScreenFixture {
  return DOCS_SCREEN_FIXTURES[shot.fixture]!;
}

// Every screenshot a docs page shows, in every language: shot -> pages.
function screensInDocs(): Map<string, Array<string>> {
  const shown: Map<string, Array<string>> = new Map();

  for (const lang of DOCS_LANGUAGES) {
    for (const page of listPages(lang)) {
      for (const link of scanPage(lang, page).links) {
        if (link.isImage && link.target.startsWith("screen:")) {
          shown.set(link.target.slice("screen:".length), [
            ...(shown.get(link.target.slice("screen:".length)) || []),
            `${lang}/${page}:${link.line}`,
          ]);
        }
      }
    }
  }

  return shown;
}

describe("the docs' shot list", () => {
  it("draws every docs language, as the docs list them", () => {
    expect([...DOCS_SCREEN_LANGUAGES]).toEqual(DOCS_LANGUAGES);
  });

  it("names each shot once, as a file name and a docs address can carry it", () => {
    const names: Array<string> = DOCS_SCREENS.map((shot: DocsScreen) => {
      return shot.name;
    });

    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect({ name, ok: SCREEN_NAME.test(name) }).toEqual({ name, ok: true });
      expect(screenNameOf(`screen:${name}`)).toBe(name);
    }
  });

  it.each(SHOT_CASES)(
    "%s names a fixture that exists, with its server",
    (_name: string, shot: DocsScreen) => {
      const fixture: DocsScreenFixture | undefined =
        DOCS_SCREEN_FIXTURES[shot.fixture];

      expect(fixture).toBeDefined();
      expect(fs.existsSync(path.join(E2E, fixture!.folder))).toBe(true);
      expect(fs.existsSync(path.join(E2E, fixture!.server))).toBe(true);
      // Its server reads the port the docs screens give it.
      expect(
        fs.readFileSync(path.join(E2E, fixture!.server), "utf8"),
      ).toContain(`process.env.${fixture!.portVariable}`);
    },
  );

  it.each(SHOT_CASES)(
    "%s names a Dashboard page that exists, at its own address, that its fixture draws",
    (_name: string, shot: DocsScreen) => {
      const pageKey: string | undefined = (
        PageMap as unknown as Record<string, string>
      )[shot.page];

      expect(pageKey).toBe(shot.page);
      expect(
        (RouteMap as unknown as Record<string, { toString: () => string }>)[
          pageKey!
        ]?.toString(),
      ).toBe(shot.path);

      // Every part of the address the shot fills, and nothing left over.
      const params: Array<string> = (shot.path.match(/:[A-Za-z]+/g) || []).map(
        (param: string): string => {
          return param.slice(1);
        },
      );
      expect(params.sort()).toEqual(
        ["projectId", ...Object.keys(shot.params || {})].sort(),
      );

      /*
       * The journeys fixture mounts the Dashboard's own App, with every
       * route; any other fixture mounts the page itself.
       */
      const fixture: DocsScreenFixture = fixtureOf(shot);
      const folder: string = path.join(E2E, fixture.folder, "Fixture");
      const sources: string = fs
        .readdirSync(folder)
        .filter((file: string): boolean => {
          return file.endsWith(".js");
        })
        .map((file: string): string => {
          return fs.readFileSync(path.join(folder, file), "utf8");
        })
        .join("\n");

      expect({
        page: shot.page,
        drawn:
          sources.includes('Dashboard/src/App"') ||
          sources.includes(`PageMap.${shot.page}]`) ||
          sources.includes(`PageMap.${shot.page},`),
      }).toEqual({ page: shot.page, drawn: true });
    },
  );

  it.each(SHOT_CASES)(
    "%s reaches its state and rings its button with the Dashboard's own English words",
    (_name: string, shot: DocsScreen) => {
      const words: Array<string> = [
        ...shot.state.flatMap(wordsOf),
        ...(shot.highlight ? [shot.highlight] : []),
      ];

      for (const word of words) {
        expect({ word, isDashboardWord: word in ENGLISH_LOCALE }).toEqual({
          word,
          isDashboardWord: true,
        });
      }
    },
  );

  it.each(SHOT_CASES)(
    "%s is cropped to one thing, at a window a docs column can show",
    (_name: string, shot: DocsScreen) => {
      expect(shot.crop.trim().length).toBeGreaterThan(0);
      expect(shot.crop).not.toBe("body");
      expect(shot.width).toBeGreaterThanOrEqual(375);
      expect(shot.width).toBeLessThanOrEqual(1440);
      expect(shot.height).toBeGreaterThanOrEqual(600);
      expect(shot.padding).toBeGreaterThanOrEqual(0);
      expect(shot.padding).toBeLessThanOrEqual(24);
      expect(shot.shows.length).toBeGreaterThan(10);
    },
  );

  it("walks a guided setup as one page: each step goes on from the one before it", () => {
    const byName: (name: string) => DocsScreen = (name: string) => {
      return DOCS_SCREENS.find((shot: DocsScreen): boolean => {
        return shot.name === name;
      })!;
    };

    expect(
      continuesFrom(byName("website-down-address"), byName("website-down-who")),
    ).toBe(true);
    expect(
      continuesFrom(byName("website-down-who"), byName("website-down-test")),
    ).toBe(true);
    expect(continuesFrom(byName("paging-test"), byName("paging-summary"))).toBe(
      true,
    );
    // A goal ticked on Home is not another goal's state.
    expect(
      continuesFrom(byName("home-goal-website"), byName("home-goal-paging")),
    ).toBe(false);
  });
});

describe("the fixtures the docs screens run", () => {
  const fixtures: Array<DocsScreenFixture> =
    Object.values(DOCS_SCREEN_FIXTURES);

  it("each on a port of its own, which no suite's config uses", () => {
    const ports: Array<number> = fixtures.map((fixture: DocsScreenFixture) => {
      return fixture.port;
    });
    const configs: string = fs
      .readdirSync(E2E)
      .filter((file: string): boolean => {
        return (
          file.startsWith("playwright.") &&
          file.endsWith(".ts") &&
          file !== "playwright.docs-screens.config.ts"
        );
      })
      .map((file: string): string => {
        return fs.readFileSync(path.join(E2E, file), "utf8");
      })
      .join("\n");

    expect(new Set(ports).size).toBe(ports.length);
    for (const port of ports) {
      expect({ port, taken: configs.includes(String(port)) }).toEqual({
        port,
        taken: false,
      });
    }
  });

  it.each(
    fixtures.map((fixture: DocsScreenFixture): [string, DocsScreenFixture] => {
      return [fixture.folder, fixture];
    }),
  )(
    "%s draws the languages it says it draws",
    (_folder: string, fixture: DocsScreenFixture) => {
      const folder: string = path.join(E2E, fixture.folder, "Fixture");
      const sources: string = fs
        .readdirSync(folder)
        .map((file: string): string => {
          return fs.readFileSync(path.join(folder, file), "utf8");
        })
        .join("\n");

      if (fixture.languageBy === "storage") {
        // The Dashboard's own i18n: every locale, read from where the Dashboard keeps the language.
        expect(sources).toContain("Dashboard/src/Utils/i18n");
        expect(fixture.languages).toBe("every");
      } else {
        // ?lang=, and a server that hands the page any locale it asks for.
        expect(sources).toContain('params.get("lang")');
        if (fixture.languages === "every") {
          expect(sources).toContain("/locales/");
        }
      }
      expect(Number.isNaN(Date.parse(fixture.now))).toBe(false);
      expect(fixture.projectId).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});

describe("the screenshots the docs show", () => {
  const shown: Map<string, Array<string>> = screensInDocs();

  it("are all on the shot list", () => {
    const listed: Set<string> = new Set(
      DOCS_SCREENS.map((shot: DocsScreen) => {
        return shot.name;
      }),
    );

    expect(
      Array.from(shown.keys()).filter((name: string): boolean => {
        return !listed.has(name);
      }),
    ).toEqual([]);
  });

  it("include every shot on the list, in English and in every translation of its page", () => {
    for (const shot of DOCS_SCREENS) {
      const where: Array<string> = shown.get(shot.name) || [];
      const languages: Set<string> = new Set(
        where.map((place: string): string => {
          return place.split("/")[0]!;
        }),
      );

      expect({
        shot: shot.name,
        languages: Array.from(languages).sort(),
      }).toEqual({ shot: shot.name, languages: [...DOCS_LANGUAGES].sort() });
    }
  });
});
