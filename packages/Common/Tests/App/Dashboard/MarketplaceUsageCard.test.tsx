import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import MarketplaceUsageCard from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/MarketplaceUsageCard";
import {
  formatMonth,
  formatUSD,
  getMonthTotalInUSD,
  parseMarketplaceUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/MarketplaceUsage";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import {
  MARKETPLACE_USAGE_ROUTE,
  MarketplaceUsageMonth,
} from "../../../Types/Marketplace/MarketplaceUsageSummary";
import API from "../../../UI/Utils/API/API";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
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

/*
 * The Billing page of a project a cloud marketplace bills: what the last
 * three months of its marketplace bill were made of. The marketplace shows
 * one line - usage units of $0.01 - and this card shows which users, active
 * monitors, telemetry and balance top-ups they were.
 */

const MONTHS: Array<JSONObject> = [
  {
    month: "2026-10",
    billedUnits: 7000,
    pendingUnits: 230,
    usersInUSD: 20.5,
    activeMonitorsInUSD: 1.75,
    telemetryInUSD: 0.04,
    smsOrCallBalanceInUSD: 20,
    aiBalanceInUSD: 30,
  },
  {
    month: "2026-09",
    billedUnits: 2200,
    pendingUnits: 0,
    usersInUSD: 22,
    activeMonitorsInUSD: 0,
    telemetryInUSD: 0,
    smsOrCallBalanceInUSD: 0,
    aiBalanceInUSD: 0,
  },
  {
    month: "2026-08",
    billedUnits: 0,
    pendingUnits: 0,
    usersInUSD: 0,
    activeMonitorsInUSD: 0,
    telemetryInUSD: 0,
    smsOrCallBalanceInUSD: 0,
    aiBalanceInUSD: 0,
  },
];

let answer: HTTPResponse<JSONObject> | HTTPErrorResponse;

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

describe("reading the server's summary", () => {
  test("keeps the months it recognizes, and reads odd amounts as nothing", () => {
    expect(
      parseMarketplaceUsage({
        marketplace: "AWS",
        usageUnitInUSD: 0.01,
        months: [
          MONTHS[0]!,
          { month: "October", billedUnits: 5 },
          { month: "2026-07", billedUnits: "lots", usersInUSD: -3 },
          "not a month",
        ] as unknown as JSONObject,
      }),
    ).toEqual({
      marketplace: CloudMarketplace.AWS,
      usageUnitInUSD: 0.01,
      months: [
        MONTHS[0],
        {
          month: "2026-07",
          billedUnits: 0,
          pendingUnits: 0,
          usersInUSD: 0,
          activeMonitorsInUSD: 0,
          telemetryInUSD: 0,
          smsOrCallBalanceInUSD: 0,
          aiBalanceInUSD: 0,
        },
      ],
    });
  });

  test("is nothing for an answer that is not a summary", () => {
    for (const data of [null, undefined, {}, { months: "no" }]) {
      expect(parseMarketplaceUsage(data as JSONObject | null)).toBeNull();
    }
  });

  test("adds up a month's billed and pending units, in dollars", () => {
    expect(
      getMonthTotalInUSD(MONTHS[0] as unknown as MarketplaceUsageMonth, 0.01),
    ).toBe(72.3);
    expect(formatUSD(72.3)).toBe("$72.30");
    expect(formatUSD(0.005)).toBe("$0.01");
    expect(formatMonth("2026-10", "en-US")).toBe("October 2026");
    expect(formatMonth("not-a-month", "en-US")).toBe("not-a-month");
  });
});

describe("the Marketplace Usage card", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    goTo(`/dashboard/${PROJECT_ID}/settings/billing`);
    answer = new HTTPResponse<JSONObject>(
      200,
      {
        marketplace: "AWS",
        usageUnitInUSD: 0.01,
        months: MONTHS as unknown as JSONObject,
      },
      {},
    );
    jest.spyOn(API, "get").mockImplementation((async (): Promise<unknown> => {
      return answer;
    }) as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("asks the project's summary, with the project's headers", async () => {
    render(<MarketplaceUsageCard marketplace={CloudMarketplace.AWS} />);
    await flush();

    const options: { url: URL; headers: Record<string, unknown> } = (
      API.get as unknown as jest.Mock
    ).mock.calls[0]![0] as { url: URL; headers: Record<string, unknown> };

    expect(options.url.toString()).toContain(MARKETPLACE_USAGE_ROUTE);
    expect(String(options.headers["tenantid"])).toBe(PROJECT_ID);
  });

  test("shows each month's items and total, and what is not confirmed yet", async () => {
    render(<MarketplaceUsageCard marketplace={CloudMarketplace.AWS} />);
    await flush();

    expect(
      screen.getByText(
        "What this project's AWS Marketplace bill was made of. AWS Marketplace shows these charges as usage units of $0.01 each.",
      ),
    ).toBeInTheDocument();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "marketplace-usage-month",
    );
    expect(rows).toHaveLength(3);

    const october: HTMLElement = rows[0]!;
    for (const amount of [
      "$20.50",
      "$1.75",
      "$0.04",
      "$20.00",
      "$30.00",
      "$72.30",
    ]) {
      expect(within(october).getByText(amount)).toBeInTheDocument();
    }
    expect(october).toHaveTextContent("$2.30 not confirmed yet");

    expect(rows[1]!).toHaveTextContent("$22.00");
    expect(rows[1]!).not.toHaveTextContent("not confirmed yet");
  });

  test("says so when nothing has been billed yet", async () => {
    answer = new HTTPResponse<JSONObject>(
      200,
      {
        marketplace: "Azure",
        usageUnitInUSD: 0.01,
        months: [MONTHS[2]!] as unknown as JSONObject,
      },
      {},
    );

    render(<MarketplaceUsageCard marketplace={CloudMarketplace.Azure} />);
    await flush();

    expect(screen.getByTestId("marketplace-usage-empty")).toHaveTextContent(
      "Nothing has been billed through Microsoft Marketplace yet.",
    );
    expect(screen.queryByTestId("marketplace-usage-table")).toBeNull();
  });

  test("shows the server's refusal", async () => {
    answer = new HTTPErrorResponse(
      403,
      {
        message:
          "You need Project Owner, Project Admin, Manage Billing or a billing role to view the project's marketplace usage.",
      },
      {},
    );

    render(<MarketplaceUsageCard marketplace={CloudMarketplace.AWS} />);
    await flush();

    expect(
      screen.getByText(
        "You need Project Owner, Project Admin, Manage Billing or a billing role to view the project's marketplace usage.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("marketplace-usage-table")).toBeNull();
  });
});
