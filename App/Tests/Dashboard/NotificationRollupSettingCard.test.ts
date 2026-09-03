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
 *  - the card not being mounted, or being moved inside one tab. It compiles
 *    and lints either way. Inside a tab it governs delivery for the five tabs
 *    it is not on, while looking like a setting for the one it is on;
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
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const PAGE_PARTS: Array<string> = [
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

function readPage(): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...PAGE_PARTS), "utf8");
}

/*
 * Comment-free and whitespace-squashed. Comment-free because every assertion
 * below is about behaviour, and the block comments on this page necessarily
 * describe the same behaviour in the same words - a test that a comment can
 * satisfy is a test of nothing.
 */
function readCode(): string {
  return squash(stripComments(readPage()));
}

/*
 * The card's own slice of the page. `toContain` against the whole file cannot
 * tell the rollup card's ModelAPI calls from the notification matrix's, and
 * both models are read and written with the same four idioms.
 */
function cardCode(): string {
  const code: string = readCode();
  const start: number = code.indexOf("const EmailRollupCard");
  const end: number = code.indexOf("const Settings:", start);

  if (start < 0 || end < 0) {
    throw new Error(
      "NotificationSettings.tsx no longer declares EmailRollupCard ahead of" +
        " the Settings page component.",
    );
  }

  return code.slice(start, end);
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
    const match: RegExpMatchArray | null = readCode().match(
      /const resolveRollupEnabled[^{]*\{\s*(return [^;]*;)\s*\};/,
    );

    if (!match || !match[1]) {
      throw new Error(
        "NotificationSettings.tsx no longer has a single-expression" +
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

describe("Email rollup card on User Settings > Notifications", () => {
  describe("Mounting", () => {
    test("the page imports the model the preference lives in", () => {
      expect(readCode()).toContain(
        'import UserNotificationEmailRollupSetting from "Common/Models/DatabaseModels/UserNotificationEmailRollupSetting"',
      );
    });

    test("the card is rendered above the tabs, so every tab shows it", () => {
      const code: string = readCode();
      const cardIndex: number = code.indexOf("<EmailRollupCard />");
      const tabsIndex: number = code.indexOf("<Tabs");

      expect(cardIndex).toBeGreaterThan(-1);
      expect(tabsIndex).toBeGreaterThan(-1);
      expect(cardIndex).toBeLessThan(tabsIndex);
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
      const page: string = readCode();

      expect(card).toContain(
        '<button type="button" role="switch" aria-checked={isEnabled}',
      );
      expect(card).toContain("onClick={handleToggle}");
      /* The page's other switch, unchanged: one idiom, not two. */
      expect(page).toContain(
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
