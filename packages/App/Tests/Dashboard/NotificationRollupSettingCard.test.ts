import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import UserNotificationEmailRollupSetting from "Common/Models/DatabaseModels/UserNotificationEmailRollupSetting";
import Route from "Common/Types/API/Route";

/*
 * THE ONLY WAY OUT OF OWNER-EMAIL BURST ROLLUP, pinned.
 *
 * Rollup is on for every user of every project and there is no row in
 * UserNotificationEmailRollupSetting until somebody turns it off on this card.
 * That makes the card the whole escape hatch: the model, the service and the
 * writer can all be perfect while the preference is unreachable by a human,
 * and nothing anywhere reports an error. What reaches the user instead is
 * mail they did not ask to have batched and no control that admits it exists.
 *
 * Each of these fails silently in production if it regresses:
 *
 *  - the card not being mounted on the Email Preferences page, or that page
 *    not being routed. A component file that nothing renders compiles and
 *    lints exactly like one that does, and the preference is then
 *    unreachable by any human;
 *  - Notification Settings losing its pointer at Email Preferences. The
 *    per-event matrix is where somebody drowning in mail goes first, and
 *    without that line they leave believing switching events off one at a
 *    time is the only remedy the product has;
 *  - "no row" being read as OFF. Almost nobody has a row - there was no
 *    backfill - so this is not an edge case, it is what nearly every user
 *    sees: a switch saying their mail is delivered individually while the
 *    server rolls it up. The card would be lying to essentially everybody;
 *  - the create/update split going wrong. An update against a user who has no
 *    row writes nothing (there is no id to update) and a create against a user
 *    who has one is rejected by the service's one-row rule. Either way the
 *    switch moves, no error is shown, and the preference silently does not
 *    stick - the worst outcome available, because the user believes they have
 *    opted out;
 *  - the accessible name going away. This is one unlabelled round button; a
 *    screen-reader user has no other way to know which state it is in;
 *  - the copy losing the "never affected" sentence. The question a reader
 *    actually has in front of a batching switch is whether it can delay a
 *    page, and an unanswered version of that question is answered by turning
 *    the feature off out of fear.
 *
 * Pinned against source rather than rendered, for the reason
 * PayAsYouGoWiring.test.ts gives: react is a dependency of the Dashboard
 * package, not of App, so importing the page here would not resolve. The two
 * expressions whose MEANING matters rather than their text - the absent-row
 * default and the accessible name - are lifted out and run, the way
 * DiscoveryReviewHostname.test.ts runs the row's own name expression.
 * Behaviour that CAN be rendered is covered in a real DOM by
 * Common/Tests/App/Dashboard/UserSettingsEmailPreferencesPage.test.tsx; this
 * file keeps only what a renderer cannot reach.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * The card is its own component file now. Reading the whole file IS reading
 * the card, which removes the slice-between-two-string-markers helper this
 * suite used to need - and with it the failure mode where a marker moved and
 * the slice silently widened to cover unrelated code.
 */
const CARD_PARTS: Array<string> = [
  "Components",
  "EmailPreferences",
  "EmailRollupCard.tsx",
];

/* The page that mounts it. */
const PAGE_PARTS: Array<string> = [
  "Pages",
  "UserSettings",
  "EmailPreferences.tsx",
];

/* The page that must keep pointing at it. */
const MATRIX_PAGE_PARTS: Array<string> = [
  "Pages",
  "UserSettings",
  "NotificationSettings.tsx",
];

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function readFile(parts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
}

/*
 * Comment-free and whitespace-squashed. Comment-free because every assertion
 * below is about behaviour, and the block comments on this page necessarily
 * describe the same behaviour in the same words - a test that a comment can
 * satisfy is a test of nothing.
 */
function readCode(parts: Array<string>): string {
  return squash(stripComments(readFile(parts)));
}

/* The card's own source. The whole file is the card. */
function cardCode(): string {
  const code: string = readCode(CARD_PARTS);

  if (!code.includes("const EmailRollupCard")) {
    throw new Error(
      "Components/EmailPreferences/EmailRollupCard.tsx no longer declares" +
        " EmailRollupCard. The rollup opt-out is the only way out of burst" +
        " rollup and nothing else in the product offers it.",
    );
  }

  return code;
}

/*
 * `const x: T = ...` -> `const x = ...`, so an extracted expression can be
 * handed to `new Function`. Only the first `=` of a const is touched.
 */
function stripTypeAnnotations(statements: string): string {
  return statements.replace(/const\s+(\w+)\s*:\s*[^=]*=/g, "const $1 =");
}

type RollupEnabledResolver = (
  setting: UserNotificationEmailRollupSetting | null,
) => boolean;

let cachedResolver: RollupEnabledResolver | null = null;

/*
 * The page's own absent-row rule, lifted and run against real model
 * instances. Pinning its text would only prove the line is spelled the way it
 * was spelled when this was written; running it proves that a user with no row
 * still sees "On".
 */
function rollupEnabledResolver(): RollupEnabledResolver {
  if (cachedResolver === null) {
    const match: RegExpMatchArray | null = cardCode().match(
      /const resolveRollupEnabled[^{]*\{\s*(return [^;]*;)\s*\};/,
    );

    if (!match || !match[1]) {
      throw new Error(
        "EmailRollupCard.tsx no longer has a single-expression" +
          " resolveRollupEnabled. The absent-row default is the whole" +
          " correctness of this card and has to stay readable.",
      );
    }

    cachedResolver = new Function(
      "setting",
      stripTypeAnnotations(match[1]),
    ) as unknown as RollupEnabledResolver;
  }

  return cachedResolver;
}

type SwitchAriaLabel = (isEnabled: boolean) => string;

let cachedAriaLabel: SwitchAriaLabel | null = null;

function switchAriaLabel(): SwitchAriaLabel {
  if (cachedAriaLabel === null) {
    const match: RegExpMatchArray | null = cardCode().match(
      /aria-label=\{(`Roll up notification emails:[^`]*`)\}/,
    );

    if (!match || !match[1]) {
      throw new Error(
        "The rollup switch no longer carries an aria-label. It renders as an" +
          " unlabelled circle, and a screen-reader user cannot tell on from" +
          " off.",
      );
    }

    cachedAriaLabel = new Function(
      "isEnabled",
      `return ${match[1]};`,
    ) as unknown as SwitchAriaLabel;
  }

  return cachedAriaLabel;
}

function settingWith(
  isEnabled: boolean | undefined,
): UserNotificationEmailRollupSetting {
  const setting: UserNotificationEmailRollupSetting =
    new UserNotificationEmailRollupSetting();

  if (isEnabled !== undefined) {
    setting.isEnabled = isEnabled;
  }

  return setting;
}

describe("Email rollup card on User Settings > Email Preferences", () => {
  describe("Mounting", () => {
    test("the card imports the model the preference lives in", () => {
      expect(cardCode()).toContain(
        'import UserNotificationEmailRollupSetting from "Common/Models/DatabaseModels/UserNotificationEmailRollupSetting"',
      );
    });

    /*
     * A component nobody renders is indistinguishable from a deleted one as
     * far as the user is concerned, and it compiles and lints identically.
     */
    test("the Email Preferences page imports and renders it", () => {
      const page: string = readCode(PAGE_PARTS);

      expect(page).toContain(
        'import EmailRollupCard from "../../Components/EmailPreferences/EmailRollupCard"',
      );
      expect(page).toContain("<EmailRollupCard />");
    });

    test("it is the second card, under the routine-email switch", () => {
      const page: string = readCode(PAGE_PARTS);
      const noiseIndex: number = page.indexOf("<EmailNoiseCard");
      const rollupIndex: number = page.indexOf("<EmailRollupCard />");

      expect(noiseIndex).toBeGreaterThan(-1);
      expect(rollupIndex).toBeGreaterThan(noiseIndex);
    });

    /*
     * THE DISCOVERABILITY THIS PAGE COSTS, bought back.
     *
     * Somebody buried in OneUptime mail opens Notification Settings, because
     * that is what the menu and every owner-email footer call the place your
     * email choices live. Rollup is not there any more. Without a pointer,
     * the matrix reads as the whole story and the only remedy on offer is
     * switching twenty-one events off by hand, one cell at a time.
     */
    test("Notification Settings points at the page this card is on", () => {
      const matrixPage: string = readCode(MATRIX_PAGE_PARTS);

      expect(matrixPage).toContain(
        "RouteMap[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] as Route",
      );
      expect(matrixPage).toContain("<Link to={emailPreferencesRoute}");
      expect(matrixPage).toContain(
        '"Reduce routine emails or change email rollup in Email Preferences"',
      );
    });

    test("it is a card, loader and error message like the rest of the page", () => {
      const card: string = cardCode();

      expect(card).toContain('<Card title="Email Rollup"');
      expect(card).toContain("<ComponentLoader />");
      expect(card).toContain("<ErrorMessage message={error}");
      expect(card).toContain("onRefreshClick={");
      expect(card).toContain("setError(API.getFriendlyMessage(err))");
    });
  });

  describe("Reading the setting", () => {
    test("it reads this user's row in the current project", () => {
      expect(cardCode()).toContain(
        "await ModelAPI.getList<UserNotificationEmailRollupSetting>({" +
          " modelType: UserNotificationEmailRollupSetting," +
          " query: { projectId: ProjectUtil.getCurrentProjectId()!," +
          " userId: User.getUserId(), },",
      );
    });

    test("it selects the value and the id it later updates by", () => {
      expect(cardCode()).toContain("select: { _id: true, isEnabled: true, },");
    });

    test("an empty list is stored as no row, not as a row", () => {
      expect(cardCode()).toContain("setSetting(result.data[0] || null);");
    });
  });

  /*
   * The default is the entire ship-safety of this feature: rollup went out on
   * with no backfill, so "no row" is the state of very nearly every user.
   */
  describe("An absent row means ENABLED", () => {
    test("no row at all reads as enabled", () => {
      expect(rollupEnabledResolver()(null)).toBe(true);
    });

    test("a row that carries no value reads as enabled", () => {
      expect(rollupEnabledResolver()(settingWith(undefined))).toBe(true);
    });

    test("only an explicit false is an opt-out", () => {
      expect(rollupEnabledResolver()(settingWith(false))).toBe(false);
      expect(rollupEnabledResolver()(settingWith(true))).toBe(true);
    });

    test("the switch, its label and the copy all read from that resolver", () => {
      const card: string = cardCode();

      expect(card).toContain(
        "const isEnabled: boolean = resolveRollupEnabled(setting);",
      );
      expect(card).toContain("aria-checked={isEnabled}");
      expect(card).toContain("await persistRollupEnabled(!isEnabled);");
    });
  });

  describe("Persisting the choice", () => {
    test("the switch moves before the write, optimistically", () => {
      const card: string = cardCode();
      const optimisticIndex: number = card.indexOf("setSetting(optimistic);");
      const tryIndex: number = card.indexOf("try {", optimisticIndex);

      expect(card).toContain("optimistic.isEnabled = next;");
      expect(optimisticIndex).toBeGreaterThan(-1);
      expect(tryIndex).toBeGreaterThan(optimisticIndex);
    });

    test("a user who already has a row has that row updated by id", () => {
      expect(cardCode()).toContain(
        "if (previous && previous.id) {" +
          " await ModelAPI.updateById<UserNotificationEmailRollupSetting>({" +
          " modelType: UserNotificationEmailRollupSetting," +
          " id: previous.id as ObjectID," +
          " data: { isEnabled: next } as JSONObject, }); } else {",
      );
    });

    test("a user who has no row gets one created, carrying project, user and value", () => {
      const card: string = cardCode();

      expect(card).toContain(
        "const newModel: UserNotificationEmailRollupSetting =" +
          " new UserNotificationEmailRollupSetting();" +
          " newModel.projectId = ProjectUtil.getCurrentProjectId()!;" +
          " newModel.userId = User.getUserId();" +
          " newModel.isEnabled = next;" +
          " await ModelAPI.create<UserNotificationEmailRollupSetting>({" +
          " model: newModel, modelType: UserNotificationEmailRollupSetting, });",
      );
    });

    /*
     * The service rejects a second row for the same (user, project), so the
     * created row has to be read back or the NEXT toggle tries to create
     * another one and fails.
     */
    test("the created row is read back before the next toggle", () => {
      const card: string = cardCode();
      const createIndex: number = card.indexOf(
        "await ModelAPI.create<UserNotificationEmailRollupSetting>({",
      );
      const refetchIndex: number = card.indexOf(
        "await fetchSetting();",
        createIndex,
      );

      expect(createIndex).toBeGreaterThan(-1);
      expect(refetchIndex).toBeGreaterThan(createIndex);
    });

    test("a failed write puts the switch back and says why", () => {
      expect(cardCode()).toContain(
        "} catch (err) { setSetting(previous);" +
          " setError(API.getFriendlyMessage(err)); }",
      );
    });
  });

  describe("Reachable without a mouse", () => {
    test("the control is a real button with a switch role, as ChannelCell is", () => {
      const card: string = cardCode();
      const matrixPage: string = readCode(MATRIX_PAGE_PARTS);

      expect(card).toContain(
        '<button type="button" role="switch" aria-checked={isEnabled}',
      );
      expect(card).toContain("onClick={handleToggle}");
      /*
       * The matrix's switch, unchanged and now in a different file: one
       * idiom across both pages, not two.
       */
      expect(matrixPage).toContain(
        '<button type="button" role="switch" aria-checked={props.enabled}',
      );
    });

    test("the accessible name says the state and what pressing it does", () => {
      expect(switchAriaLabel()(true)).toBe(
        "Roll up notification emails: On. Click to disable.",
      );
      expect(switchAriaLabel()(false)).toBe(
        "Roll up notification emails: Off. Click to enable.",
      );
    });

    test("it cannot be double-submitted while a write is in flight", () => {
      const card: string = cardCode();

      expect(card).toContain("if (isBusy) { return; }");
      expect(card).toContain("disabled={isBusy}");
    });
  });

  describe("Copy", () => {
    test("each state is explained in plain language", () => {
      const card: string = cardCode();

      expect(card).toContain(
        '"On: notifications that arrive together are delivered as one email."',
      );
      expect(card).toContain(
        '"Off: every notification arrives as its own email, immediately."',
      );
    });

    /*
     * The question a reader actually has in front of a batching switch. Left
     * unanswered, the safe-feeling move is to turn the feature off.
     */
    test("it names the mail this never affects", () => {
      const card: string = cardCode();

      expect(card).toContain("On-call paging");
      expect(card).toContain("security and sign-in email");
      expect(card).toContain("billing email");
      expect(card).toContain("are never rolled up and are never delayed");
    });

    test("it says the choice is personal and scoped to this project", () => {
      expect(cardCode()).toContain(
        "This is your own setting, in this project only.",
      );
    });
  });

  /*
   * The card writes through the model's CRUD endpoint. If that route or the
   * column moved, every write above would 404 or be dropped, and the switch
   * would still move.
   */
  describe("The model behind it", () => {
    test("the model exposes isEnabled and its own CRUD endpoint", () => {
      const model: UserNotificationEmailRollupSetting =
        new UserNotificationEmailRollupSetting();
      const crudPath: Route | null = model.getCrudApiPath();

      expect(crudPath).toBeTruthy();
      expect(crudPath?.toString()).toBe(
        "/user-notification-email-rollup-setting",
      );
      expect(Object.keys(model)).toContain("isEnabled");
    });
  });
});
