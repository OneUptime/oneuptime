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
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * What Search (Cmd/Ctrl+K) puts first, through the real palette, the real
 * page index and the real products menu, in English. Each row reads
 * "<title> — <breadcrumb>" (a product has no breadcrumb), in the order the
 * palette lists them; Enter opens the first.
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

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const config: Record<string, unknown> = { ...actual };

  Object.defineProperty(config, "BILLING_ENABLED", {
    enumerable: true,
    value: true,
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
    },
  };
});

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

describe("what the maintainer searched for comes first", () => {
  test("'api keys' and 'API key' open API Keys", () => {
    expect(rows("api keys")[0]).toBe("API Keys — Project Settings › Advanced");
    expect(rows("API key")[0]).toBe("API Keys — Project Settings › Advanced");
  });

  test("'delete project' offers the action, then the page it is done on", () => {
    expect(rows("delete project").slice(0, 2)).toEqual([
      "Delete Project — Project Settings › Danger Zone",
      "Danger Zone — Project Settings",
    ]);
  });

  test("on-call schedules and policies, however they are written", () => {
    for (const query of [
      "on-call schedules",
      "on call schedule",
      "oncall schedules",
    ]) {
      expect(rows(query)[0]).toBe(
        "On-Call Schedules — On-Call Duty › Schedules",
      );
    }

    for (const query of [
      "on-call policy",
      "On Call Policies",
      "oncall policy",
    ]) {
      expect(rows(query)[0]).toBe("On-Call Policies — On-Call Duty › Policies");
    }
  });

  test("'pager', 'escalation' and 'rota' find on-call, and only on-call", () => {
    expect(rows("pager")).toEqual(
      expect.arrayContaining([
        "On-Call Duty",
        "On-Call Policies — On-Call Duty › Policies",
      ]),
    );
    // "pager" is a real word here: Status Pages is not offered for it.
    expect(rows("pager")).not.toContain("Status Pages");

    expect(rows("escalation").slice(0, 2)).toEqual([
      "On-Call Duty",
      "On-Call Policies — On-Call Duty › Policies",
    ]);

    expect(rows("rota")[0]).toBe(
      "On-Call Schedules — On-Call Duty › Schedules",
    );
  });
});

describe("a name many pages share gives way to a distinctive one", () => {
  test("'api' opens API Keys before the thirty Developer pages called API", () => {
    const listed: Array<string> = rows("api");

    expect(listed[0]).toBe("API Keys — Project Settings › Advanced");
    expect(listed).toContain("API — Incidents › Developer");
    expect(listed.indexOf("API — Incidents › Developer")).toBeGreaterThan(0);
  });

  test("'settings' opens Project Settings and User Settings before a page called Settings", () => {
    const listed: Array<string> = rows("settings");

    expect(listed.slice(0, 2)).toEqual(["Project Settings", "User Settings"]);
    expect(
      listed.indexOf("Settings — Project Settings › Audit Logs"),
    ).toBeGreaterThan(1);
  });

  test("'monitors' opens the Monitors product before Security Events' Monitors tab", () => {
    const listed: Array<string> = rows("monitors");

    expect(listed[0]).toBe("Monitors");
    expect(listed.indexOf("All Monitors — Monitors")).toBeLessThan(
      listed.indexOf("Monitors — Security Events"),
    );
  });

  test("'slack' lists every Slack page, Project Settings first", () => {
    const listed: Array<string> = rows("slack");

    expect(listed[0]).toBe("Slack — Project Settings › Workspace");
    expect(listed).toEqual(
      expect.arrayContaining([
        "Slack — Incidents › Workspace",
        "Slack — Alerts › Workspace",
        "Slack — On-Call Duty › Workspace",
        "Slack — User Settings › Workspace",
      ]),
    );
  });
});

describe("the breadcrumb tells pages apart and narrows a search", () => {
  test("'custom fields' lists one row per product, each saying where it is", () => {
    expect(rows("custom fields")).toEqual(
      expect.arrayContaining([
        "Custom Fields — Incidents › Settings",
        "Custom Fields — Alerts › Settings",
        "Custom Fields — Monitors › Settings",
        "Custom Fields — On-Call Duty › Settings",
        "Custom Fields — Status Pages › Settings",
        "Custom Fields — Teams › Settings",
        "Custom Fields — Users › Settings",
      ]),
    );
  });

  test("'incident custom fields' and 'custom fields incidents' open the Incidents one", () => {
    expect(rows("incident custom fields")[0]).toBe(
      "Custom Fields — Incidents › Settings",
    );
    expect(rows("custom fields incidents")[0]).toBe(
      "Custom Fields — Incidents › Settings",
    );
  });

  test("'incident settings' lists the pages of Incidents > Settings, incident-named ones first", () => {
    const listed: Array<string> = rows("incident settings");

    expect(listed[0]).toMatch(
      /^Incident (State|Severity|Templates|Roles) — Incidents › Settings$/,
    );
    expect(listed).toContain("Custom Fields — Incidents › Settings");
    expect(listed).not.toContain("Owner Rules — Incidents › Rules");
  });

  test("'user settings' opens User Settings, then its own pages", () => {
    const listed: Array<string> = rows("user settings");

    expect(listed[0]).toBe("User Settings");
    expect(listed).toContain(
      "Notification Methods — User Settings › Alerts & Notifications",
    );
  });

  test("a word that only names where pages live finds the product, not every page in it", () => {
    const listed: Array<string> = rows("incidents");

    expect(listed[0]).toBe("Incidents");
    // No page is listed for living in Incidents alone.
    expect(listed).not.toContain("Owner Rules — Incidents › Rules");
    expect(listed).not.toContain("Custom Fields — Incidents › Settings");
  });
});

describe("search forgives the way people type", () => {
  test("case, accents and punctuation do not matter", () => {
    expect(rows("NOTIFICATION-SETTINGS")[0]).toMatch(
      /^Notification Settings — /,
    );
    expect(rows("dángér zóne")[0]).toBe("Danger Zone — Project Settings");
  });

  test("words can come in any order, and a plural need not match", () => {
    expect(rows("keys api")[0]).toBe("API Keys — Project Settings › Advanced");
    expect(rows("policies on-call")[0]).toBe(
      "On-Call Policies — On-Call Duty › Policies",
    );
  });

  test("other words for a page find it", () => {
    expect(rows("2fa")[0]).toBe(
      "Two-factor authentication — User Profile › Security",
    );
    expect(rows("change password")[0]).toBe(
      "Password Management — User Profile › Security",
    );
    expect(rows("saml")[0]).toBe("SSO — Project Settings › Security");
    expect(rows("invoices")[0]).toBe(
      "Invoices — Project Settings › Billing and Invoices",
    );
  });

  test("a typo is forgiven when nothing matches as typed", () => {
    expect(rows("incidnets")[0]).toBe("Incidents");
    expect(rows("shedules")).toContain(
      "On-Call Schedules — On-Call Duty › Schedules",
    );
  });

  test("initials find a page when nothing matches better", () => {
    expect(rows("ak")[0]).toBe("API Keys — Project Settings › Advanced");
    expect(rows("ocp")[0]).toBe("On-Call Policies — On-Call Duty › Policies");

    // "ai" names the AI pages, so Active Incidents is not offered for its initials.
    const ai: Array<string> = rows("ai");
    expect(ai.length).toBeGreaterThan(0);
    expect(
      ai.filter((row: string): boolean => {
        return row.startsWith("Active ");
      }),
    ).toEqual([]);
  });

  test("nothing is listed for words nothing holds", () => {
    expect(rows("zzzz nothing here")).toEqual([]);
    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
  });
});
