import apiClient from "./client";
import {
  APP_PRODUCTS,
  AppProduct,
  PROJECT_PRODUCTS_PATH,
  fetchProductsOffOnServer,
  readProductsOffOnServer,
} from "./serverProducts";
import ProductKey from "../../../Common/Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../Common/Types/Product/ServerProducts";
import { PROJECT_PRODUCTS_ROUTE } from "../../../Common/Types/Product/ProjectProductsAnswer";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THE SERVER HAS SWITCHED OFF, AS THE APP READS IT (#7478).
 *
 * A self-hosted server's admin can switch products off for every project.
 * The app reads the list from one project's products answer and leaves
 * those products out: their tabs, their Inbox categories, their place on
 * Home. Anything it cannot read is "nothing off" - the app never hides a
 * working product for want of an answer.
 */

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: {} };
      }),
    },
  };
});

function getSpy(): jest.SpyInstance {
  return apiClient.get as unknown as jest.SpyInstance;
}

beforeEach(() => {
  getSpy().mockClear();
});

describe("the app's products", () => {
  test("are the server's keys, so a product named on the server is the one hidden here", () => {
    const serverKeys: Array<string> = Object.values(ProductKey);

    for (const product of APP_PRODUCTS) {
      expect(serverKeys).toContain(product);
    }

    expect(AppProduct.OnCall).toBe(ProductKey.OnCall);
    expect(AppProduct.SecurityEvents).toBe(ProductKey.SecurityEvents);
  });

  test("are read from the route the web reads", () => {
    expect(PROJECT_PRODUCTS_PATH).toBe(`/api${PROJECT_PRODUCTS_ROUTE}`);
  });
});

describe("readProductsOffOnServer", () => {
  test("reads the products the answer says are off, for either reason", () => {
    expect(
      readProductsOffOnServer({
        offOnServer: {
          [ProductKey.Incidents]: ServerProductOffReason.SwitchedOff,
          [ProductKey.OnCall]: ServerProductOffReason.SwitchedOff,
          [ProductKey.Logs]: ServerProductOffReason.TelemetryIngestionStopped,
        },
      }),
    ).toEqual(new Set([AppProduct.Incidents, AppProduct.OnCall]));
  });

  test("leaves out products the app draws nothing for, and reasons it does not know", () => {
    expect(
      readProductsOffOnServer({
        offOnServer: {
          [ProductKey.Logs]: ServerProductOffReason.SwitchedOff,
          [ProductKey.Monitors]: "maybe",
          [ProductKey.Alerts]: true,
        },
      }),
    ).toEqual(new Set());
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["an older server's answer, with no offOnServer", { hidden: [] }],
    ["an offOnServer that is no object", { offOnServer: "incidents" }],
  ])("reads %s as nothing off", (_name: string, data: unknown) => {
    expect(readProductsOffOnServer(data)).toEqual(new Set());
  });
});

describe("fetchProductsOffOnServer", () => {
  test("asks one project's products answer, naming the project", async () => {
    getSpy().mockResolvedValueOnce({
      data: {
        offOnServer: {
          [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff,
        },
      },
    });

    expect(await fetchProductsOffOnServer("project-1")).toEqual(
      new Set([AppProduct.Monitors]),
    );
    expect(getSpy()).toHaveBeenCalledWith("/api/project-products", {
      headers: { tenantid: "project-1" },
    });
  });
});
