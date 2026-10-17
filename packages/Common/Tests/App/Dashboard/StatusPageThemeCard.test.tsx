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
 * Theme, on a status page's Branding page: Light, Dark, or as each visitor's
 * device is set - three radio rows that save the moment one is picked.
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

import StatusPageThemeCard from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageThemeCard";
import StatusPageThemeCopy, {
  STATUS_PAGE_THEME_CARD_TEST_ID,
  STATUS_PAGE_THEME_CHOICES,
  STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID,
  STATUS_PAGE_THEME_ERROR_TEST_ID,
  StatusPageThemeChoice,
  getStatusPageThemeChoiceTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageThemeCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import StatusPageTheme from "../../../Types/StatusPage/StatusPageTheme";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const STATUS_PAGE_ID: string = "5a5a5a5a-0000-4000-8000-0000000000cc";

interface Stored {
  theme?: string | null;
  customCSS?: string;
  headerHTML?: string;
  footerHTML?: string;
}

// What the status page holds, nothing, or a failed read.
let stored: Stored | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };
// The writes the server refuses, with why.
let refusal: string | null = null;

beforeEach(() => {
  stored = { theme: StatusPageTheme.Light };
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

    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    Object.assign(page, stored);

    return page;
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
    render(<StatusPageThemeCard statusPageId={new ObjectID(STATUS_PAGE_ID)} />);
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

function radio(theme: StatusPageTheme): HTMLInputElement {
  return screen.getByTestId(
    getStatusPageThemeChoiceTestId(theme),
  ) as HTMLInputElement;
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

describe("reading the status page", () => {
  test("asks for this page's theme, and the custom code that decides the note", async () => {
    await renderCard();
    await loaded();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual({
      theme: true,
      customCSS: true,
      headerHTML: true,
      footerHTML: true,
    });
  });

  test("is the Theme card: three choices, each named and explained, in one group named for the page", async () => {
    await renderCard();
    await loaded();

    const card: HTMLElement = screen.getByTestId(
      STATUS_PAGE_THEME_CARD_TEST_ID,
    );

    expect(screen.getByText(StatusPageThemeCopy.title)).toBeInTheDocument();
    expect(
      screen.getByText(StatusPageThemeCopy.description),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("radiogroup", {
        name: StatusPageThemeCopy.ariaLabel,
      }),
    ).toBeInTheDocument();

    for (const choice of STATUS_PAGE_THEME_CHOICES) {
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

  test.each([
    [StatusPageTheme.Light],
    [StatusPageTheme.Dark],
    [StatusPageTheme.System],
  ])("a %s page has that choice checked", async (theme: StatusPageTheme) => {
    stored = { theme };

    await renderCard();
    await loaded();

    expect(checked()).toEqual([theme]);
  });

  test.each([[null], [undefined], ["Sepia"]])(
    "a page with %p shows Light, the page it is drawn as",
    async (theme: string | null | undefined) => {
      stored = theme === undefined ? {} : { theme };

      await renderCard();
      await loaded();

      expect(checked()).toEqual([StatusPageTheme.Light]);
    },
  );

  test("a page that is not there says so, with no choices", async () => {
    stored = null;

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText(StatusPageThemeCopy.notFound),
      ).toBeInTheDocument();
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

    stored = { theme: StatusPageTheme.Dark };

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(STATUS_PAGE_THEME_CARD_TEST_ID)).getByTestId(
          "refresh-button",
        ),
      );
    });

    await loaded();
    expect(checked()).toEqual([StatusPageTheme.Dark]);
  });
});

describe("picking a theme", () => {
  test.each([[StatusPageTheme.Dark], [StatusPageTheme.System]])(
    "%s is saved at once, for this page, and nothing else is sent",
    async (theme: StatusPageTheme) => {
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

      expect(request["modelType"]).toBe(StatusPage);
      expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
      expect(request["data"]).toEqual({ theme });
      expect(checked()).toEqual([theme]);
    },
  );

  test("says Saved beside the new choice once it is saved", async () => {
    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(radio(StatusPageTheme.Dark));
    });

    await waitFor(() => {
      expect(
        within(
          screen.getByTestId(
            `${getStatusPageThemeChoiceTestId(StatusPageTheme.Dark)}-status`,
          ),
        ).getByText("Saved"),
      ).toBeInTheDocument();
    });
  });

  test("picking the theme the page has sends nothing", async () => {
    stored = { theme: StatusPageTheme.System };

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(radio(StatusPageTheme.System));
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a pick the server refuses goes back to what the page has, with the reason", async () => {
    refusal = "Theme must be Light, Dark or System.";

    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(radio(StatusPageTheme.Dark));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(STATUS_PAGE_THEME_ERROR_TEST_ID),
      ).toHaveTextContent("Theme must be Light, Dark or System.");
    });
    expect(checked()).toEqual([StatusPageTheme.Light]);
  });

  test("the last of quick picks is the one the page ends up with", async () => {
    await renderCard();
    await loaded();

    await act(async () => {
      fireEvent.click(radio(StatusPageTheme.Dark));
      fireEvent.click(radio(StatusPageTheme.System));
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(2);
    });

    const last: Record<string, unknown> = updateByIdMock.mock
      .calls[1]![0] as Record<string, unknown>;

    expect(last["data"]).toEqual({ theme: StatusPageTheme.System });
    expect(checked()).toEqual([StatusPageTheme.System]);
  });
});

describe("someone who may not edit the status page", () => {
  test("sees every choice locked, with why, and a pick saves nothing", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to update this Status Page.",
    };

    await renderCard();
    await loaded();

    for (const choice of STATUS_PAGE_THEME_CHOICES as Array<StatusPageThemeChoice>) {
      expect(radio(choice.value)).toBeDisabled();
    }

    expect(
      screen.getByText(
        "You do not have permission to update this Status Page.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(radio(StatusPageTheme.Dark));
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("the gate is asked about updating a status page", async () => {
    await renderCard();
    await loaded();

    const call: Array<unknown> = (PermissionGate.check as unknown as jest.Mock)
      .mock.calls[0] as Array<unknown>;

    expect(call[0]).toBeInstanceOf(StatusPage);
    expect(call[1]).toBe(ModelAction.Update);
  });
});

describe("a page with custom code", () => {
  test.each([
    ["custom CSS", { customCSS: ".status-page { color: #111; }" }],
    ["header HTML", { headerHTML: "<div>Acme</div>" }],
    ["footer HTML", { footerHTML: "<p>Acme, Inc.</p>" }],
  ])(
    "with %s is told its code applies in both themes",
    async (_what: string, code: Stored) => {
      stored = { theme: StatusPageTheme.Light, ...code };

      await renderCard();
      await loaded();

      expect(
        screen.getByTestId(STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID),
      ).toHaveTextContent(StatusPageThemeCopy.customCodeNote);
    },
  );

  test("a page without any is not told anything", async () => {
    stored = { theme: StatusPageTheme.Dark, customCSS: "  " };

    await renderCard();
    await loaded();

    expect(
      screen.queryByTestId(STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID),
    ).toBeNull();
  });
});
