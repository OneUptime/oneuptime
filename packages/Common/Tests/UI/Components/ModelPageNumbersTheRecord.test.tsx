import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE NUMBER BEFORE THE TITLE, ON EVERY PAGE OF A NUMBERED RECORD.
 *
 * "Prepend incident number here, so I know which incident I am on.
 * Similarly for alerts and scheduled maintenance events. There could be
 * several with identical / nearly identical [titles]." An incident's pages
 * were headed "Incident - Manually declared", and so was the next incident
 * declared by hand; the trail and the browser tab said the same.
 *
 * ModelPage reads a numbered record's number with its title, and heads its
 * pages "INC-18 Manually declared": the heading, the crumb that stands for
 * the record and the browser tab. Every model that numbers its records
 * (Utils/Project/RecordNumber) - incidents, alerts, scheduled maintenance
 * events and both kinds of episode - with the project's own prefix, a bare
 * number for a record numbered before prefixes, and the old heading for a
 * record without a number.
 *
 * The real ModelPage, Page and Breadcrumbs against a fake API.
 */

const getItemMock: MockFunction = getJestMockFunction();
const captureMock: MockFunction = getJestMockFunction();

// Interface words in German, when a test asks for German.
const GERMAN: Record<string, string> = {
  Project: "Projekt",
  Incidents: "Vorfälle",
  "View Incident": "Vorfall ansehen",
  Owners: "Besitzer",
  Incident: "Vorfall",
  Overview: "Übersicht",
};

let isGerman: boolean = false;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          if (isGerman && GERMAN[key]) {
            return GERMAN[key]!;
          }
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return captureMock(...args);
      },
    },
  };
});

import ModelPage from "../../../UI/Components/Page/ModelPage";
import {
  PAGE_RECORD_HEADING_SEPARATOR,
  PAGE_RECORD_HEADING_TEST_IDS,
  PAGE_RECORD_NAME_CLASS_NAME,
  PAGE_RECORD_NUMBER_CLASS_NAME,
  PAGE_RECORD_HEADING_CLASS_NAME,
} from "../../../UI/Components/Page/Page";
import {
  BREADCRUMB_NUMBERED_RECORD_CLASS_NAME,
  BREADCRUMB_RECORD_NUMBER_CLASS_NAME,
  BREADCRUMB_RECORD_NUMBER_NAME_CLASS_NAME,
} from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import { announceModelHeaderChanged } from "../../../UI/Components/Page/ModelHeaderEvents";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "65f00000-0000-4000-8000-00000000aaaa";
const RECORD_ID: string = "65f00000-0000-4000-8000-00000000bbbb";

const TITLE: string = "Manually declared";

// A run of white space, the heading's no-break space among it.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

// What a piece of the page says, its white space as one space each.
function textOf(element: Element): string {
  return (element.textContent || "").replace(WHITE_SPACE_RUN, " ").trim();
}

interface NumberedKind {
  name: string;
  modelType: { new (): BaseModel };
  // What the layout calls the page.
  pageTitle: string;
  // The list the trail goes through, and the crumb the record takes.
  list: string;
  listPath: string;
  viewTitle: string;
  numberColumn: string;
  numberWithPrefixColumn: string;
  number: string;
}

const KINDS: Array<NumberedKind> = [
  {
    name: "an incident",
    modelType: Incident,
    pageTitle: "Incident",
    list: "Incidents",
    listPath: "incidents",
    viewTitle: "View Incident",
    numberColumn: "incidentNumber",
    numberWithPrefixColumn: "incidentNumberWithPrefix",
    number: "INC-18",
  },
  {
    name: "an alert",
    modelType: Alert,
    pageTitle: "Alert",
    list: "Alerts",
    listPath: "alerts",
    viewTitle: "View Alert",
    numberColumn: "alertNumber",
    numberWithPrefixColumn: "alertNumberWithPrefix",
    number: "ALT-18",
  },
  {
    name: "a scheduled maintenance event",
    modelType: ScheduledMaintenance,
    pageTitle: "Scheduled Event",
    list: "Scheduled Maintenance Events",
    listPath: "scheduled-maintenance-events",
    viewTitle: "View Scheduled Maintenance Event",
    numberColumn: "scheduledMaintenanceNumber",
    numberWithPrefixColumn: "scheduledMaintenanceNumberWithPrefix",
    number: "SM-18",
  },
  {
    name: "an incident episode",
    modelType: IncidentEpisode,
    pageTitle: "Episode",
    list: "Episodes",
    listPath: "incidents/episodes",
    viewTitle: "View Episode",
    numberColumn: "episodeNumber",
    numberWithPrefixColumn: "episodeNumberWithPrefix",
    number: "IE-18",
  },
  {
    name: "an alert episode",
    modelType: AlertEpisode,
    pageTitle: "Episode",
    list: "Episodes",
    listPath: "alerts/episodes",
    viewTitle: "View Episode",
    numberColumn: "episodeNumber",
    numberWithPrefixColumn: "episodeNumberWithPrefix",
    number: "AE-18",
  },
];

const INCIDENT_KIND: NumberedKind = KINDS[0]!;

function recordPath(kind: NumberedKind): string {
  return `/dashboard/${PROJECT_ID}/${kind.listPath}/${RECORD_ID}`;
}

// The trail the Dashboard builds for a record's Owners page.
function ownersTrail(kind: NumberedKind): Array<Link> {
  return [
    { title: "Project", to: new Route(`/dashboard/${PROJECT_ID}`) },
    {
      title: kind.list,
      to: new Route(`/dashboard/${PROJECT_ID}/${kind.listPath}`),
    },
    { title: kind.viewTitle, to: new Route(recordPath(kind)) },
    { title: "Owners", to: new Route(`${recordPath(kind)}/owners`) },
  ];
}

// The record as the API answers, with the columns it was asked for.
function recordOf(
  kind: NumberedKind,
  fields: {
    title?: string | undefined;
    number?: number | null | undefined;
    numberWithPrefix?: string | null | undefined;
  },
): BaseModel {
  const record: BaseModel = new kind.modelType();
  record.id = new ObjectID(RECORD_ID);
  const values: JSONObject = record as unknown as JSONObject;

  values["title"] = fields.title === undefined ? TITLE : fields.title;
  values[kind.numberColumn] = fields.number === undefined ? 18 : fields.number;
  values[kind.numberWithPrefixColumn] =
    fields.numberWithPrefix === undefined
      ? kind.number
      : fields.numberWithPrefix;
  values["labels"] = [];

  return record;
}

async function renderPage(
  kind: NumberedKind,
  options: { pathname?: string; trail?: Array<Link> } = {},
): Promise<void> {
  const pathname: string = options.pathname || `${recordPath(kind)}/owners`;
  // The address bar, which tells the trail its current page.
  window.history.replaceState(null, "", pathname);

  await act(async () => {
    render(
      <ModelPage
        title={kind.pageTitle}
        modelType={kind.modelType}
        modelId={new ObjectID(RECORD_ID)}
        modelNameField="title"
        breadcrumbLinks={options.trail || ownersTrail(kind)}
      >
        <div data-testid="page-body">Body</div>
      </ModelPage>,
    );
  });
}

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

function trailText(): Array<string> {
  const nav: HTMLElement = screen.getByRole("navigation", {
    name: "Breadcrumb",
  });
  return within(nav)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return textOf(item);
    });
}

function lastSelect(): JSONObject {
  const calls: Array<Array<unknown>> = getItemMock.mock.calls as Array<
    Array<unknown>
  >;
  const options: { select: JSONObject } = calls[calls.length - 1]![0] as {
    select: JSONObject;
  };
  return options.select;
}

function pageViews(): Array<string> {
  return captureMock.mock.calls
    .map((call: Array<unknown>): string => {
      return String(call[0]);
    })
    .filter((event: string): boolean => {
      return event.startsWith("Page View:");
    });
}

beforeEach(() => {
  isGerman = false;
  document.title = "OneUptime";
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
  captureMock.mockReset();
  window.history.replaceState(null, "", "/");
});

describe.each(KINDS.map((kind: NumberedKind) => [kind.name, kind]))(
  "%s's pages lead with its number",
  (_name: unknown, kindValue: unknown) => {
    const kind: NumberedKind = kindValue as NumberedKind;

    test("the number is read with the title, in the same read", async () => {
      getItemMock.mockResolvedValue(recordOf(kind, {}));
      await renderPage(kind);

      expect(getItemMock).toHaveBeenCalledTimes(1);
      expect(lastSelect()).toMatchObject({
        title: true,
        [kind.numberColumn]: true,
        [kind.numberWithPrefixColumn]: true,
      });
    });

    test(`the heading reads "${kind.number} ${TITLE}"`, async () => {
      getItemMock.mockResolvedValue(recordOf(kind, {}));
      await renderPage(kind);

      expect(heading()).toHaveTextContent(`${kind.number} ${TITLE}`);
      expect(
        screen.getByTestId(PAGE_RECORD_HEADING_TEST_IDS.number),
      ).toHaveTextContent(kind.number);
      expect(
        screen.getByTestId(PAGE_RECORD_HEADING_TEST_IDS.name),
      ).toHaveTextContent(TITLE);
      // What kind of record it is, the trail says once: no "Incident -".
      expect(heading().textContent).not.toContain(`${kind.pageTitle} -`);
    });

    test("the crumb that stands for it names it by its number and its title", async () => {
      getItemMock.mockResolvedValue(recordOf(kind, {}));
      await renderPage(kind);

      expect(trailText()).toEqual([
        "Project",
        kind.list,
        `${kind.number} ${TITLE}`,
        "Owners",
      ]);
      expect(screen.getByTestId("breadcrumb-record-number")).toHaveTextContent(
        kind.number,
      );
      // It still opens the record's own page.
      expect(
        screen.getByTestId("breadcrumb-record-name").closest("a"),
      ).toHaveAttribute("href", recordPath(kind));
    });

    test("the browser tab says it too", async () => {
      getItemMock.mockResolvedValue(recordOf(kind, {}));
      await renderPage(kind);

      expect(document.title).toBe(
        `OneUptime | Project - ${kind.list} - ${kind.number} ${TITLE} - Owners`,
      );
    });
  },
);

describe("the project's own numbering", () => {
  test("a prefix of the project's choosing, exactly as the record was numbered", async () => {
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { numberWithPrefix: "OPS/SEV:18" }),
    );
    await renderPage(INCIDENT_KIND);

    expect(heading()).toHaveTextContent(`OPS/SEV:18 ${TITLE}`);
    expect(document.title).toContain(`OPS/SEV:18 ${TITLE}`);
  });

  test("a project without a prefix: #18", async () => {
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { numberWithPrefix: "#18" }),
    );
    await renderPage(INCIDENT_KIND);

    expect(heading()).toHaveTextContent(`#18 ${TITLE}`);
  });

  test("a record numbered before numbers kept their prefix: #18 from its bare number", async () => {
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { numberWithPrefix: null }),
    );
    await renderPage(INCIDENT_KIND);

    expect(heading()).toHaveTextContent(`#18 ${TITLE}`);
    expect(screen.getByTestId("breadcrumb-record-number")).toHaveTextContent(
      "#18",
    );
    expect(document.title).toBe(
      `OneUptime | Project - Incidents - #18 ${TITLE} - Owners`,
    );
  });

  test("two incidents of one title are two pages that read differently", async () => {
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { number: 17, numberWithPrefix: "INC-17" }),
    );
    await renderPage(INCIDENT_KIND);
    const first: { heading: string; tab: string } = {
      heading: textOf(heading()),
      tab: document.title,
    };
    cleanup();

    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, {}));
    await renderPage(INCIDENT_KIND);

    expect(first).toEqual({
      heading: `INC-17 ${TITLE}`,
      tab: `OneUptime | Project - Incidents - INC-17 ${TITLE} - Owners`,
    });
    expect(textOf(heading())).toBe(`INC-18 ${TITLE}`);
    expect(document.title).not.toBe(first.tab);
  });
});

describe("a record with no number reads as it always did", () => {
  test("Incident - Manually declared, in the heading; its title alone in the trail and the tab", async () => {
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { number: null, numberWithPrefix: null }),
    );
    await renderPage(INCIDENT_KIND);

    expect(heading().textContent).toBe(`Incident - ${TITLE}`);
    expect(
      screen.queryByTestId(PAGE_RECORD_HEADING_TEST_IDS.number),
    ).toBeNull();
    expect(screen.queryByTestId("breadcrumb-record-number")).toBeNull();
    expect(trailText()).toEqual(["Project", "Incidents", TITLE, "Owners"]);
    expect(document.title).toBe(
      `OneUptime | Project - Incidents - ${TITLE} - Owners`,
    );
  });

  test("a model that does not number its records asks for no number", async () => {
    const monitor: Monitor = new Monitor();
    monitor.id = new ObjectID(RECORD_ID);
    monitor.name = "Website: acme.com";
    monitor.labels = [];
    getItemMock.mockResolvedValue(monitor);

    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID}/monitors/${RECORD_ID}`,
    );
    await act(async () => {
      render(
        <ModelPage<Monitor>
          title="Monitor"
          modelType={Monitor}
          modelId={new ObjectID(RECORD_ID)}
          modelNameField="name"
          breadcrumbLinks={[
            { title: "Project", to: new Route(`/dashboard/${PROJECT_ID}`) },
            {
              title: "Monitors",
              to: new Route(`/dashboard/${PROJECT_ID}/monitors`),
            },
            {
              title: "View Monitor",
              to: new Route(`/dashboard/${PROJECT_ID}/monitors/${RECORD_ID}`),
            },
          ]}
        >
          <div>Body</div>
        </ModelPage>,
      );
    });

    expect(Object.keys(lastSelect()).sort()).toEqual(["labels", "name"]);
    expect(heading().textContent).toBe("Monitor - Website: acme.com");
    expect(
      screen.queryByTestId(PAGE_RECORD_HEADING_TEST_IDS.number),
    ).toBeNull();
  });
});

describe("how the number and the title sit together", () => {
  const LONG_TITLE: string =
    "Checkout API p95 latency above 2s for EU customers after release 2026.09.14-2 started with a smaller database connection pool than production needs";

  test("one heading: the number, a no-break space, then the title", async () => {
    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, {}));
    await renderPage(INCIDENT_KIND);

    const nodes: Array<ChildNode> = Array.from(heading().childNodes);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toBe(
      screen.getByTestId(PAGE_RECORD_HEADING_TEST_IDS.number),
    );
    // The number is never wrapped away from the title's first word.
    expect(nodes[1]!.textContent).toBe(PAGE_RECORD_HEADING_SEPARATOR);
    expect(PAGE_RECORD_HEADING_SEPARATOR).toBe("\u00a0");
    expect(nodes[2]).toBe(screen.getByTestId(PAGE_RECORD_HEADING_TEST_IDS.name));
  });

  test("the number is never cut or wrapped; the title gives way, two lines on a phone and one from 640px", async () => {
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { title: LONG_TITLE }),
    );
    await renderPage(INCIDENT_KIND);

    expect(heading().className).toBe(PAGE_RECORD_HEADING_CLASS_NAME);
    expect(heading()).toHaveClass("line-clamp-2", "sm:flex", "sm:min-w-0");
    expect(heading()).toHaveClass("sm:line-clamp-none", "[overflow-wrap:anywhere]");

    const number: HTMLElement = screen.getByTestId(
      PAGE_RECORD_HEADING_TEST_IDS.number,
    );
    expect(number.className).toBe(PAGE_RECORD_NUMBER_CLASS_NAME);
    expect(number).toHaveClass("whitespace-nowrap", "sm:shrink-0");
    expect(number.className).not.toContain("truncate");

    const name: HTMLElement = screen.getByTestId(
      PAGE_RECORD_HEADING_TEST_IDS.name,
    );
    expect(name.className).toBe(PAGE_RECORD_NAME_CLASS_NAME);
    expect(name).toHaveClass("sm:min-w-0", "sm:truncate");
    expect(name).toHaveTextContent(LONG_TITLE);
  });

  test("the whole heading under the pointer", async () => {
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { title: LONG_TITLE }),
    );
    await renderPage(INCIDENT_KIND);

    expect(heading()).toHaveAttribute("title", `INC-18 ${LONG_TITLE}`);
  });

  test("the number is quieter than the title", async () => {
    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, {}));
    await renderPage(INCIDENT_KIND);

    expect(heading()).toHaveClass("text-gray-900");
    expect(
      screen.getByTestId(PAGE_RECORD_HEADING_TEST_IDS.number),
    ).toHaveClass("text-gray-500");
  });

  test("the crumb keeps its number whole and cuts its title short, with the whole of it on hover", async () => {
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { title: LONG_TITLE }),
    );
    await renderPage(INCIDENT_KIND);

    const crumb: HTMLElement = screen.getByTestId("breadcrumb-record-name");
    expect(crumb.className).toBe(BREADCRUMB_NUMBERED_RECORD_CLASS_NAME);
    expect(crumb).toHaveClass("max-w-xs", "inline-flex", "min-w-0");
    expect(crumb).toHaveAttribute("title", `INC-18 ${LONG_TITLE}`);

    const number: HTMLElement = screen.getByTestId("breadcrumb-record-number");
    expect(number.className).toBe(BREADCRUMB_RECORD_NUMBER_CLASS_NAME);
    expect(number).toHaveClass("shrink-0", "whitespace-nowrap");

    const name: HTMLElement = crumb.lastElementChild as HTMLElement;
    expect(name.className).toBe(BREADCRUMB_RECORD_NUMBER_NAME_CLASS_NAME);
    expect(name).toHaveClass("min-w-0", "truncate");
    expect(name).toHaveTextContent(LONG_TITLE);
  });
});

describe("a right-to-left page: each piece reads its own way", () => {
  test("the number and an English title are isolated, the title read left to right", async () => {
    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, {}));
    await renderPage(INCIDENT_KIND);

    const number: HTMLElement = screen.getByTestId(
      PAGE_RECORD_HEADING_TEST_IDS.number,
    );
    const name: HTMLElement = screen.getByTestId(
      PAGE_RECORD_HEADING_TEST_IDS.name,
    );
    expect(number.tagName).toBe("BDI");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "ltr");

    const crumbName: HTMLElement = screen.getByTestId("breadcrumb-record-name")
      .lastElementChild as HTMLElement;
    expect(screen.getByTestId("breadcrumb-record-number").tagName).toBe(
      "BDI",
    );
    expect(crumbName.tagName).toBe("BDI");
    expect(crumbName).toHaveAttribute("dir", "ltr");
  });

  test("a Persian title is read right to left, whatever the page's language", async () => {
    const persianTitle: string = "کندی پاسخ در صفحه پرداخت";
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { title: persianTitle }),
    );
    await renderPage(INCIDENT_KIND);

    expect(screen.getByTestId(PAGE_RECORD_HEADING_TEST_IDS.name)).toHaveAttribute(
      "dir",
      "rtl",
    );
    expect(heading()).toHaveTextContent(`INC-18 ${persianTitle}`);
  });
});

describe("in another language", () => {
  test("German: the trail's words in German, the number and the title as written", async () => {
    isGerman = true;
    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, {}));
    await renderPage(INCIDENT_KIND);

    expect(heading()).toHaveTextContent(`INC-18 ${TITLE}`);
    expect(trailText()).toEqual([
      "Projekt",
      "Vorfälle",
      `INC-18 ${TITLE}`,
      "Besitzer",
    ]);
    expect(document.title).toBe(
      `OneUptime | Projekt - Vorfälle - INC-18 ${TITLE} - Besitzer`,
    );
  });

  test("a title that is an interface word is never translated", async () => {
    isGerman = true;
    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, { title: "Overview" }));
    await renderPage(INCIDENT_KIND);

    expect(heading()).toHaveTextContent("INC-18 Overview");
    expect(heading().textContent).not.toContain("Übersicht");
  });

  test("German, without a number: the kind in German before the title, as before", async () => {
    isGerman = true;
    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { number: null, numberWithPrefix: null }),
    );
    await renderPage(INCIDENT_KIND);

    expect(heading().textContent).toBe(`Vorfall - ${TITLE}`);
  });
});

describe("until the record is read, and when it cannot be", () => {
  test("while it is read: the page's own title, and the trail's own words", async () => {
    getItemMock.mockReturnValue(new Promise<BaseModel>(() => {}));
    await renderPage(INCIDENT_KIND);

    expect(heading().textContent).toBe("Incident");
    expect(trailText()).toEqual([
      "Project",
      "Incidents",
      "View Incident",
      "Owners",
    ]);
    expect(screen.queryByTestId("breadcrumb-record-number")).toBeNull();
  });

  test("a record that cannot be read names no number anywhere", async () => {
    getItemMock.mockResolvedValue(null);
    await renderPage(INCIDENT_KIND);

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByTestId("breadcrumb-record-number")).toBeNull();
    expect(document.title).toBe(
      "OneUptime | Project - Incidents - View Incident - Owners",
    );
  });

  test("its number stays when its title is edited and read again", async () => {
    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, {}));
    await renderPage(INCIDENT_KIND);

    getItemMock.mockResolvedValue(
      recordOf(INCIDENT_KIND, { title: "Checkout is down" }),
    );
    await act(async () => {
      announceModelHeaderChanged({
        modelType: Incident,
        modelId: new ObjectID(RECORD_ID),
      });
    });

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(heading()).toHaveTextContent("INC-18 Checkout is down");
    expect(document.title).toBe(
      "OneUptime | Project - Incidents - INC-18 Checkout is down - Owners",
    );
  });

  test("a refresh that fails keeps the numbered heading on screen", async () => {
    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, {}));
    await renderPage(INCIDENT_KIND);

    getItemMock.mockRejectedValue(new Error("Network error"));
    await act(async () => {
      announceModelHeaderChanged({
        modelType: Incident,
        modelId: new ObjectID(RECORD_ID),
      });
    });

    expect(heading()).toHaveTextContent(`INC-18 ${TITLE}`);
    expect(screen.getByTestId("page-body")).toBeInTheDocument();
  });
});

describe("the product analytics never see a record's number or title", () => {
  test("the page view names the page, not the incident", async () => {
    getItemMock.mockResolvedValue(recordOf(INCIDENT_KIND, {}));
    await renderPage(INCIDENT_KIND);

    expect(pageViews().length).toBeGreaterThan(0);
    for (const event of pageViews()) {
      expect(event).toBe(
        "Page View: Project > Incidents > View Incident > Owners",
      );
      expect(event).not.toContain("INC-18");
      expect(event).not.toContain(TITLE);
    }
  });
});
