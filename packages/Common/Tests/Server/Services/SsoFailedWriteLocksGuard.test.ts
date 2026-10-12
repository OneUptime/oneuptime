import {
  ClassSource,
  callArguments,
  hasMethod,
  methodText,
  readClassSource,
} from "../TestingUtils/ClassSource";
import { describe, expect, test } from "@jest/globals";
import path from "path";

/*
 * A CHANGE TO WHO CAN SIGN IN WHOSE WRITE FAILED HANDS WHAT FAILED TO THE
 * HELPER THAT GIVES ITS LOCKS BACK.
 *
 * Its locks keep every other change to who can sign in from being checked
 * while it is written. A write that failed was not applied - unless the
 * database never answered it: the cancel of a statement the client stopped
 * waiting for (DATABASE_QUERY_TIMEOUT_MS) could not reach the database, or
 * the connection was lost while it ran, and the database may still apply it
 * (Server/Utils/Database/StatementOutcome). The locks are then kept until
 * the database would have cancelled it (ProjectSsoProviderChanges.
 * giveBackAfterFailedWrite), so the helpers have to know what failed - and
 * which step of the write it was: DatabaseService hands every error hook
 * `failedStatement` (WriteProgress), the write's own statement or one around
 * it, and one around it applied nothing of the write. A create runs in a
 * transaction of its own and can still land only by its COMMIT. Every error
 * hook of a service whose writes are checked hands its `error` and its
 * `failedStatement` to one of them:
 *
 *   - ProjectService and GlobalConfigService (Require SSO for Login):
 *     SsoRequirementChanges.afterFailedUpdate / afterFailedProjectCreate;
 *   - a project's SAML and OIDC providers: ProjectSsoProviderChanges.
 *     afterFailedWrite;
 *   - the global providers and their attachments: GlobalSsoProviderChanges.
 *     afterFailedWrite, and afterFailedCreate for an attachment's create.
 *
 * None of them gives the locks back with the helpers the success hooks use,
 * which do not know what failed.
 *
 * The two writes that put an SSH credential within reach of OneUptime AI's
 * commands - a Runner's update, a runbook credential's create - hold a lock
 * the same way (AiCommandCredentialReach), and hand on the same.
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const SERVICES_DIR: string = path.join(COMMON_DIR, "Server", "Services");
const UTILS_DIR: string = path.join(COMMON_DIR, "Server", "Utils");

// What an error hook hands on, last: the error it was handed, and which step failed.
const HANDS_ON_ERROR_AND_STEP: RegExp =
  /,\s*error\s*,\s*failedStatement\s*,?\s*$/;

// The same for AiCommandCredentialReach, which takes the error first.
const HANDS_ON_ERROR_WRITE_AND_STEP: RegExp =
  /^\s*error\s*,\s*on(Create|Update)\s*,\s*failedStatement\s*,?\s*$/;

interface ErrorHookEntry {
  file: string;
  hooks: Array<string>;
  helper: RegExp;
  handsOn: RegExp;
}

// Each service's error hooks, and the helper each hands what failed to.
const ERROR_HOOKS: Array<ErrorHookEntry> = [
  {
    file: "ProjectService.ts",
    hooks: ["onUpdateError"],
    helper: /SsoRequirementChanges\.afterFailedUpdate/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "ProjectService.ts",
    hooks: ["onCreateError"],
    helper: /SsoRequirementChanges\.afterFailedProjectCreate/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "GlobalConfigService.ts",
    hooks: ["onUpdateError"],
    helper: /SsoRequirementChanges\.afterFailedUpdate/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "ProjectSsoService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /ProjectSsoProviderChanges\.afterFailedWrite/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "ProjectOidcService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /ProjectSsoProviderChanges\.afterFailedWrite/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "GlobalSsoService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /GlobalSsoProviderChanges\.afterFailedWrite/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "GlobalOidcService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /GlobalSsoProviderChanges\.afterFailedWrite/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "GlobalSsoProjectService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /GlobalSsoProviderChanges\.afterFailedWrite/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "GlobalSsoProjectService.ts",
    hooks: ["onCreateError"],
    helper: /GlobalSsoProviderChanges\.afterFailedCreate/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "GlobalOidcProjectService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /GlobalSsoProviderChanges\.afterFailedWrite/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "GlobalOidcProjectService.ts",
    hooks: ["onCreateError"],
    helper: /GlobalSsoProviderChanges\.afterFailedCreate/,
    handsOn: HANDS_ON_ERROR_AND_STEP,
  },
  {
    file: "RunnerService.ts",
    hooks: ["onUpdateError"],
    helper: /AiCommandCredentialReach\.giveBackAfterFailedUpdate/,
    handsOn: HANDS_ON_ERROR_WRITE_AND_STEP,
  },
  {
    file: "RunbookCredentialService.ts",
    hooks: ["onCreateError"],
    helper: /AiCommandCredentialReach\.giveBackAfterFailedCreate/,
    handsOn: HANDS_ON_ERROR_WRITE_AND_STEP,
  },
];

// The helpers the success hooks give locks back with: they do not know what failed.
const SUCCESS_HELPERS: RegExp =
  /\b(SsoRequirementChanges\.afterUpdate|SsoRequirementChanges\.afterProjectCreate|GlobalSsoProviderChanges\.afterWrite|ProjectSsoProviderChanges\.releaseSignInChange|AiCommandCredentialReach\.giveBack|AiCommandCredentialReach\.giveBackAfterUpdate|AiCommandCredentialReach\.giveBackAfterCreate)\s*\(/;

const SOURCES: Map<string, ClassSource> = new Map<string, ClassSource>();

function sourceOf(file: string): ClassSource {
  let classSource: ClassSource | undefined = SOURCES.get(file);

  if (!classSource) {
    classSource = readClassSource(path.join(SERVICES_DIR, file));
    SOURCES.set(file, classSource);
  }

  return classSource;
}

describe.each(ERROR_HOOKS)(
  "$file hands what failed on when a checked write fails",
  (entry: ErrorHookEntry) => {
    test.each(entry.hooks)(
      "%s takes which step of the write failed, and hands it and its error to the helper that gives the locks back",
      (hook: string) => {
        const classSource: ClassSource = sourceOf(entry.file);

        expect(hasMethod(classSource, hook)).toBe(true);

        const text: string = methodText(classSource, hook);

        // DatabaseService says which step of the write failed (WriteProgress).
        expect(text).toMatch(
          /failedStatement\?: StatementContext \| undefined/,
        );

        const calls: Array<string> = callArguments(text, entry.helper);

        expect(calls).toHaveLength(1);
        // The error the hook was handed, and which step failed.
        expect(calls[0]!).toMatch(entry.handsOn);
      },
    );

    test.each(entry.hooks)(
      "%s gives no lock back with a helper that does not know what failed",
      (hook: string) => {
        expect(methodText(sourceOf(entry.file), hook)).not.toMatch(
          SUCCESS_HELPERS,
        );
      },
    );
  },
);

describe("the helpers decide by what failed, and which step it was", () => {
  // Each helper, and the method of its own it gives the locks back through.
  test.each([
    ["SsoRequirementChanges.ts", "afterFailedUpdate", "release"],
    ["SsoRequirementChanges.ts", "afterFailedProjectCreate", "release"],
    ["ProjectSsoProviderChanges.ts", "afterFailedWrite", "release"],
    ["GlobalSsoProviderChanges.ts", "afterFailedWrite", "giveBackAfterFailure"],
    [
      "GlobalSsoProviderChanges.ts",
      "afterFailedCreate",
      "giveBackAfterFailure",
    ],
  ])(
    "%s %s takes what failed and leaves the decision to giveBackAfterFailedWrite",
    (file: string, method: string, through: string) => {
      const classSource: ClassSource = readClassSource(
        path.join(UTILS_DIR, file),
      );
      const text: string = methodText(classSource, method);

      expect(text).toMatch(/error: unknown/);
      expect(text).toMatch(/failedStatement\?: StatementContext \| undefined/);

      const handedOn: string = callArguments(
        text,
        new RegExp(`\\.${through}`),
      )[0]!;

      // What failed, and which step of the write it was, are handed on by name.
      expect(handedOn).toMatch(/\berror\b/);
      expect(handedOn).toMatch(/\bcontext:\s*[^,}]*\bfailedStatement\b/);
      // Through the one helper that gives a change's locks back.
      expect(methodText(classSource, through)).toMatch(
        /ProjectSsoProviderChanges\.giveBack\s*\(/,
      );
    },
  );

  test("the one helper that gives a change's locks back leaves a failed write to giveBackAfterFailedWrite", () => {
    const text: string = methodText(
      readClassSource(path.join(UTILS_DIR, "ProjectSsoProviderChanges.ts")),
      "giveBack",
    );

    expect(text).toMatch(/failure\?: SignInChangeFailure/);
    expect(text).toMatch(
      /ProjectSsoProviderChanges\.giveBackAfterFailedWrite\s*\(\s*locks,\s*failure\.error,\s*failure\.context,?\s*\)/,
    );
  });

  test.each([
    ["giveBackAfterFailedUpdate", /^\s*failedStatement\s*$/],
    [
      "giveBackAfterFailedCreate",
      /^\s*StatementOutcome\.ofCreate\(\s*failedStatement\s*\)\s*$/,
    ],
  ])(
    "AiCommandCredentialReach %s hands its error, and which step failed, to giveBackAfterFailedWrite",
    (method: string, context: RegExp) => {
      const classSource: ClassSource = readClassSource(
        path.join(UTILS_DIR, "AutoRemediation", "AiCommandCredentialReach.ts"),
      );
      const text: string = methodText(classSource, method);

      expect(text).toMatch(/failedStatement\?: StatementContext \| undefined/);

      const calls: Array<string> = callArguments(
        text,
        /AiCommandCredentialReach\.giveBackAfterFailedWrite/,
      );

      expect(calls).toHaveLength(1);

      // The hold, the error, and what is known of the failed statement.
      const handedOn: Array<string> = calls[0]!
        .split(/,(?![^(]*\))/)
        .filter((argument: string): boolean => {
          return argument.trim().length > 0;
        });

      expect(handedOn).toHaveLength(3);
      expect(handedOn[1]!.trim()).toBe("error");
      expect(handedOn[2]!).toMatch(context);

      // Which decides by StatementOutcome.
      expect(methodText(classSource, "giveBackAfterFailedWrite")).toMatch(
        /StatementOutcome\.mayStillApply\(\s*error,\s*context\s*\)/,
      );
    },
  );

  test.each([
    ["SsoRequirementChanges.ts", "afterFailedProjectCreate"],
    ["GlobalSsoProviderChanges.ts", "afterFailedCreate"],
    [
      path.join("AutoRemediation", "AiCommandCredentialReach.ts"),
      "giveBackAfterFailedCreate",
    ],
  ])(
    "%s %s says the create runs in a transaction of its own",
    (file: string, method: string) => {
      expect(
        methodText(readClassSource(path.join(UTILS_DIR, file)), method),
      ).toMatch(/StatementOutcome\.ofCreate\(\s*failedStatement\s*\)/);
    },
  );
});
