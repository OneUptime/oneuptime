import { describe, expect, test } from "@jest/globals";
import { DashboardPlaylistDashboard } from "Common/Types/Dashboard/DashboardPlaylist";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";
import {
  PLAYLIST_DASHBOARD_COUNT,
  PLAYLIST_SUMMARY,
  PLAYLIST_WITHOUT_DASHBOARDS,
  PlaylistEntry,
  PlaylistListedDashboard,
  PlaylistReadableDashboard,
  addPlaylistDashboard,
  formatPlaylistInterval,
  getPlaylistDashboardIds,
  getPlaylistEntries,
  getPlaylistIntervalParts,
  getPlaylistListedDashboards,
  getPlaylistSummary,
  movePlaylistDashboard,
  removePlaylistDashboard,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";

/*
 * What the playlist pages and the player make of a playlist's dashboards
 * (issue #5235): the rotation is the playlist's dashboards the viewer may
 * read and that are not archived, in its order, each as often as it is
 * named - the rest skipped; the pages list every entry, saying which are
 * archived and which the viewer cannot see; the editor's moves; and the
 * interval in the reader's words.
 */

const ANY_SPACE: RegExp = /\s/gu;

const OVERVIEW: string = "5f8b9c0d-e1a2-4b3c-8d5e-000000000001";
const CLUSTERS: string = "5f8b9c0d-e1a2-4b3c-8d5e-000000000002";
const ARCHIVED: string = "5f8b9c0d-e1a2-4b3c-8d5e-000000000003";
const PRIVATE: string = "5f8b9c0d-e1a2-4b3c-8d5e-000000000004";
const DELETED: string = "5f8b9c0d-e1a2-4b3c-8d5e-000000000005";

function entries(...ids: Array<string>): Array<DashboardPlaylistDashboard> {
  return ids.map((id: string): DashboardPlaylistDashboard => {
    return { dashboardId: id };
  });
}

// What the API answers this viewer: the private and the deleted ones are not in it.
const READABLE: Array<PlaylistReadableDashboard> = [
  { id: CLUSTERS, name: "Kubernetes clusters", isArchived: false },
  { id: OVERVIEW, name: "Production overview" },
  { id: ARCHIVED, name: "Old checkout", isArchived: true },
];

describe("the rotation", () => {
  test("plays the dashboards in the playlist's order, not the read's", () => {
    const rotation: Array<PlaylistEntry> = getPlaylistEntries({
      dashboards: entries(OVERVIEW, CLUSTERS),
      readable: READABLE,
    });

    expect(
      rotation.map((entry: PlaylistEntry): string => {
        return entry.name;
      }),
    ).toEqual(["Production overview", "Kubernetes clusters"]);
  });

  test("skips a dashboard archived, deleted, or out of the viewer's reach", () => {
    const rotation: Array<PlaylistEntry> = getPlaylistEntries({
      dashboards: entries(ARCHIVED, PRIVATE, OVERVIEW, DELETED, CLUSTERS),
      readable: READABLE,
    });

    expect(
      rotation.map((entry: PlaylistEntry): string => {
        return entry.dashboardId;
      }),
    ).toEqual([OVERVIEW, CLUSTERS]);
  });

  test("plays a dashboard as often as the playlist names it, each turn told apart", () => {
    const rotation: Array<PlaylistEntry> = getPlaylistEntries({
      dashboards: entries(OVERVIEW, CLUSTERS, OVERVIEW),
      readable: READABLE,
    });

    expect(rotation).toHaveLength(3);
    expect(rotation[0]!.dashboardId).toBe(rotation[2]!.dashboardId);
    expect(rotation[0]!.key).not.toBe(rotation[2]!.key);
    expect(
      new Set(
        rotation.map((entry: PlaylistEntry): string => {
          return entry.key;
        }),
      ).size,
    ).toBe(3);
  });

  test("a turn's key is its place in the playlist: it stays when the playlist around it does not change, and when others are skipped", () => {
    const before: Array<PlaylistEntry> = getPlaylistEntries({
      dashboards: entries(PRIVATE, OVERVIEW, CLUSTERS),
      readable: READABLE,
    });
    const after: Array<PlaylistEntry> = getPlaylistEntries({
      dashboards: entries(PRIVATE, OVERVIEW, CLUSTERS),
      readable: [...READABLE, { id: PRIVATE, name: "Finance" }],
    });

    expect(
      before.map((entry: PlaylistEntry): string => {
        return entry.key;
      }),
    ).toEqual(
      after.slice(1).map((entry: PlaylistEntry): string => {
        return entry.key;
      }),
    );
  });

  test("matches ids without regard to case, and takes the API's spelling", () => {
    const rotation: Array<PlaylistEntry> = getPlaylistEntries({
      dashboards: entries(OVERVIEW.toUpperCase()),
      readable: READABLE,
    });

    expect(rotation).toHaveLength(1);
    expect(rotation[0]!.dashboardId).toBe(OVERVIEW);
  });

  test("nothing to read, nothing to play", () => {
    expect(
      getPlaylistEntries({ dashboards: entries(OVERVIEW), readable: [] }),
    ).toEqual([]);
    expect(getPlaylistEntries({ dashboards: [], readable: READABLE })).toEqual(
      [],
    );
  });
});

describe("the ids to read", () => {
  test("each once, in the order they first appear", () => {
    expect(
      getPlaylistDashboardIds(
        entries(CLUSTERS, OVERVIEW, CLUSTERS, OVERVIEW.toUpperCase(), DELETED),
      ),
    ).toEqual([CLUSTERS, OVERVIEW, DELETED]);
  });
});

describe("the playlist as its pages list it", () => {
  test("every entry, in order: named when readable, archived ones marked, the rest unnamed", () => {
    const listed: Array<PlaylistListedDashboard> = getPlaylistListedDashboards({
      dashboards: entries(ARCHIVED, PRIVATE, OVERVIEW, DELETED),
      readable: READABLE,
    });

    expect(
      listed.map((item: PlaylistListedDashboard) => {
        return [item.name, item.isArchived];
      }),
    ).toEqual([
      ["Old checkout", true],
      [null, false],
      ["Production overview", false],
      [null, false],
    ]);
    expect(
      listed.map((item: PlaylistListedDashboard) => {
        return item.dashboardId;
      }),
    ).toEqual([ARCHIVED, PRIVATE, OVERVIEW, DELETED]);
  });

  test("keys the entries as the rotation does", () => {
    const listed: Array<PlaylistListedDashboard> = getPlaylistListedDashboards({
      dashboards: entries(OVERVIEW, OVERVIEW),
      readable: READABLE,
    });
    const rotation: Array<PlaylistEntry> = getPlaylistEntries({
      dashboards: entries(OVERVIEW, OVERVIEW),
      readable: READABLE,
    });

    expect(
      listed.map((item: PlaylistListedDashboard): string => {
        return item.key;
      }),
    ).toEqual(
      rotation.map((entry: PlaylistEntry): string => {
        return entry.key;
      }),
    );
  });
});

describe("editing the order", () => {
  const LIST: Array<DashboardPlaylistDashboard> = entries(
    OVERVIEW,
    CLUSTERS,
    ARCHIVED,
  );

  test("moves an entry up and down, without touching the list it was given", () => {
    expect(movePlaylistDashboard(LIST, 2, 1)).toEqual(
      entries(OVERVIEW, ARCHIVED, CLUSTERS),
    );
    expect(movePlaylistDashboard(LIST, 0, 1)).toEqual(
      entries(CLUSTERS, OVERVIEW, ARCHIVED),
    );
    expect(movePlaylistDashboard(LIST, 0, 2)).toEqual(
      entries(CLUSTERS, ARCHIVED, OVERVIEW),
    );
    expect(LIST).toEqual(entries(OVERVIEW, CLUSTERS, ARCHIVED));
  });

  test("a move off either end, or onto itself, changes nothing", () => {
    expect(movePlaylistDashboard(LIST, 0, -1)).toEqual(LIST);
    expect(movePlaylistDashboard(LIST, 2, 3)).toEqual(LIST);
    expect(movePlaylistDashboard(LIST, 1, 1)).toEqual(LIST);
    expect(movePlaylistDashboard(LIST, 5, 0)).toEqual(LIST);
  });

  test("removes the entry at a place - one turn of a dashboard named twice, not both", () => {
    expect(removePlaylistDashboard(LIST, 1)).toEqual(
      entries(OVERVIEW, ARCHIVED),
    );
    expect(
      removePlaylistDashboard(entries(OVERVIEW, CLUSTERS, OVERVIEW), 2),
    ).toEqual(entries(OVERVIEW, CLUSTERS));
    expect(removePlaylistDashboard(LIST, 7)).toEqual(LIST);
  });

  test("adds a dashboard at the end", () => {
    expect(addPlaylistDashboard(LIST, PRIVATE)).toEqual(
      entries(OVERVIEW, CLUSTERS, ARCHIVED, PRIVATE),
    );
    expect(LIST).toHaveLength(3);
  });
});

describe("how long each dashboard is shown, in words", () => {
  test("in hours, minutes and seconds, the larger units first", () => {
    expect(getPlaylistIntervalParts(30)).toEqual([
      { count: 30, unit: "second" },
    ]);
    expect(getPlaylistIntervalParts(60)).toEqual([
      { count: 1, unit: "minute" },
    ]);
    expect(getPlaylistIntervalParts(90)).toEqual([
      { count: 1, unit: "minute" },
      { count: 30, unit: "second" },
    ]);
    expect(getPlaylistIntervalParts(3600)).toEqual([
      { count: 1, unit: "hour" },
    ]);
    expect(getPlaylistIntervalParts(5430)).toEqual([
      { count: 1, unit: "hour" },
      { count: 30, unit: "minute" },
      { count: 30, unit: "second" },
    ]);
    expect(getPlaylistIntervalParts(0)).toEqual([{ count: 0, unit: "second" }]);
  });

  test("in English, as the form offers them", () => {
    expect(formatPlaylistInterval(15)).toBe("15 seconds");
    expect(formatPlaylistInterval(60)).toBe("1 minute");
    expect(formatPlaylistInterval(120, "en")).toBe("2 minutes");
    expect(formatPlaylistInterval(3600, "en-GB")).toBe("1 hour");
    expect(formatPlaylistInterval(90)).toBe("1 minute, 30 seconds");
    expect(formatPlaylistInterval(1)).toBe("1 second");
  });

  test("in the reader's language, with its own unit names", () => {
    // Intl puts a no-break space between a number and its unit in some languages.
    const spaced: (text: string) => string = (text: string): string => {
      return text.replace(ANY_SPACE, " ");
    };

    expect(spaced(formatPlaylistInterval(60, "de"))).toBe("1 Minute");
    expect(spaced(formatPlaylistInterval(120, "de"))).toBe("2 Minuten");
    expect(spaced(formatPlaylistInterval(30, "fr"))).toBe("30 secondes");
    expect(spaced(formatPlaylistInterval(3600, "es"))).toBe("1 hora");
  });
});

/*
 * A playlist's row in the Playlists list says what it plays in one phrase -
 * how many dashboards, and how long each is shown - so the list is two
 * columns and a Play button, and fits beside the side menu without
 * scrolling sideways (the UI review of #5235).
 */
describe("a playlist's row in the list, in one phrase", () => {
  const LOCALES_DIR: string = path.join(
    __dirname,
    "../../FeatureSet/Dashboard/src/Locales",
  );

  const readLocale: (language: string) => Record<string, string> = (
    language: string,
  ): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  };

  const translatorFor: (
    language: string,
    words?: Record<string, string>,
  ) => Translator = (
    language: string,
    words?: Record<string, string>,
  ): Translator => {
    const locale: Record<string, string> = words || readLocale(language);

    return createTranslator((key: string): string | undefined => {
      return locale[key];
    }, language);
  };

  // Intl puts a no-break space between a number and its unit in some languages.
  const spaced: (text: string) => string = (text: string): string => {
    return text.replace(ANY_SPACE, " ");
  };

  test("how many dashboards, and how long each is shown", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(
      getPlaylistSummary({
        translator: english,
        dashboardCount: 3,
        intervalInSeconds: 60,
      }),
    ).toBe("3 dashboards, 1 minute each");
    expect(
      getPlaylistSummary({
        translator: english,
        dashboardCount: 1,
        intervalInSeconds: 15,
      }),
    ).toBe("1 dashboard, 15 seconds each");
    expect(
      getPlaylistSummary({
        translator: english,
        dashboardCount: 12,
        intervalInSeconds: 90,
      }),
    ).toBe("12 dashboards, 1 minute, 30 seconds each");
  });

  test("a playlist with none yet says so, without a time nobody sees", () => {
    for (const count of [0, -1]) {
      expect(
        getPlaylistSummary({
          translator: createTranslator(undefined, "en"),
          dashboardCount: count,
          intervalInSeconds: 60,
        }),
      ).toBe("No dashboards");
    }

    expect(
      getPlaylistSummary({
        translator: translatorFor("de"),
        dashboardCount: 0,
        intervalInSeconds: 60,
      }),
    ).toBe("Keine Dashboards");
  });

  test("in the reader's language: the count, the time and the words around them", () => {
    expect(
      spaced(
        getPlaylistSummary({
          translator: translatorFor("de"),
          dashboardCount: 3,
          intervalInSeconds: 60,
        }),
      ),
    ).toBe("3 Dashboards, je 1 Minute");
    expect(
      spaced(
        getPlaylistSummary({
          translator: translatorFor("de"),
          dashboardCount: 1,
          intervalInSeconds: 30,
        }),
      ),
    ).toBe("1 Dashboard, je 30 Sekunden");
    // Persian writes its own digits, in the count and in the time.
    expect(
      spaced(
        getPlaylistSummary({
          translator: translatorFor("fa"),
          dashboardCount: 3,
          intervalInSeconds: 60,
        }),
      ),
    ).toBe("\u06F3 داشبورد، هر کدام \u06F1 دقیقه");
  });

  test("a language that has not worded the phrase reads it whole in English - its count and time too", () => {
    const halfGerman: Translator = translatorFor("de", {
      [PLAYLIST_DASHBOARD_COUNT.other]: "{{count}} Dashboards",
    });

    expect(
      getPlaylistSummary({
        translator: halfGerman,
        dashboardCount: 3,
        intervalInSeconds: 120,
      }),
    ).toBe("3 dashboards, 2 minutes each");
  });

  test("every language words the phrase, keeps both of its slots, and words a playlist with none", () => {
    const english: Record<string, string> = readLocale("en");

    expect(english[PLAYLIST_SUMMARY]).toBe(PLAYLIST_SUMMARY);
    expect(english[PLAYLIST_WITHOUT_DASHBOARDS]).toBe(
      PLAYLIST_WITHOUT_DASHBOARDS,
    );

    const languages: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json") && file !== "en.json";
      })
      .map((file: string): string => {
        return file.replace(".json", "");
      });

    expect(languages).toHaveLength(16);

    for (const language of languages) {
      const locale: Record<string, string> = readLocale(language);
      const phrase: string = locale[PLAYLIST_SUMMARY] || "";

      expect({ language, worded: phrase !== PLAYLIST_SUMMARY }).toEqual({
        language,
        worded: true,
      });
      expect({
        language,
        slots: [
          phrase.includes("{{dashboards}}"),
          phrase.includes("{{interval}}"),
        ],
      }).toEqual({ language, slots: [true, true] });
      expect({
        language,
        worded:
          (locale[PLAYLIST_WITHOUT_DASHBOARDS] ||
            PLAYLIST_WITHOUT_DASHBOARDS) !== PLAYLIST_WITHOUT_DASHBOARDS,
      }).toEqual({ language, worded: true });
    }
  });
});
