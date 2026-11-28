import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const FEATURE_SETS: string = path.resolve(
  COMMON_ROOT,
  "..",
  "App",
  "FeatureSet",
);

/*
 * A STATUS PAGE'S BAR OF ITS PAGES, WITHOUT THE DASHBOARD'S PRODUCTS MENU.
 *
 * A status page draws its pages - Overview, Incidents, Subscribe - in a bar
 * of its own items, and never opens a products menu. It drew that bar with
 * Common's NavBar, which draws a bar handed children as it is, and
 * otherwise its own items, the products menu, the phone's menu and
 * Cmd/Ctrl+K: so every status page downloaded all of them before it drew,
 * some 10 KiB gzipped of its first load
 * (packages/Common/Scripts/first-load-budgets.js). It draws the bar with
 * NavBarOfItems now, the bar NavBar draws for children.
 *
 * Built as the status page builds (the shared esbuild config, for
 * production), with its NavBar as the entry (Helpers/FirstLoadBuild). Its
 * sources read "Common/..." and their packages through Common, which is all
 * this suite installs.
 */

const NAVBAR: string = "UI/Components/Navbar";

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: [
      `export { default as NavBar } from ${JSON.stringify(
        path.join(FEATURE_SETS, "StatusPage/src/Components/NavBar/NavBar"),
      )};`,
    ],
    serviceName: "StatusPage",
    publicPath: "/status-page/dist/",
    additionalAlias: { Common: COMMON_ROOT },
    nodePaths: [path.join(COMMON_ROOT, "node_modules")],
  });
}, 300000);

describe("a status page's bar of its pages", () => {
  test("has the bar of items and its items in its first load", () => {
    expect(
      inputsUnder(built!.firstLoad, `${NAVBAR}/NavBarOfItems.tsx`).length,
    ).toBe(1);
    expect(
      inputsUnder(built!.firstLoad, `${NAVBAR}/NavBarItem.tsx`).length,
    ).toBe(1);
  });

  test.each([
    ["the Dashboard's bar", `${NAVBAR}/NavBar.tsx`],
    ["the products menu", `${NAVBAR}/NavBarMenuModal.tsx`],
    ["the phone's products menu", `${NAVBAR}/NavBarMobileMenu.tsx`],
    ["the products menu's catalog", `${NAVBAR}/NavBarMenuCatalog.ts`],
    ["the recently visited products", `${NAVBAR}/NavBarRecentProducts.ts`],
    ["the menu's keyboard hints", "UI/Components/KeyboardShortcut/"],
  ])("does not build %s at all", (_name: string, file: string) => {
    expect(
      inputsUnder([...built!.firstLoad, ...built!.loadedLater], file),
    ).toEqual([]);
  });
});
