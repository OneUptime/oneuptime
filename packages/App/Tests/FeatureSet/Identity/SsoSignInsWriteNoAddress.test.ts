import fs from "fs";
import Path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * SINGLE SIGN-ON NEVER WRITES AN ACCOUNT'S ADDRESS (#9907).
 *
 * The address an account leaves is emailed whenever a write changes it
 * (UserService.tellPreviousAddressesOfChange): the link that confirms a
 * person's own change, a master admin's, SCIM's. Single sign-on - a
 * project's SAML or OIDC, the server's own, Continue with Google or
 * Microsoft, the mobile app's hand-off - finds the account by the address
 * its provider names, or makes one with it, and writes no address of an
 * account that exists: whatever it sends is the address it found the
 * account by, which changes nothing and sends nothing
 * (Common's UserServiceEmailAddressChangedNotice.test.ts holds that a write
 * of the same address sends nothing).
 *
 * This holds every sign-in file to that: each UserService update it makes
 * names its data in place, and none of them writes `email`. One that starts
 * to - a provider whose new address moves the account - must decide what
 * its address change tells the old one, and is listed here on purpose.
 */

const IDENTITY: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Identity",
);

const SIGN_IN_FILES: ReadonlyArray<string> = [
  "API/SSO.ts",
  "API/OIDC.ts",
  "API/GlobalSSO.ts",
  "API/GlobalOIDC.ts",
  "API/GoogleSignIn.ts",
  "API/MicrosoftSignIn.ts",
  "API/MobileSsoExchange.ts",
  "API/ProjectSsoSignInConfirmation.ts",
  "Utils/SSO.ts",
  "Utils/OIDC.ts",
  "Utils/ProviderSignIn.ts",
  "Utils/ProjectSsoSignInGate.ts",
  "Utils/ProjectSsoSignInConfirmation.ts",
  "Utils/ProjectSsoIdentityBinding.ts",
  "Utils/SsoTeamMembership.ts",
  "Utils/MobileSso.ts",
];

const UPDATE_METHODS: ReadonlySet<string> = new Set<string>([
  "updateOneById",
  "updateOneBy",
  "updateBy",
  "updateOneByIdAndFetch",
]);

interface UserUpdate {
  file: string;
  line: number;
  // The columns its data names, or null when the data is not written in place.
  columns: Array<string> | null;
}

function userUpdatesOf(file: string): Array<UserUpdate> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(Path.join(IDENTITY, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Array<UserUpdate> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "UserService" &&
      UPDATE_METHODS.has(node.expression.name.text)
    ) {
      const argument: ts.Expression | undefined = node.arguments[0];
      let columns: Array<string> | null = null;

      if (argument && ts.isObjectLiteralExpression(argument)) {
        const data: ts.ObjectLiteralElementLike | undefined =
          argument.properties.find(
            (property: ts.ObjectLiteralElementLike): boolean => {
              return (
                ts.isPropertyAssignment(property) &&
                property.name.getText(source) === "data"
              );
            },
          );

        if (
          data &&
          ts.isPropertyAssignment(data) &&
          ts.isObjectLiteralExpression(data.initializer)
        ) {
          columns = data.initializer.properties.map(
            (property: ts.ObjectLiteralElementLike): string => {
              return property.name ? property.name.getText(source) : "...";
            },
          );
        }
      }

      found.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        columns: columns,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

describe("single sign-on writes no account's address", () => {
  test("every sign-in file this lists is there to read", () => {
    for (const file of SIGN_IN_FILES) {
      expect({
        file,
        exists: fs.existsSync(Path.join(IDENTITY, file)),
      }).toEqual({ file, exists: true });
    }
  });

  test("each account update a sign-in makes names its columns in place", () => {
    const unreadable: Array<UserUpdate> = SIGN_IN_FILES.flatMap(
      userUpdatesOf,
    ).filter((update: UserUpdate): boolean => {
      return update.columns === null;
    });

    expect(unreadable).toEqual([]);
  });

  test("and none of them writes the address", () => {
    const writesAddress: Array<UserUpdate> = SIGN_IN_FILES.flatMap(
      userUpdatesOf,
    ).filter((update: UserUpdate): boolean => {
      return (update.columns || []).some((column: string): boolean => {
        return column === "email" || column === "...";
      });
    });

    expect(writesAddress).toEqual([]);
  });

  test("the scan finds the updates a sign-in does make: verifying the address it signed in with", () => {
    const updates: Array<UserUpdate> = SIGN_IN_FILES.flatMap(userUpdatesOf);

    expect(updates.length).toBeGreaterThan(0);
    expect(
      updates.every((update: UserUpdate): boolean => {
        return (update.columns || []).includes("isEmailVerified");
      }),
    ).toBe(true);
  });
});
