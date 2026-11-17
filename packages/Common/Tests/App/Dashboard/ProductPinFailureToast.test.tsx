import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import ProductKey from "../../../Types/Product/ProductKey";
import Toast, { ToastItem, ToastType } from "../../../UI/Utils/Toast";
import { Mock } from "jest-mock";

/*
 * A pin or an unpin the server did not keep (#9120). The bar put the
 * product back where it was without a word, so a person without the
 * permission saw their pin appear, then vanish, and could not tell why.
 * Now an error toast says which product and why, and stays until it is
 * closed.
 */

const setProductPinnedMock: Mock<
  (data: { isPinned: boolean }) => Promise<void>
> = jest.fn<(data: { isPinned: boolean }) => Promise<void>>();

let pinnedProducts: Array<ProductKey> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProductPinActions",
  () => {
    return {
      __esModule: true,
      ProductPinSource: { Menu: "menu" },
      setProductPinned: (data: { isPinned: boolean }): Promise<void> => {
        return setProductPinnedMock(data);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/UseDashboardProductsMenu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          navItems: [],
          moreMenuCategoriesOpenByDefault: [],
          rightElement: undefined,
          menu: { listed: [], hidden: [], pinned: [] },
          products: {
            answer: { pinned: pinnedProducts, canChooseProducts: true },
          },
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/UseProjectProducts",
  () => {
    return { __esModule: true, loadQuietly: () => {} };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "11111111-1111-1111-1111-111111111111";
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (err: unknown): string => {
        return (err as Error).message;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

// The bar itself: one button that pins or unpins Logs, as its menu does.
jest.mock("../../../UI/Components/Navbar/NavBar", () => {
  return {
    __esModule: true,
    default: (props: {
      onTogglePin: (item: unknown) => void;
    }): ReactElement => {
      return (
        <button
          type="button"
          onClick={() => {
            props.onTogglePin({
              key: "logs",
              title: "Logs",
              description: "",
              route: {},
              icon: "",
            });
          }}
        >
          Toggle pin
        </button>
      );
    },
  };
});

import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";

const toggle: () => Promise<void> = async (): Promise<void> => {
  render(<DashboardNavbar show={true} />);

  await act(async () => {
    fireEvent.click(screen.getByText("Toggle pin"));
  });
};

afterEach(() => {
  cleanup();
  Toast.dismissAll();
  setProductPinnedMock.mockReset();
  pinnedProducts = [];
});

describe("a pin the server did not keep", () => {
  test("says which product could not be pinned, why, and stays", async () => {
    setProductPinnedMock.mockRejectedValue(
      new Error("You need the Edit Project permission to pin products."),
    );

    await toggle();

    expect(setProductPinnedMock).toHaveBeenCalledWith(
      expect.objectContaining({ isPinned: true }),
    );

    const toasts: ReadonlyArray<ToastItem> = Toast.getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.type).toBe(ToastType.Error);
    expect(toasts[0]?.title).toBe("Couldn't pin Logs.");
    expect(toasts[0]?.durationInMs).toBeNull();

    // Its reason, drawn under the title.
    render(<>{toasts[0]?.description}</>);
    expect(
      screen.getByText("You need the Edit Project permission to pin products."),
    ).toBeInTheDocument();
  });

  test("an unpin says unpin", async () => {
    pinnedProducts = [ProductKey.Logs];
    setProductPinnedMock.mockRejectedValue(new Error("Request failed."));

    await toggle();

    expect(setProductPinnedMock).toHaveBeenCalledWith(
      expect.objectContaining({ isPinned: false }),
    );
    expect(Toast.getToasts()[0]?.title).toBe("Couldn't unpin Logs.");
  });

  test("a pin the server kept says nothing: the bar shows it", async () => {
    setProductPinnedMock.mockResolvedValue(undefined);

    await toggle();

    expect(Toast.getToasts()).toEqual([]);
  });
});
