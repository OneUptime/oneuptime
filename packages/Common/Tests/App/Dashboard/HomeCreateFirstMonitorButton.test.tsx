import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/*
 * Before anything is monitored, Home's headline reads "Nothing is being
 * monitored yet - Create a monitor and OneUptime will check your website, API
 * or server around the clock ...", and it used to end there: no button. The
 * way to do what it said was the first item of the Create menu beside the
 * search box, or a step of the welcome checklist, which is gone for good once
 * dismissed. The headline now ends on "Create your first monitor", for
 * whoever may create one, and only while nothing is monitored and nothing is
 * open.
 *
 * The real ProjectHealthCard, drawn from counts, in a router so the button's
 * link can be followed; react-i18next answered from the REAL locale files.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

function readLocale(code: string): LocaleData {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
}

const EN: LocaleData = readLocale("en");
const DE: LocaleData = readLocale("de");

let activeLocale: LocaleData = EN;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const flat: unknown = activeLocale[key];
          if (typeof flat === "string") {
            return flat;
          }
          if (options && typeof options === "object") {
            return (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return typeof options === "string" ? options : key;
        },
        i18n: {
          language: activeLocale === DE ? "de" : "en",
        },
      };
    },
  };
});

const PROJECT_ID: string = "65f00000000000000000cccc";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: (): string => {
            return "65f00000000000000000cccc";
          },
        };
      },
    },
  };
});

import { HomeCounts } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import ProjectHealthCard, {
  CREATE_FIRST_MONITOR_BUTTON_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ProjectHealthCard";
import {
  NOT_SET_UP_HEADLINE,
  NOT_SET_UP_SUMMARY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ProjectHealth";

const BUTTON_TEXT: string = "Create your first monitor";
const NOW: Date = new Date("2026-10-20T12:00:00.000Z");

function nothingYet(): HomeCounts {
  return {
    activeIncidents: 0,
    activeAlerts: 0,
    notOperationalMonitors: 0,
    ongoingMaintenance: 0,
    slosNeedingAttention: 0,
    totalMonitors: 0,
    totalSlos: 0,
  };
}

interface CardOptions {
  counts?: HomeCounts | null | undefined;
  canCreateMonitor?: boolean | undefined;
  isLoading?: boolean | undefined;
  error?: string | undefined;
}

function renderCard(options: CardOptions = {}): void {
  const counts: HomeCounts | null =
    options.counts === undefined ? nothingYet() : options.counts;

  render(
    <MemoryRouter initialEntries={[`/dashboard/${PROJECT_ID}/home/`]}>
      <Routes>
        <Route
          path="/dashboard/:projectId/home/"
          element={
            <ProjectHealthCard
              counts={counts}
              isLoading={Boolean(options.isLoading)}
              isRefreshing={false}
              error={options.error || ""}
              loadedAt={counts ? NOW : null}
              now={NOW}
              onRefresh={() => {}}
              canCreateMonitor={options.canCreateMonitor}
            />
          }
        />
        <Route
          path="/dashboard/:projectId/monitors/create"
          element={<div data-testid="create-monitor-page"></div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function button(): HTMLElement | null {
  return screen.queryByRole("link", {
    name: String(activeLocale[BUTTON_TEXT]),
  });
}

afterEach(() => {
  cleanup();
  activeLocale = EN;
});

describe("before anything is monitored", () => {
  test("the headline ends on Create your first monitor", () => {
    renderCard({ canCreateMonitor: true });

    expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
      NOT_SET_UP_HEADLINE,
    );
    expect(screen.getByTestId("home-health-summary")).toHaveTextContent(
      NOT_SET_UP_SUMMARY,
    );
    expect(button()).toBeVisible();
  });

  test("it comes after the sentence it acts on", () => {
    renderCard({ canCreateMonitor: true });

    expect(
      screen
        .getByTestId("home-health-summary")
        .compareDocumentPosition(button()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("it opens the create monitor form of this project", () => {
    renderCard({ canCreateMonitor: true });

    expect(button()).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/create`,
    );

    fireEvent.click(button()!);

    expect(screen.getByTestId("create-monitor-page")).toBeInTheDocument();
  });

  test("it is a link, so it opens in a new tab too, drawn as the primary button", () => {
    renderCard({ canCreateMonitor: true });

    expect(button()!.tagName).toBe("A");
    expect(button()).toHaveClass("bg-indigo-600", "text-white");
    expect(button()!.className).toContain(
      CREATE_FIRST_MONITOR_BUTTON_CLASS_NAME,
    );
  });

  test("it is the only primary button on the card", () => {
    renderCard({ canCreateMonitor: true });

    const primaries: Array<Element> = Array.from(
      screen
        .getByTestId("home-project-health")
        .querySelectorAll(".bg-indigo-600"),
    );
    expect(primaries).toHaveLength(1);
  });

  test("someone who may not create a monitor gets the headline, and no button", () => {
    renderCard({ canCreateMonitor: false });

    expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
      NOT_SET_UP_HEADLINE,
    );
    expect(button()).toBeNull();
  });

  test("with no word on what may be created, the button stays away", () => {
    renderCard({});

    expect(button()).toBeNull();
  });

  test("in German it reads as the welcome checklist's own step does", () => {
    activeLocale = DE;
    renderCard({ canCreateMonitor: true });

    expect(DE[BUTTON_TEXT]).toBe("Ersten Monitor erstellen");
    expect(button()).toBeVisible();
    expect(screen.queryByText(BUTTON_TEXT)).toBeNull();
  });
});

describe("whenever the headline says something else, there is no button", () => {
  test.each([
    ["an incident is open", { activeIncidents: 1 }],
    ["an alert is open", { activeAlerts: 2 }],
    ["maintenance is in progress", { ongoingMaintenance: 1 }],
    ["monitors are running", { totalMonitors: 3 }],
    ["a monitor is down", { totalMonitors: 3, notOperationalMonitors: 1 }],
  ])("%s", (_name: string, counts: Partial<HomeCounts>) => {
    renderCard({
      canCreateMonitor: true,
      counts: { ...nothingYet(), ...counts },
    });

    expect(screen.getByTestId("home-health-headline")).not.toHaveTextContent(
      NOT_SET_UP_HEADLINE,
    );
    expect(button()).toBeNull();
  });

  test("while the project is still being read", () => {
    renderCard({ canCreateMonitor: true, counts: null, isLoading: true });

    expect(screen.getByTestId("home-health-loading")).toBeInTheDocument();
    expect(button()).toBeNull();
  });

  test("when the project could not be read", () => {
    renderCard({
      canCreateMonitor: true,
      counts: null,
      error: "Network error",
    });

    expect(screen.getByTestId("home-health-try-again")).toBeVisible();
    expect(button()).toBeNull();
  });
});
