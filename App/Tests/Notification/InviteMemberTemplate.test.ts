import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * InviteMember.hbs - the only email TeamMemberService sends when somebody is
 * added to a project.
 *
 * It now has to describe two different things. An ordinary invitation leaves a
 * pending membership the recipient has to accept. A master admin who ticks
 * "accept the invitation automatically" on an Admin Dashboard invite form
 * creates a membership that is already accepted - there is nothing left to
 * accept, and the old copy would send that person looking for an invitation
 * that is not in their list.
 *
 * `isInvitationAccepted` is the variable that picks the branch. The last test
 * here pins it against the service that sets it, because a rename on one side
 * silently falls back to the invitation wording on the other.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const HANDLEBARS_UTIL_PATH: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Utils",
  "Handlebars.ts",
);

const TEAM_MEMBER_SERVICE_PATH: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Server",
  "Services",
  "TeamMemberService.ts",
);

const PROJECT_NAME: string = "Acme Production";
const SIGN_IN_LINK: string = "https://oneuptime.test/accounts";
const REGISTER_LINK: string =
  "https://oneuptime.test/accounts/register?email=member%40company.com";

function templateSource(): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, "InviteMember.hbs"), {
    encoding: "utf8",
  });
}

function render(vars: Record<string, unknown>): string {
  return Handlebars.compile(templateSource())({
    signInLink: SIGN_IN_LINK,
    registerLink: REGISTER_LINK,
    projectName: PROJECT_NAME,
    homeUrl: "https://oneuptime.test",
    ...vars,
  });
}

beforeAll(() => {
  /*
   * Mirrors FeatureSet/Notification/Utils/Handlebars.ts: every file in
   * Templates/Partials becomes a partial, plus the helper set the templates
   * use. Registered here rather than by importing that module, which resolves
   * the partials directory from process.cwd(). The "only uses helpers the util
   * registers" test below keeps the two in step.
   */
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }

  Handlebars.registerHelper(
    "ifCond",
    function (v1: any, v2: any, options: any) {
      // @ts-expect-error - Handlebars uses dynamic this context for template helpers
      return v1 === v2 ? options.fn(this) : options.inverse(this);
    },
  );

  Handlebars.registerHelper(
    "ifNotCond",
    function (v1: any, v2: any, options: any) {
      // @ts-expect-error - Handlebars uses dynamic this context for template helpers
      return v1 !== v2 ? options.fn(this) : options.inverse(this);
    },
  );

  Handlebars.registerHelper("concat", (v1: any, v2: any) => {
    return v1 + v2;
  });
});

describe("InviteMember.hbs - an invitation that was accepted for the recipient", () => {
  describe("the recipient has no OneUptime account yet", () => {
    let html: string = "";

    beforeAll(() => {
      html = render({ isInvitationAccepted: "true", isNewUser: "true" });
    });

    test("the headline says they were added, and names the project", () => {
      expect(html).toContain(`You&#x27;ve Been Added to ${PROJECT_NAME}`);
    });

    test("it never calls the membership an invitation to accept", () => {
      expect(html).not.toContain("You&#x27;re Invited");
      expect(html).not.toContain("manage your invitations");
      expect(html).not.toContain("been invited");
    });

    test("it sends them to register, because they cannot sign in yet", () => {
      expect(html).toContain(REGISTER_LINK);
      expect(html).toContain("Create Your Account");
    });

    test("it does not also offer the sign-in link", () => {
      /*
       * Both links would render if the nested isNewUser branch were dropped,
       * and an account that does not exist cannot sign in.
       */
      expect(html).not.toContain("Sign In to OneUptime");
    });
  });

  describe("the recipient already has an account", () => {
    let html: string = "";

    beforeAll(() => {
      html = render({ isInvitationAccepted: "true", isNewUser: "false" });
    });

    test("the headline says they were added", () => {
      expect(html).toContain(`You&#x27;ve Been Added to ${PROJECT_NAME}`);
    });

    test("it tells them there is nothing to accept", () => {
      expect(html).toContain("nothing for you to accept");
    });

    test("it sends them to sign in rather than to register", () => {
      expect(html).toContain("Sign In to OneUptime");
      expect(html).not.toContain("Create Your Account");
    });

    test("it does not point them at a pending-invitations list", () => {
      expect(html).not.toContain("manage your invitations");
    });
  });
});

describe("InviteMember.hbs - an ordinary invitation", () => {
  describe("the recipient has no OneUptime account yet", () => {
    let html: string = "";

    beforeAll(() => {
      html = render({ isInvitationAccepted: "false", isNewUser: "true" });
    });

    test("the headline still invites them", () => {
      expect(html).toContain(`You&#x27;re Invited to ${PROJECT_NAME}`);
      expect(html).not.toContain("You&#x27;ve Been Added");
    });

    test("it sends them to register", () => {
      expect(html).toContain(REGISTER_LINK);
      expect(html).toContain("Create Your Account");
      expect(html).not.toContain("Sign In to OneUptime");
    });
  });

  describe("the recipient already has an account", () => {
    let html: string = "";

    beforeAll(() => {
      html = render({ isInvitationAccepted: "false", isNewUser: "false" });
    });

    test("the headline still invites them", () => {
      expect(html).toContain(`You&#x27;re Invited to ${PROJECT_NAME}`);
    });

    test("it points them at their pending invitations", () => {
      expect(html).toContain("manage your invitations");
      expect(html).toContain("Sign In to OneUptime");
      expect(html).not.toContain("Create Your Account");
    });
  });
});

describe("InviteMember.hbs - the branch variable", () => {
  test("an email with no isInvitationAccepted still renders the invitation", () => {
    /*
     * `ifCond` is an equality test, so an absent variable takes the else arm
     * rather than rendering an email with no body. Any caller that predates
     * the auto-accept flag keeps working.
     */
    const html: string = render({ isNewUser: "false" });

    expect(html).toContain(`You&#x27;re Invited to ${PROJECT_NAME}`);
    expect(html).toContain("Sign In to OneUptime");
  });

  test("an absent isNewUser is treated as an existing account", () => {
    const html: string = render({ isInvitationAccepted: "true" });

    expect(html).toContain(`You&#x27;ve Been Added to ${PROJECT_NAME}`);
    expect(html).toContain("Sign In to OneUptime");
  });

  test("both branches always produce a call to action", () => {
    for (const isInvitationAccepted of ["true", "false"]) {
      for (const isNewUser of ["true", "false"]) {
        const html: string = render({
          isInvitationAccepted: isInvitationAccepted,
          isNewUser: isNewUser,
        });

        expect(
          html.includes("Create Your Account") ||
            html.includes("Sign In to OneUptime"),
        ).toBe(true);
        expect(html).toContain(PROJECT_NAME);
      }
    }
  });

  test("TeamMemberService sets the variable this template branches on", () => {
    /*
     * The template silently falls back to the invitation wording if the
     * service stops setting the variable, or renames it. Nothing else would
     * fail.
     */
    const serviceSource: string = fs.readFileSync(TEAM_MEMBER_SERVICE_PATH, {
      encoding: "utf8",
    });

    expect(templateSource()).toContain("isInvitationAccepted");
    expect(serviceSource).toContain("isInvitationAccepted:");
  });

  test("only uses helpers the notification Handlebars util registers", () => {
    const utilSource: string = fs.readFileSync(HANDLEBARS_UTIL_PATH, {
      encoding: "utf8",
    });

    for (const helper of ["ifCond", "ifNotCond", "concat"]) {
      if (!templateSource().includes(helper)) {
        continue;
      }

      expect(utilSource).toContain(`registerHelper("${helper}"`);
    }
  });
});
