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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * Admin Dashboard > Settings > Session Length (Enterprise Edition), as a
 * master admin uses it:
 *
 *   - it reads the one GlobalConfig row's five columns, and shows the two
 *     lengths every sign-in is held to - No limit and 30 days until they are
 *     set - with what each means, and that API keys and MCP connections are
 *     not sign-ins;
 *   - each pick saves the moment it is made, one column at a time; a pick
 *     that signs nobody out at once (a longer length, or one nobody is past)
 *     is saved without a word, and one that signs people out is asked first,
 *     saying how many, and whether the master admin is one of them - or, when
 *     the server cannot say, in general words; Cancel saves nothing, and the
 *     row goes back;
 *   - SSO sign-ins' own lengths are folded under More settings, behind a
 *     switch, whose header says "SSO Sign-ins: On" while it is; turned on,
 *     they start at the lengths above, so nobody is signed out or kept
 *     longer by it;
 *   - each length reads as a form field does - what it sets, what the pick
 *     means, then the dropdown, with "Saved" after it;
 *   - without a license that includes session lengths, the page says so, and
 *     offers only the defaults - what is set can always be removed.
 *
 * Only the network and the license mode are stubbed, and the page frame and
 * the side menu are plain; the rows, their dropdowns (react-select), the
 * switch, the save-on-change hook, the folded section, the license notice
 * and the confirmation are the real ones.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("@oneuptime/admin-dashboard/Utils/ModelAPI", () => {
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

jest.mock("Common/UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      breadcrumbLinks: Array<{ title: string; to: { toString: () => string } }>;
      children: ReactElement;
    }): ReactElement => {
      return (
        <div data-testid="page">
          <h1>{props.title}</h1>
          <nav data-testid="breadcrumbs">
            {props.breadcrumbLinks.map(
              (link: { title: string; to: { toString: () => string } }) => {
                return (
                  <a key={link.title} href={link.to.toString()}>
                    {link.title}
                  </a>
                );
              },
            )}
          </nav>
          {props.children}
        </div>
      );
    },
  };
});

jest.mock("@oneuptime/admin-dashboard/Pages/Settings/SideMenu", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <aside data-testid="settings-side-menu" />;
    },
  };
});

let mockLicenseMode: string = "editable";
let mockLicenseFeatures: Array<unknown> = [];

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (feature: unknown): string => {
        mockLicenseFeatures.push(feature);
        return mockLicenseMode;
      },
    };
  },
);

jest.mock("react-i18next", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-i18next",
  ) as Record<string, unknown>;

  return {
    ...actual,
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import SessionLengthSettingsPage from "../../../AdminDashboard/SessionLength/SessionLengthSettingsPage";
import SessionLengthCopy, {
  getSessionLengthRowTestId,
  SESSION_LENGTH_MORE_SETTINGS_TEST_ID,
  SSO_SESSION_LENGTH_CARD_TEST_ID,
} from "../../../AdminDashboard/SessionLength/SessionLengthCopy";
import {
  getSeparateSsoChange,
  SEPARATE_SSO_SWITCH_TEST_ID,
} from "../../../AdminDashboard/SessionLength/SessionLengthSettingRows";
import { SESSION_LENGTH_PREVIEW_PATH } from "../../../AdminDashboard/SessionLength/SessionLengthSettingsAPI";
import { LicensedFeature } from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";

type Row = Partial<
  Record<
    | "sessionLengthInMinutes"
    | "sessionIdleTimeoutInMinutes"
    | "useSeparateSsoSessionLengths"
    | "ssoSessionLengthInMinutes"
    | "ssoSessionIdleTimeoutInMinutes",
    number | boolean | null
  >
>;

const LENGTH: string = "sessionLengthInMinutes";
const IDLE: string = "sessionIdleTimeoutInMinutes";
const SSO_LENGTH: string = "ssoSessionLengthInMinutes";
const SSO_IDLE: string = "ssoSessionIdleTimeoutInMinutes";

const NOTICE_TEST_ID_PREFIX: string = "enterprise-setting-license";

// What the server holds, or a failed read.
let stored: Row | Error = {};
// What the preview answers, or how it fails.
let preview: JSONObject | "error" = { peopleSignedOut: 0, includesYou: false };
let post: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  stored = {};
  preview = { peopleSignedOut: 0, includesYou: false };
  mockLicenseMode = "editable";
  mockLicenseFeatures = [];

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    const config: GlobalConfig = new GlobalConfig();
    Object.assign(config, stored);
    return config;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  post = jest
    .spyOn(API, "post")
    .mockImplementation(
      async (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        if (preview === "error") {
          return new HTTPErrorResponse(
            500,
            { message: "Something went wrong" },
            {},
          );
        }

        return new HTTPResponse<JSONObject>(200, preview, {});
      },
    ) as unknown as ReturnType<typeof jest.spyOn>;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

async function openPage(): Promise<void> {
  await act(async (): Promise<void> => {
    render(<SessionLengthSettingsPage />);
  });
  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
  await flush();
}

function row(column: string): HTMLElement {
  return screen.getByTestId(getSessionLengthRowTestId(column));
}

function box(column: string): HTMLElement {
  return within(row(column)).getByRole("combobox", { hidden: true });
}

function shown(column: string): string {
  return (
    row(column).querySelector(".ou-select__single-value")?.textContent ||
    row(column).querySelector(".ou-select__placeholder")?.textContent ||
    ""
  );
}

function description(column: string): string {
  return (
    screen.getByTestId(`${getSessionLengthRowTestId(column)}-description`)
      .textContent || ""
  );
}

function options(column: string): Array<HTMLElement> {
  fireEvent.keyDown(box(column), { key: "ArrowDown", code: "ArrowDown" });

  return screen.queryAllByRole("option");
}

function offered(column: string): Array<string> {
  const labels: Array<string> = options(column).map(
    (option: HTMLElement): string => {
      return (option.textContent || "").trim();
    },
  );

  fireEvent.keyDown(box(column), { key: "Escape", code: "Escape" });

  return labels;
}

function enabledOptions(column: string): Array<string> {
  const labels: Array<string> = options(column)
    .filter((option: HTMLElement): boolean => {
      return option.getAttribute("aria-disabled") !== "true";
    })
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });

  fireEvent.keyDown(box(column), { key: "Escape", code: "Escape" });

  return labels;
}

async function pick(column: string, label: string): Promise<void> {
  fireEvent.keyDown(box(column), { key: "ArrowDown", code: "ArrowDown" });

  const option: HTMLElement = screen.getByRole("option", { name: label });

  fireEvent.mouseDown(option);
  fireEvent.click(option);
  await flush();
}

function writes(): Array<Record<string, unknown>> {
  return updateByIdMock.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    },
  );
}

function previewsAsked(): Array<JSONObject> {
  return post.mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
  });
}

function confirmation(): HTMLElement | null {
  return screen.queryByTestId("confirm-modal-description");
}

// Opens More settings, as a master admin does to reach SSO sign-ins.
async function openMoreSettings(): Promise<void> {
  fireEvent.click(
    within(
      screen.getByTestId(SESSION_LENGTH_MORE_SETTINGS_TEST_ID),
    ).getByTestId("folded-section-header"),
  );
  await flush();
}

function ssoSwitch(): HTMLElement {
  return within(
    screen.getByTestId(SEPARATE_SSO_SWITCH_TEST_ID + "-row"),
  ).getByRole("switch");
}

// What the folded header says of SSO sign-ins.
function ssoFoldedItem(): HTMLElement {
  return within(
    screen.getByTestId(SESSION_LENGTH_MORE_SETTINGS_TEST_ID),
  ).getByTestId("folded-section-item");
}

describe("what the page reads and shows", () => {
  test("reads the five columns of the one GlobalConfig row, and asks the license about session lengths alone", async () => {
    await openPage();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };

    expect(request.modelType).toBe(GlobalConfig);
    expect(request.id.toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(request.select).toEqual({
      sessionLengthInMinutes: true,
      sessionIdleTimeoutInMinutes: true,
      useSeparateSsoSessionLengths: true,
      ssoSessionLengthInMinutes: true,
      ssoSessionIdleTimeoutInMinutes: true,
    });
    expect(new Set(mockLicenseFeatures)).toEqual(
      new Set([LicensedFeature.SessionLength]),
    );
  });

  test("until they are set: No limit, and 30 days without use, each saying what it means", async () => {
    await openPage();

    expect(
      within(screen.getByTestId("breadcrumbs")).getByText(
        SessionLengthCopy.cardTitle,
      ),
    ).toHaveAttribute("href", "/admin/settings/session-length");
    expect(shown(LENGTH)).toBe("No limit");
    expect(description(LENGTH)).toBe(
      SessionLengthCopy.lengthNoLimitDescription,
    );
    expect(shown(IDLE)).toBe("30 days");
    expect(description(IDLE)).toBe(SessionLengthCopy.idleDefaultDescription);
  });

  test("each length reads as a form field: what it sets, what the pick means, then the dropdown, with Saved after it", async () => {
    stored = { sessionLengthInMinutes: 480 };

    await openPage();

    for (const column of [LENGTH, IDLE]) {
      const testId: string = getSessionLengthRowTestId(column);
      const label: HTMLElement = screen.getByTestId(`${testId}-label`);
      const meaning: HTMLElement = screen.getByTestId(`${testId}-description`);
      const dropdown: HTMLElement = screen.getByTestId(`${testId}-dropdown`);
      const status: HTMLElement = screen.getByTestId(`${testId}-status`);

      // In this order on the page, and so for a screen reader too.
      expect(
        label.compareDocumentPosition(meaning) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        meaning.compareDocumentPosition(dropdown) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        dropdown.compareDocumentPosition(status) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // The dropdown is named by what it sets, and described by what the pick means.
      expect(box(column).getAttribute("aria-labelledby")).toBe(label.id);
      expect(box(column).getAttribute("aria-describedby") || "").toContain(
        meaning.id,
      );
    }

    await pick(LENGTH, "14 days");

    await waitFor(() => {
      expect(
        screen.getByTestId(`${getSessionLengthRowTestId(LENGTH)}-status`),
      ).toHaveTextContent("Saved");
    });
    expect(
      screen.getByTestId(`${getSessionLengthRowTestId(IDLE)}-status`),
    ).toHaveTextContent("");
  });

  test("says that API keys and MCP connections are not sign-ins", async () => {
    await openPage();

    expect(
      screen.getByText(SessionLengthCopy.notSessionsNote),
    ).toBeInTheDocument();
  });

  test("what is set, with what it means", async () => {
    stored = { sessionLengthInMinutes: 480, sessionIdleTimeoutInMinutes: 30 };

    await openPage();

    expect(shown(LENGTH)).toBe("8 hours");
    expect(description(LENGTH)).toBe(SessionLengthCopy.lengthSetDescription);
    expect(shown(IDLE)).toBe("30 minutes");
    expect(description(IDLE)).toBe(SessionLengthCopy.idleSetDescription);
  });

  test("offers No limit, then 1 hour to 90 days; and 15 minutes to 14 days without use, then the 30 days of the default", async () => {
    await openPage();

    expect(offered(LENGTH)).toEqual([
      "No limit",
      "1 hour",
      "4 hours",
      "8 hours",
      "12 hours",
      "1 day",
      "3 days",
      "7 days",
      "14 days",
      "30 days",
      "90 days",
    ]);
    expect(offered(IDLE)).toEqual([
      "15 minutes",
      "30 minutes",
      "1 hour",
      "2 hours",
      "4 hours",
      "8 hours",
      "12 hours",
      "1 day",
      "3 days",
      "7 days",
      "14 days",
      "30 days",
    ]);
  });

  test("a length set through the API, which the list does not offer, is offered too, in its place", async () => {
    stored = { sessionLengthInMinutes: 45 };

    await openPage();

    expect(shown(LENGTH)).toBe("45 minutes");
    expect(offered(LENGTH).slice(0, 3)).toEqual([
      "No limit",
      "45 minutes",
      "1 hour",
    ]);
  });

  test("a read that fails says so, and Try again reads again", async () => {
    stored = new Error("the network went away");

    await openPage();

    expect(screen.queryByTestId(getSessionLengthRowTestId(LENGTH))).toBeNull();

    stored = {};
    fireEvent.click(screen.getByRole("button", { name: /refresh|try again/i }));
    await flush();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });
    await flush();

    expect(shown(LENGTH)).toBe("No limit");
  });
});

describe("a pick that signs nobody out right away", () => {
  test("a longer length is saved as it is picked, without asking anyone", async () => {
    stored = { sessionLengthInMinutes: 480 };

    await openPage();
    await pick(LENGTH, "No limit");

    await waitFor(() => {
      expect(writes()).toEqual([{ sessionLengthInMinutes: null }]);
    });
    expect(previewsAsked()).toEqual([]);
    expect(confirmation()).toBeNull();
    expect(shown(LENGTH)).toBe("No limit");
  });

  test("a shorter one nobody is past yet is saved once the server says so, without asking", async () => {
    await openPage();
    await pick(LENGTH, "8 hours");

    await waitFor(() => {
      expect(writes()).toEqual([{ sessionLengthInMinutes: 480 }]);
    });
    expect(confirmation()).toBeNull();
  });

  test("the server is asked about the whole setting the pick would leave, at the preview route", async () => {
    stored = { sessionIdleTimeoutInMinutes: 60 };

    await openPage();
    await pick(LENGTH, "8 hours");

    expect(previewsAsked()).toEqual([
      {
        sessionLengthInMinutes: 480,
        sessionIdleTimeoutInMinutes: 60,
        useSeparateSsoSessionLengths: false,
        ssoSessionLengthInMinutes: null,
        ssoSessionIdleTimeoutInMinutes: null,
      },
    ]);
    expect(
      (post.mock.calls[0]![0] as { url: { toString: () => string } }).url
        .toString()
        .endsWith(`/api${SESSION_LENGTH_PREVIEW_PATH}`),
    ).toBe(true);
  });
});

describe("a pick that signs people out right away", () => {
  test("is asked first, saying how many, and saved once confirmed", async () => {
    preview = { peopleSignedOut: 3, includesYou: false };

    await openPage();
    await pick(IDLE, "15 minutes");

    expect(writes()).toEqual([]);
    expect(
      screen.getByText(SessionLengthCopy.confirmTitle),
    ).toBeInTheDocument();
    expect(confirmation()).toHaveTextContent(
      "Saving this signs out 3 people right away: their sign-ins are already older, or have been idle longer, than it allows.",
    );
    // The row shows the pick while it is asked.
    expect(shown(IDLE)).toBe("15 minutes");

    fireEvent.click(
      screen.getByRole("button", { name: SessionLengthCopy.confirmButton }),
    );
    await flush();

    await waitFor(() => {
      expect(writes()).toEqual([{ sessionIdleTimeoutInMinutes: 15 }]);
    });
    expect(confirmation()).toBeNull();
  });

  test("one person, not the master admin: the one form of the sentence", async () => {
    preview = { peopleSignedOut: 1, includesYou: false };

    await openPage();
    await pick(LENGTH, "1 hour");

    expect(confirmation()).toHaveTextContent(
      "Saving this signs out 1 person right away: their sign-in is already older, or has been idle longer, than it allows.",
    );
    expect(confirmation()).not.toHaveTextContent(
      SessionLengthCopy.confirmIncludesYou,
    );
    expect(
      screen.getByRole("button", { name: SessionLengthCopy.confirmButton }),
    ).toBeInTheDocument();
  });

  test("many people, the master admin among them: says so, and that they come back here", async () => {
    preview = { peopleSignedOut: 37, includesYou: true };

    await openPage();
    await pick(LENGTH, "1 hour");

    expect(
      screen.getByText(SessionLengthCopy.confirmTitle),
    ).toBeInTheDocument();
    expect(confirmation()).toHaveTextContent(
      "Saving this signs out 37 people right away: their sign-ins are already older, or have been idle longer, than it allows.",
    );
    expect(confirmation()).toHaveTextContent(
      SessionLengthCopy.confirmIncludesYou,
    );
    expect(
      screen.getByRole("button", { name: SessionLengthCopy.confirmButton }),
    ).toBeInTheDocument();
  });

  test("only the master admin making it: asks them to sign themselves out, in words of their own", async () => {
    preview = { peopleSignedOut: 1, includesYou: true };

    await openPage();
    await pick(LENGTH, "1 hour");

    expect(
      screen.getByText(SessionLengthCopy.confirmOnlyYouTitle),
    ).toBeInTheDocument();
    expect(screen.queryByText(SessionLengthCopy.confirmTitle)).toBeNull();
    expect(confirmation()).toHaveTextContent(SessionLengthCopy.confirmOnlyYou);
    expect(confirmation()).not.toHaveTextContent("1 person");
    expect(
      screen.queryByRole("button", { name: SessionLengthCopy.confirmButton }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: SessionLengthCopy.confirmOnlyYouButton,
      }),
    );
    await flush();

    await waitFor(() => {
      expect(writes()).toEqual([{ sessionLengthInMinutes: 60 }]);
    });
  });

  test("Cancel saves nothing, and the row goes back to what is set", async () => {
    stored = { sessionLengthInMinutes: 480 };
    preview = { peopleSignedOut: 2, includesYou: false };

    await openPage();
    await pick(LENGTH, "1 hour");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();

    expect(writes()).toEqual([]);
    expect(confirmation()).toBeNull();
    expect(shown(LENGTH)).toBe("8 hours");
  });

  test("when the server cannot say who, it is asked in general words, and the button still says what going ahead does", async () => {
    preview = "error";

    await openPage();
    await pick(LENGTH, "1 hour");

    expect(confirmation()).toHaveTextContent(SessionLengthCopy.confirmUnknown);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: SessionLengthCopy.confirmButton }),
    );
    await flush();

    await waitFor(() => {
      expect(writes()).toEqual([{ sessionLengthInMinutes: 60 }]);
    });
  });

  test("a pick the server refuses goes back to what is set, with the reason under it", async () => {
    stored = { sessionLengthInMinutes: 480 };
    updateByIdMock.mockRejectedValue(
      new Error("A session length must be a whole number of minutes.") as never,
    );

    await openPage();
    await pick(LENGTH, "No limit");

    await waitFor(() => {
      expect(
        screen.getByTestId(`${getSessionLengthRowTestId(LENGTH)}-error`),
      ).toBeInTheDocument();
    });
    expect(shown(LENGTH)).toBe("8 hours");
  });
});

describe("SSO sign-ins, under More settings", () => {
  test("it starts folded, and a link to SSO Sign-ins opens it at the card", async () => {
    await openPage();

    expect(
      within(
        screen.getByTestId(SESSION_LENGTH_MORE_SETTINGS_TEST_ID),
      ).getByTestId("folded-section-header"),
    ).toHaveAttribute("aria-expanded", "false");

    cleanup();

    const place: string = getPageAnchorNameForTitle(
      SessionLengthCopy.ssoCardTitle,
    );

    expect(place).toBe("sso-sign-ins");

    window.history.replaceState(null, "", `#${place}`);

    try {
      await openPage();

      expect(
        within(
          screen.getByTestId(SESSION_LENGTH_MORE_SETTINGS_TEST_ID),
        ).getByTestId("folded-section-header"),
      ).toHaveAttribute("aria-expanded", "true");
      expect(ssoSwitch()).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "", window.location.pathname);
    }
  });

  test("folded, its header names SSO Sign-ins, and says On while they have lengths of their own", async () => {
    await openPage();

    expect(ssoFoldedItem()).toHaveAttribute("data-item-set", "false");
    expect(ssoFoldedItem()).toHaveTextContent(SessionLengthCopy.ssoCardTitle);
    expect(ssoFoldedItem()).not.toHaveTextContent("On");

    cleanup();
    stored = { useSeparateSsoSessionLengths: true };

    await openPage();

    expect(ssoFoldedItem()).toHaveAttribute("data-item-set", "true");
    expect(ssoFoldedItem()).toHaveTextContent(
      `${SessionLengthCopy.ssoCardTitle}: On`,
    );
  });

  test("with the switch off there is only the switch; on, the two SSO lengths", async () => {
    await openPage();

    const card: HTMLElement = screen.getByTestId(
      SSO_SESSION_LENGTH_CARD_TEST_ID,
    );

    expect(
      within(card).getByTestId(`${SEPARATE_SSO_SWITCH_TEST_ID}-row`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(getSessionLengthRowTestId(SSO_LENGTH)),
    ).toBeNull();
    expect(
      screen.queryByTestId(getSessionLengthRowTestId(SSO_IDLE)),
    ).toBeNull();

    cleanup();
    stored = {
      useSeparateSsoSessionLengths: true,
      ssoSessionLengthInMinutes: 60,
    };

    await openPage();

    expect(shown(SSO_LENGTH)).toBe("1 hour");
    expect(shown(SSO_IDLE)).toBe("30 days");
  });

  test("turning the switch on starts SSO sign-ins at the lengths above, in one write, without asking anyone", async () => {
    stored = { sessionLengthInMinutes: 480, sessionIdleTimeoutInMinutes: 60 };

    await openPage();
    await openMoreSettings();

    fireEvent.click(ssoSwitch());
    await flush();

    await waitFor(() => {
      expect(writes()).toEqual([
        {
          useSeparateSsoSessionLengths: true,
          ssoSessionLengthInMinutes: 480,
          ssoSessionIdleTimeoutInMinutes: 60,
        },
      ]);
    });
    expect(previewsAsked()).toEqual([]);
    expect(confirmation()).toBeNull();
    // Its two rows show what SSO sign-ins now follow: the same lengths.
    await waitFor(() => {
      expect(shown(SSO_LENGTH)).toBe("8 hours");
    });
    expect(shown(SSO_IDLE)).toBe("1 hour");
  });

  test("with nothing set, turning it on leaves SSO sign-ins at No limit and 30 days, as every sign-in is", async () => {
    await openPage();
    await openMoreSettings();

    fireEvent.click(ssoSwitch());
    await flush();

    await waitFor(() => {
      expect(writes()).toEqual([
        {
          useSeparateSsoSessionLengths: true,
          ssoSessionLengthInMinutes: null,
          ssoSessionIdleTimeoutInMinutes: null,
        },
      ]);
    });
    await waitFor(() => {
      expect(shown(SSO_LENGTH)).toBe("No limit");
    });
    expect(shown(SSO_IDLE)).toBe("30 days");
  });

  test("SSO lengths left from an earlier time it was on never come back: turning it on asks nothing and starts again from the lengths above", async () => {
    stored = { sessionLengthInMinutes: 480, ssoSessionLengthInMinutes: 60 };
    preview = { peopleSignedOut: 4, includesYou: false };

    await openPage();
    await openMoreSettings();

    fireEvent.click(ssoSwitch());
    await flush();

    expect(previewsAsked()).toEqual([]);
    expect(confirmation()).toBeNull();
    await waitFor(() => {
      expect(writes()).toEqual([
        {
          useSeparateSsoSessionLengths: true,
          ssoSessionLengthInMinutes: 480,
          ssoSessionIdleTimeoutInMinutes: null,
        },
      ]);
    });
    await waitFor(() => {
      expect(shown(SSO_LENGTH)).toBe("8 hours");
    });
  });

  test("turning it off when SSO sign-ins last longer asks first, since they then follow the shorter lengths above", async () => {
    stored = {
      sessionLengthInMinutes: 480,
      useSeparateSsoSessionLengths: true,
      ssoSessionLengthInMinutes: null,
    };
    preview = { peopleSignedOut: 2, includesYou: false };

    await openPage();
    await openMoreSettings();

    fireEvent.click(ssoSwitch());
    await flush();

    expect(previewsAsked()).toEqual([
      {
        sessionLengthInMinutes: 480,
        sessionIdleTimeoutInMinutes: null,
        useSeparateSsoSessionLengths: false,
        ssoSessionLengthInMinutes: null,
        ssoSessionIdleTimeoutInMinutes: null,
      },
    ]);
    expect(confirmation()).toHaveTextContent("Saving this signs out 2 people");
    expect(writes()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();

    expect(writes()).toEqual([]);
    expect(ssoSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("what the switch writes, on and off", () => {
    expect(
      getSeparateSsoChange(true, {
        sessionLengthInMinutes: 10080,
        sessionIdleTimeoutInMinutes: 15,
      }),
    ).toEqual({
      useSeparateSsoSessionLengths: true,
      ssoSessionLengthInMinutes: 10080,
      ssoSessionIdleTimeoutInMinutes: 15,
    });
    expect(
      getSeparateSsoChange(false, {
        sessionLengthInMinutes: 10080,
        sessionIdleTimeoutInMinutes: 15,
      }),
    ).toEqual({ useSeparateSsoSessionLengths: false });
  });

  test("its fold, holding one card, says nothing of its own once open: the card says it", async () => {
    await openPage();
    await openMoreSettings();

    const section: HTMLElement = screen.getByTestId(
      SESSION_LENGTH_MORE_SETTINGS_TEST_ID,
    );

    expect(
      within(section).getByTestId("folded-section-header"),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(section).queryByTestId("folded-section-description"),
    ).toBeNull();
    expect(
      within(section).getByText(SessionLengthCopy.ssoCardDescription),
    ).toBeInTheDocument();
  });

  test("its two lengths are named with the card first, so no two dropdowns on the page share a name", async () => {
    stored = { useSeparateSsoSessionLengths: true };

    await openPage();
    await openMoreSettings();

    const names: Array<[string, string]> = [
      [LENGTH, SessionLengthCopy.lengthLabel],
      [IDLE, SessionLengthCopy.idleLabel],
      [
        SSO_LENGTH,
        `${SessionLengthCopy.ssoCardTitle} ${SessionLengthCopy.lengthLabel}`,
      ],
      [
        SSO_IDLE,
        `${SessionLengthCopy.ssoCardTitle} ${SessionLengthCopy.idleLabel}`,
      ],
    ];

    for (const [column, name] of names) {
      expect(
        within(row(column)).getByRole("combobox", { hidden: true, name }),
      ).toBe(box(column));
      expect(
        screen.getAllByRole("combobox", { hidden: true, name }),
      ).toHaveLength(1);
    }

    // The card's title says it on the page; the name only repeats it to a screen reader.
    const context: HTMLElement = screen.getByTestId(
      `${getSessionLengthRowTestId(SSO_LENGTH)}-name-context`,
    );

    expect(context).not.toBeVisible();
    expect(
      screen.queryByTestId(`${getSessionLengthRowTestId(LENGTH)}-name-context`),
    ).toBeNull();
  });
});

describe("once a change that signs people out is saved", () => {
  /*
   * The server ends every session past the new lengths as the change is
   * saved, the master admin's own too when it is past them. The page then
   * reads the setting again: the server refuses that read when it signed
   * the master admin out, and the browser goes to the sign-in page, which
   * says why, and brings them back once they sign in (Common/UI/Utils/API,
   * BaseAPISessionLength) - as the confirmation said it would.
   */
  test("the setting is read again, so a master admin it signs out goes to the sign-in page right away", async () => {
    preview = { peopleSignedOut: 1, includesYou: true };

    await openPage();
    await pick(LENGTH, "1 hour");

    expect(getItemMock).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: SessionLengthCopy.confirmOnlyYouButton,
      }),
    );
    await flush();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });
    expect(writes()).toEqual([{ sessionLengthInMinutes: 60 }]);

    // Read after the write, the way the page first read it.
    expect(updateByIdMock.mock.invocationCallOrder[0]!).toBeLessThan(
      getItemMock.mock.invocationCallOrder[1]!,
    );
    expect(getItemMock.mock.calls[1]![0]).toEqual(
      getItemMock.mock.calls[0]![0],
    );
  });

  test("the same when it signs out others with the master admin among them, or when the server could not say who", async () => {
    const answers: Array<JSONObject | "error"> = [
      { peopleSignedOut: 37, includesYou: true },
      { peopleSignedOut: 12, includesYou: false },
      "error",
    ];

    for (const answer of answers) {
      cleanup();
      getItemMock.mockClear();
      updateByIdMock.mockClear();
      preview = answer;

      await openPage();
      await pick(LENGTH, "1 hour");

      fireEvent.click(
        screen.getByRole("button", { name: SessionLengthCopy.confirmButton }),
      );
      await flush();

      await waitFor(() => {
        expect(getItemMock).toHaveBeenCalledTimes(2);
      });
    }
  });

  test("a change that signs nobody out, or one not confirmed, is not read again", async () => {
    stored = { sessionLengthInMinutes: 480 };

    await openPage();
    await pick(LENGTH, "14 days");

    await waitFor(() => {
      expect(writes()).toEqual([{ sessionLengthInMinutes: 20160 }]);
    });

    preview = { peopleSignedOut: 2, includesYou: true };
    await pick(LENGTH, "1 hour");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();

    expect(writes()).toEqual([{ sessionLengthInMinutes: 20160 }]);
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("a save the server refuses is not read again, nor is the next pick that signs nobody out", async () => {
    preview = { peopleSignedOut: 1, includesYou: true };
    updateByIdMock.mockRejectedValueOnce(
      new Error("A session length must be a whole number of minutes.") as never,
    );

    await openPage();
    await pick(LENGTH, "1 hour");
    fireEvent.click(
      screen.getByRole("button", {
        name: SessionLengthCopy.confirmOnlyYouButton,
      }),
    );
    await flush();

    await waitFor(() => {
      expect(
        screen.getByTestId(`${getSessionLengthRowTestId(LENGTH)}-error`),
      ).toBeInTheDocument();
    });

    // Shorter, but nobody is past it yet: saved without asking.
    preview = { peopleSignedOut: 0, includesYou: false };
    await pick(IDLE, "14 days");

    await waitFor(() => {
      expect(writes()).toEqual([
        { sessionLengthInMinutes: 60 },
        { sessionIdleTimeoutInMinutes: 20160 },
      ]);
    });
    expect(confirmation()).toBeNull();
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("a read the server refuses leaves the page as it is: the browser is already on its way to the sign-in page", async () => {
    preview = { peopleSignedOut: 1, includesYou: true };

    await openPage();

    getItemMock.mockRejectedValueOnce(
      new Error("Your session has ended.") as never,
    );

    await pick(LENGTH, "1 hour");
    fireEvent.click(
      screen.getByRole("button", {
        name: SessionLengthCopy.confirmOnlyYouButton,
      }),
    );
    await flush();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(2);
    });
    await flush();

    expect(shown(LENGTH)).toBe("1 hour");
    expect(screen.queryByText(SessionLengthCopy.loadFailed)).toBeNull();
    expect(screen.queryByText("Your session has ended.")).toBeNull();
  });
});

describe("the license", () => {
  test("with one that includes session lengths, nothing is said above the page", async () => {
    await openPage();

    expect(
      document.querySelector(`[data-testid^="${NOTICE_TEST_ID_PREFIX}"]`),
    ).toBeNull();
  });

  test.each([["read-only"], ["not-included"]])(
    "%s: the page says so, and only the default - and what is set - can be picked",
    async (mode: string) => {
      mockLicenseMode = mode;
      stored = { sessionLengthInMinutes: 480 };

      await openPage();

      expect(
        screen.getByTestId(
          `${NOTICE_TEST_ID_PREFIX}-${mode}-notice-${LicensedFeature.SessionLength}`,
        ),
      ).toBeInTheDocument();
      expect(enabledOptions(LENGTH)).toEqual(["No limit", "8 hours"]);
      expect(enabledOptions(IDLE)).toEqual(["30 days"]);
    },
  );

  test("locked, removing what is set still saves", async () => {
    mockLicenseMode = "read-only";
    stored = { sessionLengthInMinutes: 480 };

    await openPage();
    await pick(LENGTH, "No limit");

    await waitFor(() => {
      expect(writes()).toEqual([{ sessionLengthInMinutes: null }]);
    });
  });

  test("locked, the SSO switch can be turned off and not on", async () => {
    mockLicenseMode = "read-only";

    await openPage();
    await openMoreSettings();

    expect(ssoSwitch()).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(ssoSwitch());
    await flush();

    expect(writes()).toEqual([]);

    cleanup();
    stored = { useSeparateSsoSessionLengths: true };

    await openPage();
    await openMoreSettings();

    expect(ssoSwitch()).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(ssoSwitch());
    await flush();

    await waitFor(() => {
      expect(writes()).toEqual([{ useSeparateSsoSessionLengths: false }]);
    });
  });

  test("in the trial or the grace period it warns, and every length can still be picked", async () => {
    mockLicenseMode = "grace";

    await openPage();

    expect(
      screen.getByTestId(
        `${NOTICE_TEST_ID_PREFIX}-grace-notice-${LicensedFeature.SessionLength}`,
      ),
    ).toBeInTheDocument();
    expect(enabledOptions(LENGTH)).toHaveLength(11);
  });
});
