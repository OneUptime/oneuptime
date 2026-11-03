import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import {
  ON_CALL_PAGE_PUSH_CATEGORY,
  PUSH_NOTIFICATION_CATEGORIES,
} from "../../../Types/PushNotification/PushNotificationCategory";
import { ESCALATE } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERVER AND THE MOBILE APP NAME THE SAME CATEGORY.
 *
 * Every on-call page's push names ON_CALL_PAGE_PUSH_CATEGORY, and the app
 * draws Acknowledge and Escalate under a push of the category it registered
 * (MobileApp/src/notifications/categories.ts) - its own copy of the id, since
 * the app is built without Common's code. A copy that drifts fails silently:
 * the page arrives, with no buttons under it. So this suite compiles the
 * app's file as it is, runs it beside the server's list, and holds the two
 * together.
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
const categoriesModule: ModuleExports = loadMobileModule(
  "notifications/categories.ts",
  { "../oncall/passOn": passOnModule },
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
