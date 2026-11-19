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
import { beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT THE SERVER HAS SWITCHED OFF, AS THE APP READS IT (#7478).
 *
 * A self-hosted server's admin can switch products off for every project.
 * The app reads the list from one project's products answer and leaves
 * those products out: their tabs, their Inbox categories, their place on
 * Home. Anything it cannot read is "nothing off" - the app never hides a
 * working product for want of an answer.
 */

/*
 * The route the web reads its products answer from: Common's
 * PROJECT_PRODUCTS_ROUTE (Types/Product/ProjectProductsAnswer), read from
 * its file rather than imported. That file's imports reach moment-timezone
 * (ProductUsage's activation milestones, through the Translator), and CI
 * installs this app's node_modules only, so importing it failed the suite
 * before a test ran.
 */
const PROJECT_PRODUCTS_ANSWER_FILE: string = path.join(
  __dirname,
  "../../../Common/Types/Product/ProjectProductsAnswer.ts",
);

function readProjectProductsRoute(): string {
  const match: RegExpMatchArray | null = fs
    .readFileSync(PROJECT_PRODUCTS_ANSWER_FILE, "utf8")
    .match(/export const PROJECT_PRODUCTS_ROUTE: string = "([^"]+)";/);

  if (!match) {
    throw new Error(
      `${PROJECT_PRODUCTS_ANSWER_FILE} declares no PROJECT_PRODUCTS_ROUTE string`,
    );
  }

  return match[1] as string;
}

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
    expect(PROJECT_PRODUCTS_PATH).toBe(`/api${readProjectProductsRoute()}`);
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
