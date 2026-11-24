/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AnnouncementList from "../../../../App/FeatureSet/StatusPage/src/Pages/Announcement/List";
import IncidentDetail from "../../../../App/FeatureSet/StatusPage/src/Pages/Incidents/Detail";
import IncidentList from "../../../../App/FeatureSet/StatusPage/src/Pages/Incidents/List";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";
import ScheduledEventList from "../../../../App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/List";
import {
  HISTORY_WINDOW_WORDS,
  readHistoryInDays,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/HistoryWindow";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getStatusPageResourcesByIdPath } from "../../../Types/StatusPage/StatusPageResourcesLink";
import { PluralTemplate } from "../../../Types/Translator";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DEFAULT_STATUS_PAGE_HISTORY_IN_DAYS,
  getStatusPageHistoryInDays,
  HISTORY_IN_DAYS_RESPONSE_KEY,
} from "../../../Utils/StatusPage/HistoryWindow";

/*
 * WHAT A PUBLIC STATUS PAGE TELLS ITS VISITORS (#9122).
 *
 * - A page with no resources told every visitor "Everything looks great",
 *   under a green check, over an instruction meant for its owner. It now
 *   says it isn't showing any services yet, with no check mark, and the
 *   owner's note shows only in the Dashboard's preview.
 * - The incident, announcement and maintenance lists hold only the last N
 *   days (the page's history setting, 14 when unset) but never said so:
 *   "No Incident" under an alarm icon read as "this service has never had
 *   an incident". Each list now names its window, from the number the server
 *   read it with, in the reader's plural forms.
 * - An episode opened as an "Episode Report": the team's word. It is an
 *   incident to the people reading the page.
 *
 * The real pages and the real locale files, through a real i18next; the
 * API, the signed-in user and the page chrome are stubbed.
 */

const STATUS_PAGE_ID: string = "91220000-0000-4000-8000-000000000001";
const ITEM_ID: string = "91220000-0000-4000-8000-000000000002";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  });

function readLocale(language: string): JSONObject {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as JSONObject;
}

function nested(language: string, section: string, key: string): string {
  return (readLocale(language)[section] as JSONObject)[key] as string;
}

type PostResponse = HTTPResponse<JSONObject> | HTTPErrorResponse;

let mockRespondToPost: (url: string) => PostResponse = (): PostResponse => {
  throw new Error("mockRespondToPost was not set by the test");
};

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isLoggedIn: () => {
        return true;
      },
      logout: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (options: { url: { toString: () => string } }) => {
        return Promise.resolve(mockRespondToPost(options.url.toString()));
      },
      getDefaultHeaders: () => {
        return {};
      },
      getFriendlyMessage: (error: { message?: string }) => {
        return error?.message || "Something went wrong";
      },
    },
  };
});

// The chrome's breadcrumbs need a router; its title is all these read.
jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page",
  () => {
    return {
      __esModule: true,
      default: (props: { title?: string; children: React.ReactNode }) => {
        return (
          <div>
            <h1 data-testid="page-title">{props.title}</h1>
            {props.children}
          </div>
        );
      },
    };
  },
);

function ok(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

type PageComponent = React.FunctionComponent<{
  pageRoute: Route;
  onLoadComplete: () => void;
}>;

async function renderPage(Component: PageComponent): Promise<void> {
  await act(async () => {
    render(<Component pageRoute={new Route("/")} onLoadComplete={() => {}} />);
  });

  await act(async () => {
    await Promise.resolve();
  });
}

function emptyIncidents(days?: number): JSONObject {
  const data: JSONObject = {
    incidents: [],
    incidentPublicNotes: [],
    incidentStateTimelines: [],
    incidentStates: [],
    statusPageResources: [],
    monitorsInGroup: {},
  };

  if (days !== undefined) {
    data[HISTORY_IN_DAYS_RESPONSE_KEY] = days;
  }

  return data;
}

function noEpisodes(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    400,
    { message: "Episodes are not enabled on this status page." },
    {},
  );
}

function respondWithIncidents(data: JSONObject): void {
  mockRespondToPost = (url: string): PostResponse => {
    return url.includes("/incidents/") ? ok(data) : noEpisodes();
  };
}

function noResourcesOverview(): JSONObject {
  return {
    statusPage: {
      _id: STATUS_PAGE_ID,
      downtimeMonitorStatuses: [],
      showOverallUptimePercentOnStatusPage: false,
      showUptimeHistoryInDays: 90,
    },
    resourceGroups: [],
    statusPageResources: [],
    monitorStatuses: [],
    monitorStatusTimelines: [],
    statusPageHistoryChartBarColorRules: [],
    incidentStateTimelines: [],
    scheduledMaintenanceStateTimelines: [],
    scheduledMaintenanceStates: [],
    scheduledMaintenanceEvents: [],
    scheduledMaintenanceEventsPublicNotes: [],
    activeAnnouncements: [],
    activeIncidents: [],
    activeEpisodes: [],
    incidentPublicNotes: [],
    episodePublicNotes: [],
    episodeStateTimelines: [],
    timelineIncidents: [],
    monitorsInGroup: {},
    monitorGroupCurrentStatuses: {},
  };
}

const realNavigate: typeof Navigation.navigate = Navigation.navigate;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  localStorage.clear();
  StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
  window.history.replaceState({}, "", "/");
  Navigation.navigate = (): void => {};
});

afterEach(async () => {
  cleanup();
  Navigation.navigate = realNavigate;
  jest.clearAllMocks();
  await i18next.changeLanguage("en");
});

describe("the window a status page's lists cover", () => {
  test("is the page's history setting, 14 days when it has none", () => {
    expect(DEFAULT_STATUS_PAGE_HISTORY_IN_DAYS).toBe(14);
    expect(getStatusPageHistoryInDays(30)).toBe(30);
    expect(getStatusPageHistoryInDays(1)).toBe(1);
    expect(getStatusPageHistoryInDays(undefined)).toBe(14);
    expect(getStatusPageHistoryInDays(null)).toBe(14);
    expect(getStatusPageHistoryInDays(0)).toBe(14);
    expect(getStatusPageHistoryInDays(-3)).toBe(14);
  });

  test("is read from the list's response, 14 from a server that sends none", () => {
    expect(readHistoryInDays({ [HISTORY_IN_DAYS_RESPONSE_KEY]: 45 })).toBe(45);
    expect(readHistoryInDays({})).toBe(14);
    expect(readHistoryInDays(null)).toBe(14);
  });

  test("the server reads each list with it, and sends it with each list", () => {
    const api: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/API/StatusPageAPI.ts"),
      "utf8",
    );

    for (const field of [
      "showIncidentHistoryInDays",
      "showEpisodeHistoryInDays",
      "showAnnouncementHistoryInDays",
      "showScheduledEventHistoryInDays",
    ]) {
      expect(api).toContain(
        `getStatusPageHistoryInDays(\n      statusPage.${field},\n    )`,
      );
      expect(api).not.toContain(`statusPage.${field} || 14`);
    }

    expect(
      api.split("[HISTORY_IN_DAYS_RESPONSE_KEY]: historyInDays,").length - 1,
    ).toBe(4);
  });
});

describe("the incidents list names its window", () => {
  test("empty, it says none in the page's own number of days, under no alarm", async () => {
    respondWithIncidents(emptyIncidents(30));
    await renderPage(IncidentList as PageComponent);

    const empty: HTMLElement = document.getElementById(
      "incidents-empty-state",
    )!;

    expect(empty).toHaveTextContent("No incidents in the last 30 days");
    expect(empty).toHaveTextContent(
      "When an incident affects the services on this page, it is posted here.",
    );
    expect(empty).not.toHaveTextContent("No Incident");
  });

  test("a server that sends no window gets the 14 days it reads by default", async () => {
    respondWithIncidents(emptyIncidents());
    await renderPage(IncidentList as PageComponent);

    expect(document.getElementById("incidents-empty-state")).toHaveTextContent(
      "No incidents in the last 14 days",
    );
  });

  test("one day reads as one day", async () => {
    respondWithIncidents(emptyIncidents(1));
    await renderPage(IncidentList as PageComponent);

    expect(document.getElementById("incidents-empty-state")).toHaveTextContent(
      "No incidents in the last day",
    );
  });

  test("its resolved incidents are titled by the window", async () => {
    respondWithIncidents({
      ...emptyIncidents(7),
      incidents: [
        {
          _id: ITEM_ID,
          title: "Checkout errors",
          createdAt: {
            _type: "DateTime",
            value: "2026-11-10T10:00:00.000Z",
          },
          declaredAt: {
            _type: "DateTime",
            value: "2026-11-10T10:00:00.000Z",
          },
          currentIncidentState: {
            _id: "91220000-0000-4000-8000-000000000003",
            name: "Resolved",
            color: { _type: "Color", value: "#16a34a" },
            order: 3,
          },
          monitors: [],
        },
      ],
    });
    await renderPage(IncidentList as PageComponent);

    expect(screen.getByText("Resolved in the Last 7 Days")).toBeInTheDocument();
    expect(screen.queryByText("Resolved Incidents")).toBeNull();
  });

  test("in German, with German's plural", async () => {
    await i18next.changeLanguage("de");
    respondWithIncidents(emptyIncidents(30));
    await renderPage(IncidentList as PageComponent);

    expect(document.getElementById("incidents-empty-state")).toHaveTextContent(
      "Keine Vorfälle in den letzten 30 Tagen",
    );
  });

  test("in Persian, read right to left, in Persian digits", async () => {
    await i18next.changeLanguage("fa");
    respondWithIncidents(emptyIncidents(30));
    await renderPage(IncidentList as PageComponent);

    expect(document.getElementById("incidents-empty-state")).toHaveTextContent(
      "در ۳۰ روز گذشته حادثه‌ای نبوده است",
    );
  });
});

describe("the announcements list names its window", () => {
  test("empty, it says none in the page's own number of days", async () => {
    mockRespondToPost = (): PostResponse => {
      return ok({
        announcements: [],
        statusPageResources: [],
        monitorsInGroup: {},
        [HISTORY_IN_DAYS_RESPONSE_KEY]: 21,
      });
    };
    await renderPage(AnnouncementList as PageComponent);

    const empty: HTMLElement = document.getElementById(
      "announcements-empty-state",
    )!;

    expect(empty).toHaveTextContent("No announcements in the last 21 days");
    expect(empty).not.toHaveTextContent("No Announcement");
  });
});

describe("the maintenance list names its window", () => {
  test("empty, it says nothing is planned and none took place in the window", async () => {
    mockRespondToPost = (): PostResponse => {
      return ok({
        scheduledMaintenanceEvents: [],
        scheduledMaintenanceEventsPublicNotes: [],
        scheduledMaintenanceStateTimelines: [],
        scheduledMaintenanceStates: [],
        statusPageResources: [],
        monitorsInGroup: {},
        [HISTORY_IN_DAYS_RESPONSE_KEY]: 60,
      });
    };
    await renderPage(ScheduledEventList as PageComponent);

    const empty: HTMLElement = document.getElementById(
      "scheduled-events-empty-state",
    )!;

    expect(empty).toHaveTextContent("No maintenance planned");
    expect(empty).toHaveTextContent(
      "None is planned, and none took place in the last 60 days.",
    );
    expect(empty).not.toHaveTextContent("No Scheduled Maintenance");
  });
});

describe("an episode is an incident on the public page", () => {
  test("a missing one is an Incident Report that says the incident was not found", async () => {
    window.history.replaceState({}, "", `/incidents/${ITEM_ID}`);
    mockRespondToPost = (url: string): PostResponse => {
      if (url.includes("/incidents/")) {
        return ok(emptyIncidents());
      }

      return ok({
        episodes: [],
        episodePublicNotes: [],
        episodeStateTimelines: [],
        incidentStates: [],
        statusPageResources: [],
        monitorsInGroup: {},
      });
    };

    await renderPage(IncidentDetail as PageComponent);

    expect(screen.getByTestId("page-title")).toHaveTextContent(
      "Incident Report",
    );
    expect(document.getElementById("item-empty-state")).toHaveTextContent(
      "Incident not found",
    );
    expect(document.body).not.toHaveTextContent(/episode/i);
  });

  test("no status page language has the word left to show", () => {
    for (const language of LANGUAGES) {
      expect({ language, episodes: readLocale(language)["episodes"] }).toEqual({
        language,
        episodes: undefined,
      });
    }

    const pages: Array<string> = ["Incidents/Detail.tsx", "Incidents/List.tsx"];

    for (const page of pages) {
      const source: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/StatusPage/src/Pages",
          page,
        ),
        "utf8",
      );
      expect(source).not.toContain('t("episodes.');
    }
  });
});

describe("a status page with no resources", () => {
  test("tells a visitor it isn't showing any services yet, with no check mark and no note for its owner", async () => {
    mockRespondToPost = (): PostResponse => {
      return ok(noResourcesOverview());
    };
    await renderPage(Overview as PageComponent);

    const empty: HTMLElement = document.getElementById("overview-empty-state")!;

    expect(empty).toHaveTextContent("Nothing to show yet");
    expect(empty).toHaveTextContent(
      "This page isn't showing any services yet.",
    );
    expect(empty).not.toHaveTextContent("Everything looks great");
    expect(empty).not.toHaveTextContent(/dashboard/i);
    expect(document.getElementById("overview-empty-state-owner-note")).toBe(
      null,
    );

    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview.tsx",
      ),
      "utf8",
    );
    const emptyState: string = source.slice(
      source.indexOf('id="overview-empty-state"') - 200,
      source.indexOf('id="overview-empty-state"') + 200,
    );
    expect(emptyState).not.toContain("IconProp.CheckCircle");
  });

  test("tells its owner, in the Dashboard's preview, how to add resources", async () => {
    window.history.replaceState({}, "", `/status-page/${STATUS_PAGE_ID}/`);
    expect(StatusPageUtil.isPreviewPage()).toBe(true);
    mockRespondToPost = (): PostResponse => {
      return ok(noResourcesOverview());
    };
    await renderPage(Overview as PageComponent);

    expect(document.getElementById("overview-empty-state")).toHaveTextContent(
      "This page isn't showing any services yet.",
    );
    expect(
      document.getElementById("overview-empty-state-owner-note"),
    ).toHaveTextContent(
      "Visitors see this until you add resources. Add resources in the Dashboard",
    );
  });
});

/*
 * The owner's note links to the page's Resources in the Dashboard (#9180).
 * The preview knows the page's id and no project - the public overview
 * hands out none - so it links to the Dashboard's address for the page by
 * its id alone (Common/Types/StatusPage/StatusPageResourcesLink), on the
 * host it is served from, and the Dashboard opens the page in its project
 * (OpenStatusPageResources).
 */
describe("the owner's note in the preview links to the page's Resources", () => {
  function link(): HTMLAnchorElement | null {
    return document.getElementById(
      "overview-empty-state-resources-link",
    ) as HTMLAnchorElement | null;
  }

  async function renderPreview(): Promise<void> {
    window.history.replaceState({}, "", `/status-page/${STATUS_PAGE_ID}/`);
    mockRespondToPost = (): PostResponse => {
      return ok(noResourcesOverview());
    };
    await renderPage(Overview as PageComponent);
  }

  test("by the page's id alone, under the Dashboard on the preview's own host", async () => {
    await renderPreview();

    expect(link()).not.toBeNull();
    expect(link()!.tagName).toBe("A");
    expect(link()!.getAttribute("href")).toBe(
      `${window.location.protocol}//${window.location.host}/dashboard${getStatusPageResourcesByIdPath(STATUS_PAGE_ID)}`,
    );
    expect(link()!.getAttribute("href")).toContain(
      `/dashboard/status-pages/${STATUS_PAGE_ID}/resources`,
    );
    // It opens the Dashboard in place of the preview, as any link does.
    expect(link()!.getAttribute("target")).toBeNull();
    expect(link()).toHaveTextContent("Add resources in the Dashboard");
  });

  test("the link is inside the note, after its sentence", async () => {
    await renderPreview();

    const note: HTMLElement = document.getElementById(
      "overview-empty-state-owner-note",
    )!;

    expect(note.contains(link())).toBe(true);
    expect(note.textContent).toBe(
      "Visitors see this until you add resources. Add resources in the Dashboard",
    );
  });

  test("in the reader's language, to the same address", async () => {
    await i18next.changeLanguage("de");
    await renderPreview();

    expect(link()).toHaveTextContent("Ressourcen im Dashboard hinzufügen");
    expect(
      document.getElementById("overview-empty-state-owner-note"),
    ).toHaveTextContent(
      "Besucher sehen diesen Hinweis, bis Sie Ressourcen hinzufügen.",
    );
    expect(link()!.getAttribute("href")).toContain(
      `/dashboard/status-pages/${STATUS_PAGE_ID}/resources`,
    );
  });

  test("is never shown to a visitor of the page itself", async () => {
    mockRespondToPost = (): PostResponse => {
      return ok(noResourcesOverview());
    };
    await renderPage(Overview as PageComponent);

    expect(StatusPageUtil.isPreviewPage()).toBe(false);
    expect(link()).toBeNull();
    expect(document.body).not.toHaveTextContent(
      "Add resources in the Dashboard",
    );
  });

  test("names no project: the public overview hands out none", async () => {
    await renderPreview();

    expect(link()!.getAttribute("href")).not.toMatch(
      /\/dashboard\/[0-9a-f-]{36}\/status-pages/,
    );
  });
});

describe("every status page language words all of it", () => {
  const NESTED: Array<[string, string]> = [
    ["overview", "noResourcesTitle"],
    ["overview", "noResourcesDescription"],
    ["overview", "noResourcesPreviewDescription"],
    ["overview", "noResourcesPreviewLink"],
    ["incidents", "notFoundTitle"],
    ["incidents", "noneDescription"],
    ["incidents", "notFound"],
    ["announcements", "notFoundTitle"],
    ["announcements", "noneDescription"],
    ["announcements", "notFound"],
    ["scheduledEvents", "none"],
  ];

  const RETIRED: Array<[string, string]> = [
    ["overview", "allClearTitle"],
    ["overview", "allClearDescription"],
    ["incidents", "none"],
    ["incidents", "resolved"],
    ["announcements", "none"],
    ["announcements", "past"],
    ["scheduledEvents", "completed"],
    ["scheduledEvents", "noneDescription"],
  ];

  test("there are the eighteen languages the status page speaks", () => {
    expect(LANGUAGES.length).toBe(18);
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )("%s", (language: string) => {
    const locale: JSONObject = readLocale(language);

    for (const [section, key] of NESTED) {
      const words: string = nested(language, section, key);
      expect({ section, key, type: typeof words }).toEqual({
        section,
        key,
        type: "string",
      });
      expect({
        section,
        key,
        same: words === nested("en", section, key),
      }).toEqual({ section, key, same: false });
    }

    for (const [section, key] of RETIRED) {
      expect({
        section,
        key,
        kept: key in (locale[section] as JSONObject),
      }).toEqual({ section, key, kept: false });
    }

    for (const template of Object.values(HISTORY_WINDOW_WORDS)) {
      const plural: PluralTemplate = template as PluralTemplate;
      const general: unknown = locale[plural.other];
      const one: unknown = locale[`${plural.other}_one`];

      expect({ key: plural.other, type: typeof general }).toEqual({
        key: plural.other,
        type: "string",
      });
      expect({ key: plural.other, type: typeof one }).toEqual({
        key: plural.other,
        type: "string",
      });
      expect(general as string).toContain("{{count}}");
      expect({ key: plural.other, same: general === plural.other }).toEqual({
        key: plural.other,
        same: false,
      });
    }
  });

  test("English holds each window's two forms", () => {
    const en: JSONObject = readLocale("en");

    for (const template of Object.values(HISTORY_WINDOW_WORDS)) {
      const plural: PluralTemplate = template as PluralTemplate;
      expect(en[plural.other]).toBe(plural.other);
      expect(en[`${plural.other}_one`]).toBe(plural.one);
    }
  });
});
