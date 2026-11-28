import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const STATUS_PAGE_SOURCE: string = path.resolve(
  COMMON_ROOT,
  "..",
  "App",
  "FeatureSet",
  "StatusPage",
  "src",
);

/*
 * A STATUS PAGE, WITHOUT THE PAGE OF AN ADDRESS WHERE NOTHING IS SET UP.
 *
 * Every status page is drawn inside its master page, which draws, where no
 * status page answers at the address it was opened at - a new install
 * opened at its server's address, say - the page that says what to set up
 * (AddressNotSetUp): the HOST line and the command that applies it, the
 * proxy setting, each with its Copy button. A visitor to a status page never
 * sees it, and every status page downloaded it before it could draw, about
 * 1 KiB gzipped of its first load
 * (packages/Common/Scripts/first-load-budgets.js). It is a file of its own,
 * which that address loads, with the page's loading shape in its place
 * until it arrives.
 *
 * Built as the status page builds (the shared esbuild config, for
 * production), with its master page as the entry (Helpers/FirstLoadBuild).
 */

// The status page's own modules, as the metafile names them.
const MASTER_PAGE: string =
  "StatusPage/src/Components/MasterPage/MasterPage.tsx";
const ADDRESS_FACTS: string = "StatusPage/src/Utils/AddressNotSetUp.ts";
const ADDRESS_PAGE: string =
  "StatusPage/src/Components/AddressNotSetUp/AddressNotSetUp.tsx";

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: [
      `export { default as MasterPage } from ${JSON.stringify(
        path.join(STATUS_PAGE_SOURCE, "Components/MasterPage/MasterPage"),
      )};`,
    ],
    serviceName: "StatusPage",
    publicPath: "/status-page/dist/",
    additionalAlias: { Common: COMMON_ROOT },
    nodePaths: [path.join(COMMON_ROOT, "node_modules")],
  });
}, 300000);

describe("a status page's master page", () => {
  test("has the master page and how it tells an address with nothing set up in its first load", () => {
    expect(inputsUnder(built!.firstLoad, MASTER_PAGE).length).toBe(1);
    expect(inputsUnder(built!.firstLoad, ADDRESS_FACTS).length).toBe(1);
  });

  test("loads the page of an address with nothing set up only where it is drawn", () => {
    expect(inputsUnder(built!.firstLoad, ADDRESS_PAGE)).toEqual([]);
    expect(inputsUnder(built!.loadedLater, ADDRESS_PAGE).length).toBe(1);
  });
});
