import {
  INVITEE_NAME_DESCRIPTION,
  shouldAskForInviteeName,
} from "../../../UI/Utils/InviteeName";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE NAME AN INVITATION SETS UP A NEW ACCOUNT WITH (#9745).
 *
 * The invite forms asked POST /team-member/is-user-registered whether an
 * address had a OneUptime account, and offered a Name only when it had
 * none: any signed-in account could ask about any address. The route is
 * gone; every form offers an optional Name once a whole address is typed,
 * whoever it belongs to, except for a person picked from the suggestions,
 * who has an account the reader may see.
 */

// packages/Common/Tests/UI/Utils -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

function read(relative: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relative), "utf8");
}

describe("shouldAskForInviteeName", () => {
  test.each([
    ["nothing typed", undefined],
    ["an empty box", ""],
    ["spaces", "   "],
    ["part of an address", "grace@"],
    ["no domain", "grace"],
    ["a list, not an address", ["grace@acme.test"]],
    ["a number", 42],
  ])("asks nothing for %s", (_case: string, email: unknown) => {
    expect(shouldAskForInviteeName({ email: email })).toBe(false);
  });

  test("asks for a whole address, whoever it belongs to", () => {
    expect(shouldAskForInviteeName({ email: "grace@acme.test" })).toBe(true);
    expect(shouldAskForInviteeName({ email: "  grace@acme.test  " })).toBe(
      true,
    );
  });

  test("asks nothing for the person picked from the suggestions, however the address is cased", () => {
    expect(
      shouldAskForInviteeName({
        email: "Ada@Acme.test",
        pickedEmail: "ada@acme.test",
      }),
    ).toBe(false);
    expect(
      shouldAskForInviteeName({
        email: "ada@acme.test",
        pickedEmail: " ADA@acme.test ",
      }),
    ).toBe(false);
  });

  test("asks again once the address is changed after a pick", () => {
    expect(
      shouldAskForInviteeName({
        email: "ada.byron@acme.test",
        pickedEmail: "ada@acme.test",
      }),
    ).toBe(true);
  });

  test("a pick of nothing changes nothing", () => {
    expect(
      shouldAskForInviteeName({ email: "grace@acme.test", pickedEmail: "" }),
    ).toBe(true);
    expect(
      shouldAskForInviteeName({ email: "grace@acme.test", pickedEmail: null }),
    ).toBe(true);
  });
});

describe("what the Name field says", () => {
  test("is one short sentence that promises nothing about the address", () => {
    expect(INVITEE_NAME_DESCRIPTION).toBe(
      "If they have no OneUptime account yet, it is set up with this name.",
    );
    expect(INVITEE_NAME_DESCRIPTION.length).toBeLessThanOrEqual(150);
    // It never tells the inviter whether the address has an account.
    expect(INVITEE_NAME_DESCRIPTION).not.toMatch(
      /not registered|is registered/i,
    );
  });
});

/*
 * The four invite forms, as written: each offers its Name row for every
 * address through the helper, optional, and none asks the server about the
 * address.
 */
describe("the invite forms", () => {
  const FORMS: Array<[string, string, boolean]> = [
    [
      "the Dashboard's Invite New User",
      "packages/App/FeatureSet/Dashboard/src/Pages/Users/Index.tsx",
      true,
    ],
    [
      "a team's Invite New Team Member",
      "packages/App/FeatureSet/Dashboard/src/Pages/Teams/View/Members.tsx",
      true,
    ],
    [
      "the Admin Dashboard's Invite New User",
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Users.tsx",
      true,
    ],
    [
      "the Admin Dashboard's team members",
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/TeamView.tsx",
      true,
    ],
  ];

  test.each(FORMS)(
    "%s offers an optional Name for any address, through the helper",
    (_name: string, file: string, hasSuggestions: boolean) => {
      const source: string = read(file);
      const nameRow: string = source.slice(
        source.indexOf('title: "Name"'),
        source.indexOf(
          "},",
          source.indexOf("showIf:", source.indexOf('title: "Name"')),
        ),
      );

      expect(nameRow).toContain("description: INVITEE_NAME_DESCRIPTION");
      expect(nameRow).toContain("required: false");
      expect(nameRow).toContain('overrideFieldKey: "name"');
      expect(nameRow).toContain("shouldAskForInviteeName(");
      expect(source).not.toContain("isEmailRegistered");
      expect(source).not.toContain("useUserEmailRegistrationStatus");

      /*
       * Every form suggests people as the address is typed - the Admin
       * Dashboard's too, since #9826 - and hides it for a person picked
       * from the suggestions.
       */
      expect(source.includes("pickedEmail: pickedInviteeEmail")).toBe(
        hasSuggestions,
      );
      expect(source.includes("setPickedInviteeEmail(suggestion.email)")).toBe(
        hasSuggestions,
      );
    },
  );

  test("nothing asks the server whether an address has an account", () => {
    expect(
      fs.existsSync(
        path.join(
          REPOSITORY_ROOT,
          "packages/Common/UI/Utils/UserEmailRegistrationStatus.ts",
        ),
      ),
    ).toBe(false);

    for (const [, file] of FORMS) {
      expect(read(file)).not.toContain("is-user-registered");
    }

    expect(read("packages/Common/Server/API/TeamMemberAPI.ts")).not.toMatch(
      /router\.(post|get)\(\s*`[^`]*\/is-user-registered`/,
    );
  });
});
