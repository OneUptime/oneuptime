import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import {
  ON_CALL_OBSERVER_PAGE_PUSH_CATEGORY,
  ON_CALL_PAGE_PUSH_CATEGORY,
  PUSH_NOTIFICATION_CATEGORIES,
} from "../../../Types/PushNotification/PushNotificationCategory";
import { ESCALATE } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL,
  ON_CALL_OBSERVER_PAGE_SMS_LEAD,
} from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERVER AND THE MOBILE APP NAME THE SAME CATEGORY.
 *
 * Every responder's page's push names ON_CALL_PAGE_PUSH_CATEGORY, and the
 * app draws Acknowledge and Escalate under a push of the category it
 * registered (MobileApp/src/notifications/categories.ts) - its own copy of
 * the id, since the app is built without Common's code. An observer's page
 * (OnCallObserverPage) names ON_CALL_OBSERVER_PAGE_PUSH_CATEGORY, and the
 * app draws "I've seen it" under it, in the server's words. A copy that
 * drifts fails silently: the page arrives with no buttons under it - or,
 * worse, an observer's with a responder's. So this suite compiles the app's
 * files as they are, runs them beside the server's list and words, and holds
 * the two together.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const MOBILE_SRC: string = path.join(REPOSITORY_ROOT, "packages/MobileApp/src");

type ModuleExports = Record<string, unknown>;

function loadMobileModule(
  relativePath: string,
  modules: Record<string, ModuleExports>,
): ModuleExports {
  const source: string = fs.readFileSync(
    path.join(MOBILE_SRC, relativePath),
    "utf8",
  );
  const compiled: string = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: path.basename(relativePath),
  }).outputText;
  const moduleObject: { exports: ModuleExports } = { exports: {} };

  vm.runInNewContext(compiled, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (specifier: string): ModuleExports => {
      const required: ModuleExports | undefined = modules[specifier];

      if (!required) {
        throw new Error(
          `The app's ${relativePath} imports ${specifier}, which this suite does not provide.`,
        );
      }

      return required;
    },
  });

  return moduleObject.exports;
}

const passOnModule: ModuleExports = loadMobileModule("oncall/passOn.ts", {});
const observerPageModule: ModuleExports = loadMobileModule(
  "oncall/observerPage.ts",
  {},
);
const categoriesModule: ModuleExports = loadMobileModule(
  "notifications/categories.ts",
  {
    "../oncall/passOn": passOnModule,
    "../oncall/observerPage": observerPageModule,
  },
);

interface MobileAction {
  identifier: string;
  buttonTitle: string;
  options: Record<string, unknown>;
}

const MOBILE_CATEGORY: unknown = categoriesModule["ON_CALL_PAGE_CATEGORY"];
const MOBILE_ACTIONS: Array<MobileAction> = JSON.parse(
  JSON.stringify(categoriesModule["ON_CALL_PAGE_ACTIONS"]),
) as Array<MobileAction>;
const getActionKind: (identifier: string) => string | null = categoriesModule[
  "getPushPageActionKind"
] as (identifier: string) => string | null;

const MOBILE_OBSERVER_CATEGORY: unknown =
  categoriesModule["ON_CALL_OBSERVER_PAGE_CATEGORY"];
const MOBILE_OBSERVER_ACTIONS: Array<MobileAction> = JSON.parse(
  JSON.stringify(categoriesModule["ON_CALL_OBSERVER_PAGE_ACTIONS"]),
) as Array<MobileAction>;
const MOBILE_REGISTERED: Array<{ identifier: string }> = JSON.parse(
  JSON.stringify(categoriesModule["NOTIFICATION_CATEGORIES"]),
) as Array<{ identifier: string }>;
const MOBILE_OBSERVER_TEXT: Record<string, string> = observerPageModule[
  "OBSERVER_PAGE_TEXT"
] as Record<string, string>;

describe("the on-call page's category", () => {
  test("the app registers the id the server names on every page", () => {
    expect(MOBILE_CATEGORY).toBe(ON_CALL_PAGE_PUSH_CATEGORY);
    expect(PUSH_NOTIFICATION_CATEGORIES).toContain(MOBILE_CATEGORY);
  });

  test("its actions are Acknowledge and Escalate, in the words the product uses everywhere", () => {
    expect(
      MOBILE_ACTIONS.map((action: MobileAction) => {
        return action.buttonTitle;
      }),
    ).toEqual(["Acknowledge", ESCALATE]);
  });

  test("both open the app once the phone is unlocked: nothing is done unseen from the lock screen", () => {
    for (const action of MOBILE_ACTIONS) {
      expect(action.options).toEqual({
        opensAppToForeground: true,
        isAuthenticationRequired: true,
      });
    }
  });

  test("each action asks the record's screen for what its button says", () => {
    expect(
      MOBILE_ACTIONS.map((action: MobileAction) => {
        return getActionKind(action.identifier);
      }),
    ).toEqual(["acknowledge", "escalate"]);
  });
});

describe("the observer's page's category", () => {
  test("the app registers the id the server names on every observer's page", () => {
    expect(MOBILE_OBSERVER_CATEGORY).toBe(ON_CALL_OBSERVER_PAGE_PUSH_CATEGORY);
    expect(PUSH_NOTIFICATION_CATEGORIES).toContain(MOBILE_OBSERVER_CATEGORY);
  });

  test("its one action is I've seen it, in the words of the email's button - never Acknowledge or Escalate", () => {
    expect(
      MOBILE_OBSERVER_ACTIONS.map((action: MobileAction) => {
        return action.buttonTitle;
      }),
    ).toEqual([ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL]);
  });

  test("it opens the app once the phone is unlocked, as the responder's do", () => {
    for (const action of MOBILE_OBSERVER_ACTIONS) {
      expect(action.options).toEqual({
        opensAppToForeground: true,
        isAuthenticationRequired: true,
      });
    }
  });

  test("it asks the record's screen to mark the page seen, which never acknowledges the record", () => {
    expect(
      MOBILE_OBSERVER_ACTIONS.map((action: MobileAction) => {
        return getActionKind(action.identifier);
      }),
    ).toEqual(["seen"]);
  });

  test("the app's screens say FYI (observer) and I've seen it, as the server's messages do", () => {
    expect(MOBILE_OBSERVER_TEXT["label"]).toBe(ON_CALL_OBSERVER_PAGE_SMS_LEAD);
    expect(MOBILE_OBSERVER_TEXT["seenButton"]).toBe(
      ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL,
    );
  });
});

describe("every category the server names", () => {
  test("is one the app registers, and the app registers no other", () => {
    expect(
      MOBILE_REGISTERED.map((category: { identifier: string }) => {
        return category.identifier;
      }),
    ).toEqual([...PUSH_NOTIFICATION_CATEGORIES]);
  });
});
