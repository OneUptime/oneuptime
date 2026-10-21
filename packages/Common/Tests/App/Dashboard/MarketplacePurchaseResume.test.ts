import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import MarketplacePendingPurchase from "../../../UI/Utils/MarketplacePendingPurchase";
import Navigation from "../../../UI/Utils/Navigation";
import { resumePendingMarketplacePurchase } from "../../../../App/FeatureSet/Dashboard/src/Utils/MarketplacePurchaseResume";

/*
 * A marketplace buyer who had to sign in first is sent back to the purchase
 * page by the dashboard, where every sign-in ends. The marker that says a
 * purchase is waiting lives on the dashboard's path, says nothing secret, and
 * is used once.
 */

const PENDING_COOKIE: string = "oneuptime-marketplace-purchase-pending";

const onPage: <T>(path: string, read: () => T) => T = <T>(
  path: string,
  read: () => T,
): T => {
  window.history.pushState({}, "", path);

  try {
    return read();
  } finally {
    window.history.pushState({}, "", "/");
  }
};

afterEach(() => {
  onPage("/dashboard", () => {
    MarketplacePendingPurchase.clear();
  });
  jest.restoreAllMocks();
});

describe("the pending purchase marker", () => {
  test("is kept for the dashboard's path only, and holds no secret", () => {
    onPage("/accounts/marketplace", () => {
      MarketplacePendingPurchase.remember();

      // The purchase page itself cannot read it back.
      expect(document.cookie).not.toContain(PENDING_COOKIE);
    });

    expect(
      onPage("/dashboard/some-project", () => {
        return document.cookie;
      }),
    ).toContain(`${PENDING_COOKIE}=1`);
  });

  test("sends the browser back to the purchase page once, then forgets it", () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    onPage("/accounts/marketplace", () => {
      MarketplacePendingPurchase.remember();
    });

    expect(
      onPage("/dashboard", () => {
        return resumePendingMarketplacePurchase();
      }),
    ).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0].toString()).toBe("/accounts/marketplace");
    expect(navigate.mock.calls[0]![1]).toEqual({ forceNavigate: true });

    expect(
      onPage("/dashboard", () => {
        return resumePendingMarketplacePurchase();
      }),
    ).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test("ignores a marker with any other value, and forgets it", () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    onPage("/dashboard", () => {
      document.cookie = `${PENDING_COOKIE}=https%3A%2F%2Fevil.example.com; path=/dashboard`;
    });

    expect(
      onPage("/dashboard", () => {
        return resumePendingMarketplacePurchase();
      }),
    ).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(
      onPage("/dashboard", () => {
        return document.cookie;
      }),
    ).not.toContain(PENDING_COOKIE);
  });

  test("does nothing when no purchase is waiting", () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    expect(
      onPage("/dashboard", () => {
        return resumePendingMarketplacePurchase();
      }),
    ).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
