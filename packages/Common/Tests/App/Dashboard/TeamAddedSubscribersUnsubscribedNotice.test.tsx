import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The notice above a status page's subscriber list naming the subscribers
 * the team added that have unsubscribed recently. Every notification can be
 * unsubscribed from without signing in, so one reader of a shared address
 * can take a whole site off the page; the owners are emailed, and this
 * keeps it on screen for everyone else who manages the list.
 *
 * The list request is stubbed and recorded: these pin what it asks for (this
 * page, this channel, only team-added subscribers, only the last 30 days,
 * newest first) and what the notice says.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import TeamAddedSubscribersUnsubscribedNotice from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/TeamAddedSubscribersUnsubscribedNotice";
import SubscriberUnsubscribeCopy, {
  RECENTLY_UNSUBSCRIBED_LIST_LIMIT,
  RECENTLY_UNSUBSCRIBED_WINDOW_IN_DAYS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberUnsubscribeCopy";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);

function emailSubscriber(email: string, index: number): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = `30000000-0000-4000-8000-00000000000${index}`;
  row.subscriberEmail = new Email(email);
  row.unsubscribedAt = new Date("2026-09-20T10:00:00.000Z");
  return row;
}

async function renderNotice(props?: {
  channelQuery?: JSONObject;
  contactSelect?: JSONObject;
}): Promise<void> {
  await act(async () => {
    render(
      <TeamAddedSubscribersUnsubscribedNotice
        statusPageId={STATUS_PAGE_ID}
        projectId={PROJECT_ID}
        channelQuery={
          (props?.channelQuery as never) || { subscriberEmail: new NotNull() }
        }
        contactSelect={
          (props?.contactSelect as never) || { subscriberEmail: true }
        }
      />,
    );
  });
}

function listRequest(): JSONObject {
  expect(getListMock).toHaveBeenCalledTimes(1);
  return getListMock.mock.calls[0]![0] as JSONObject;
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: RECENTLY_UNSUBSCRIBED_LIST_LIMIT,
  } as never);
});

afterEach(() => {
  cleanup();
});

describe("TeamAddedSubscribersUnsubscribedNotice", () => {
  test("asks for this page's team-added subscribers on this channel that left in the last 30 days", async () => {
    const before: number = Date.now();

    await renderNotice();

    const request: JSONObject = listRequest();
    const query: JSONObject = request["query"] as JSONObject;

    expect(request["modelType"]).toBe(StatusPageSubscriber);
    expect(query["statusPageId"]).toBe(STATUS_PAGE_ID);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["isUnsubscribed"]).toBe(true);
    /*
     * Is Added By Team, not Created By: a subscriber an API key or a
     * workflow added has no creator, and is the team's all the same.
     */
    expect(query["isAddedByTeam"]).toBe(true);
    expect(query["createdByUserId"]).toBeUndefined();
    expect(query["subscriberEmail"]).toBeInstanceOf(NotNull);

    const since: GreaterThan<Date> = query["unsubscribedAt"] as never;
    expect(since).toBeInstanceOf(GreaterThan);
    const windowStart: number = new Date(since.value as Date).getTime();
    const expected: number =
      before - RECENTLY_UNSUBSCRIBED_WINDOW_IN_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(windowStart - expected)).toBeLessThan(60 * 1000);

    expect(request["sort"]).toEqual({ unsubscribedAt: SortOrder.Descending });
    expect(request["limit"]).toBe(RECENTLY_UNSUBSCRIBED_LIST_LIMIT);
    expect(request["select"]).toEqual({
      _id: true,
      unsubscribedAt: true,
      subscriberEmail: true,
    });
  });

  test("shows nothing when nobody the team added has left", async () => {
    await renderNotice();

    expect(
      screen.queryByTestId("team-added-subscribers-unsubscribed"),
    ).not.toBeInTheDocument();
  });

  test("names each subscriber that left, and when", async () => {
    getListMock.mockResolvedValue({
      data: [
        emailSubscriber("site03-all@acme.com", 1),
        emailSubscriber("site07-ops@acme.com", 2),
      ],
      count: 2,
      skip: 0,
      limit: RECENTLY_UNSUBSCRIBED_LIST_LIMIT,
    } as never);

    await renderNotice();

    const notice: HTMLElement = await screen.findByTestId(
      "team-added-subscribers-unsubscribed",
    );

    expect(notice).toHaveTextContent(
      SubscriberUnsubscribeCopy.recentlyUnsubscribedTitle,
    );
    expect(notice).toHaveTextContent(
      SubscriberUnsubscribeCopy.recentlyUnsubscribedDescription,
    );
    expect(notice).toHaveTextContent("site03-all@acme.com, unsubscribed");
    expect(notice).toHaveTextContent("site07-ops@acme.com, unsubscribed");
    expect(notice).not.toHaveTextContent("more.");
  });

  test("summarises the rest past the first ten", async () => {
    getListMock.mockResolvedValue({
      data: [emailSubscriber("site03-all@acme.com", 1)],
      count: 13,
      skip: 0,
      limit: RECENTLY_UNSUBSCRIBED_LIST_LIMIT,
    } as never);

    await renderNotice();

    expect(
      await screen.findByTestId("team-added-subscribers-unsubscribed"),
    ).toHaveTextContent(
      "12 more. Filter the list by Unsubscribed At to see them all.",
    );
  });

  test("names an SMS subscriber by its number on the SMS list", async () => {
    const sms: StatusPageSubscriber = new StatusPageSubscriber();
    sms._id = "30000000-0000-4000-8000-000000000009";
    sms.subscriberPhone = new Phone("+15555550123");
    sms.unsubscribedAt = new Date("2026-09-20T10:00:00.000Z");

    getListMock.mockResolvedValue({
      data: [sms],
      count: 1,
      skip: 0,
      limit: RECENTLY_UNSUBSCRIBED_LIST_LIMIT,
    } as never);

    await renderNotice({
      channelQuery: { subscriberPhone: new NotNull() } as never,
      contactSelect: { subscriberPhone: true },
    });

    expect(
      (listRequest()["query"] as JSONObject)["subscriberPhone"],
    ).toBeInstanceOf(NotNull);
    expect(
      await screen.findByTestId("team-added-subscribers-unsubscribed"),
    ).toHaveTextContent("+15555550123, unsubscribed");
  });

  test("a list that cannot load leaves the notice out", async () => {
    getListMock.mockRejectedValue(new Error("forbidden") as never);

    await renderNotice();

    expect(
      screen.queryByTestId("team-added-subscribers-unsubscribed"),
    ).not.toBeInTheDocument();
  });
});
