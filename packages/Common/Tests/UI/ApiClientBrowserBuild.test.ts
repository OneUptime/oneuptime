import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

/*
 * A PAGE SENDS ITS REQUESTS WITHOUT THE SERVER'S OUTBOUND PROXY RULES
 * (issue #10442).
 *
 * On a server, the shared API client (Utils/API) routes every request
 * through the outbound proxy, or directly, on Node agents
 * (Utils/OutboundRequestRouting, and Server/Utils/OutboundProxyAgents
 * through it): axios had signed in to a proxy with its password
 * percent-encoded. A browser sends through whatever its own machine uses,
 * has no Node agents, and cannot build Node's http modules at all. So a
 * browser build takes OutboundRequestRouting.browser.ts in its place
 * (packages/Common/package.json's "browser" field), which leaves every
 * request as it is.
 *
 * Built as the Dashboard builds (the shared esbuild config, for
 * production), with the API client as the entry (Helpers/FirstLoadBuild).
 */

const NOT_BUILT: ReadonlyArray<[string, string]> = [
  [
    "the server's half of the API client's routing",
    "Utils/OutboundRequestRouting.ts",
  ],
  ["the server's proxy agents", "Server/Utils/OutboundProxyAgents.ts"],
  ["the server's proxy rules", "Server/Utils/OutboundProxy.ts"],
];

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: [
      `export { default as Api } from ${JSON.stringify(
        path.join(COMMON_ROOT, "Utils/API"),
      )};`,
    ],
    serviceName: "Dashboard",
    publicPath: "/dashboard/dist/",
  });
}, 300000);

describe("a browser build of the API client", () => {
  test("has the API client in its first load", () => {
    expect(inputsUnder(built!.firstLoad, "Utils/API.ts").length).toBe(1);
  });

  test("routes its requests with the browser's twin, which leaves each as it is", () => {
    expect(
      inputsUnder(built!.firstLoad, "Utils/OutboundRequestRouting.browser.ts")
        .length,
    ).toBe(1);
  });

  test.each(NOT_BUILT)(
    "does not build %s at all",
    (_name: string, file: string) => {
      expect(
        inputsUnder([...built!.firstLoad, ...built!.loadedLater], file),
      ).toEqual([]);
    },
  );
});
