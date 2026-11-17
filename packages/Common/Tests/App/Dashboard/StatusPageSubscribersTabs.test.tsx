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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A STATUS PAGE'S SUBSCRIBERS: ONE PAGE, A TAB PER CHANNEL (#9125).
 *
 * They were five pages (Email, SMS, Slack, Microsoft Teams and Webhook
 * Subscribers). The real Subscribers page is drawn here, with its shared
 * list (StatusPageSubscriberList) - only the table is recorded - and each
 * tab is checked to be its channel's whole list: the right subscribers, its
 * own card, Add, Edit, Delete, Unsubscribe, Export CSV (which comes with the
 * bulk selection) and Add in Bulk. The open tab is in the address, and each
 * tab carries its channel's count.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const recordedTables: Array<Record<string, unknown>> = [];

(
  globalThis as unknown as {
    __subscriberTabsTables: Array<Record<string, unknown>>;
  }
).__subscriberTabsTables = recordedTables;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      (
        globalThis as unknown as {
          __subscriberTabsTables: Array<Record<string, unknown>>;
        }
      ).__subscriberTabsTables.push(props);

      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement("div", { "data-testid": "model-table" });
    },
  };
});

const mockNothing: () => {
  __esModule: boolean;
  default: () => null;
} = () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelOffPanel",
  () => {
    return mockNothing();
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationWarnings",
  () => {
    return mockNothing();
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/TeamAddedSubscribersUnsubscribedNotice",
  () => {
    return mockNothing();
  },
);

const getItemMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
    },
  };
});

import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberChannel from "../../../Types/StatusPage/StatusPageSubscriberChannel";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPageSubscribers from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Subscribers";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const PATH: string = "/dashboard/status-pages/subscribers";

interface ChannelTab {
  channel: StatusPageSubscriberChannel;
  tab: string;
  contactColumn: string;
  tableName: string;
  cardTitle: string;
  // Subscribers counted on this channel, by the count mock.
  count: number;
}

const TABS: Array<ChannelTab> = [
  {
    channel: StatusPageSubscriberChannel.Email,
    tab: "Email",
    contactColumn: "subscriberEmail",
    tableName: "Status Page > Email Subscribers",
    cardTitle: "Email Subscribers",
    count: 12,
  },
  {
    channel: StatusPageSubscriberChannel.SMS,
    tab: "SMS",
    contactColumn: "subscriberPhone",
    tableName: "Status Page > SMS Subscribers",
    cardTitle: "SMS Subscribers",
    count: 3,
  },
  {
    channel: StatusPageSubscriberChannel.Slack,
    tab: "Slack",
    contactColumn: "slackWorkspaceName",
    tableName: "Status Page > Slack Subscribers",
    cardTitle: "Slack Subscribers",
    count: 2,
  },
  {
    channel: StatusPageSubscriberChannel.MicrosoftTeams,
    tab: "Microsoft Teams",
    contactColumn: "microsoftTeamsWorkspaceName",
    tableName: "Status Page > Microsoft Teams Subscribers",
    cardTitle: "Microsoft Teams Subscribers",
    count: 7,
  },
  {
    channel: StatusPageSubscriberChannel.Webhook,
    tab: "Webhook",
    contactColumn: "subscriberWebhook",
    tableName: "Status Page > Webhook Subscribers",
    cardTitle: "Webhook Subscribers",
    count: 1,
  },
];

function pageProps(): PageComponentProps {
  const project: Project = new Project();
  project._id = PROJECT_ID;

  return {
    pageRoute: new Route("/dashboard"),
    currentProject: project,
    hasPaymentMethod: false,
  };
}

async function openAt(search: string): Promise<void> {
  window.history.replaceState(null, "", `${PATH}${search}`);

  await act(async () => {
    render(<StatusPageSubscribers {...pageProps()} />);
  });

  await waitFor(() => {
    expect(recordedTables.length).toBeGreaterThan(0);
  });
}

function lastTable(): Record<string, unknown> {
  return recordedTables[recordedTables.length - 1]!;
}

function selectedTab(): string {
  const selected: Array<HTMLElement> = screen
    .getAllByRole("tab")
    .filter((tab: HTMLElement): boolean => {
      return tab.getAttribute("aria-selected") === "true";
    });

  expect(selected).toHaveLength(1);

  return selected[0]!.getAttribute("data-testid")!.replace(/^tab-/, "");
}

beforeEach(() => {
  recordedTables.length = 0;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    page.enableEmailSubscribers = true;
    return page;
  });

  countMock.mockReset();
  countMock.mockImplementation(
    async (request: { query: Record<string, unknown> }): Promise<number> => {
      const tab: ChannelTab | undefined = TABS.find(
        (candidate: ChannelTab): boolean => {
          return request.query[candidate.contactColumn] instanceof NotNull;
        },
      );
      return tab ? tab.count : 0;
    },
  );

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));
  jest.spyOn(Navigation, "getCurrentRoute").mockReturnValue(new Route(PATH));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the tabs", () => {
  test("are the five channels, in the order the Subscribe page offers them", async () => {
    await openAt("");

    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return tab.getAttribute("data-testid")!.replace(/^tab-/, "");
      }),
    ).toEqual(
      TABS.map((tab: ChannelTab): string => {
        return tab.tab;
      }),
    );
  });

  test("open on Email at the bare address, and at one that names no channel", async () => {
    await openAt("");
    expect(selectedTab()).toBe("Email");
    cleanup();

    await openAt("?channel=pigeon");
    expect(selectedTab()).toBe("Email");
  });

  test("each show how many subscribers their channel has", async () => {
    await openAt("");

    for (const tab of TABS) {
      await waitFor(() => {
        expect(screen.getByTestId(`tab-${tab.tab}`)).toHaveTextContent(
          `${tab.tab}${tab.count}`,
        );
      });
    }

    // Each count is this status page's, in this project.
    for (const call of countMock.mock.calls) {
      const query: Record<string, unknown> = (
        call[0] as { query: Record<string, unknown> }
      ).query;

      expect(String(query["statusPageId"])).toBe(STATUS_PAGE_ID);
      expect(String(query["projectId"])).toBe(PROJECT_ID);
    }
  });

  test("put the open tab in the address, the first as the bare address", async () => {
    await openAt("");

    for (const tab of [...TABS.slice(1), TABS[0]!]) {
      await act(async () => {
        fireEvent.click(screen.getByTestId(`tab-${tab.tab}`));
      });

      await waitFor(() => {
        expect(window.location.search).toBe(
          tab.channel === StatusPageSubscriberChannel.Email
            ? ""
            : `?channel=${tab.channel}`,
        );
      });
      expect(selectedTab()).toBe(tab.tab);
    }
  });
});

describe.each(TABS)("the $tab tab", (tab: ChannelTab) => {
  test("opens from its address, and lists only this channel's subscribers of this page", async () => {
    await openAt(
      tab.channel === StatusPageSubscriberChannel.Email
        ? ""
        : `?channel=${tab.channel}`,
    );

    expect(selectedTab()).toBe(tab.tab);

    const table: Record<string, unknown> = lastTable();
    const query: Record<string, unknown> = table["query"] as Record<
      string,
      unknown
    >;

    expect(table["name"]).toBe(tab.tableName);
    expect(query[tab.contactColumn]).toBeInstanceOf(NotNull);
    expect(String(query["statusPageId"])).toBe(STATUS_PAGE_ID);
    expect(String(query["projectId"])).toBe(PROJECT_ID);

    // No other channel's column picks its rows.
    for (const other of TABS) {
      if (other.contactColumn !== tab.contactColumn) {
        expect(query[other.contactColumn]).toBeUndefined();
      }
    }

    // It read whether its own channel is on.
    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(request["modelType"]).toBe(StatusPage);
  });

  test("keeps every capability: add, edit, delete, unsubscribe, export and add in bulk", async () => {
    await openAt(`?channel=${tab.channel}`);

    const table: Record<string, unknown> = lastTable();
    const card: Record<string, unknown> = table["cardProps"] as Record<
      string,
      unknown
    >;

    expect(card["title"]).toBe(tab.cardTitle);
    expect(table["isCreateable"]).toBe(true);
    expect(table["createVerb"]).toBe("Add");
    expect(table["isEditable"]).toBe(true);
    expect(table["isDeleteable"]).toBe(true);
    expect((table["formFields"] as Array<unknown>).length).toBeGreaterThan(0);

    /*
     * Unsubscribe in Bulk Actions - where Export CSV comes with the
     * selection - and in each row's menu.
     */
    const bulkButtons: Array<Record<string, unknown>> = (
      table["bulkActions"] as { buttons: Array<Record<string, unknown>> }
    ).buttons;
    expect(bulkButtons.length).toBeGreaterThan(0);
    expect((table["actionButtons"] as Array<unknown>).length).toBeGreaterThan(
      0,
    );

    expect(
      (card["buttons"] as Array<Record<string, unknown>>).map(
        (button: Record<string, unknown>): unknown => {
          return button["title"];
        },
      ),
    ).toContain("Add in Bulk");
  });
});
