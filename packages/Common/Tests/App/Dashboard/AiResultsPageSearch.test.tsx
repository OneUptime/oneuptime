import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import Permission from "../../../Types/Permission";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * SEARCH (Cmd/Ctrl+K) FINDS AI RESULTS.
 *
 * Through the real palette and the real page index, in English: a reader
 * who types the page's name, or the words its three cards are about
 * ("pages avoided", "fixes verified", "root causes confirmed"), gets AI
 * Results first, filed where the menu has it: Project Settings › AI. Enter
 * opens it. Each row reads "<title> — <breadcrumb>".
 */

jest.mock("react-i18next", () => {
  const nodeFs: typeof import("fs") = jest.requireActual(
    "fs",
  ) as typeof import("fs");
  const nodePath: typeof import("path") = jest.requireActual(
    "path",
  ) as typeof import("path");

  const english: Record<string, unknown> = JSON.parse(
    nodeFs.readFileSync(
      nodePath.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const translate: (key: string, defaultValue?: unknown) => string = (
    key: string,
    defaultValue?: unknown,
  ): string => {
    if (typeof english[key] === "string") {
      return english[key] as string;
    }

    // Area titles are nested keys ("navbar.items.projectSettingsTitle").
    let value: unknown = english;

    for (const part of key.split(".")) {
      if (typeof value !== "object" || value === null) {
        value = undefined;
        break;
      }

      value = (value as Record<string, unknown>)[part];
    }

    if (typeof value === "string") {
      return value;
    }

    return typeof defaultValue === "string" ? defaultValue : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

/*
 * Billing off: the page is on every install, so it is found without the
 * billing pages beside it (AI Credits is gated on billing; AI Results is not).
 */
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const config: Record<string, unknown> = { ...actual };

  Object.defineProperty(config, "BILLING_ENABLED", {
    enumerable: true,
    value: false,
  });

  return config;
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner];
      },
      // The rows PermissionGate reads the blocks from: none.
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

const AI_RESULTS_ROW: string = "AI Results — Project Settings › AI";

const AI_RESULTS_PATH: string = `/dashboard/${PROJECT_ID}/settings/ai-results`;

const openPalette: () => void = (): void => {
  render(<DashboardCommandPalette />);
  act((): void => {
    GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
  });
};

// The rows a query lists, in order: "<title> — <breadcrumb>".
const rows: (query: string) => Array<string> = (
  query: string,
): Array<string> => {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value: query },
  });

  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    const title: string =
      option.querySelector("p.font-medium")?.textContent || "";
    const breadcrumb: HTMLElement | null = option.querySelector(
      '[data-testid$="-breadcrumb"]',
    );

    if (!breadcrumb) {
      return title;
    }

    const crumbs: string = Array.from(breadcrumb.childNodes)
      .filter((node: ChildNode): boolean => {
        return !(
          node instanceof HTMLElement && node.classList.contains("sr-only")
        );
      })
      .map((node: ChildNode): string => {
        return node.textContent || "";
      })
      .join("")
      .replace(/›/g, " › ")
      .replace(/\s+/g, " ")
      .trim();

    return `${title} — ${crumbs}`;
  });
};

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}/home`);
  openPalette();
});

describe("Search finds AI Results", () => {
  test.each([
    ["ai results"],
    ["AI Results"],
    ["pages avoided"],
    ["fixes verified"],
    ["root causes confirmed"],
    ["ai quality"],
    ["ai outcomes"],
  ])(
    "'%s' lists AI Results first, under Project Settings › AI",
    (query: string) => {
      expect(rows(query)[0]).toBe(AI_RESULTS_ROW);
    },
  );

  test("is listed once for its name", () => {
    expect(
      rows("ai results").filter((row: string): boolean => {
        return row === AI_RESULTS_ROW;
      }),
    ).toHaveLength(1);
  });

  test("'ai logs' still opens AI Logs, its neighbour, first", () => {
    const listed: Array<string> = rows("ai logs");

    expect(listed[0]).toBe("AI Logs — Project Settings › AI");
  });

  test("Enter on the first row opens …/settings/ai-results of this project", () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    expect(rows("pages avoided")[0]).toBe(AI_RESULTS_ROW);

    fireEvent.keyDown(screen.getByTestId("command-palette-input"), {
      key: "Enter",
    });

    expect(navigate).toHaveBeenCalled();
    expect(String(navigate.mock.calls[0]![0])).toBe(AI_RESULTS_PATH);

    navigate.mockRestore();
  });
});
