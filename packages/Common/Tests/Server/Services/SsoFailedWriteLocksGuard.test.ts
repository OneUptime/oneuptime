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
 * database never answered it: the client stopped waiting for the statement
 * (DATABASE_QUERY_TIMEOUT_MS) or lost the connection while it ran, and the
 * database may still apply it (Server/Utils/Database/StatementOutcome). The
 * locks are then kept until the database would have cancelled it
 * (ProjectSsoProviderChanges.giveBackAfterFailedWrite), so the helpers have
 * to know what failed - and whether it was a create, which runs in a
 * transaction of its own and can still land only by its COMMIT. Every
 * error hook of a service whose writes are checked hands its `error` to one
 * of them:
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
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const SERVICES_DIR: string = path.join(COMMON_DIR, "Server", "Services");

// Each service's error hooks, and the helper each hands what failed to.
const ERROR_HOOKS: Array<{
  file: string;
  hooks: Array<string>;
  helper: RegExp;
}> = [
  {
    file: "ProjectService.ts",
    hooks: ["onUpdateError"],
    helper: /SsoRequirementChanges\.afterFailedUpdate/,
  },
  {
    file: "ProjectService.ts",
    hooks: ["onCreateError"],
    helper: /SsoRequirementChanges\.afterFailedProjectCreate/,
  },
  {
    file: "GlobalConfigService.ts",
    hooks: ["onUpdateError"],
    helper: /SsoRequirementChanges\.afterFailedUpdate/,
  },
  {
    file: "ProjectSsoService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /ProjectSsoProviderChanges\.afterFailedWrite/,
  },
  {
    file: "ProjectOidcService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /ProjectSsoProviderChanges\.afterFailedWrite/,
  },
  {
    file: "GlobalSsoService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /GlobalSsoProviderChanges\.afterFailedWrite/,
  },
  {
    file: "GlobalOidcService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /GlobalSsoProviderChanges\.afterFailedWrite/,
  },
  {
    file: "GlobalSsoProjectService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /GlobalSsoProviderChanges\.afterFailedWrite/,
  },
  {
    file: "GlobalSsoProjectService.ts",
    hooks: ["onCreateError"],
    helper: /GlobalSsoProviderChanges\.afterFailedCreate/,
  },
  {
    file: "GlobalOidcProjectService.ts",
    hooks: ["onUpdateError", "onDeleteError"],
    helper: /GlobalSsoProviderChanges\.afterFailedWrite/,
  },
  {
    file: "GlobalOidcProjectService.ts",
    hooks: ["onCreateError"],
    helper: /GlobalSsoProviderChanges\.afterFailedCreate/,
  },
];

// The helpers the success hooks give locks back with: they do not know what failed.
const SUCCESS_HELPERS: RegExp =
  /\b(SsoRequirementChanges\.afterUpdate|SsoRequirementChanges\.afterProjectCreate|GlobalSsoProviderChanges\.afterWrite|ProjectSsoProviderChanges\.releaseSignInChange)\s*\(/;

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
  (entry: { file: string; hooks: Array<string>; helper: RegExp }) => {
    test.each(entry.hooks)(
      "%s hands its error to the helper that gives the locks back",
      (hook: string) => {
        const classSource: ClassSource = sourceOf(entry.file);

        expect(hasMethod(classSource, hook)).toBe(true);

        const text: string = methodText(classSource, hook);
        const calls: Array<string> = callArguments(text, entry.helper);

        expect(calls).toHaveLength(1);
        // The error the hook was handed is the last thing the helper is given.
        expect(calls[0]!).toMatch(/,\s*error\s*,?\s*$/);
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

describe("the helpers decide by what failed", () => {
  const UTILS_DIR: string = path.join(COMMON_DIR, "Server", "Utils");

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
      // What failed is handed on, by name.
      expect(callArguments(text, new RegExp(`\\.${through}`))[0]).toMatch(
        /\berror\b/,
      );
      expect(methodText(classSource, through)).toMatch(
        /ProjectSsoProviderChanges\.giveBackAfterFailedWrite\s*\(/,
      );
    },
  );

  test.each([
    ["SsoRequirementChanges.ts", "afterFailedProjectCreate"],
    ["GlobalSsoProviderChanges.ts", "afterFailedCreate"],
  ])(
    "%s %s says the create runs in a transaction of its own",
    (file: string, method: string) => {
      expect(
        methodText(readClassSource(path.join(UTILS_DIR, file)), method),
      ).toMatch(/inOwnTransaction:\s*true/);
    },
  );
});
