import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * CompleteRegistration.hbs - sent when somebody tried to register an address
 * that already had an unclaimed invitation behind it, without the token that
 * proves they own the mailbox.
 *
 * The recipient may not be the person who made that request. That is the whole
 * point of the email: on a guessed address the link lands in the real owner's
 * inbox and the guesser gets nothing. So the copy must not congratulate them on
 * an action they may not have taken, and must tell them what it means if they
 * were not expecting it.
 *
 * The last test pins the variable names against the code that sets them,
 * because a rename on one side renders an email with an empty button on the
 * other -- and this is the only way an invited person can recover their
 * account.
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

const AUTHENTICATION_EMAIL_PATH: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Identity",
  "Utils",
  "AuthenticationEmail.ts",
);

const REGISTRATION_LINK: string =
  "https://oneuptime.test/accounts/register?email=alice%40company.com&token=33333333-3333-4333-8333-333333333333";

const TOKEN: string = "33333333-3333-4333-8333-333333333333";

const EXPIRY_NOTE: string =
  "<strong>Note:</strong> This link expires in 7 days, and can only be used once.";

function templateSource(): string {
  return fs.readFileSync(
    Path.resolve(TEMPLATES_DIR, "CompleteRegistration.hbs"),
    {
      encoding: "utf8",
    },
  );
}

function render(vars: Record<string, unknown> = {}): string {
  return Handlebars.compile(templateSource())({
    registrationLink: REGISTRATION_LINK,
    expiryNote: EXPIRY_NOTE,
    homeUrl: "https://oneuptime.test",
    ...vars,
  });
}

beforeAll(() => {
  /*
   * Mirrors FeatureSet/Notification/Utils/Handlebars.ts, the same way
   * InviteMemberTemplate.test.ts does: importing that module would resolve the
   * partials directory from process.cwd().
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

  Handlebars.registerHelper("concat", (v1: any, v2: any) => {
    return v1 + v2;
  });
});

describe("CompleteRegistration.hbs", () => {
  test("renders the registration link as the call to action", () => {
    const html: string = render();

    expect(html).toContain(REGISTRATION_LINK);
    expect(html).toContain("Complete Registration");
  });

  test("also prints the link as text, for clients that swallow the button", () => {
    const html: string = render();

    /*
     * Once in the button href and once as copyable text. A recipient who cannot
     * click the button has no other route back into their account.
     *
     * Counted on the token rather than the whole URL because the two renderings
     * differ: ButtonBlock interpolates the href with a double stache and so
     * escapes the query separator to &amp;, while InfoBlock uses a triple and
     * emits it raw. Both are correct -- browsers parse &amp; in an href back to
     * & -- and the token itself has nothing escapable in it.
     */
    const occurrences: number = html.split(TOKEN).length - 1;

    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test("the button href decodes back to the exact link, query string and all", () => {
    /*
     * ButtonBlock interpolates the href with a double stache, so Handlebars
     * entity-encodes it -- `&` and `=` both go. That is fine, because an HTML
     * attribute is decoded before the browser navigates, but it means the raw
     * URL is not findable in the markup. What has to hold is that decoding the
     * attribute gives back the link intact: a truncated query string here would
     * drop the token and send the recipient to an unauthorized signup.
     */
    const href: RegExpMatchArray | null = render().match(/href=([^\s>]+)/);

    expect(href).not.toBeNull();

    const decoded: string = href![1]!
      .replace(/&#x2F;/g, "/")
      .replace(/&#x3D;/g, "=")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");

    expect(decoded).toBe(REGISTRATION_LINK);
  });

  test("says the link expires and is single use", () => {
    expect(render()).toContain(EXPIRY_NOTE);
  });

  test("does not assume the recipient asked for it", () => {
    /*
     * On a guessed address this mail arrives unprompted. Wording it as "here is
     * the account you asked to set up" would be a lie to the person who did not
     * ask, and would hide the fact that somebody else tried.
     */
    const html: string = render();

    expect(html).toContain("If that was you");
    expect(html).toContain("weren't expecting this");
  });

  test("reassures the recipient that nothing has changed yet", () => {
    /*
     * True, and load-bearing: a failed claim writes nothing to the account. If
     * this ever stops being true the email becomes a lie.
     */
    expect(render()).toContain("nothing changes until you use it");
  });

  test("never renders an empty call to action", () => {
    const html: string = render();

    expect(html).not.toContain('href=""');
    expect(html.trim().length).toBeGreaterThan(0);
  });

  test("uses the variable names AuthenticationEmail actually sets", () => {
    /*
     * The pin. A rename on either side renders a button pointing nowhere, and
     * nothing else in the suite would notice.
     */
    const source: string = fs.readFileSync(AUTHENTICATION_EMAIL_PATH, {
      encoding: "utf8",
    });

    expect(source).toContain("registrationLink:");
    expect(source).toContain("expiryNote:");
    expect(source).toContain("EmailTemplateType.CompleteRegistration");

    expect(templateSource()).toContain("registrationLink");
    expect(templateSource()).toContain("expiryNote");
  });

  test("only uses helpers the Handlebars util registers", () => {
    /*
     * `concat` takes exactly two arguments, which is why the expiry sentence is
     * built server-side rather than assembled here -- a three-argument call
     * silently drops everything after the second.
     */
    const util: string = fs.readFileSync(HANDLEBARS_UTIL_PATH, {
      encoding: "utf8",
    });

    const helpersUsed: Array<string> = Array.from(
      templateSource().matchAll(/\{\{#?([a-zA-Z]+)\s/g),
    )
      .map((match: RegExpMatchArray) => {
        return match[1]!;
      })
      .filter((name: string) => {
        return name !== "if" && name !== "unless" && name !== "each";
      });

    for (const helper of helpersUsed) {
      if (helper === "ifCond" || helper === "concat") {
        expect(util).toContain(`registerHelper("${helper}"`);
      }
    }

    // The whole sentence arrives pre-formatted, so no multi-argument concat.
    expect(templateSource()).not.toMatch(/concat\s+[^)]*\s+[^)]*\s+[^)]*\)/);
  });
});
