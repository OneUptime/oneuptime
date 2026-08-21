import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The two-factor half of Admin Dashboard > User > Authentication.
 *
 * App/Tests/AdminDashboard/UserAuthenticationPageWiring.test.ts already pins
 * the things that make the buttons reach the server at all: that both new
 * actions are registered in UserAPI, on the verb the page calls them with, and
 * behind a master-admin gate. This file pins what happens once they do - the
 * wirings that leave an operator with a page that renders, responds, and lies:
 *
 *  - `isRequired` crosses the wire as a JSON boolean. The route rejects
 *    anything else with `typeof isRequired !== "boolean"`, so a page that sent
 *    the string "true" would 400; worse, a page that sent the string "false"
 *    against a truthiness check on some future rewrite would read as "stop
 *    requiring two factor auth", which is the one direction that weakens an
 *    account.
 *  - every write reloads the status. The tri-state label, the method count and
 *    BOTH buttons' disabled states are read off one fetched object, so a write
 *    that skips `loadStatus()` leaves "Require" greyed out on an account whose
 *    requirement was just removed - and the operator's next click is on a
 *    button that is telling them the opposite of the truth.
 *  - every write clears its loading flag in a `finally`. `isSavingTwoFactor`
 *    drives the ConfirmModal's spinner and its submit button; a path that
 *    leaves it true leaves a modal that cannot be submitted and cannot report
 *    why, with a page reload the only way out.
 *  - the status label covers all three states. `twoFactorStatusLabel` falls
 *    through to "Not Enabled", so a page that forgot to render the pending
 *    branch would show "Not Enabled" for an account that is mandated and
 *    locked out - exactly the account somebody is on this page to rescue.
 *  - and every locale carries every key. i18next's fallback is to render the
 *    dotted path itself, so a missing key captions a destructive confirmation
 *    modal with `pages.userAuthentication.twoFactorResetModalSubmit`.
 *
 * Source text rather than imports: the page renders React and pulls in
 * Common/UI, UserAPI builds an express router at construction time, and the two
 * types are compile-time only. What is being asserted on is which literals
 * these files contain, and no runtime value exposes that.
 *
 * Same deferred-import + browser-stub shape and the same copy-pasted helper set
 * as App/Tests/AdminDashboard/UserAuthenticationPageWiring.test.ts; the
 * `blockAfter` / `balancedBlockAt` / `countOccurrences` trio is copy-pasted from
 * App/Tests/AdminDashboard/BulkAddUsersToProjectWiring.test.ts. This repo
 * duplicates these per file by convention rather than factoring them out.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/AdminDashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/AdminDashboard/src/Utils/PageMap");
type RouteParamsModule =
  typeof import("../../FeatureSet/AdminDashboard/src/Utils/RouteParams");

let RouteMap: RouteMapModule["default"];
let PageMap: PageMapModule["default"];
let RouteParams: RouteParamsModule["default"];

/*
 * The declared path for a page. Reading it through a helper keeps the
 * "is it even registered?" failure separate from whatever the caller went on
 * to assert about the path.
 */
function routePath(pageKey: string): string {
  const route: { toString: () => string } | undefined = RouteMap[pageKey];

  if (!route) {
    throw new Error(`No route registered for PageMap.${pageKey}`);
  }

  return route.toString();
}

const REPO_ROOT: string = nodePath.join(__dirname, "../../..");

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  REPO_ROOT,
  "App/FeatureSet/AdminDashboard/src",
);

/*
 * Comments are stripped first so a file that explains a wiring in prose cannot
 * satisfy an assertion about the code. That matters unusually much here: the
 * page carries a comment explaining why the effect's dependency array is empty
 * and why both writes reload the status, and UserAPI carries one that spells
 * out `Boolean(req.body["isRequired"])` and the string "false" - which are
 * three of the things asserted on below.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(absolutePath: string): string {
  return stripComments(fs.readFileSync(absolutePath, "utf8"));
}

function readAdminDashboardSource(relativePath: string): string {
  return readSource(nodePath.join(ADMIN_DASHBOARD_SRC, relativePath));
}

const authenticationPageSource: string = readAdminDashboardSource(
  "Pages/Users/View/Authentication.tsx",
);
const userApiSource: string = readSource(
  nodePath.join(REPO_ROOT, "Common/Server/API/UserAPI.ts"),
);
const userServiceSource: string = readSource(
  nodePath.join(REPO_ROOT, "Common/Server/Services/UserService.ts"),
);
const authenticationStatusTypeSource: string = readSource(
  nodePath.join(REPO_ROOT, "Common/Types/UserAuthenticationStatus.ts"),
);
const twoFactorAuthStatusTypeSource: string = readSource(
  nodePath.join(REPO_ROOT, "Common/Types/TwoFactorAuthStatus.ts"),
);
const cardComponentSource: string = readSource(
  nodePath.join(REPO_ROOT, "Common/UI/Components/Card/Card.tsx"),
);

const LOCALES_DIR: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");

const localeFileNames: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string) => {
    return fileName.endsWith(".json");
  })
  .sort();

function readLocale(fileName: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, fileName), "utf8"),
  );
}

const englishLocale: Record<string, unknown> = readLocale("en.json");

function lookUpLocaleKey(
  locale: Record<string, unknown>,
  key: string,
): unknown {
  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

function hasTranslation(locale: Record<string, unknown>, key: string): boolean {
  const value: unknown = lookUpLocaleKey(locale, key);

  return typeof value === "string" && value.trim().length > 0;
}

/* Every `t("...")` the page asks for. */
function translationKeysUsedByPage(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const pattern: RegExp = /\bt\(\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = pattern.exec(authenticationPageSource);

  while (match) {
    keys.add(match[1]!);
    match = pattern.exec(authenticationPageSource);
  }

  return [...keys];
}

/*
 * The (verb, action) pairs the page calls the server with. The page routes
 * every one of them through the same `userAuthenticationRoute(modelId, action)`
 * builder, so the action literal plus the API method beside it is the whole of
 * what it asks the server for.
 */
interface PageApiCall {
  verb: string;
  action: string;
}

function apiCallsMadeByPage(): Array<PageApiCall> {
  const calls: Array<PageApiCall> = [];
  const pattern: RegExp =
    /API\.(get|post)<[^>]*>\(\s*\{\s*url:\s*userAuthenticationRoute\(\s*modelId,\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = pattern.exec(authenticationPageSource);

  while (match) {
    calls.push({ verb: match[1]!, action: match[2]! });
    match = pattern.exec(authenticationPageSource);
  }

  return calls;
}

/*
 * Walks braces from `blockStart` (which must be a `{`) to its match. `marker`
 * is carried only so the failure names what the caller was looking for.
 */
function balancedBlockAt(
  source: string,
  blockStart: number,
  marker: string,
): string {
  let depth: number = 0;

  for (let index: number = blockStart; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
    }

    if (character === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(blockStart, index + 1);
      }
    }
  }

  throw new Error(`Unbalanced braces after marker: ${marker}`);
}

/*
 * The balanced-brace block that follows `marker`. Used to bound an assertion to
 * ONE handler body, so that "the reset handler reloads the status" cannot be
 * satisfied by the four sibling handlers on the same page that all legitimately
 * do reload it.
 */
function blockAfter(source: string, marker: string): string {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const blockStart: number = source.indexOf("{", markerIndex);

  if (blockStart === -1) {
    throw new Error(`No block follows marker: ${marker}`);
  }

  return balancedBlockAt(source, blockStart, marker);
}

/*
 * Used where "the call happens here" is only half the guarantee and "the call
 * happens nowhere else in this body" is the other half.
 */
function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/*
 * The text immediately following `marker`, up to `length` characters. Used to
 * bind a route literal to the middleware registered beside it: an unbounded
 * search for `isAuthorizedMasterAdminMiddleware` would pass on any of the five
 * other routes in UserAPI that carry it.
 */
function windowAfter(source: string, marker: string, length: number): string {
  const markerIndex: number = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  return source.slice(markerIndex, markerIndex + marker.length + length);
}

/*
 * The `buttons={[ ... ]}` block belonging to the Card whose title renders
 * `titleKey`. The page has three Cards with buttons on it, so every assertion
 * about a button has to say which Card's button it means.
 */
function cardButtonsBlock(titleKey: string): string {
  const titleIndex: number = authenticationPageSource.indexOf(
    `t("pages.userAuthentication.${titleKey}")`,
  );

  if (titleIndex === -1) {
    throw new Error(`No card renders the title key: ${titleKey}`);
  }

  const buttonsIndex: number = authenticationPageSource.indexOf(
    "buttons={[",
    titleIndex,
  );

  if (buttonsIndex === -1) {
    throw new Error(`No buttons follow the card titled: ${titleKey}`);
  }

  return balancedBlockAt(
    authenticationPageSource,
    buttonsIndex + "buttons=".length,
    titleKey,
  );
}

/*
 * The individual button objects inside a `buttons={[ ... ]}` block. The block
 * itself is `{[ {...}, {...} ]}`, so the outer brace is depth 1 and each button
 * literal is depth 2; anything deeper is an onClick body.
 */
function cardButtonObjects(buttonsBlock: string): Array<string> {
  const objects: Array<string> = [];

  let depth: number = 0;
  let objectStart: number = -1;

  for (let index: number = 0; index < buttonsBlock.length; index++) {
    const character: string = buttonsBlock[index]!;

    if (character === "{") {
      depth++;

      if (depth === 2) {
        objectStart = index;
      }
    }

    if (character === "}") {
      if (depth === 2 && objectStart !== -1) {
        objects.push(buttonsBlock.slice(objectStart, index + 1));
        objectStart = -1;
      }

      depth--;
    }
  }

  return objects;
}

/* Every button object on the page, across all three Cards. */
function allCardButtonObjects(): Array<string> {
  const objects: Array<string> = [];

  for (const titleKey of [
    "statusCardTitle",
    "twoFactorCardTitle",
    "resetLinkCardTitle",
  ]) {
    objects.push(...cardButtonObjects(cardButtonsBlock(titleKey)));
  }

  return objects;
}

/* The button in the two-factor Card whose title renders `titleKey`. */
function twoFactorButton(titleKey: string): string {
  const button: string | undefined = cardButtonObjects(
    cardButtonsBlock("twoFactorCardTitle"),
  ).find((candidate: string) => {
    return candidate.includes(`t("pages.userAuthentication.${titleKey}")`);
  });

  if (!button) {
    throw new Error(`No two factor button renders the title key: ${titleKey}`);
  }

  return button;
}

/*
 * Hoisted rather than written inline at the call site, which is this repo's
 * house style for a regexp used with `.test` / `.exec`.
 */
const DISABLED_EXPRESSION: RegExp = /disabled:\s*([^\n]*)/;
const CARD_BUTTON_ICON: RegExp = /\bicon:\s*IconProp\.\w+/;

/* The `disabled:` expression on one button, or "" when it declares none. */
function disabledExpression(buttonSource: string): string {
  const match: RegExpExecArray | null = DISABLED_EXPRESSION.exec(buttonSource);

  return match ? match[1]!.trim() : "";
}

/* The `Name = "Value",` members declared by a string enum. */
function enumMembers(source: string): Array<string> {
  const members: Array<string> = [];
  const pattern: RegExp = /^\s*(\w+)\s*=\s*"([^"]*)",?\s*$/gm;

  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    members.push(`${match[1]!}=${match[2]!}`);
    match = pattern.exec(source);
  }

  return members;
}

/*
 * The `pages.userAuthentication.twoFactor*` leaf names one locale file
 * declares. Compared as a set against en.json below, in both directions.
 */
function twoFactorLocaleKeys(locale: Record<string, unknown>): Array<string> {
  const node: unknown = lookUpLocaleKey(locale, "pages.userAuthentication");

  if (typeof node !== "object" || node === null) {
    return [];
  }

  return Object.keys(node as Record<string, unknown>)
    .filter((key: string) => {
      return key.startsWith("twoFactor");
    })
    .sort();
}

/* The `twoFactor*` leaf names the page actually renders. */
function twoFactorKeysUsedByPage(): Array<string> {
  const prefix: string = "pages.userAuthentication.twoFactor";

  return translationKeysUsedByPage()
    .filter((key: string) => {
      return key.startsWith(prefix);
    })
    .map((key: string) => {
      return key.slice("pages.userAuthentication.".length);
    })
    .sort();
}

/*
 * Common/UI/Config reads `window` the moment it loads, and ObjectID is pulled
 * in transitively, so the browser stub has to exist before either of them
 * does - hence the deferred imports. A static import would be hoisted above
 * the stub and throw.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  const routeMapModule: RouteMapModule = await import(
    "../../FeatureSet/AdminDashboard/src/Utils/RouteMap"
  );
  const pageMapModule: PageMapModule = await import(
    "../../FeatureSet/AdminDashboard/src/Utils/PageMap"
  );
  const routeParamsModule: RouteParamsModule = await import(
    "../../FeatureSet/AdminDashboard/src/Utils/RouteParams"
  );

  RouteMap = routeMapModule.default;
  PageMap = pageMapModule.default;
  RouteParams = routeParamsModule.default;
});

describe("User two factor auth page extraction guards", () => {
  /*
   * Every assertion in this file is a claim about text pulled out of a source
   * file by a regex or a brace walk. A regex that stops matching - because a
   * formatter moved a line, or a helper was renamed - would make those claims
   * vacuously true rather than false. These tests fail loudly in that case, so
   * that "nothing broke" and "nothing was checked" cannot look the same.
   */

  test("the page's translation keys were found at all", () => {
    const keys: Array<string> = translationKeysUsedByPage();

    expect(keys.length).toBeGreaterThan(20);
    expect(keys).toContain("pages.userAuthentication.twoFactorCardTitle");
    expect(keys).toContain("pages.userAuthentication.twoFactorResetButton");
  });

  test("the page's API calls were found at all", () => {
    const actions: Array<string> = apiCallsMadeByPage().map(
      (call: PageApiCall) => {
        return call.action;
      },
    );

    expect(actions.length).toBeGreaterThanOrEqual(5);
    expect(actions).toContain("set-two-factor-auth-required");
    expect(actions).toContain("reset-two-factor-auth");
  });

  test("the page's Card buttons were found at all", () => {
    /*
     * The brace walk in `cardButtonObjects` depends on the exact `buttons={[`
     * spelling. Five buttons: one refresh, three two-factor, one reset link.
     */
    const buttons: Array<string> = allCardButtonObjects();

    expect(buttons.length).toBe(5);
    expect(
      buttons.filter((button: string) => {
        return button.includes("twoFactorResetButton");
      }).length,
    ).toBe(1);
  });

  test("the two factor keys the page renders were found at all", () => {
    expect(twoFactorKeysUsedByPage().length).toBeGreaterThan(15);
  });

  test("the TwoFactorAuthStatus members were found at all", () => {
    expect(enumMembers(twoFactorAuthStatusTypeSource).length).toBeGreaterThan(
      0,
    );
  });

  test("the locale files' two factor keys were found at all", () => {
    expect(twoFactorLocaleKeys(englishLocale).length).toBeGreaterThan(15);
  });
});

describe("User two factor auth master admin gate", () => {
  /*
   * UserAuthenticationPageWiring.test.ts asserts that a master-admin middleware
   * is present on these routes. This block asserts WHICH one.
   *
   * `isAuthorizedMasterAdminOrMasterApiKeyMiddleware` also passes a
   * master-admin session, so swapping it in breaks no manual test and no other
   * assertion in this repo - it only additionally admits the instance-wide
   * static master API key. That key is deliberately scoped to reads: a leaked
   * key that can read discloses data, but one that can turn two factor auth off
   * across every account on the instance is an account takeover with the safety
   * catch removed.
   */

  test("the require route is gated on a master admin session, not the master API key", () => {
    const gate: string = windowAfter(
      userApiSource,
      "/:userId/set-two-factor-auth-required`",
      150,
    );

    expect(gate).toContain(
      "MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,",
    );
    expect(gate).not.toContain("MasterApiKey");
  });

  test("the reset route is gated on a master admin session, not the master API key", () => {
    const gate: string = windowAfter(
      userApiSource,
      "/:userId/reset-two-factor-auth`",
      150,
    );

    expect(gate).toContain(
      "MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,",
    );
    expect(gate).not.toContain("MasterApiKey");
  });

  test("the middleware names asserted on above both exist", () => {
    /*
     * Guards the two negative assertions: if the read-scoped variant were
     * renamed, "the window does not contain MasterApiKey" would pass for the
     * wrong reason, and so would a typo in the strict variant's name.
     */
    expect(userApiSource).toContain(
      "MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,",
    );
    expect(
      countOccurrences(
        userApiSource,
        "MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,",
      ),
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("User two factor auth request bodies", () => {
  test("the require confirmation asks for the requirement as a boolean true", () => {
    /*
     * The route rejects anything that is not a JSON boolean outright, so the
     * string "true" is a 400 the operator reads as a server fault. Bounded to
     * the require modal's own JSX, because the do-not-require modal beside it
     * calls the very same function with the opposite argument.
     */
    const requireModal: string = blockAfter(
      authenticationPageSource,
      "{showRequireTwoFactorModal ? (",
    );

    expect(requireModal).toContain("setTwoFactorAuthRequired(true)");
    expect(requireModal).not.toContain("setTwoFactorAuthRequired(false)");
    expect(requireModal).not.toMatch(/setTwoFactorAuthRequired\(\s*"/);
  });

  test("the do-not-require confirmation asks for the requirement as a boolean false", () => {
    /*
     * The dangerous direction. A string "false" is truthy in JavaScript, so a
     * quoted argument here plus any truthiness check on the way to the column
     * would turn "stop requiring two factor auth" into "start requiring it",
     * or - on the reverse rewrite - silently weaken an account nobody asked to
     * weaken. The route's `typeof` check is what makes the quoted form loud;
     * this assertion is what keeps the page from relying on it.
     */
    const doNotRequireModal: string = blockAfter(
      authenticationPageSource,
      "{showDoNotRequireTwoFactorModal ? (",
    );

    expect(doNotRequireModal).toContain("setTwoFactorAuthRequired(false)");
    expect(doNotRequireModal).not.toContain("setTwoFactorAuthRequired(true)");
    expect(doNotRequireModal).not.toMatch(/setTwoFactorAuthRequired\(\s*"/);
  });

  test("the flag reaches the wire unconverted", () => {
    /*
     * Both modals pass a boolean, and this is the one place between them and
     * the request where it could stop being one. `String(isRequired)` or
     * `isRequired.toString()` compiles and reads fine.
     */
    const handler: string = blockAfter(
      authenticationPageSource,
      "const setTwoFactorAuthRequired",
    );

    expect(handler).toMatch(/data:\s*\{\s*isRequired:\s*isRequired,\s*\}/);
    expect(handler).not.toContain("String(isRequired)");
    expect(handler).not.toContain("isRequired.toString()");
  });

  test("the server insists on a boolean rather than coercing one", () => {
    /*
     * The other half of the contract, bounded to this route's own handler.
     * `Boolean(req.body["isRequired"])` would read a missing field, a null, or
     * the string "false" as a request to turn the requirement OFF.
     */
    const handler: string = blockAfter(
      userApiSource,
      "/:userId/set-two-factor-auth-required`",
    );

    expect(handler).toContain('typeof isRequired !== "boolean"');
    expect(handler).toContain("BadDataException");
    expect(handler).not.toMatch(/Boolean\(\s*req\.body/);
  });

  test("the reset action posts no body at all", () => {
    /*
     * Reset takes no options: there is nothing to configure, and a route that
     * ignores its body cannot be steered by one. A `data:` here would be the
     * beginning of a reset that could be told which methods to spare.
     */
    const handler: string = blockAfter(
      authenticationPageSource,
      "const resetTwoFactorAuth",
    );

    expect(handler).toMatch(
      /await API\.post<JSONObject>\(\{\s*url: userAuthenticationRoute\(modelId, "reset-two-factor-auth"\),\s*\}\);/,
    );
    expect(handler).not.toContain("data:");
  });

  test("the reset route reads nothing from its body either", () => {
    const handler: string = blockAfter(
      userApiSource,
      "/:userId/reset-two-factor-auth`",
    );

    expect(handler).toContain("UserService.resetTwoFactorAuth(");
    expect(handler).not.toContain("req.body");
  });
});

describe("User two factor auth write handlers", () => {
  /*
   * The page fetches its status once, on mount, and renders everything from
   * that one object. Every write therefore has to refetch, and every write has
   * to release its loading flag no matter how it exits.
   */

  const writeHandlers: Array<{ marker: string; loadingSetter: string }> = [
    { marker: "const setPassword", loadingSetter: "setIsSettingPassword" },
    {
      marker: "const sendPasswordResetLink",
      loadingSetter: "setIsSendingResetLink",
    },
    {
      marker: "const setTwoFactorAuthRequired",
      loadingSetter: "setIsSavingTwoFactor",
    },
    {
      marker: "const resetTwoFactorAuth",
      loadingSetter: "setIsSavingTwoFactor",
    },
  ];

  test("every write handler reloads the status before it returns", () => {
    /*
     * Skipping this leaves the whole status Card stale: the tri-state label,
     * the verified method count, and both two-factor buttons' disabled states
     * are all read off `status`. Concretely, an operator who removes a
     * requirement and then wants to put it back finds "Require" still greyed
     * out with a tooltip saying it is already required.
     *
     * Bounded per handler, because an unbounded search would pass on any one
     * of the four handlers calling it.
     */
    const withoutReload: Array<string> = [];

    for (const handler of writeHandlers) {
      const body: string = blockAfter(authenticationPageSource, handler.marker);

      if (!body.includes("await loadStatus()")) {
        withoutReload.push(handler.marker);
      }
    }

    expect(withoutReload).toEqual([]);
  });

  test("the reload sits on the success path, inside the try", () => {
    /*
     * `await loadStatus()` in the `finally` would refetch after a rejected
     * write too, which is not wrong so much as it is a second error banner
     * covering the first. More importantly, a reload placed after the
     * try/catch would run even when the write threw - reporting the unchanged
     * status as though the operator's click had been applied.
     */
    const outsideTry: Array<string> = [];

    for (const handler of writeHandlers) {
      const body: string = blockAfter(authenticationPageSource, handler.marker);
      const tryBlock: string = blockAfter(body, "try {");

      if (
        !tryBlock.includes("await loadStatus()") ||
        countOccurrences(body, "await loadStatus()") !== 1
      ) {
        outsideTry.push(handler.marker);
      }
    }

    expect(outsideTry).toEqual([]);
  });

  test("every write handler releases its loading flag in a finally", () => {
    /*
     * `isSavingTwoFactor` is the ConfirmModal's `isLoading`, which disables its
     * submit button and spins it. A handler that cleared the flag only on the
     * happy path leaves a modal that is permanently mid-save after one failed
     * write - it cannot be retried and it cannot say why, and the only way out
     * is a page reload.
     *
     * `finally`, not a call at the end of the try and a second one in the
     * catch: the two-call shape misses any path neither covers, and stops
     * being true the moment somebody adds an early `return`. So the assertion
     * is that exactly one release exists per handler and that it sits in the
     * `finally`, which makes "every exit releases the flag" true by
     * construction.
     */
    const violations: Array<string> = [];

    for (const handler of writeHandlers) {
      const body: string = blockAfter(authenticationPageSource, handler.marker);
      const finallyBlock: string = blockAfter(body, "} finally");
      const release: string = `${handler.loadingSetter}(false)`;

      if (!finallyBlock.includes(release)) {
        violations.push(`${handler.marker}: finally does not call ${release}`);
      }

      if (countOccurrences(body, release) !== 1) {
        violations.push(
          `${handler.marker}: ${release} is not called exactly once`,
        );
      }

      if (
        !new RegExp(
          `^\\{\\s*${handler.loadingSetter}\\(false\\);\\s*\\}$`,
        ).test(finallyBlock)
      ) {
        violations.push(
          `${handler.marker}: finally does more than release the flag`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  test("the status fetch releases its own loading flag in a finally too", () => {
    /*
     * Not a write, but the same failure: `isStatusLoading` gates the
     * ComponentLoader that stands in for the whole status Card, so a fetch that
     * rejected without clearing it would leave a spinner where the tri-state
     * label belongs, forever.
     */
    const body: string = blockAfter(
      authenticationPageSource,
      "const loadStatus",
    );
    const finallyBlock: string = blockAfter(body, "} finally");

    expect(finallyBlock).toMatch(/^\{\s*setIsStatusLoading\(false\);\s*\}$/);
  });
});

describe("User two factor auth page effect", () => {
  test("the page has exactly one effect", () => {
    /* Guard: the assertions below are about "the" useEffect. */
    expect(countOccurrences(authenticationPageSource, "useEffect(")).toBe(1);
  });

  test("the status is fetched on mount and never re-fetched in a loop", () => {
    /*
     * The dependency array must stay `[]`. It is tempting to list `modelId`,
     * but `Navigation.getLastParamAsObjectID()` builds a brand new ObjectID on
     * every render, so a dependency array containing it - or containing a
     * callback memoized on it - compares unequal every time and re-runs the
     * effect forever. That is not a slow page: it is an unbounded request loop
     * against a master-admin endpoint, and it renders perfectly while doing it.
     *
     * The id cannot change without remounting this page anyway, because it
     * comes from the URL this route matched.
     */
    const effectIndex: number = authenticationPageSource.indexOf("useEffect(");
    const blockStart: number = authenticationPageSource.indexOf(
      "{",
      effectIndex,
    );
    const body: string = balancedBlockAt(
      authenticationPageSource,
      blockStart,
      "useEffect(",
    );
    const tail: string = authenticationPageSource.slice(
      blockStart + body.length,
      blockStart + body.length + 20,
    );

    expect(body).toContain("loadStatus()");
    expect(tail.replace(/\s/g, "")).toMatch(/^,\[\]\)/);
  });
});

describe("User two factor auth buttons", () => {
  test("every Card button declares an icon", () => {
    /*
     * CardButtonSchema.icon is required, so this is normally the compiler's
     * job - but only while every button object is written inline in a literal
     * the compiler can see. The reason it is pinned here is that the required-
     * ness itself is a one-character edit in Card.tsx: making `icon` optional
     * compiles the whole repo and silently renders a row of unlabelled-by-icon
     * buttons, three of which on this page change how somebody signs in.
     */
    const withoutIcon: Array<string> = allCardButtonObjects().filter(
      (button: string) => {
        return !CARD_BUTTON_ICON.test(button);
      },
    );

    expect(withoutIcon).toEqual([]);
    expect(cardComponentSource).toMatch(/^\s*icon: IconProp;$/m);
  });

  test("the reset button is styled as the destructive action it is", () => {
    /*
     * Reset wipes every authenticator the user has. It sits between two
     * NORMAL-styled buttons that merely toggle a requirement, so the colour is
     * the only thing on screen distinguishing "change a setting" from "log this
     * person out of their own second factor".
     */
    const resetButton: string = twoFactorButton("twoFactorResetButton");

    expect(resetButton).toContain("buttonStyle: ButtonStyleType.DANGER");
  });

  test("the reset confirmation is styled as the destructive action it is", () => {
    /*
     * The second half of the same guarantee: the modal is the last thing the
     * operator reads before the write happens, and a PRIMARY submit button
     * there reads as "OK" rather than as "delete".
     */
    const resetModal: string = blockAfter(
      authenticationPageSource,
      "{showResetTwoFactorModal ? (",
    );

    expect(resetModal).toContain("submitButtonType={ButtonStyleType.DANGER}");
    expect(resetModal).toMatch(
      /submitButtonText=\{t\(\s*"pages\.userAuthentication\.twoFactorResetModalSubmit",?\s*\)\}/,
    );

    /*
     * And that this is the reset modal rather than one of the two beside it,
     * which are correctly PRIMARY: the block bound above is only the right one
     * while it is the block that runs the reset.
     */
    expect(resetModal).toContain("resetTwoFactorAuth()");
  });

  test("the reset button is never disabled", () => {
    /*
     * Deliberate: an operator does not necessarily know what a locked-out user
     * has set up, and running a reset against an account with nothing on it is
     * a harmless no-op. Disabling it on `verifiedTwoFactorAuthMethodCount === 0`
     * would hide the escape hatch from the exact operator who has been told
     * "I cannot sign in" and needs to try something.
     */
    expect(disabledExpression(twoFactorButton("twoFactorResetButton"))).toBe(
      "",
    );
  });

  test("the require button is locked, with its reason, once the requirement is on", () => {
    /*
     * Disabled rather than hidden, and with a tooltip: a button that vanishes
     * when it would be a no-op reads as a missing feature, and a disabled
     * button with no explanation reads as a bug. Button keeps a disabled button
     * hoverable precisely so the tooltip can be read.
     */
    const requireButton: string = twoFactorButton("twoFactorRequireButton");

    expect(disabledExpression(requireButton)).toBe(
      "status?.isTwoFactorAuthEnabled === true,",
    );
    expect(requireButton).toMatch(
      /tooltip:\s*status\?\.isTwoFactorAuthEnabled === true\s*\?\s*t\(\s*"pages\.userAuthentication\.twoFactorAlreadyRequiredTooltip",?\s*\)\s*:\s*undefined/,
    );
  });

  test("the do-not-require button is the exact mirror of the require button", () => {
    /*
     * Stated as a mirror rather than as two independent facts, because the
     * failure mode is that the two conditions drift into agreement. Both
     * buttons disabled on `=== true` leaves an operator who cannot remove a
     * requirement; both on `=== false` leaves one who cannot add one; and
     * `!status?.isTwoFactorAuthEnabled` in place of `=== false` would disable
     * the button while the status is still loading, which looks identical to
     * "already off" and is not.
     *
     * The `=== true` / `=== false` pair rather than truthiness is also what
     * makes both buttons ENABLED before the fetch lands: `undefined === true`
     * and `undefined === false` are both false, so nothing is greyed out on the
     * strength of a status the page does not have yet.
     */
    const requireDisabled: string = disabledExpression(
      twoFactorButton("twoFactorRequireButton"),
    );
    const doNotRequireDisabled: string = disabledExpression(
      twoFactorButton("twoFactorDoNotRequireButton"),
    );

    expect(doNotRequireDisabled).toBe(requireDisabled.replace("true", "false"));
    expect(doNotRequireDisabled).toBe(
      "status?.isTwoFactorAuthEnabled === false,",
    );
    expect(twoFactorButton("twoFactorDoNotRequireButton")).toMatch(
      /tooltip:\s*status\?\.isTwoFactorAuthEnabled === false\s*\?\s*t\(\s*"pages\.userAuthentication\.twoFactorNotRequiredTooltip"\s*\)\s*:\s*undefined/,
    );
  });

  test("the buttons key off the requirement, not off the derived tri-state", () => {
    /*
     * `twoFactorAuthStatus` folds the requirement together with whether
     * anything is set up. Keying the buttons off it would disable "Require" for
     * an account in EnabledPendingSetup only if the comparison happened to
     * cover that member - and forget it, and the operator can re-require an
     * account that is already mandated. `isTwoFactorAuthEnabled` is the
     * requirement on its own, which is the only thing these two buttons write.
     */
    const twoFactorButtons: string = cardButtonsBlock("twoFactorCardTitle");

    expect(twoFactorButtons).not.toMatch(/disabled:[^\n]*twoFactorAuthStatus/);
  });
});

describe("User two factor auth status rendering", () => {
  test("all three status labels are rendered", () => {
    /*
     * `twoFactorStatusLabel` falls through to "Not Enabled", so dropping the
     * middle branch does not throw and does not render blank: it reports an
     * account that is mandated with nothing set up - the locked-out user - as
     * "Not Enabled". An operator reading that closes the ticket.
     */
    const keys: Array<string> = translationKeysUsedByPage();

    expect(keys).toContain(
      "pages.userAuthentication.twoFactorStatusNotEnabled",
    );
    expect(keys).toContain(
      "pages.userAuthentication.twoFactorStatusPendingSetup",
    );
    expect(keys).toContain(
      "pages.userAuthentication.twoFactorStatusConfigured",
    );
  });

  test("each label is chosen by the enum member it belongs to", () => {
    /*
     * The keys existing is not the same as them being wired to the right
     * branch. Two branches comparing against the same member would render one
     * state's label for two states, and every other assertion here would pass.
     */
    const label: string = blockAfter(
      authenticationPageSource,
      "const twoFactorStatusLabel",
    );

    expect(label).toMatch(
      /twoFactorAuthStatus === TwoFactorAuthStatus\.EnabledConfigured[\s\S]{0,120}twoFactorStatusConfigured/,
    );
    expect(label).toMatch(
      /twoFactorAuthStatus === TwoFactorAuthStatus\.EnabledPendingSetup[\s\S]{0,120}twoFactorStatusPendingSetup/,
    );
    expect(label).toContain(
      'return t("pages.userAuthentication.twoFactorStatusNotEnabled");',
    );
  });

  test("the page renders the tri-state label rather than a bare yes/no", () => {
    /*
     * `yesNo(status.isTwoFactorAuthEnabled)` is the tempting one-liner, and it
     * is the specific lie this whole tri-state exists to prevent: "Two Factor
     * Auth: Yes" is true of an account an admin has just mandated and that has
     * nothing behind the mandate.
     */
    expect(authenticationPageSource).toContain(
      "twoFactorStatusLabel(status.twoFactorAuthStatus)",
    );
    expect(authenticationPageSource).not.toContain(
      "yesNo(status.isTwoFactorAuthEnabled)",
    );
  });

  test("the page renders the verified method count", () => {
    /*
     * The number behind the label. "Enabled - Configured" with a count of 1
     * tells an operator that resetting will lock the user out until they
     * re-enrol; the label alone does not.
     */
    expect(authenticationPageSource).toContain(
      "{status.verifiedTwoFactorAuthMethodCount}",
    );
    expect(translationKeysUsedByPage()).toContain(
      "pages.userAuthentication.twoFactorMethodCountLabel",
    );
  });
});

describe("User two factor auth status contract", () => {
  /*
   * The page and the endpoint are typed against the same declaration in
   * Common/Types, which is what makes a renamed field a compile error rather
   * than an `undefined` rendered into the Card. These tests pin that the fields
   * are declared there at all - a field deleted from the interface AND from the
   * page compiles perfectly and simply stops being reported.
   */

  test("the status type declares the two new fields", () => {
    expect(authenticationStatusTypeSource).toMatch(
      /^\s*twoFactorAuthStatus: TwoFactorAuthStatus;$/m,
    );
    expect(authenticationStatusTypeSource).toMatch(
      /^\s*verifiedTwoFactorAuthMethodCount: number;$/m,
    );
  });

  test("the status type keeps the raw requirement alongside the derived state", () => {
    /*
     * Both are needed and neither substitutes for the other: the tri-state is
     * what the operator reads, and the raw flag is what the two buttons' mirror
     * conditions key off.
     */
    expect(authenticationStatusTypeSource).toMatch(
      /^\s*isTwoFactorAuthEnabled: boolean;$/m,
    );
  });

  test("TwoFactorAuthStatus has exactly the three states the page renders", () => {
    /*
     * Exactly three, pinned as a set. A fourth member added without a fourth
     * branch in `twoFactorStatusLabel` falls through to "Not Enabled" and is
     * reported as an account with two factor auth off, whatever it actually
     * means.
     */
    expect(enumMembers(twoFactorAuthStatusTypeSource)).toEqual([
      "NotEnabled=NotEnabled",
      "EnabledPendingSetup=EnabledPendingSetup",
      "EnabledConfigured=EnabledConfigured",
    ]);
  });
});

describe("User two factor auth method count", () => {
  test("only verified authenticators are counted, in both tables", () => {
    /*
     * `isVerified: true` is mandatory on BOTH queries and the two tables reach
     * it differently, which is what makes leaving it off a real bug rather than
     * a redundancy. UserTotpAuthService writes `isVerified = false` on create
     * and only the enrolment step flips it, so an abandoned QR scan leaves a row
     * behind forever; UserWebAuthnService creates its rows already verified.
     * Counting unverified rows reports a user who has never once typed a code
     * as "Enabled - Configured" - and that user is precisely the one an operator
     * is on the page to help.
     *
     * A source-text guard rather than a behavioural one, deliberately
     * overlapping the service's own test: the filter is one line that can be
     * deleted without any type changing, so it is worth catching in both places.
     */
    const counter: string = blockAfter(
      userServiceSource,
      "private async countVerifiedTwoFactorAuthMethods",
    );

    expect(counter).toContain("UserTotpAuthService.countBy(");
    expect(counter).toContain("UserWebAuthnService.countBy(");
    expect(countOccurrences(counter, "isVerified: true")).toBe(2);
    expect(counter).not.toContain("isVerified: false");
  });

  test("the status endpoint reports that count and derives the tri-state from it", () => {
    /*
     * Bounds the test above to something the page actually reads. A perfectly
     * correct counter that `getAuthenticationStatus` stopped calling would
     * leave the Card reporting whatever the fallback happened to be.
     */
    const status: string = blockAfter(
      userServiceSource,
      "public async getAuthenticationStatus",
    );

    expect(status).toContain(
      "await this.countVerifiedTwoFactorAuthMethods(userId)",
    );
    expect(status).toMatch(
      /verifiedTwoFactorAuthMethodCount: verifiedTwoFactorAuthMethodCount,/,
    );
    expect(status).toMatch(
      /twoFactorAuthStatus: Service\.deriveTwoFactorAuthStatus\(\{[\s\S]{0,200}verifiedMethodCount: verifiedTwoFactorAuthMethodCount,/,
    );
  });

  test("the requirement is read from the column login actually consults", () => {
    /*
     * `User` carries both `enableTwoFactorAuth` and the similarly named
     * `twoFactorAuthEnabled`. Only the former is the one login reads and the
     * one the rest of the product writes; the latter is a vestige of the
     * initial migration that nothing reads. Reporting it would tell an operator
     * "2FA off" about a user who very much has it on.
     */
    const status: string = blockAfter(
      userServiceSource,
      "public async getAuthenticationStatus",
    );

    expect(status).toContain(
      "const isTwoFactorAuthEnabled: boolean = Boolean(user.enableTwoFactorAuth);",
    );
    expect(status).not.toContain("user.twoFactorAuthEnabled");
  });
});

describe("User two factor auth page route", () => {
  test("the page still reads its user from the segment the route puts it in", () => {
    /*
     * Re-derived here rather than restated, because this page's buttons now
     * include one that wipes every authenticator an account has.
     * `Navigation.getLastParamAsObjectID(n)` counts path segments BACKWARDS
     * from the end of the URL, so `n` has to equal the number of segments that
     * follow the model id. With the wrong index the page does not throw: it
     * constructs an ObjectID around the literal "authentication", and the reset
     * button posts to whoever that turns out to name.
     *
     * The expected index is computed from RouteMap, so re-nesting the route
     * without re-checking the page fails here rather than in production.
     */
    const segments: Array<string> = routePath(
      PageMap.USER_AUTHENTICATION,
    ).split("/");
    const segmentsAfterModelId: number =
      segments.length - 1 - segments.indexOf(RouteParams.ModelID);

    expect(segmentsAfterModelId).toBe(1);
    expect(authenticationPageSource).toContain(
      `Navigation.getLastParamAsObjectID(${segmentsAfterModelId})`,
    );
    expect(
      countOccurrences(authenticationPageSource, "getLastParamAsObjectID("),
    ).toBe(1);
  });
});

describe("User two factor auth translations", () => {
  test("all sixteen locale files are being looked at", () => {
    /*
     * The loops below prove nothing if the directory read comes back short, and
     * i18next's fallbackLng is "en", so a locale file that simply lacks these
     * keys renders an English page with no error to notice. Pinned as the exact
     * list rather than a count, so a seventeenth language added without these
     * keys is a failure here rather than a half-translated page.
     */
    expect(localeFileNames).toEqual([
      "da.json",
      "de.json",
      "en.json",
      "es.json",
      "fr.json",
      "hi.json",
      "it.json",
      "ja.json",
      "ko.json",
      "nl.json",
      "no.json",
      "pt.json",
      "ru.json",
      "sv.json",
      "zh-CN.json",
      "zh-TW.json",
    ]);
  });

  test("every key the page asks for is translated in every locale", () => {
    /*
     * i18next renders the dotted path itself when a key is missing, so a locale
     * without `pages.userAuthentication.twoFactorResetModalSubmit` captions the
     * submit button of a destructive confirmation modal with that path. The
     * violations are collected as "<file>: <key>" so a failure names exactly
     * which file and which key rather than reporting `false`.
     */
    const keys: Array<string> = translationKeysUsedByPage();
    const missing: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);

      for (const key of keys) {
        if (!hasTranslation(locale, key)) {
          missing.push(`${fileName}: ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("every two factor key the page renders exists in en.json", () => {
    /*
     * Narrowed to the keys this change introduced, so that a failure reads as
     * "the two-factor work is missing a key" rather than as a page-wide i18n
     * problem.
     */
    const missing: Array<string> = twoFactorKeysUsedByPage().filter(
      (key: string) => {
        return !hasTranslation(
          englishLocale,
          `pages.userAuthentication.${key}`,
        );
      },
    );

    expect(missing).toEqual([]);
  });

  test("en.json carries no two factor key the page has stopped rendering", () => {
    /*
     * The other direction. A key left in all sixteen files after its call site
     * was renamed is sixteen dead translations that the i18n validator happily
     * keeps in sync forever, and it hides the rename: the page renders the raw
     * path while every locale file looks complete.
     */
    expect(twoFactorLocaleKeys(englishLocale)).toEqual(
      twoFactorKeysUsedByPage(),
    );
  });

  test("no locale carries a two factor key en.json does not", () => {
    /*
     * en.json is the source of truth and the fallback. A key that exists only
     * in, say, fr.json is invisible in development and untestable in review -
     * and if the page is ever pointed at it, every language except French
     * renders the raw path.
     */
    const englishKeys: Array<string> = twoFactorLocaleKeys(englishLocale);
    const extra: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);

      for (const key of twoFactorLocaleKeys(locale)) {
        if (!englishKeys.includes(key)) {
          extra.push(`${fileName}: ${key}`);
        }
      }
    }

    expect(extra).toEqual([]);
  });
});
