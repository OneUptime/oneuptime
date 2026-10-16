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
import {
  getCurrentProjectBillingMarketplace,
  getMarketplaceAutoRechargeFailedDescription,
  getMarketplaceBalanceCardDescription,
  ProjectBalanceAccess,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceAccess";
import {
  AUTO_RECHARGE_FAILED_DESCRIPTIONS,
  AUTO_RECHARGE_FAILED_TITLE,
  PROJECT_BALANCE_CARD_DESCRIPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceCopy";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AutoRechargeState from "../../../Types/Billing/AutoRechargeState";
import { JSONObject } from "../../../Types/JSON";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import API from "../../../UI/Utils/API/API";
import ProjectUtil from "../../../UI/Utils/Project";
import { ProjectBalanceType } from "../../../Utils/Project/ProjectBalance";
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

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: true,
  };
});

/*
 * A project a cloud marketplace bills has no card. Its prepaid balances are
 * still recharged - by hand or by Auto Recharge - and billed through the
 * marketplace. So the pages that hold them say where a recharge is billed,
 * and when Auto Recharge's last charge was refused, the notice says to check
 * the subscription on the marketplace - not the payment method.
 */

const ALL_BALANCES: Array<ProjectBalanceType> = [
  ProjectBalanceType.SmsOrCall,
  ProjectBalanceType.AI,
];

const onMarketplace: (marketplace: unknown) => void = (
  marketplace: unknown,
): void => {
  jest
    .spyOn(ProjectUtil, "getCurrentProject")
    .mockReturnValue(
      Object.assign(new Project(), { billingMarketplace: marketplace }),
    );
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which marketplace bills the current project", () => {
  test("reads it off the current project", () => {
    onMarketplace(CloudMarketplace.GoogleCloud);

    expect(getCurrentProjectBillingMarketplace()).toBe(
      CloudMarketplace.GoogleCloud,
    );
  });

  test("is none for a card-billed project, an odd value, or no project", () => {
    for (const value of [undefined, null, "", "SomewhereElse", 42]) {
      jest.restoreAllMocks();
      onMarketplace(value);

      expect(getCurrentProjectBillingMarketplace()).toBeNull();
    }

    jest.restoreAllMocks();
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);
    expect(getCurrentProjectBillingMarketplace()).toBeNull();
  });
});

describe("the Current Balance card on a marketplace-billed project", () => {
  test.each(ALL_BALANCES)(
    "%s: the usual words, then where recharges are billed",
    (balance: ProjectBalanceType) => {
      for (const access of [
        ProjectBalanceAccess.Yes,
        ProjectBalanceAccess.No,
      ]) {
        const description: string = getMarketplaceBalanceCardDescription({
          balance: balance,
          access: access,
          marketplace: CloudMarketplace.AWS,
        });

        expect(description).toBe(
          `${
            access === ProjectBalanceAccess.Yes
              ? PROJECT_BALANCE_CARD_DESCRIPTIONS[balance].forPeopleWhoMayAdd
              : PROJECT_BALANCE_CARD_DESCRIPTIONS[balance].forEveryoneElse
          } Recharges and Auto Recharge are billed through AWS Marketplace, not a card.`,
        );
      }
    },
  );
});

describe("the Auto Recharge failure on a marketplace-billed project", () => {
  test("tells someone who may add balance to check the subscription, not a card", () => {
    expect(
      getMarketplaceAutoRechargeFailedDescription({
        balance: ProjectBalanceType.SmsOrCall,
        access: ProjectBalanceAccess.Yes,
        marketplace: CloudMarketplace.Azure,
      }),
    ).toBe(
      "It tries again within an hour. Check that this project's subscription on Microsoft Marketplace is active, or recharge the balance now.",
    );
    expect(
      getMarketplaceAutoRechargeFailedDescription({
        balance: ProjectBalanceType.AI,
        access: ProjectBalanceAccess.Yes,
        marketplace: CloudMarketplace.Azure,
      }),
    ).toBe(
      "It tries again within an hour. Check that this project's subscription on Microsoft Marketplace is active, or add AI credits now.",
    );
  });

  test.each(ALL_BALANCES)(
    "%s: tells everyone else who can, as for a card",
    (balance: ProjectBalanceType) => {
      for (const access of [
        ProjectBalanceAccess.No,
        ProjectBalanceAccess.Unknown,
      ]) {
        expect(
          getMarketplaceAutoRechargeFailedDescription({
            balance: balance,
            access: access,
            marketplace: CloudMarketplace.Azure,
          }),
        ).toBe(AUTO_RECHARGE_FAILED_DESCRIPTIONS[balance].forEveryoneElse);
      }
    },
  );

  describe("the notice", () => {
    beforeEach(() => {
      window.sessionStorage.clear();
      goTo(`/dashboard/${PROJECT_ID}/settings/notification-settings`);
      jest.spyOn(API, "get").mockImplementation((async (): Promise<unknown> => {
        return new HTTPResponse<JSONObject>(
          200,
          { state: AutoRechargeState.Failed },
          {},
        );
      }) as never);
    });

    test("names the marketplace that refused, and what to check there", async () => {
      onMarketplace(CloudMarketplace.GoogleCloud);

      render(
        <AutoRechargeFailedNotice
          balance={ProjectBalanceType.AI}
          access={ProjectBalanceAccess.Yes}
        />,
      );
      await flush();

      const notice: HTMLElement = screen.getByTestId(
        "auto-recharge-failed-notice",
      );

      expect(notice).toHaveTextContent(
        "Auto Recharge could not bill Google Cloud Marketplace.",
      );
      expect(notice).toHaveTextContent(
        "Check that this project's subscription on Google Cloud Marketplace is active, or add AI credits now.",
      );
      expect(notice).not.toHaveTextContent(AUTO_RECHARGE_FAILED_TITLE);
      expect(notice).not.toHaveTextContent("payment method");
    });

    test("still says it could not charge the card on a card-billed project", async () => {
      onMarketplace(undefined);

      render(
        <AutoRechargeFailedNotice
          balance={ProjectBalanceType.AI}
          access={ProjectBalanceAccess.Yes}
        />,
      );
      await flush();

      expect(
        screen.getByTestId("auto-recharge-failed-notice"),
      ).toHaveTextContent(AUTO_RECHARGE_FAILED_TITLE);
    });
  });
});
