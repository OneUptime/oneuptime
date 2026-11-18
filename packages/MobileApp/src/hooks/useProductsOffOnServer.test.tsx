import React from "react";
import { Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  PRODUCTS_OFF_ON_SERVER_STALE_TIME_MS,
  getProductsOffOnServer,
  loadProductsOffOnServer,
  resetProductsOffOnServer,
  useProductsOffOnServer,
} from "./useProductsOffOnServer";
import { AppProduct } from "../api/serverProducts";
import * as ServerProductsApi from "../api/serverProducts";

/*
 * One answer for the whole session (#7478): the server's off list is the
 * same in every project. Nothing is off until it is read, a failed read
 * changes nothing, a fresh answer is not asked for again, and signing out
 * forgets it.
 */

afterEach(() => {
  resetProductsOffOnServer();
  jest.restoreAllMocks();
});

function answer(off: Array<AppProduct>): void {
  jest
    .spyOn(ServerProductsApi, "fetchProductsOffOnServer")
    .mockResolvedValue(new Set(off));
}

function OffList(): React.JSX.Element {
  const productsOff: ReturnType<typeof useProductsOffOnServer> =
    useProductsOffOnServer();

  return (
    <Text testID="off">
      {[...productsOff.off].sort().join(",") || "nothing"}
      {productsOff.isOff(AppProduct.Incidents) ? " incidents-off" : ""}
    </Text>
  );
}

describe("useProductsOffOnServer", () => {
  test("is nothing until the server's answer is read, then what it says", async () => {
    answer([AppProduct.Incidents, AppProduct.OnCall]);

    await render(<OffList />);
    expect(screen.getByTestId("off").props.children).toEqual(["nothing", ""]);

    await act(async () => {
      await loadProductsOffOnServer("project-1");
    });

    expect(screen.getByTestId("off").props.children).toEqual([
      "incidents,on-call",
      " incidents-off",
    ]);
  });

  test("a read that fails keeps what was known: nothing off", async () => {
    jest
      .spyOn(ServerProductsApi, "fetchProductsOffOnServer")
      .mockRejectedValue(new Error("offline"));

    await loadProductsOffOnServer("project-1");

    expect(getProductsOffOnServer().size).toBe(0);
  });

  test("a fresh answer is not asked for again; a stale one is", async () => {
    answer([AppProduct.Monitors]);
    const now: number = Date.now();

    await loadProductsOffOnServer("project-1", now);
    await loadProductsOffOnServer("project-2", now + 1000);

    expect(ServerProductsApi.fetchProductsOffOnServer).toHaveBeenCalledTimes(1);

    await loadProductsOffOnServer(
      "project-2",
      Date.now() + PRODUCTS_OFF_ON_SERVER_STALE_TIME_MS + 1,
    );

    expect(ServerProductsApi.fetchProductsOffOnServer).toHaveBeenCalledTimes(2);
  });

  test("signing out forgets it, and an answer on its way for the last session is dropped", async () => {
    answer([AppProduct.Alerts]);

    await loadProductsOffOnServer("project-1");
    expect(getProductsOffOnServer().has(AppProduct.Alerts)).toBe(true);

    resetProductsOffOnServer();
    expect(getProductsOffOnServer().size).toBe(0);

    let finish: (off: Set<AppProduct>) => void = (): void => {};
    jest
      .spyOn(ServerProductsApi, "fetchProductsOffOnServer")
      .mockImplementation((): Promise<Set<AppProduct>> => {
        return new Promise((resolve: (off: Set<AppProduct>) => void) => {
          finish = resolve;
        });
      });

    const reading: Promise<void> = loadProductsOffOnServer("project-1");
    resetProductsOffOnServer();
    finish(new Set([AppProduct.Monitors]));
    await reading;

    expect(getProductsOffOnServer().size).toBe(0);
  });
});
