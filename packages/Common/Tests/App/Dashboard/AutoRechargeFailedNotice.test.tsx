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
import AutoRechargeFailedNotice from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/AutoRechargeFailedNotice";
import { ProjectBalanceAccess } from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceAccess";
import {
  AUTO_RECHARGE_FAILED_DESCRIPTIONS,
  AUTO_RECHARGE_FAILED_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceCopy";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import AutoRechargeState from "../../../Types/Billing/AutoRechargeState";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE,
  ProjectBalanceType,
} from "../../../Utils/Project/ProjectBalance";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

type MockBillingGlobal = typeof globalThis & {
  __autoRechargeNoticeBillingEnabled: boolean;
};

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__autoRechargeNoticeBillingEnabled = true;

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__autoRechargeNoticeBillingEnabled;
    },
  });

  return mocked;
});

/*
 * AutoRechargeFailedNotice, the red notice at the top of Notification
 * Settings and AI Credits while Auto Recharge's last automatic charge has
 * failed. It asks the server (AutoRechargeState) and shows only Failed;
 * anything else - Ready, Off, an error, an answer on its way - shows
 * nothing. Saving Auto Recharge (refreshKey) asks again, and a project
 * switch never shows one project's failure on another's page.
 */

const OTHER_PROJECT_ID: string = "9a3b2c1d-4e5f-4a60-8b7c-2d3e4f5a6b7c";

let answers: Array<HTTPResponse<JSONObject> | HTTPErrorResponse>;

function answer(state: string): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, { state }, {});
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__autoRechargeNoticeBillingEnabled = value;
}

beforeEach(() => {
  setBillingEnabled(true);
  window.sessionStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}/settings/notification-settings`);
  answers = [];

  jest.spyOn(API, "get").mockImplementation((async (): Promise<unknown> => {
    return answers.shift() || answer(AutoRechargeState.Ready);
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each([
  ["Notification Settings", ProjectBalanceType.SmsOrCall],
  ["AI Credits", ProjectBalanceType.AI],
])("on %s", (_page: string, balance: ProjectBalanceType) => {
  test("Failed: the notice, with its title and what to do", async () => {
    answers.push(answer(AutoRechargeState.Failed));

    render(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
      />,
    );
    await flush();

    const notice: HTMLElement = screen.getByTestId(
      "auto-recharge-failed-notice",
    );
    expect(notice).toHaveTextContent(AUTO_RECHARGE_FAILED_TITLE);
    expect(notice).toHaveTextContent(
      AUTO_RECHARGE_FAILED_DESCRIPTIONS[balance].forPeopleWhoMayAdd,
    );
  });

  test("asks its own balance's route, with the project's headers", async () => {
    render(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
      />,
    );
    await flush();

    expect(API.get).toHaveBeenCalledTimes(1);
    const options: { url: URL; headers: Record<string, unknown> } = (
      API.get as unknown as jest.Mock
    ).mock.calls[0]![0] as { url: URL; headers: Record<string, unknown> };

    expect(options.url.toString()).toContain(
      PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE[balance],
    );
    expect(String(options.headers["tenantid"])).toBe(PROJECT_ID);
  });

  test.each([
    ["Ready", AutoRechargeState.Ready],
    ["Off", AutoRechargeState.Off],
    ["an unknown answer", "Unknown"],
  ])("%s: nothing", async (_case: string, state: string) => {
    answers.push(answer(state));

    render(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
      />,
    );
    await flush();

    expect(
      screen.queryByTestId("auto-recharge-failed-notice"),
    ).not.toBeInTheDocument();
  });

  test("an error answer: nothing", async () => {
    answers.push(new HTTPErrorResponse(500, { message: "down" }, {}));

    render(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
      />,
    );
    await flush();

    expect(
      screen.queryByTestId("auto-recharge-failed-notice"),
    ).not.toBeInTheDocument();
  });

  test("where OneUptime does not bill: nothing is asked, nothing is shown", async () => {
    setBillingEnabled(false);

    render(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
      />,
    );
    await flush();

    expect(API.get).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("auto-recharge-failed-notice"),
    ).not.toBeInTheDocument();
  });

  test("Auto Recharge saved (refreshKey): it asks again, and a charge that worked takes the notice away", async () => {
    answers.push(answer(AutoRechargeState.Failed));

    const { rerender } = render(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
        refreshKey={0}
      />,
    );
    await flush();
    expect(screen.getByTestId("auto-recharge-failed-notice")).toBeVisible();

    answers.push(answer(AutoRechargeState.Ready));
    rerender(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
        refreshKey={1}
      />,
    );
    await flush();

    expect(API.get).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByTestId("auto-recharge-failed-notice"),
    ).not.toBeInTheDocument();
  });

  test("who may not add balance is told who can", async () => {
    answers.push(answer(AutoRechargeState.Failed));

    render(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.No}
      />,
    );
    await flush();

    expect(screen.getByTestId("auto-recharge-failed-notice")).toHaveTextContent(
      AUTO_RECHARGE_FAILED_DESCRIPTIONS[balance].forEveryoneElse,
    );
  });

  test("another project: one project's failure is never shown on the other's page", async () => {
    answers.push(answer(AutoRechargeState.Failed));

    const { rerender } = render(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
      />,
    );
    await flush();
    expect(screen.getByTestId("auto-recharge-failed-notice")).toBeVisible();

    // The other project's answer is still on its way.
    let resolveOther: (value: HTTPResponse<JSONObject>) => void = () => {};
    (API.get as unknown as jest.Mock).mockImplementation((() => {
      return new Promise((resolve: (value: unknown) => void) => {
        resolveOther = resolve as (value: HTTPResponse<JSONObject>) => void;
      });
    }) as never);

    goTo(`/dashboard/${OTHER_PROJECT_ID}/settings/notification-settings`);
    rerender(
      <AutoRechargeFailedNotice
        balance={balance}
        access={ProjectBalanceAccess.Yes}
      />,
    );
    await flush();

    expect(
      screen.queryByTestId("auto-recharge-failed-notice"),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveOther(answer(AutoRechargeState.Ready));
    });
    await flush();

    expect(
      screen.queryByTestId("auto-recharge-failed-notice"),
    ).not.toBeInTheDocument();
  });
});
