/**
 * @timezone UTC
 */
import { MemoryRouter, Link as RouterLink } from "react-router-dom";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
import IncidentDetail from "../../../../App/FeatureSet/StatusPage/src/Pages/Incidents/Detail";
import IncidentList from "../../../../App/FeatureSet/StatusPage/src/Pages/Incidents/List";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";
import { RELATED_INCIDENTS_WORDS } from "../../../../App/FeatureSet/StatusPage/src/Utils/IncidentGrouping";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { EVENT_PART_OF } from "../../../UI/Components/EventItem/EventItem";

/*
 * SMART INCIDENT GROUPING, AS A VISITOR SEES IT (#10767).
 *
 * The real Incidents tab, overview and incident pages, with the real locale
 * files through a real i18next; only the API, the signed-in user and the
 * page chrome are stubbed. On a page that groups incidents by episode:
 *
 *   - one incident in no episode is a card of its own;
 *   - an episode is one card: what happened, what it affects by the page's
 *     names for its resources, and its incidents - "3 related incidents" -
 *     folded until opened, each a row that opens the incident's page;
 *   - an incident's page says which episode it is part of, and an episode's
 *     page shows its incidents open.
 *
 * A page that does not group keeps what it shows; a page that shows
 * episodes only lists them in the uptime history's day details, where it
 * said "No incidents".
 */

const STATUS_PAGE_ID: string = "10767000-0000-4000-8000-000000000001";

const WEBSITE_MONITOR: string = "10767000-0000-4000-8000-0000000000a1";
const API_MONITOR: string = "10767000-0000-4000-8000-0000000000a2";
const DATABASE_MONITOR: string = "10767000-0000-4000-8000-0000000000a3";

const LONE: string = "10767000-0000-4000-8000-0000000000b1";
const OUTAGE_WEBSITE: string = "10767000-0000-4000-8000-0000000000b2";
const OUTAGE_API: string = "10767000-0000-4000-8000-0000000000b3";
const OUTAGE_DATABASE: string = "10767000-0000-4000-8000-0000000000b4";

const OUTAGE: string = "10767000-0000-4000-8000-0000000000e1";

const INVESTIGATING_STATE_ID: string = "10767000-0000-4000-8000-0000000000c1";
const RESOLVED_STATE_ID: string = "10767000-0000-4000-8000-0000000000c3";
const OPERATIONAL_STATUS_ID: string = "10767000-0000-4000-8000-0000000000d1";

const NOW: Date = new Date("2026-11-24T15:30:00.000Z");

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
  })
  .sort();

function readLocale(language: string): JSONObject {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as JSONObject;
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
      refreshSession: () => {
        return Promise.resolve(true);
      },
    },
  };
});

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

function refused(message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(400, { message: message }, {});
}

function dateTime(value: Date): JSONObject {
  return { _type: "DateTime", value: value.toISOString() };
}

function color(value: string): JSONObject {
  return { _type: "Color", value: value };
}

function objectId(value: string): JSONObject {
  return { _type: "ObjectID", value: value };
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

const INVESTIGATING: JSONObject = {
  _id: INVESTIGATING_STATE_ID,
  name: "Investigating",
  color: color("#f59e0b"),
  order: 1,
};

const RESOLVED: JSONObject = {
  _id: RESOLVED_STATE_ID,
  name: "Resolved",
  color: color("#16a34a"),
  order: 3,
  isResolvedState: true,
};

const SEVERITY: JSONObject = {
  name: "Major Incident",
  color: color("#ef4444"),
};

function incidentJson(data: {
  id: string;
  title: string;
  hoursAgo: number;
  monitorId: string;
  state?: JSONObject | undefined;
}): JSONObject {
  return {
    _id: data.id,
    title: data.title,
    description: `${data.title}: what we know`,
    declaredAt: dateTime(hoursAgo(data.hoursAgo)),
    createdAt: dateTime(hoursAgo(data.hoursAgo)),
    currentIncidentState: data.state || INVESTIGATING,
    incidentSeverity: SEVERITY,
    monitors: [{ _id: data.monitorId }],
  };
}

const LONE_INCIDENT: JSONObject = incidentJson({
  id: LONE,
  title: "Search is slow",
  hoursAgo: 9,
  monitorId: WEBSITE_MONITOR,
});

const OUTAGE_INCIDENTS: Array<JSONObject> = [
  incidentJson({
    id: OUTAGE_DATABASE,
    title: "Database Monitor Outage",
    hoursAgo: 7.8,
    monitorId: DATABASE_MONITOR,
  }),
  incidentJson({
    id: OUTAGE_API,
    title: "API Monitor Outage",
    hoursAgo: 7.9,
    monitorId: API_MONITOR,
    state: RESOLVED,
  }),
  incidentJson({
    id: OUTAGE_WEBSITE,
    title: "Website Monitor Outage",
    hoursAgo: 8,
    monitorId: WEBSITE_MONITOR,
  }),
];

function episodeJson(data: {
  incidents?: Array<JSONObject> | undefined;
}): JSONObject {
  return {
    _id: OUTAGE,
    title: "Infrastructure Outage",
    description: "Several services are failing to respond.",
    declaredAt: dateTime(hoursAgo(8.1)),
    createdAt: dateTime(hoursAgo(8.1)),
    currentIncidentState: INVESTIGATING,
    incidentSeverity: SEVERITY,
    monitors: [
      { _id: WEBSITE_MONITOR },
      { _id: API_MONITOR },
      { _id: DATABASE_MONITOR },
    ],
    ...(data.incidents ? { incidents: data.incidents } : {}),
  };
}

function resourceJson(data: {
  id: string;
  name: string;
  monitorId: string;
  order: number;
}): JSONObject {
  return {
    _id: data.id,
    displayName: data.name,
    showCurrentStatus: true,
    showUptimePercent: false,
    showStatusHistoryChart: true,
    order: data.order,
    monitorId: objectId(data.monitorId),
    monitor: {
      _id: data.monitorId,
      currentMonitorStatusId: objectId(OPERATIONAL_STATUS_ID),
    },
  };
}

// The page's names for its resources, never the monitors' own names.
const RESOURCES: JSONArray = [
  resourceJson({
    id: "10767000-0000-4000-8000-0000000000f1",
    name: "Storefront",
    monitorId: WEBSITE_MONITOR,
    order: 1,
  }),
  resourceJson({
    id: "10767000-0000-4000-8000-0000000000f2",
    name: "Public API",
    monitorId: API_MONITOR,
    order: 2,
  }),
  resourceJson({
    id: "10767000-0000-4000-8000-0000000000f3",
    name: "Orders database",
    monitorId: DATABASE_MONITOR,
    order: 3,
  }),
];

function incidentsAnswer(mode: string | undefined): JSONObject {
  return {
    ...(mode ? { incidentListMode: mode } : {}),
    historyInDays: 14,
    incidents: [LONE_INCIDENT, ...OUTAGE_INCIDENTS],
    incidentPublicNotes: [],
    incidentStateTimelines: [],
    incidentStates: [INVESTIGATING, RESOLVED],
    statusPageResources: RESOURCES,
    monitorsInGroup: {},
  };
}

function episodesAnswer(
  mode: string | undefined,
  episodes: JSONArray,
): JSONObject {
  return {
    ...(mode ? { incidentListMode: mode } : {}),
    historyInDays: 14,
    episodes: episodes,
    episodePublicNotes: [],
    episodeStateTimelines: [],
    incidentStates: [INVESTIGATING, RESOLVED],
    statusPageResources: RESOURCES,
    monitorsInGroup: {},
  };
}

// What the Incidents tab reads, for a page in each mode.
function respondForMode(mode: string | undefined): void {
  mockRespondToPost = (url: string): PostResponse => {
    if (url.includes("/incidents/")) {
      return mode === "EpisodesOnly"
        ? refused("Incidents are not enabled on this status page.")
        : ok(incidentsAnswer(mode));
    }

    if (url.includes("/episodes/")) {
      if (mode === "IncidentsOnly") {
        return refused("Episodes are not enabled on this status page.");
      }

      /*
       * As the server answers: an episode carries its incidents while the
       * page shows both lists, grouped or not (#9181).
       */
      return ok(
        episodesAnswer(mode, [
          episodeJson({
            incidents:
              mode === "GroupedByEpisode" || mode === "Separate"
                ? OUTAGE_INCIDENTS
                : undefined,
          }),
        ]),
      );
    }

    throw new Error(`Unexpected read: ${url}`);
  };
}

test("changing incident categories in the same tab reloads the filtered list", async () => {
  const categoryId: string = ObjectID.generate().toString();
  const seen: Array<string> = [];
  mockRespondToPost = (url: string): PostResponse => {
    seen.push(url);
    if (url.includes("/episodes/")) {
      return ok(episodesAnswer("Separate", []));
    }

    return ok({
      ...incidentsAnswer("Separate"),
      incidentCategories: [
        {
          _id: categoryId,
          publicName: "Security advisories",
          publicDescription: "Updates about vulnerabilities.",
        },
      ],
    });
  };

  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/incidents"]}>
        <RouterLink to={`/incidents?category=${categoryId}`}>
          Advisories
        </RouterLink>
        <IncidentList
          pageRoute={new Route("/incidents")}
          onLoadComplete={() => {}}
        />
      </MemoryRouter>,
    );
  });
  expect(screen.queryByText("Updates about vulnerabilities.")).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Advisories" }));
  });
  expect(seen.at(-1)).toContain(`?category=${categoryId}`);
  expect(screen.getByText("Updates about vulnerabilities.")).toBeVisible();
});

type PageComponent = React.FunctionComponent<{
  pageRoute: Route;
  onLoadComplete: () => void;
}>;

async function renderPage(Component: PageComponent): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <Component pageRoute={new Route("/")} onLoadComplete={() => {}} />
      </MemoryRouter>,
    );
  });

  await act(async () => {
    await Promise.resolve();
  });
}

// The cards' titles, in the order drawn.
function cardTitles(): Array<string> {
  return Array.from(
    document.querySelectorAll(".active-event-box-body-title"),
  ).map((title: Element): string => {
    return (title.textContent || "").trim();
  });
}

// The card a title heads.
function cardOf(title: string): HTMLElement {
  const heading: Element | undefined = Array.from(
    document.querySelectorAll(".active-event-box-body-title"),
  ).find((candidate: Element): boolean => {
    return (candidate.textContent || "").trim() === title;
  });

  if (!heading) {
    throw new Error(`No card is titled ${title}`);
  }

  return heading.closest(".shadow") as HTMLElement;
}

function relatedTitles(card: HTMLElement): Array<string> {
  return within(card)
    .queryAllByTestId("event-item-related-event-title")
    .map((title: HTMLElement): string => {
      return (title.textContent || "").trim();
    });
}

let navigated: Array<string> = [];
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
  navigated = [];
  localStorage.clear();
  StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
  window.history.replaceState({}, "", "/");
  Navigation.navigate = (route: unknown): void => {
    navigated.push(String(route));
  };
});

afterEach(async () => {
  cleanup();
  Navigation.navigate = realNavigate;
  jest.useRealTimers();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

describe("the Incidents tab, grouped by episode", () => {
  test("an episode of three is one card, and the incident of no episode keeps its own: a mix", async () => {
    respondForMode("GroupedByEpisode");
    await renderPage(IncidentList as PageComponent);

    expect(cardTitles()).toEqual(["Infrastructure Outage", "Search is slow"]);
  });

  test("its incidents are folded until opened, under how many there are", async () => {
    respondForMode("GroupedByEpisode");
    await renderPage(IncidentList as PageComponent);

    const card: HTMLElement = cardOf("Infrastructure Outage");
    const toggle: HTMLElement = within(card).getByTestId(
      "event-item-related-events-toggle",
    );

    expect(toggle).toHaveTextContent("3 related incidents");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.tagName).toBe("BUTTON");
    expect(relatedTitles(card)).toEqual([]);

    // None of them is a card of its own either.
    expect(screen.queryByText("Website Monitor Outage")).toBeNull();
  });

  test("opened, each incident is a row with its state, opening its own page", async () => {
    respondForMode("GroupedByEpisode");
    await renderPage(IncidentList as PageComponent);

    const card: HTMLElement = cardOf("Infrastructure Outage");
    const toggle: HTMLElement = within(card).getByTestId(
      "event-item-related-events-toggle",
    );

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute(
      "aria-controls",
      within(card).getByTestId("event-item-related-events-list").id,
    );
    expect(relatedTitles(card)).toEqual([
      "Database Monitor Outage",
      "API Monitor Outage",
      "Website Monitor Outage",
    ]);

    const rows: Array<HTMLElement> = within(card).getAllByTestId(
      "event-item-related-event",
    );

    expect(
      rows.map((row: HTMLElement): string => {
        return (
          within(row).getByTestId("event-item-related-event-status")
            .textContent || ""
        ).trim();
      }),
    ).toEqual(["Investigating", "Resolved", "Investigating"]);

    const links: Array<HTMLElement> = within(card).getAllByTestId(
      "event-item-related-event-link",
    );

    expect(
      links.map((link: HTMLElement): string => {
        return link.getAttribute("href") || "";
      }),
    ).toEqual([
      `/incidents/${OUTAGE_DATABASE}`,
      `/incidents/${OUTAGE_API}`,
      `/incidents/${OUTAGE_WEBSITE}`,
    ]);

    // When each was declared, in the page's words.
    expect(
      within(rows[0]!).getByTestId("event-item-related-event-detail"),
    ).toHaveTextContent(/^Declared at /);

    // Closed again, they fold away.
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(relatedTitles(card)).toEqual([]);
  });

  test("the episode card names what it affects by the page's names for its resources", async () => {
    respondForMode("GroupedByEpisode");
    await renderPage(IncidentList as PageComponent);

    const card: HTMLElement = cardOf("Infrastructure Outage");

    for (const name of ["Storefront", "Public API", "Orders database"]) {
      expect(within(card).getByText(name)).toBeInTheDocument();
    }
  });

  test("one incident in no episode is a normal card, with no fold", async () => {
    respondForMode("GroupedByEpisode");
    await renderPage(IncidentList as PageComponent);

    const card: HTMLElement = cardOf("Search is slow");

    expect(
      within(card).queryByTestId("event-item-related-events-toggle"),
    ).toBeNull();
    expect(within(card).getByText("Storefront")).toBeInTheDocument();
  });

  test("an episode that lists no incident, its incidents all hidden, is not drawn", async () => {
    mockRespondToPost = (url: string): PostResponse => {
      if (url.includes("/incidents/")) {
        return ok({ ...incidentsAnswer("GroupedByEpisode"), incidents: [] });
      }

      return ok(
        episodesAnswer("GroupedByEpisode", [episodeJson({ incidents: [] })]),
      );
    };

    await renderPage(IncidentList as PageComponent);

    expect(cardTitles()).toEqual([]);
    expect(document.getElementById("incidents-empty-state")).not.toBeNull();
  });

  test("an incident whose episode the page does not show keeps a card of its own", async () => {
    mockRespondToPost = (url: string): PostResponse => {
      return url.includes("/incidents/")
        ? ok(incidentsAnswer("GroupedByEpisode"))
        : ok(episodesAnswer("GroupedByEpisode", []));
    };

    await renderPage(IncidentList as PageComponent);

    expect(cardTitles().sort()).toEqual(
      [
        "Search is slow",
        "Database Monitor Outage",
        "API Monitor Outage",
        "Website Monitor Outage",
      ].sort(),
    );
  });
});

describe("the Incidents tab of a page that does not group keeps what it shows", () => {
  test("separate: a card for every incident and another for the episode, whose card lists none though the answer carries them", async () => {
    respondForMode("Separate");
    await renderPage(IncidentList as PageComponent);

    expect(cardTitles().sort()).toEqual(
      [
        "Infrastructure Outage",
        "Search is slow",
        "Database Monitor Outage",
        "API Monitor Outage",
        "Website Monitor Outage",
      ].sort(),
    );
    expect(
      within(cardOf("Infrastructure Outage")).queryByTestId(
        "event-item-related-events-toggle",
      ),
    ).toBeNull();
  });

  test("an older server that names no mode lists both, each on its own", async () => {
    respondForMode(undefined);
    await renderPage(IncidentList as PageComponent);

    expect(cardTitles()).toHaveLength(5);
  });

  /*
   * A page that shows episodes but not incidents has no Incidents tab (the
   * nav offers it only while incidents are shown), as before; its address
   * says incidents are off. Its episodes are on the overview, and in the
   * uptime history's day details (below).
   */
  test("episodes only: the tab is not the page's, and its address says so, as before", async () => {
    respondForMode("EpisodesOnly");
    await renderPage(IncidentList as PageComponent);

    expect(cardTitles()).toEqual([]);
    expect(
      screen.getByText("Incidents are not enabled on this status page."),
    ).toBeInTheDocument();
  });

  test("incidents only: a card for every incident and none for the episode", async () => {
    respondForMode("IncidentsOnly");
    await renderPage(IncidentList as PageComponent);

    expect(cardTitles()).toHaveLength(4);
    expect(cardTitles()).not.toContain("Infrastructure Outage");
  });
});

describe("an incident's own page and an episode's", () => {
  test("grouped, an incident's page says which episode it is part of, linking to it", async () => {
    window.history.replaceState({}, "", `/incidents/${OUTAGE_API}`);

    mockRespondToPost = (): PostResponse => {
      return ok({
        ...incidentsAnswer("GroupedByEpisode"),
        incidents: [OUTAGE_INCIDENTS[1]!],
        partOfEpisodes: [{ _id: OUTAGE, title: "Infrastructure Outage" }],
      });
    };

    await renderPage(IncidentDetail as PageComponent);

    const partOf: HTMLElement = screen.getByTestId("event-item-part-of");

    expect(partOf).toHaveTextContent("Part of Infrastructure Outage");
    expect(screen.getByTestId("event-item-part-of-link")).toHaveAttribute(
      "href",
      `/incidents/${OUTAGE}`,
    );
  });

  test("an incident in no episode says nothing of one", async () => {
    window.history.replaceState({}, "", `/incidents/${LONE}`);

    mockRespondToPost = (): PostResponse => {
      return ok({
        ...incidentsAnswer("GroupedByEpisode"),
        incidents: [LONE_INCIDENT],
        partOfEpisodes: [],
      });
    };

    await renderPage(IncidentDetail as PageComponent);

    expect(cardTitles()).toEqual(["Search is slow"]);
    expect(screen.queryByTestId("event-item-part-of")).toBeNull();
  });

  test("grouped, an episode's own page shows its incidents open", async () => {
    window.history.replaceState({}, "", `/incidents/${OUTAGE}`);

    mockRespondToPost = (url: string): PostResponse => {
      if (url.includes("/incidents/")) {
        // Not an incident: the page looks the id up as an episode next.
        return ok({ ...incidentsAnswer("GroupedByEpisode"), incidents: [] });
      }

      return ok(
        episodesAnswer("GroupedByEpisode", [
          episodeJson({ incidents: OUTAGE_INCIDENTS }),
        ]),
      );
    };

    await renderPage(IncidentDetail as PageComponent);

    const card: HTMLElement = cardOf("Infrastructure Outage");

    expect(
      within(card).getByTestId("event-item-related-events-toggle"),
    ).toHaveAttribute("aria-expanded", "true");
    expect(relatedTitles(card)).toEqual([
      "Database Monitor Outage",
      "API Monitor Outage",
      "Website Monitor Outage",
    ]);
  });

  /*
   * #9181: not grouped, an episode's own page lists the incidents it groups
   * all the same, each opening its own page - and each of those names the
   * episode back.
   */
  test("separate, an episode's own page lists the incidents it groups, open, each opening its page", async () => {
    window.history.replaceState({}, "", `/incidents/${OUTAGE}`);

    mockRespondToPost = (url: string): PostResponse => {
      if (url.includes("/incidents/")) {
        return ok({ ...incidentsAnswer("Separate"), incidents: [] });
      }

      return ok(
        episodesAnswer("Separate", [
          episodeJson({ incidents: OUTAGE_INCIDENTS }),
        ]),
      );
    };

    await renderPage(IncidentDetail as PageComponent);

    const card: HTMLElement = cardOf("Infrastructure Outage");

    expect(
      within(card).getByTestId("event-item-related-events-toggle"),
    ).toHaveAttribute("aria-expanded", "true");
    expect(relatedTitles(card)).toEqual([
      "Database Monitor Outage",
      "API Monitor Outage",
      "Website Monitor Outage",
    ]);
    expect(
      within(card)
        .getAllByTestId("event-item-related-event-link")
        .map((link: HTMLElement): string | null => {
          return link.getAttribute("href");
        }),
    ).toEqual([
      `/incidents/${OUTAGE_DATABASE}`,
      `/incidents/${OUTAGE_API}`,
      `/incidents/${OUTAGE_WEBSITE}`,
    ]);
  });

  test("separate, an incident's page names its episode too", async () => {
    window.history.replaceState({}, "", `/incidents/${OUTAGE_API}`);

    mockRespondToPost = (): PostResponse => {
      return ok({
        ...incidentsAnswer("Separate"),
        incidents: [OUTAGE_INCIDENTS[1]!],
        partOfEpisodes: [{ _id: OUTAGE, title: "Infrastructure Outage" }],
      });
    };

    await renderPage(IncidentDetail as PageComponent);

    expect(screen.getByTestId("event-item-part-of")).toHaveTextContent(
      "Part of Infrastructure Outage",
    );
  });

  test("episodes only, an episode's own page names no incident", async () => {
    window.history.replaceState({}, "", `/incidents/${OUTAGE}`);

    mockRespondToPost = (url: string): PostResponse => {
      if (url.includes("/incidents/")) {
        return refused("Incidents are not enabled on this status page.");
      }

      return ok(episodesAnswer("EpisodesOnly", [episodeJson({})]));
    };

    await renderPage(IncidentDetail as PageComponent);

    const card: HTMLElement = cardOf("Infrastructure Outage");

    expect(within(card).queryByTestId("event-item-related-events")).toBeNull();
    expect(card).not.toHaveTextContent("Website Monitor Outage");
  });
});

function overviewAnswer(data: {
  mode: string;
  activeIncidents: JSONArray;
  activeEpisodes: JSONArray;
  timelineEpisodes?: JSONArray | undefined;
}): JSONObject {
  return {
    incidentListMode: data.mode,
    statusPage: {
      _id: STATUS_PAGE_ID,
      defaultBarColor: color("#16a34a"),
      downtimeMonitorStatuses: [],
      showOverallUptimePercentOnStatusPage: false,
      showUptimeHistoryInDays: 10,
    },
    resourceGroups: [],
    statusPageResources: RESOURCES,
    monitorStatuses: [
      {
        _id: OPERATIONAL_STATUS_ID,
        name: "Operational",
        color: color("#16a34a"),
        priority: 1,
        isOperationalState: true,
      },
    ],
    monitorStatusTimelines: [],
    statusPageHistoryChartBarColorRules: [],
    incidentStateTimelines: [],
    scheduledMaintenanceStateTimelines: [],
    scheduledMaintenanceStates: [],
    scheduledMaintenanceEvents: [],
    scheduledMaintenanceEventsPublicNotes: [],
    activeAnnouncements: [],
    activeIncidents: data.activeIncidents,
    activeEpisodes: data.activeEpisodes,
    incidentPublicNotes: [],
    episodePublicNotes: [],
    episodeStateTimelines: [],
    incidentStates: [INVESTIGATING, RESOLVED],
    timelineIncidents: [],
    timelineEpisodes: data.timelineEpisodes || [],
    monitorsInGroup: {},
    monitorGroupCurrentStatuses: {},
    overallStatus: {
      _id: OPERATIONAL_STATUS_ID,
      name: "Operational",
      color: color("#16a34a"),
      priority: 1,
      isOperationalState: true,
    },
  };
}

function barOn(strip: HTMLElement, label: string): HTMLElement {
  const bar: HTMLElement | undefined = within(strip)
    .getAllByTestId("uptime-bar")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.getAttribute("aria-label") || "").startsWith(
        `${label}:`,
      );
    });

  if (!bar) {
    throw new Error(`No bar is labelled ${label}`);
  }

  return bar;
}

describe("the overview", () => {
  test("grouped, its active incidents are the episode's card, folded, and the incident of no episode", async () => {
    mockRespondToPost = (): PostResponse => {
      return ok(
        overviewAnswer({
          mode: "GroupedByEpisode",
          activeIncidents: [LONE_INCIDENT, ...OUTAGE_INCIDENTS],
          activeEpisodes: [episodeJson({ incidents: OUTAGE_INCIDENTS })],
        }),
      );
    };

    await renderPage(Overview as PageComponent);

    const list: HTMLElement = document.getElementById("incidents-list")!;

    expect(list).not.toBeNull();
    // Newest first: the episode was declared after the lone incident.
    expect(cardTitles()).toEqual(["Infrastructure Outage", "Search is slow"]);
    expect(
      within(cardOf("Infrastructure Outage")).getByTestId(
        "event-item-related-events-toggle",
      ),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("separate, it lists every active incident and then the episode, as before", async () => {
    mockRespondToPost = (): PostResponse => {
      return ok(
        overviewAnswer({
          mode: "Separate",
          activeIncidents: [LONE_INCIDENT, ...OUTAGE_INCIDENTS],
          activeEpisodes: [episodeJson({})],
        }),
      );
    };

    await renderPage(Overview as PageComponent);

    expect(cardTitles()).toEqual([
      "Search is slow",
      "Database Monitor Outage",
      "API Monitor Outage",
      "Website Monitor Outage",
      "Infrastructure Outage",
    ]);
  });

  test('a page of episodes only lists, in a day\'s details, the episode behind each incident of the day: no more "No incidents"', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    const declared: Date = new Date("2026-11-23T09:00:00.000Z");

    mockRespondToPost = (): PostResponse => {
      return ok(
        overviewAnswer({
          mode: "EpisodesOnly",
          activeIncidents: [],
          activeEpisodes: [episodeJson({})],
          timelineEpisodes: [
            {
              _id: OUTAGE,
              title: "Infrastructure Outage",
              declaredAt: dateTime(declared),
              currentIncidentState: INVESTIGATING,
              incidentSeverity: SEVERITY,
              incidents: [
                // Two of its incidents that day on the storefront: one row.
                {
                  declaredAt: dateTime(declared),
                  monitors: [{ _id: WEBSITE_MONITOR }],
                },
                {
                  declaredAt: dateTime(new Date("2026-11-23T10:00:00.000Z")),
                  monitors: [{ _id: WEBSITE_MONITOR }],
                },
                {
                  declaredAt: dateTime(declared),
                  monitors: [{ _id: API_MONITOR }],
                },
              ],
            },
          ],
        }),
      );
    };

    await renderPage(Overview as PageComponent);

    const strips: Array<HTMLElement> =
      screen.getAllByTestId("day-uptime-graph");

    // The storefront's strip: the day names one incident, the episode.
    const bar: HTMLElement = barOn(strips[0]!, "Nov 23, 2026");

    expect(bar.getAttribute("aria-label")).toContain("1 incidents");

    fireEvent.click(bar);

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(within(dialog).queryByText("No incidents")).toBeNull();
    expect(
      within(dialog).getAllByTestId("uptime-day-incident-item"),
    ).toHaveLength(1);
    expect(
      within(dialog).getByTestId("uptime-day-incident-item"),
    ).toHaveTextContent("Infrastructure Outage");

    fireEvent.click(
      within(dialog).getByRole("button", { name: /Infrastructure Outage/ }),
    );

    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toContain(`/incidents/${OUTAGE}`);

    // The database had none of its incidents: nothing there that day.
    expect(
      barOn(strips[2]!, "Nov 23, 2026").getAttribute("aria-label"),
    ).not.toContain("incidents");
  });
});

describe("in the reader's language", () => {
  test("German: the fold and the part of line read in German", async () => {
    await i18next.changeLanguage("de");

    respondForMode("GroupedByEpisode");
    await renderPage(IncidentList as PageComponent);

    expect(
      within(cardOf("Infrastructure Outage")).getByTestId(
        "event-item-related-events-toggle",
      ),
    ).toHaveTextContent("3 zugehörige Vorfälle");
  });

  test("Arabic, read right to left: the fold reads in Arabic", async () => {
    await i18next.changeLanguage("ar");

    respondForMode("GroupedByEpisode");
    await renderPage(IncidentList as PageComponent);

    expect(
      within(cardOf("Infrastructure Outage")).getByTestId(
        "event-item-related-events-toggle",
      ),
    ).toHaveTextContent("الحوادث ذات الصلة: 3");
  });

  test("German: an incident's page says which episode it is part of in German", async () => {
    await i18next.changeLanguage("de");
    window.history.replaceState({}, "", `/incidents/${OUTAGE_API}`);

    mockRespondToPost = (): PostResponse => {
      return ok({
        ...incidentsAnswer("GroupedByEpisode"),
        incidents: [OUTAGE_INCIDENTS[1]!],
        partOfEpisodes: [{ _id: OUTAGE, title: "Infrastructure Outage" }],
      });
    };

    await renderPage(IncidentDetail as PageComponent);

    expect(screen.getByTestId("event-item-part-of")).toHaveTextContent(
      "Teil von Infrastructure Outage",
    );
  });

  test.each(LANGUAGES)(
    "%s has the fold's words in both forms, and the part of sentence, keeping their values",
    (language: string) => {
      const words: JSONObject = readLocale(language);
      const many: unknown = words[RELATED_INCIDENTS_WORDS.other];
      const one: unknown = words[`${RELATED_INCIDENTS_WORDS.other}_one`];
      const partOf: unknown = words[EVENT_PART_OF];

      expect(typeof many).toBe("string");
      expect(typeof one).toBe("string");
      expect(typeof partOf).toBe("string");
      expect(many as string).toContain("{{count}}");
      expect(partOf as string).toContain("{{incident}}");

      if (language === "en") {
        expect(many).toBe(RELATED_INCIDENTS_WORDS.other);
        expect(one).toBe(RELATED_INCIDENTS_WORDS.one);
        expect(partOf).toBe(EVENT_PART_OF);
      } else {
        expect(many).not.toBe(RELATED_INCIDENTS_WORDS.other);
        expect(partOf).not.toBe(EVENT_PART_OF);
      }
    },
  );
});
