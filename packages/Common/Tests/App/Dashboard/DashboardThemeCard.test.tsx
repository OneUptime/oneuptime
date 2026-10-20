import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Theme, on a dashboard's Branding page: how its public link looks to
 * visitors - Light, Dark, or as each visitor's device is set - three radio
 * rows that save the moment one is picked, each beside a picture of a
 * dashboard in that theme. It is every public page's Theme card
 * (PublicPageThemeCard), which a status page's shares
 * (StatusPageThemeCard.test.tsx holds that one).
 *
 * Only the network and the permission gate are stubbed; the card, its
 * choice rows and its "Saved" are the real ones.
 */

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import DashboardThemeCard from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardThemeCard";
import DashboardThemeCopy, {
  DASHBOARD_THEME_CARD_TEST_ID,
  DASHBOARD_THEME_CHOICES,
  DASHBOARD_THEME_ERROR_TEST_ID,
  DashboardThemeChoice,
  getDashboardThemeChoiceTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardThemeCopy";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import ObjectID from "../../../Types/ObjectID";
import DashboardTheme from "../../../Types/Dashboard/DashboardTheme";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const DASHBOARD_ID: string = "5a5a5a5a-0000-4000-8000-0000000000dd";

interface Stored {
  theme?: string | null;
}

// What the dashboard holds, nothing, or a failed read.
let stored: Stored | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };
// The writes the server refuses, with why.
let refusal: string | null = null;

beforeEach(() => {
  stored = { theme: DashboardTheme.Light };
  gate = { isAllowed: true };
  refusal = null;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const dashboard: Dashboard = new Dashboard();
    dashboard._id = DASHBOARD_ID;
    Object.assign(dashboard, stored);

    return dashboard;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    if (refusal) {
      throw new Error(refusal);
    }

    return {};
  });

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(<DashboardThemeCard dashboardId={new ObjectID(DASHBOARD_ID)} />);
  });

  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
}

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
}

function radio(theme: DashboardTheme): HTMLInputElement {
  return screen.getByTestId(
    getDashboardThemeChoiceTestId(theme),
  ) as HTMLInputElement;
}

// The picture beside a choice: its label (the slot), and the drawing in it.
function picture(theme: DashboardTheme): {
  slot: HTMLElement;
  drawing: SVGElement;
} {
  const slot: HTMLElement = screen.getByTestId(
    `${getDashboardThemeChoiceTestId(theme)}-visual`,
  );

  return { slot, drawing: slot.querySelector("svg") as SVGElement };
}

function framed(): Array<string> {
  return DASHBOARD_THEME_CHOICES.filter(
    (choice: DashboardThemeChoice): boolean => {
      return (
        picture(choice.value).drawing.getAttribute("data-selected") === "true"
      );
    },
  ).map((choice: DashboardThemeChoice): string => {
    return choice.value;
  });
}

function checked(): Array<string> {
  return screen
    .getAllByRole("radio")
    .filter((element: HTMLElement): boolean => {
      return (element as HTMLInputElement).checked;
    })
    .map((element: HTMLElement): string => {
      return (element as HTMLInputElement).value;
    });
}

describe("reading the dashboard", () => {
  test("asks for this dashboard's theme, and nothing else", async () => {
    await renderCard();
    await loaded();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Dashboard);
    expect((request["id"] as ObjectID).toString()).toBe(DASHBOARD_ID);
    expect(request["select"]).toEqual({ theme: true });
  });

  test("is the Theme card: three choices, each named and explained, in one group named for the public dashboard", async () => {
    await renderCard();
    await loaded();

    const card: HTMLElement = screen.getByTestId(DASHBOARD_THEME_CARD_TEST_ID);

    expect(screen.getByText(DashboardThemeCopy.title)).toBeInTheDocument();
    expect(
      screen.getByText(DashboardThemeCopy.description),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("radiogroup", {
        name: DashboardThemeCopy.ariaLabel,
      }),
    ).toBeInTheDocument();

    for (const choice of DASHBOARD_THEME_CHOICES) {
      const option: HTMLElement = within(card).getByRole("radio", {
        name: choice.title,
      });

      expect(option).toBe(radio(choice.value));
      expect(within(card).getByText(choice.description)).toBeInTheDocument();
    }

    // No Edit button and no dialog: a pick is the whole change.
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("says once that visitors can switch it themselves, and no choice promises every visitor one look", async () => {
    await renderCard();
    await loaded();

    expect(DashboardThemeCopy.description).toContain("toolbar");

    for (const choice of DASHBOARD_THEME_CHOICES) {
      expect(choice.description).not.toMatch(/every visitor/i);
    }
  });

  test.each([
    [DashboardTheme.Light],
    [DashboardTheme.Dark],
    [DashboardTheme.System],
  ])(
    "a %s dashboard has that choice checked",
    async (theme: DashboardTheme) => {
      stored = { theme };

      await renderCard();
      await loaded();

      expect(checked()).toEqual([theme]);
    },
  );

  test.each([[null], [undefined], ["Sepia"], ["dark"]])(
    "a dashboard with %p shows Light, the page it is drawn as",
    async (theme: string | null | undefined) => {
      stored = theme === undefined ? {} : { theme };

      await renderCard();
      await loaded();

      expect(checked()).toEqual([DashboardTheme.Light]);
    },
  );

  test("a dashboard that is not there says so, with no choices", async () => {
    stored = null;

    await renderCard();

    await waitFor(() => {
      expect(screen.getByText(DashboardThemeCopy.notFound)).toBeInTheDocument();
    });
    expect(screen.queryByRole("radio")).toBeNull();
  });

  test("a read that fails says why, and can be tried again", async () => {
    stored = new Error("The server is down for maintenance.");

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("The server is down for maintenance."),
      ).toBeInTheDocument();
    });

    stored = { theme: DashboardTheme.Dark };

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(DASHBOARD_THEME_CARD_TEST_ID)).getByTestId(
          "refresh-button",
        ),
      );
    });

    await loaded();
    expect(checked()).toEqual([DashboardTheme.Dark]);
  });
});

describe("picking a theme", () => {
  test.each([[DashboardTheme.Dark], [DashboardTheme.System]])(
    "%s is saved at once, for this dashboard, and nothing else is sent",
    async (theme: DashboardTheme) => {
      await renderCard();
      await loaded();

      await act(async () => {
        fireEvent.click(radio(theme));
      });

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      const request: Record<string, unknown> = updateByIdMock.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(request["modelType"]).toBe(Dashboard);
      expect((request["id"] as ObjectID).toString()).toBe(DASHBOARD_ID);
      expect(request["data"]).toEqual({ theme });
      expect(checked()).toEqual([theme]);
    },
  );

  test("says Saved beside the new choice once it is saved", async () => {
    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(radio(DashboardTheme.Dark));
    });

    await waitFor(() => {
      expect(
        within(
          screen.getByTestId(
            `${getDashboardThemeChoiceTestId(DashboardTheme.Dark)}-status`,
          ),
        ).getByText("Saved"),
      ).toBeInTheDocument();
    });
  });

  test("picking the theme the dashboard has sends nothing", async () => {
    stored = { theme: DashboardTheme.System };

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(radio(DashboardTheme.System));
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a pick the server refuses goes back to what the dashboard has, with the reason", async () => {
    refusal = "Theme must be Light, Dark or System.";

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(radio(DashboardTheme.Dark));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(DASHBOARD_THEME_ERROR_TEST_ID),
      ).toHaveTextContent("Theme must be Light, Dark or System.");
    });
    expect(screen.getByTestId(DASHBOARD_THEME_ERROR_TEST_ID)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(checked()).toEqual([DashboardTheme.Light]);
  });

  test("the last of quick picks is the one the dashboard ends up with", async () => {
    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(radio(DashboardTheme.Dark));
      fireEvent.click(radio(DashboardTheme.System));
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(2);
    });

    const last: Record<string, unknown> = updateByIdMock.mock
      .calls[1]![0] as Record<string, unknown>;

    expect(last["data"]).toEqual({ theme: DashboardTheme.System });
    expect(checked()).toEqual([DashboardTheme.System]);
  });
});

describe("someone who may not edit the dashboard", () => {
  test("sees every choice locked, with why, and a pick saves nothing", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to update this Dashboard.",
    };

    await renderCard();
    await loaded();

    for (const choice of DASHBOARD_THEME_CHOICES as Array<DashboardThemeChoice>) {
      expect(radio(choice.value)).toBeDisabled();
    }

    expect(
      screen.getByText("You do not have permission to update this Dashboard."),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(radio(DashboardTheme.Dark));
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("the gate is asked about updating a dashboard", async () => {
    await renderCard();
    await loaded();

    const call: Array<unknown> = (PermissionGate.check as unknown as jest.Mock)
      .mock.calls[0] as Array<unknown>;

    expect(call[0]).toBeInstanceOf(Dashboard);
    expect(call[1]).toBe(ModelAction.Update);
  });
});

describe("the pictures beside the choices", () => {
  test("each choice has a picture of a dashboard in its theme, beside it, hidden from screen readers", async () => {
    await renderCard();
    await loaded();

    for (const choice of DASHBOARD_THEME_CHOICES) {
      const { slot, drawing } = picture(choice.value);

      expect(drawing).toHaveAttribute("data-theme-preview", choice.value);
      expect(slot).toHaveAttribute("aria-hidden", "true");
      expect(drawing).toHaveAttribute("aria-hidden", "true");
      // It is the radio's own label, so pressing it is pressing the choice.
      expect(slot.tagName).toBe("LABEL");
      expect(slot).toHaveAttribute("for", radio(choice.value).id);
      // It adds no words: the radio is still named by its title alone.
      expect(slot).toHaveTextContent("");
      expect(screen.getByRole("radio", { name: choice.title })).toBe(
        radio(choice.value),
      );
    }
  });

  test("a dashboard that follows the device is pictured half light and half dark", async () => {
    await renderCard();
    await loaded();

    const fills: (theme: DashboardTheme) => Array<string> = (
      theme: DashboardTheme,
    ): Array<string> => {
      return Array.from(
        picture(theme).drawing.querySelectorAll("rect[fill]"),
      ).map((element: Element): string => {
        return element.getAttribute("fill") || "";
      });
    };

    const light: Array<string> = fills(DashboardTheme.Light);
    const dark: Array<string> = fills(DashboardTheme.Dark);
    const both: Array<string> = fills(DashboardTheme.System);

    expect(light).toContain("#f9fafb");
    expect(light).not.toContain("#0f172a");
    expect(dark).toContain("#0f172a");
    expect(dark).not.toContain("#f9fafb");
    expect(both).toContain("#f9fafb");
    expect(both).toContain("#0f172a");
  });

  test("the pictures are of a dashboard - a value, a line chart and a bar chart - not of a status page", async () => {
    await renderCard();
    await loaded();

    const drawing: SVGElement = picture(DashboardTheme.Light).drawing;

    expect(drawing.querySelectorAll("polyline")).toHaveLength(1);
    // The bar chart's ten bars, past the header, the widgets and their labels.
    expect(drawing.querySelectorAll("rect[fill]").length).toBeGreaterThan(15);
  });

  test("the choice in force has its picture framed, and the frame follows a pick", async () => {
    stored = { theme: DashboardTheme.Dark };

    await renderCard();
    await loaded();

    expect(framed()).toEqual([DashboardTheme.Dark]);

    await act(async () => {
      fireEvent.click(radio(DashboardTheme.System));
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(framed()).toEqual([DashboardTheme.System]);
  });

  test("the pictures' clip paths are named for the dashboard's card, apart from a status page's", async () => {
    await renderCard();
    await loaded();

    const ids: Array<string> = Array.from(
      document.querySelectorAll("clipPath"),
    ).map((element: Element): string => {
      return element.id;
    });

    expect(ids.length).toBe(9);
    for (const id of ids) {
      expect(id.startsWith("dashboard-theme-preview-")).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("pressing a picture picks its choice and saves it", async () => {
    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(picture(DashboardTheme.Dark).slot);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, unknown>)["data"],
    ).toEqual({ theme: DashboardTheme.Dark });
    expect(checked()).toEqual([DashboardTheme.Dark]);
  });

  test("for someone who may not edit the dashboard, pressing a picture saves nothing", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to update this Dashboard.",
    };

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(picture(DashboardTheme.Dark).slot);
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(checked()).toEqual([DashboardTheme.Light]);
  });
});

describe("what the card does not have", () => {
  test("no note under the choices: a dashboard has no custom code", async () => {
    await renderCard();
    await loaded();

    const card: HTMLElement = screen.getByTestId(DASHBOARD_THEME_CARD_TEST_ID);

    expect(card.querySelectorAll("p.border-t")).toHaveLength(0);
    expect(card.querySelector("code")).toBeNull();
  });
});
