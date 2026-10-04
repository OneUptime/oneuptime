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
} from "@testing-library/react";
import React, { isValidElement, ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A status page's subscriber pages, wired: Subscriber Settings, Advanced
 * Settings and the five subscriber lists (email, SMS, Slack, Microsoft
 * Teams, webhook).
 *
 * The subscription switches - Show Subscriber Page and the five channels -
 * live in one place, the Channels card on Subscriber Settings. Advanced
 * Settings no longer repeats them, and a channel's list carries the
 * channel's own switch, in a quiet panel, where a red "not enabled" banner
 * used to send people to another page. The email forms carry the
 * shared-address advice as one sentence in the field's description. The
 * Notification Templates tab warns only about a linked template that cannot
 * be used.
 *
 * Tables, detail cards, the Channels card and the panel are recorded rather
 * than drawn (each has a suite of its own); what matters here is what each
 * page hands them, and what the pages no longer draw.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedDetailCards: Array<Record<string, unknown>> = [];
const recordedChannelCards: Array<Record<string, unknown>> = [];
const recordedOffPanels: Array<Record<string, unknown>> = [];
const recordedBulkForms: Array<Record<string, unknown>> = [];

(
  globalThis as unknown as {
    __subscriberPagesRecorded: Record<string, Array<Record<string, unknown>>>;
  }
).__subscriberPagesRecorded = {
  tables: recordedTables,
  cards: recordedDetailCards,
  channelCards: recordedChannelCards,
  offPanels: recordedOffPanels,
  bulkForms: recordedBulkForms,
};

type Recorder = (
  list: string,
  testId: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (list: string, testId: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    (
      globalThis as unknown as {
        __subscriberPagesRecorded: Record<
          string,
          Array<Record<string, unknown>>
        >;
      }
    ).__subscriberPagesRecorded[list]!.push(props);

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", { "data-testid": testId });
  };
};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return { __esModule: true, default: mockRecorder("tables", "model-table") };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: mockRecorder("cards", "card-model-detail"),
  };
});

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: mockRecorder("bulkForms", "bulk-form-modal"),
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelsCard",
  () => {
    return {
      __esModule: true,
      default: mockRecorder("channelCards", "subscriber-channels-card"),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelOffPanel",
  () => {
    return {
      __esModule: true,
      default: mockRecorder("offPanels", "subscriber-channel-off-panel"),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationWarnings",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/TeamAddedSubscribersUnsubscribedNotice",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: zone.js reports a rejected promise as unhandled even
 * when the page catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import Field from "../../../UI/Components/Forms/Types/Field";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  SUBSCRIPTION_SWITCH_COLUMNS,
  SubscriptionSwitchColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelsCopy";
import { DISPLAY_SETTING_COLUMNS } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import { STATUS_PAGE_DISPLAY_SETTINGS_CARD_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCard";
import SubscriberUnsubscribeCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberUnsubscribeCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import EmailSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/EmailSubscribers";
import MicrosoftTeamsSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/MicrosoftTeamsSubscribers";
import SMSSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SMSSubscribers";
import SlackSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SlackSubscribers";
import StatusPageSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPageSettings";
import SubscriberSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SubscriberSettings";
import WebhookSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/WebhookSubscribers";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

let storedStatusPage: Record<string, unknown> = {};
let linkedMethods: Array<StatusPageSubscriberNotificationMethod> = [];

beforeEach(() => {
  recordedTables.length = 0;
  recordedDetailCards.length = 0;
  recordedChannelCards.length = 0;
  recordedOffPanels.length = 0;
  recordedBulkForms.length = 0;

  storedStatusPage = {};
  linkedMethods = [];

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    Object.assign(page, storedStatusPage);
    return page;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    const data: Array<StatusPageSubscriberNotificationTemplateStatusPage> =
      linkedMethods.map(
        (
          method: StatusPageSubscriberNotificationMethod,
          index: number,
        ): StatusPageSubscriberNotificationTemplateStatusPage => {
          const template: StatusPageSubscriberNotificationTemplate =
            new StatusPageSubscriberNotificationTemplate();
          template.notificationMethod = method;

          const link: StatusPageSubscriberNotificationTemplateStatusPage =
            new StatusPageSubscriberNotificationTemplateStatusPage();
          link._id = `33333333-3333-4333-8333-33333333333${index}`;
          link.statusPageSubscriberNotificationTemplate = template;
          return link;
        },
      );

    return { data: data, count: data.length, skip: 0, limit: 10000 };
  });

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/status-pages"));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(element: ReactElement): Promise<void> {
  await act(async () => {
    render(element);
  });

  // Let the page's own reads land.
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

function fieldKey(field: { field?: unknown }): string {
  return Object.keys((field.field as Record<string, unknown>) || {})[0]!;
}

// Every column a detail card shows or edits.
function columnsOfCard(card: Record<string, unknown>): Array<string> {
  const formFields: Array<{ field?: unknown }> =
    (card["formFields"] as Array<{ field?: unknown }>) || [];
  const detailFields: Array<{ field?: unknown }> =
    ((card["modelDetailProps"] as Record<string, unknown>)?.[
      "fields"
    ] as Array<{ field?: unknown }>) || [];

  return [...formFields, ...detailFields].map(fieldKey);
}

function lastTable(): Record<string, unknown> {
  expect(recordedTables.length).toBeGreaterThan(0);
  return recordedTables[recordedTables.length - 1]!;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") {
    return node;
  }

  if (isValidElement(node)) {
    // Read back as the browser would, entities and all.
    const holder: HTMLDivElement = document.createElement("div");
    holder.innerHTML = renderToStaticMarkup(node as ReactElement);
    return holder.textContent || "";
  }

  return "";
}

describe("Subscriber Settings", () => {
  test("the Settings tab has the Channels card, for this status page", async () => {
    await renderPage(<SubscriberSettings {...PAGE_PROPS} />);

    expect(recordedChannelCards.length).toBeGreaterThan(0);
    expect(
      (
        recordedChannelCards[recordedChannelCards.length - 1]![
          "statusPageId"
        ] as ObjectID
      ).toString(),
    ).toBe(STATUS_PAGE_ID);
  });

  test("no other card on it shows or edits a subscription switch", async () => {
    await renderPage(<SubscriberSettings {...PAGE_PROPS} />);

    expect(recordedDetailCards.length).toBeGreaterThan(0);

    for (const card of recordedDetailCards) {
      for (const column of columnsOfCard(card)) {
        expect([card["name"], column]).not.toEqual([
          card["name"],
          expect.stringMatching(
            /^(showSubscriberPageOnStatusPage|enable(Email|Sms|Slack|MicrosoftTeams|Webhook)Subscribers)$/,
          ),
        ]);
      }
    }
  });

  test("keeps its other cards: Advanced Subscriber Settings, Email Footer, Custom SMTP and Twilio Config", async () => {
    await renderPage(<SubscriberSettings {...PAGE_PROPS} />);

    const titles: Array<unknown> = recordedDetailCards.map(
      (card: Record<string, unknown>): unknown => {
        return (card["cardProps"] as Record<string, unknown>)["title"];
      },
    );

    expect(Array.from(new Set(titles))).toEqual([
      "Advanced Subscriber Settings",
      "Email Footer Settings",
      "Custom SMTP",
      "Twilio Config",
    ]);
  });

  test("with no subscriber timezones, says what subscribers see in the placeholder chip, which wraps", async () => {
    await renderPage(<SubscriberSettings {...PAGE_PROPS} />);

    const advanced: Record<string, unknown> | undefined =
      recordedDetailCards.find((card: Record<string, unknown>): boolean => {
        return (
          (card["cardProps"] as Record<string, unknown>)["title"] ===
          "Advanced Subscriber Settings"
        );
      });

    expect(advanced).toBeDefined();

    const timezones:
      | { field?: unknown; getElement?: (item: StatusPage) => ReactElement }
      | undefined = (
      (advanced!["modelDetailProps"] as Record<string, unknown>)[
        "fields"
      ] as Array<{
        field?: unknown;
        getElement?: (item: StatusPage) => ReactElement;
      }>
    ).find((field: { field?: unknown }): boolean => {
      return fieldKey(field) === "subscriberTimezones";
    });

    expect(timezones?.getElement).toBeDefined();

    const { container } = render(timezones!.getElement!(new StatusPage()));

    expect(container.textContent).toBe(
      "No subscriber timezones selected so far. Subscribers will receive notifications with times shown in GMT, EST, PST, IST, ACT timezones by default.",
    );
    /*
     * The chip every unset value on a detail card has. It used to be
     * no-wrap, and these two sentences ran past the card's edge; it wraps
     * now, so the page needs no plain-text stand-in of its own.
     */
    expect(
      container.querySelector('[data-testid="placeholder-text"]'),
    ).not.toBeNull();
    expect(container.innerHTML).not.toContain("whitespace-nowrap");
    expect(container.innerHTML).toContain("whitespace-normal");
  });

  describe("the Notification Templates tab", () => {
    async function openTemplates(): Promise<void> {
      await renderPage(<SubscriberSettings {...PAGE_PROPS} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("tab", { name: "Notification Templates" }),
        );
      });

      // The table reports what it loaded, and the page reads the links.
      const table: Record<string, unknown> = lastTable();

      expect(table["modelType"]).toBe(
        StatusPageSubscriberNotificationTemplateStatusPage,
      );

      await act(async () => {
        (
          table["onFetchSuccess"] as (
            data: Array<unknown>,
            count: number,
          ) => void
        )([], 0);
      });

      await act(async () => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      });
    }

    function warning(): HTMLElement | null {
      return screen.queryByTestId("custom-templates-require-configuration");
    }

    test("no linked template, and no Custom SMTP or Twilio Config: nothing to warn about", async () => {
      linkedMethods = [];

      await openTemplates();

      expect(warning()).not.toBeInTheDocument();
      expect(
        screen.queryByText("Custom Templates Require Configuration"),
      ).not.toBeInTheDocument();
    });

    test("Slack, Microsoft Teams and webhook templates need nothing more", async () => {
      linkedMethods = [
        StatusPageSubscriberNotificationMethod.Slack,
        StatusPageSubscriberNotificationMethod.MicrosoftTeams,
        StatusPageSubscriberNotificationMethod.Webhook,
      ];

      await openTemplates();

      expect(warning()).not.toBeInTheDocument();
    });

    test("a linked Email template without a Custom SMTP: says the email templates are not used", async () => {
      linkedMethods = [StatusPageSubscriberNotificationMethod.Email];

      await openTemplates();

      await waitFor(() => {
        expect(warning()).toBeInTheDocument();
      });
      expect(warning()).toHaveTextContent(
        "Custom SMTP is not configured for this status page. Custom Email notification templates will not be used.",
      );
      expect(warning()).toHaveTextContent(
        "Custom Templates Require Configuration",
      );
    });

    test("a linked SMS template without a Twilio Config: says the SMS templates are not used", async () => {
      linkedMethods = [StatusPageSubscriberNotificationMethod.SMS];

      await openTemplates();

      await waitFor(() => {
        expect(warning()).toBeInTheDocument();
      });
      expect(warning()).toHaveTextContent(
        "Twilio Config is not configured for this status page. Custom SMS notification templates will not be used.",
      );
    });

    test("both, without either: says so about both", async () => {
      linkedMethods = [
        StatusPageSubscriberNotificationMethod.SMS,
        StatusPageSubscriberNotificationMethod.Email,
      ];

      await openTemplates();

      await waitFor(() => {
        expect(warning()).toBeInTheDocument();
      });
      expect(warning()).toHaveTextContent(
        "Custom SMTP and Twilio Config are not configured for this status page.",
      );
    });

    test("an Email template with a Custom SMTP, and no SMS template: nothing to warn about", async () => {
      storedStatusPage = {
        smtpConfig: { _id: "44444444-4444-4444-8444-444444444444" },
      };
      linkedMethods = [StatusPageSubscriberNotificationMethod.Email];

      await openTemplates();

      expect(warning()).not.toBeInTheDocument();
    });

    test("only the configuration that is missing is named", async () => {
      storedStatusPage = {
        smtpConfig: { _id: "44444444-4444-4444-8444-444444444444" },
      };
      linkedMethods = [
        StatusPageSubscriberNotificationMethod.Email,
        StatusPageSubscriberNotificationMethod.SMS,
      ];

      await openTemplates();

      await waitFor(() => {
        expect(warning()).toBeInTheDocument();
      });
      expect(warning()).toHaveTextContent(
        "Twilio Config is not configured for this status page.",
      );
      expect(warning()).not.toHaveTextContent("Custom SMTP is not configured");
    });

    test("asks for this page's linked templates and their method, each time the table loads", async () => {
      await openTemplates();

      expect(getListMock).toHaveBeenCalledTimes(1);

      const request: Record<string, unknown> = getListMock.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(request["modelType"]).toBe(
        StatusPageSubscriberNotificationTemplateStatusPage,
      );
      expect(
        (
          (request["query"] as Record<string, unknown>)[
            "statusPageId"
          ] as ObjectID
        ).toString(),
      ).toBe(STATUS_PAGE_ID);
      expect(request["select"]).toEqual({
        _id: true,
        statusPageSubscriberNotificationTemplate: {
          notificationMethod: true,
        },
      });

      // Linking one reloads the table, and the warning follows.
      linkedMethods = [StatusPageSubscriberNotificationMethod.Email];

      await act(async () => {
        (
          lastTable()["onFetchSuccess"] as (
            data: Array<unknown>,
            count: number,
          ) => void
        )([], 1);
      });

      await waitFor(() => {
        expect(warning()).toBeInTheDocument();
      });
      expect(getListMock).toHaveBeenCalledTimes(2);

      // And unlinking it takes the warning away again.
      linkedMethods = [];

      await act(async () => {
        (
          lastTable()["onFetchSuccess"] as (
            data: Array<unknown>,
            count: number,
          ) => void
        )([], 0);
      });

      await waitFor(() => {
        expect(warning()).not.toBeInTheDocument();
      });
    });

    test("a list that fails to load warns about nothing", async () => {
      linkedMethods = [StatusPageSubscriberNotificationMethod.Email];
      getListMock.mockImplementation(async (): Promise<unknown> => {
        throw new Error("Request failed");
      });

      await openTemplates();

      expect(warning()).not.toBeInTheDocument();
    });
  });
});

describe("Advanced Settings", () => {
  /*
   * What the page shows is one card of its own now ("What your status page
   * shows", drawn for real here), the overall uptime % and the downtime
   * statuses included: no detail card with an Edit dialog is left on the
   * page, and nothing on it is about subscribers.
   */
  test("no card shows or edits Show Subscriber Page or a subscriber channel", async () => {
    await renderPage(<StatusPageSettings {...PAGE_PROPS} />);

    expect(recordedDetailCards).toEqual([]);

    await waitFor(() => {
      expect(
        screen.getByTestId(STATUS_PAGE_DISPLAY_SETTINGS_CARD_TEST_ID),
      ).toBeInTheDocument();
    });

    const requested: Array<string> = getItemMock.mock.calls.flatMap(
      (call: Array<unknown>): Array<string> => {
        return Object.keys(
          ((call[0] as Record<string, unknown>)["select"] as Record<
            string,
            unknown
          >) || {},
        );
      },
    );

    expect(requested.length).toBeGreaterThan(0);

    for (const column of SUBSCRIPTION_SWITCH_COLUMNS) {
      expect(DISPLAY_SETTING_COLUMNS).not.toContain(column);
      expect(requested).not.toContain(column);
      expect(screen.queryByTestId(`subscription-switch-${column}`)).toBeNull();
    }
  });

  test("has no Subscriber Settings card", async () => {
    await renderPage(<StatusPageSettings {...PAGE_PROPS} />);

    expect(screen.queryByText("Subscriber Settings")).not.toBeInTheDocument();
    expect(recordedChannelCards).toEqual([]);
  });
});

interface ChannelPage {
  name: string;
  page: (props: PageComponentProps) => ReactElement;
  method: StatusPageSubscriberNotificationMethod;
  column: SubscriptionSwitchColumn;
  oldBanner: string;
}

const CHANNEL_PAGES: Array<ChannelPage> = [
  {
    name: "Email Subscribers",
    page: EmailSubscribers as unknown as ChannelPage["page"],
    method: StatusPageSubscriberNotificationMethod.Email,
    column: "enableEmailSubscribers",
    oldBanner: "Email subscribers are not enabled for this status page.",
  },
  {
    name: "SMS Subscribers",
    page: SMSSubscribers as unknown as ChannelPage["page"],
    method: StatusPageSubscriberNotificationMethod.SMS,
    column: "enableSmsSubscribers",
    oldBanner: "SMS subscribers are not enabled for this status page.",
  },
  {
    name: "Slack Subscribers",
    page: SlackSubscribers as unknown as ChannelPage["page"],
    method: StatusPageSubscriberNotificationMethod.Slack,
    column: "enableSlackSubscribers",
    oldBanner: "Slack subscribers are not enabled for this status page.",
  },
  {
    name: "Microsoft Teams Subscribers",
    page: MicrosoftTeamsSubscribers as unknown as ChannelPage["page"],
    method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
    column: "enableMicrosoftTeamsSubscribers",
    oldBanner:
      "Microsoft Teams subscribers are not enabled for this status page.",
  },
  {
    name: "Webhook Subscribers",
    page: WebhookSubscribers as unknown as ChannelPage["page"],
    method: StatusPageSubscriberNotificationMethod.Webhook,
    column: "enableWebhookSubscribers",
    oldBanner: "Webhook subscribers are not enabled for this status page.",
  },
];

describe.each(CHANNEL_PAGES)("$name", (channelPage: ChannelPage) => {
  async function renderChannelPage(isEnabled: boolean): Promise<void> {
    storedStatusPage = { [channelPage.column]: isEnabled };

    const Page: ChannelPage["page"] = channelPage.page;

    await renderPage(<Page {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(recordedOffPanels.length).toBeGreaterThan(0);
    });
  }

  function lastPanel(): Record<string, unknown> {
    return recordedOffPanels[recordedOffPanels.length - 1]!;
  }

  test("reads whether its channel is on", async () => {
    await renderChannelPage(false);

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect(request["select"]).toMatchObject({ [channelPage.column]: true });
  });

  test("with the channel off, hands the panel this page's channel, off", async () => {
    await renderChannelPage(false);

    expect(lastPanel()["method"]).toBe(channelPage.method);
    expect(lastPanel()["isEnabled"]).toBe(false);
    expect((lastPanel()["statusPageId"] as ObjectID).toString()).toBe(
      STATUS_PAGE_ID,
    );
  });

  test("with the channel on, hands the panel on (which then draws nothing)", async () => {
    await renderChannelPage(true);

    expect(lastPanel()["method"]).toBe(channelPage.method);
    expect(lastPanel()["isEnabled"]).toBe(true);
  });

  test("never draws the panel before it knows whether the channel is on", async () => {
    await renderChannelPage(true);

    for (const panel of recordedOffPanels) {
      expect(panel["isEnabled"]).toBe(true);
    }
  });

  test("shows no red 'not enabled' banner, off or on", async () => {
    await renderChannelPage(false);

    expect(
      screen.queryByText(channelPage.oldBanner, { exact: false }),
    ).toBeNull();
    expect(
      screen.queryByText("Please enable it in Subscriber Settings", {
        exact: false,
      }),
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("still lists this channel's subscribers below", async () => {
    await renderChannelPage(false);

    const table: Record<string, unknown> = lastTable();

    expect(table["name"]).toBe(`Status Page > ${channelPage.name}`);
    expect(table["isCreateable"]).toBe(true);
  });
});

describe("the email forms' shared-address advice", () => {
  async function renderEmailPage(): Promise<void> {
    storedStatusPage = { enableEmailSubscribers: true };

    await renderPage(<EmailSubscribers {...PAGE_PROPS} />);

    await waitFor(() => {
      const fields: Array<Field<unknown>> =
        (lastTable()["formFields"] as Array<Field<unknown>>) || [];

      expect(fields.length).toBeGreaterThan(0);
    });
  }

  test("adding one subscriber: one sentence in the Email field's description, and no warning box under it", async () => {
    await renderEmailPage();

    const email: Field<unknown> | undefined = (
      lastTable()["formFields"] as Array<Field<unknown>>
    ).find((field: Field<unknown>): boolean => {
      return fieldKey(field) === "subscriberEmail";
    });

    expect(email).toBeDefined();
    expect(email!.description).toBe(
      SubscriberUnsubscribeCopy.sharedAddressAdvice,
    );
    expect(email!.footerElement).toBeUndefined();
  });

  test("Add in Bulk: the same sentence after how to paste the addresses, and no warning box", async () => {
    await renderEmailPage();

    const buttons: Array<Record<string, unknown>> = (
      lastTable()["cardProps"] as Record<string, unknown>
    )["buttons"] as Array<Record<string, unknown>>;

    const addInBulk: Record<string, unknown> | undefined = buttons.find(
      (button: Record<string, unknown>): boolean => {
        return button["title"] === "Add in Bulk";
      },
    );

    expect(addInBulk).toBeDefined();

    await act(async () => {
      (addInBulk!["onClick"] as () => void)();
    });

    await waitFor(() => {
      expect(recordedBulkForms.length).toBeGreaterThan(0);
    });

    const formProps: Record<string, unknown> = recordedBulkForms[
      recordedBulkForms.length - 1
    ]!["formProps"] as Record<string, unknown>;

    const emails: Field<unknown> | undefined = (
      formProps["fields"] as Array<Field<unknown>>
    ).find((field: Field<unknown>): boolean => {
      return fieldKey(field) === "emails";
    });

    expect(emails).toBeDefined();
    expect(emails!.footerElement).toBeUndefined();

    const description: string = textOf(emails!.description as ReactNode);

    expect(description).toContain(
      "One email per line (or separated by commas, semicolons, or spaces). Invalid or duplicate entries will be skipped.",
    );
    expect(description).toContain(
      SubscriberUnsubscribeCopy.sharedAddressAdvice,
    );
  });

  test("the advice is one sentence, names a mailing list, and says it is unsubscribed for everyone", () => {
    const advice: string = SubscriberUnsubscribeCopy.sharedAddressAdvice;

    expect(advice).toContain("mailing list");
    expect(advice).toContain("for everyone");
    // One sentence: a full stop only at the end.
    expect(advice.endsWith(".")).toBe(true);
    expect(advice.slice(0, -1)).not.toMatch(/[.!?]\s/);
  });
});
