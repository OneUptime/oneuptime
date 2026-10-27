import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Admin Dashboard > Settings > Custom Channels (Enterprise Edition), as a
 * master admin sees it:
 *
 *   - the license: the page asks about custom channels alone; with a license
 *     that covers them it says nothing, in the trial or the grace period it
 *     warns, and once they have stopped - the license lapsed, or leaves them
 *     out - it says so and is read-only: no Add, no edit and no Send test,
 *     while Delete stays, as the server allows (EditionPermissions);
 *   - the table and its form: through the Admin Dashboard's model API, two
 *     steps - the channel (name, URL, a signing secret made for the admin),
 *     then its delivery (on, and paging everyone, on by default);
 *   - Send test: one request to /custom-notification-channel/instance/test
 *     naming the channel, and the answer shown as it came: delivered, not
 *     delivered, refused (the edition's own words) or unreachable.
 *
 * The table is a stand-in that records its props, and the page frame and the
 * side menu are plain; the license notice and the test dialog are real.
 */

let mockTables: Record<string, Record<string, unknown>> = {};

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockTables[String(props["id"])] = props;
      return <div data-testid={`model-table-${String(props["id"])}`} />;
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
      sideMenu: ReactElement;
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
          {props.sideMenu}
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

import CustomChannelsSettingsPage, {
  CUSTOM_CHANNEL_FORM_STEPS,
  CUSTOM_CHANNEL_INSTANCE_TEST_PATH,
  generateSigningSecret,
} from "../../../AdminDashboard/CustomChannels/CustomChannelsSettingsPage";
import { CUSTOM_CHANNELS_SETTINGS_PAGE_TITLE } from "../../../AdminDashboard/CustomChannels/CustomChannelsPaths";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import API from "Common/UI/Utils/API/API";

const TABLE_ID: string = "custom-notification-channels-table";
const CHANNEL_ID: string = "c4a30000-0000-4000-8000-000000000001";

// The notice for each license mode, by the test id it carries.
const NOTICE_TEST_IDS: Record<string, string> = {
  "read-only":
    "enterprise-setting-license-read-only-notice-custom-notification-channels",
  "not-included":
    "enterprise-setting-license-not-included-notice-custom-notification-channels",
  grace: "enterprise-setting-license-grace-notice-custom-notification-channels",
};

const COMMUNITY_EDITION_MESSAGE: string =
  "This is a OneUptime Enterprise Edition feature and is not available in the Community Edition. Run the OneUptime Enterprise Edition image to use it. See https://oneuptime.com/enterprise/overview for details.";

type ActionButton = ActionButtonSchema<CustomNotificationChannel>;

interface FormField {
  field: Record<string, boolean>;
  title: string;
  stepId?: string;
  required?: boolean;
  defaultValue?: unknown;
  doNotShowWhenCreating?: boolean;
  collapsibleSection?: unknown;
}

interface Column {
  field: Record<string, boolean>;
  title: string;
}

let post: jest.SpyInstance;

function table(): Record<string, unknown> {
  return mockTables[TABLE_ID]!;
}

function actionButtons(): Array<ActionButton> {
  return table()["actionButtons"] as Array<ActionButton>;
}

function formFields(): Array<FormField> {
  return table()["formFields"] as Array<FormField>;
}

function formField(name: string): FormField {
  return formFields().find((field: FormField): boolean => {
    return Boolean(field.field[name]);
  })!;
}

function corpoApp(): CustomNotificationChannel {
  const row: CustomNotificationChannel = new CustomNotificationChannel();
  row._id = CHANNEL_ID;
  row.name = "CorpoApp";
  row.isEnabled = false;
  return row;
}

async function renderPage(mode: string = "editable"): Promise<void> {
  mockLicenseMode = mode;

  await act(async () => {
    render(
      <MemoryRouter>
        <CustomChannelsSettingsPage />
      </MemoryRouter>,
    );
  });
}

// Presses Send test on a row, as the table does, and waits for the answer.
async function sendTest(
  item: CustomNotificationChannel = corpoApp(),
): Promise<{ completed: jest.Mock; failed: jest.Mock }> {
  const completed: jest.Mock = jest.fn();
  const failed: jest.Mock = jest.fn();
  const button: ActionButton = actionButtons().find(
    (candidate: ActionButton): boolean => {
      return candidate.title === "Send test";
    },
  )!;

  await act(async () => {
    await (button.onClick(item, completed, failed) as unknown as Promise<void>);
  });

  return { completed, failed };
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

beforeEach(() => {
  mockTables = {};
  mockLicenseMode = "editable";
  mockLicenseFeatures = [];

  post = jest.spyOn(API, "post").mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        ok: true,
        responseStatusCode: 202,
        statusMessage: "Sent to CorpoApp (HTTP 202).",
      },
      {},
    ) as never,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the page", () => {
  test("asks the license about custom channels, and nothing else", async () => {
    await renderPage();

    expect(mockLicenseFeatures.length).toBeGreaterThan(0);
    expect(new Set(mockLicenseFeatures)).toEqual(
      new Set([LicensedFeature.CustomNotificationChannels]),
    );
  });

  test("sits under Settings, with its own breadcrumb", async () => {
    await renderPage();

    const breadcrumbs: HTMLElement = screen.getByTestId("breadcrumbs");

    expect(
      within(breadcrumbs).getByText(CUSTOM_CHANNELS_SETTINGS_PAGE_TITLE),
    ).toHaveAttribute("href", "/admin/settings/custom-channels");
    expect(screen.getByTestId("settings-side-menu")).toBeInTheDocument();
    expect(
      screen.getByTestId("custom-channels-settings-page"),
    ).toBeInTheDocument();
  });

  test("links to what a channel's service receives, in a new tab", async () => {
    await renderPage();

    const link: HTMLElement = screen
      .getByText("What your service receives")
      .closest("a")!;

    expect(link).toHaveAttribute(
      "href",
      "/docs/self-hosted/custom-notification-channels",
    );
  });

  test("lists the channels through the Admin Dashboard's model API, with their URL, whether they are on and whether they page everyone", async () => {
    await renderPage();

    expect(table()["modelType"]).toBe(CustomNotificationChannel);
    expect(table()["modelAPI"]).toBe(AdminModelAPI);
    expect(table()["createVerb"]).toBe("Add");
    expect(
      (table()["columns"] as Array<Column>).map((column: Column): string => {
        return column.title;
      }),
    ).toEqual(["Name", "Webhook URL", "On", "Pages Everyone"]);
    expect(String(table()["deleteConfirmationWarning"])).toContain(
      "Everyone's on-call rules that use this channel are deleted with it.",
    );
  });
});

describe("the license", () => {
  test.each(["editable", "unknown"])(
    "%s: no notice, and everything can be done",
    async (mode: string) => {
      await renderPage(mode);

      for (const testId of Object.values(NOTICE_TEST_IDS)) {
        expect(screen.queryByTestId(testId)).toBeNull();
      }

      expect(table()["isCreateable"]).toBe(true);
      expect(table()["isEditable"]).toBe(true);
      expect(table()["isDeleteable"]).toBe(true);
      expect(
        actionButtons().map((button: ActionButton): string => {
          return button.title;
        }),
      ).toEqual(["Send test"]);
    },
  );

  test("in the trial or the grace period: a warning, and everything can still be done", async () => {
    await renderPage(EnterpriseLicenseMode.Grace);

    expect(screen.getByTestId(NOTICE_TEST_IDS["grace"]!)).toHaveTextContent(
      "No valid Enterprise license: custom channels stop when the trial or grace period ends.",
    );
    expect(table()["isCreateable"]).toBe(true);
    expect(table()["isEditable"]).toBe(true);
    expect(actionButtons()).toHaveLength(1);
  });

  test.each([
    [
      EnterpriseLicenseMode.ReadOnly,
      "Enterprise license required: custom channels cannot be added or changed, and nothing is sent to them.",
    ],
    [
      EnterpriseLicenseMode.NotIncluded,
      "Your Enterprise license does not include custom channels: they cannot be added or changed, and nothing is sent to them.",
    ],
  ])(
    "%s: says nothing is sent, and the page is read-only - no Add, no edit, no Send test - but Delete stays",
    async (mode: string, title: string) => {
      await renderPage(mode);

      const notice: HTMLElement = screen.getByTestId(NOTICE_TEST_IDS[mode]!);

      expect(notice).toHaveTextContent(title);
      expect(notice).toHaveTextContent("You can still delete a channel.");
      expect(table()["isCreateable"]).toBe(false);
      expect(table()["isEditable"]).toBe(false);
      expect(table()["isDeleteable"]).toBe(true);
      expect(actionButtons()).toEqual([]);
    },
  );
});

describe("the form", () => {
  test("walks two steps: the channel, then its delivery", async () => {
    await renderPage();

    expect(table()["formSteps"]).toBe(CUSTOM_CHANNEL_FORM_STEPS);
    expect(
      CUSTOM_CHANNEL_FORM_STEPS.map(
        (step: FormStep<CustomNotificationChannel>): [string, string] => {
          return [step.id, step.title];
        },
      ),
    ).toEqual([
      ["channel", "Channel"],
      ["delivery", "Delivery"],
    ]);
    expect(
      formFields().map((field: FormField): [string, string | undefined] => {
        return [Object.keys(field.field)[0]!, field.stepId];
      }),
    ).toEqual([
      ["name", "channel"],
      ["webhookUrl", "channel"],
      ["secret", "channel"],
      ["isEnabled", "delivery"],
      ["pageEveryoneByDefault", "delivery"],
    ]);
  });

  test("every field is on a step the form has, and none is folded away", async () => {
    await renderPage();

    const stepIds: Array<string> = CUSTOM_CHANNEL_FORM_STEPS.map(
      (step: FormStep<CustomNotificationChannel>): string => {
        return step.id;
      },
    );

    for (const field of formFields()) {
      expect(stepIds).toContain(field.stepId);
      expect(field.collapsibleSection).toBeUndefined();
    }
  });

  test("the name, the URL and the secret are required; the switches are not", async () => {
    await renderPage();

    expect(formField("name").required).toBe(true);
    expect(formField("webhookUrl").required).toBe(true);
    expect(formField("secret").required).toBe(true);
    expect(formField("isEnabled").required).toBe(false);
    expect(formField("pageEveryoneByDefault").required).toBe(false);
  });

  test("the signing secret is made for the admin, once per visit, as 64 hex digits", async () => {
    await renderPage();

    const secret: unknown = formField("secret").defaultValue;

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(table()["selectMoreFields"]).toEqual({ secret: true });
  });

  test("a new channel is on and pages everyone; whether it is on is asked only when editing", async () => {
    await renderPage();

    expect(formField("isEnabled").doNotShowWhenCreating).toBe(true);
    expect(formField("pageEveryoneByDefault").defaultValue).toBe(true);
    expect(formField("pageEveryoneByDefault").title).toBe(
      "Page everyone through this channel",
    );
  });

  test("generateSigningSecret: 32 random bytes from the browser, as hex, never the same twice", () => {
    const getRandomValues: jest.SpyInstance = jest.spyOn(
      globalThis.crypto,
      "getRandomValues",
    );

    const first: string = generateSigningSecret();
    const second: string = generateSigningSecret();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    expect((getRandomValues.mock.calls[0]![0] as Uint8Array).length).toBe(32);
  });
});

describe("Send test", () => {
  test("posts the channel, by id, to the instance test route, once", async () => {
    await renderPage();
    await sendTest();

    expect(CUSTOM_CHANNEL_INSTANCE_TEST_PATH).toBe(
      "/custom-notification-channel/instance/test",
    );
    expect(post).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = post.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(String(request["url"])).toMatch(
      /\/custom-notification-channel\/instance\/test$/,
    );
    expect(request["data"]).toEqual({
      customNotificationChannelId: CHANNEL_ID,
    });
  });

  test("delivered: the dialog says what the channel's service answered", async () => {
    await renderPage();

    const { completed, failed } = await sendTest();

    expect(within(dialog()).getByText("Send test: CorpoApp")).toBeVisible();
    expect(dialog()).toHaveTextContent("Sent to CorpoApp (HTTP 202).");
    expect(completed).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  test("a channel that is off can be tried too: the button is on every row", async () => {
    await renderPage();

    const channel: CustomNotificationChannel = corpoApp();
    channel.isEnabled = false;

    await sendTest(channel);

    expect(post).toHaveBeenCalledTimes(1);
  });

  test("not delivered: the dialog shows the answer as an error", async () => {
    post.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          ok: false,
          responseStatusCode: 503,
          statusMessage:
            "Not delivered: CorpoApp answered HTTP 503 (tried 3 times).",
        },
        {},
      ) as never,
    );

    await renderPage();
    await sendTest();

    expect(dialog()).toHaveTextContent(
      "Not delivered: CorpoApp answered HTTP 503 (tried 3 times).",
    );
    expect(dialog()).not.toHaveTextContent(
      "Sending a test request to the channel.",
    );
  });

  test("refused by the server - custom channels not available - the dialog shows the server's own words", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(
        402,
        { error: COMMUNITY_EDITION_MESSAGE },
        {},
      ) as never,
    );

    await renderPage();
    await sendTest();

    expect(dialog()).toHaveTextContent(COMMUNITY_EDITION_MESSAGE);
  });

  test("a request that never got an answer: the dialog says so", async () => {
    post.mockRejectedValue(new Error("Network Error"));

    await renderPage();

    const { completed } = await sendTest();

    expect(dialog()).toHaveTextContent("Network Error");
    expect(completed).toHaveBeenCalledTimes(1);
  });

  test("while it is on its way the dialog says so; then it shows the answer", async () => {
    let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {
      return undefined;
    };

    post.mockReturnValue(
      new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void): void => {
          answer = resolve;
        },
      ) as never,
    );

    await renderPage();

    const button: ActionButton = actionButtons()[0]!;
    let pending: Promise<void> = Promise.resolve();

    await act(async () => {
      pending = button.onClick(
        corpoApp(),
        (): void => {
          return undefined;
        },
        (): void => {
          return undefined;
        },
      ) as unknown as Promise<void>;
    });

    expect(dialog()).toHaveTextContent("Sending a test request…");

    await act(async () => {
      answer(
        new HTTPResponse<JSONObject>(
          200,
          { ok: true, statusMessage: "Sent to CorpoApp (HTTP 200)." },
          {},
        ),
      );
      await pending;
    });

    expect(dialog()).toHaveTextContent("Sent to CorpoApp (HTTP 200).");
  });

  test("Close clears the dialog and refreshes the table", async () => {
    await renderPage();
    await sendTest();

    const later: Date = new Date("2031-01-01T00:00:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(later);

    await act(async () => {
      fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(table()["refreshToggle"]).toBe(later.toString());
  });

  test("a second test starts clean: nothing of the first answer is left", async () => {
    post
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          {
            ok: false,
            statusMessage: "Not delivered: CorpoApp answered HTTP 500.",
          },
          {},
        ) as never,
      )
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          { ok: true, statusMessage: "Sent to CorpoApp (HTTP 200)." },
          {},
        ) as never,
      );

    await renderPage();
    await sendTest();

    expect(dialog()).toHaveTextContent(
      "Not delivered: CorpoApp answered HTTP 500.",
    );

    await sendTest();

    expect(dialog()).toHaveTextContent("Sent to CorpoApp (HTTP 200).");
    expect(dialog()).not.toHaveTextContent("HTTP 500");
  });

  test("it never names another route, and the instance test needs no project", async () => {
    await renderPage();
    await sendTest();

    const request: Record<string, unknown> = post.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(Object.keys(request["data"] as JSONObject)).toEqual([
      "customNotificationChannelId",
    ]);
    expect(new ObjectID(CHANNEL_ID).toString()).toBe(
      (request["data"] as JSONObject)["customNotificationChannelId"],
    );
  });
});
