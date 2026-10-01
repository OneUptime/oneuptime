import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";

/*
 * EnterpriseLicenseExpiryReminder.hbs - sent by oneuptime.com to the master
 * admins of every self-hosted instance whose Enterprise license is about to
 * expire or has expired.
 *
 * It reaches every self-hosted version, so what it says has to hold for all
 * of them. In every release, SCIM provisioning and audit logging stop when the
 * grace period ends, and enterprise configuration becomes read-only. Single
 * sign-on is part of the Community Edition in the releases after 14.0.10, so
 * it stops only on 14.0.10 and earlier - where "Require SSO for login" is no
 * longer enforced either, and users sign in with a password. The template
 * names single sign-on in that one sentence and nowhere else.
 *
 * The status line at the top (expiryStatusMessage) is built by the license
 * server's reminder copy and pinned by its own tests.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const VARS: Record<string, string> = {
  companyName: "Acme Inc",
  licenseKey: "abcd-****-wxyz",
  expiresAt: "Sep 1, 2026",
  emailTitle: "Your OneUptime Enterprise license has expired",
  expiryStatus: "Expired 3 days ago",
  expiryStatusMessage:
    "Your OneUptime Enterprise license expired 3 days ago. Here are the details:",
  homeUrl: "https://oneuptime.test",
};

const SINGLE_SIGN_ON_WORDING: RegExp =
  /\bSSO\b|single sign-on|\bSAML\b|\bOIDC\b|OpenID Connect/i;

const OLDER_RELEASES: string = "On OneUptime 14.0.10 and earlier,";

// The line this template used to send, before single sign-on moved into the Community Edition.
const FORMER_LAPSE_LINE: string =
  'When the grace period ends, until a renewed license is activated: SSO and OIDC sign-in stop and "Require SSO" is no longer enforced, so your users sign in with their password; SCIM provisioning stops, so your identity provider can no longer provision or deprovision users; audit logging stops recording; and enterprise configuration becomes read-only. Everything resumes as soon as the renewed license is activated. Monitoring, alerts, incidents, on-call and status pages are not affected.';

function templateSource(): string {
  return fs.readFileSync(
    Path.resolve(TEMPLATES_DIR, "EnterpriseLicenseExpiryReminder.hbs"),
    { encoding: "utf8" },
  );
}

function render(): string {
  return Handlebars.compile(templateSource())(VARS);
}

// What the reader sees: tags dropped, entities decoded, whitespace collapsed.
function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x3D;/g, "=")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * One sentence per entry. A sentence ends at a full stop followed by a
 * space, so the dots of a version number do not split one.
 */
function sentencesOf(text: string): Array<string> {
  return text.split(/(?<=\.)\s+/);
}

// The fixed copy the template writes itself (its InfoBlock literals), sentence by sentence.
function fixedSentences(): Array<string> {
  return Array.from(
    templateSource().matchAll(/\binfo="([^"]*)"/g),
    (match: RegExpMatchArray): string => {
      return match[1]!.replace(/&quot;/g, '"');
    },
  ).flatMap((literal: string) => {
    return sentencesOf(literal);
  });
}

/*
 * True when single sign-on is named in exactly one sentence, and that
 * sentence is about 14.0.10 and earlier.
 */
function namesSingleSignOnOnlyForOlderReleases(
  sentences: Array<string>,
): boolean {
  const mentions: Array<string> = sentences.filter((sentence: string) => {
    return SINGLE_SIGN_ON_WORDING.test(sentence);
  });

  return mentions.length === 1 && mentions[0]!.startsWith(OLDER_RELEASES);
}

beforeAll(() => {
  /*
   * Mirrors FeatureSet/Notification/Utils/Handlebars.ts, the same way
   * CompleteRegistrationTemplate.test.ts does: importing that module would
   * resolve the partials directory from process.cwd().
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
});

describe("EnterpriseLicenseExpiryReminder.hbs", () => {
  test("renders the license details the reminder job passes", () => {
    const text: string = textOf(render());

    for (const value of Object.values(VARS).filter((value: string) => {
      return value !== VARS["homeUrl"];
    })) {
      expect({ value, rendered: text.includes(value) }).toEqual({
        value,
        rendered: true,
      });
    }
  });

  test("states the 30-day grace period, the one the installation applies", () => {
    expect(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS).toBe(30);
    expect(textOf(render())).toContain(
      `Your self-hosted OneUptime instances keep every enterprise feature for ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS} days after the expiry date above (the grace period).`,
    );
  });

  test("says what stops in every release when the grace period ends", () => {
    expect(textOf(render())).toContain(
      "When the grace period ends, until a renewed license is activated: SCIM provisioning stops, so your identity provider can no longer provision or deprovision users; audit logging stops recording; and enterprise configuration becomes read-only.",
    );
  });

  test('says single sign-on stops too on 14.0.10 and earlier, and that "Require SSO" is then no longer enforced', () => {
    expect(textOf(render())).toContain(
      'On OneUptime 14.0.10 and earlier, SSO and OIDC sign-in stop too and "Require SSO" is no longer enforced, so your users sign in with their password.',
    );
  });

  test("names single sign-on only in the sentence about 14.0.10 and earlier", () => {
    expect(namesSingleSignOnOnlyForOlderReleases(fixedSentences())).toBe(true);
    expect(
      namesSingleSignOnOnlyForOlderReleases(sentencesOf(textOf(render()))),
    ).toBe(true);
  });

  test("the check catches the line this email used to send", () => {
    expect(
      namesSingleSignOnOnlyForOlderReleases(sentencesOf(FORMER_LAPSE_LINE)),
    ).toBe(false);
  });

  test("never lists single sign-on with what stops in every release", () => {
    const text: string = textOf(render());

    expect(text).not.toContain(
      "until a renewed license is activated: SSO and OIDC sign-in stop",
    );
    expect(text).not.toMatch(/SSO and OIDC sign-in stop(?! too)/);
  });

  test("never claims single sign-on keeps working without a license", () => {
    expect(textOf(render())).not.toMatch(
      /\b(?:SSO|single sign-on|OIDC)\b[^.]{0,100}\b(?:keeps? (?:working|running)|never stops?|continues|still works|(?:is|are) not affected)\b/i,
    );
  });

  test("says everything resumes with a renewed license, and that core monitoring is not affected", () => {
    const text: string = textOf(render());

    expect(text).toContain(
      "Everything resumes as soon as the renewed license is activated.",
    );
    expect(text).toContain(
      "Monitoring, alerts, incidents, on-call and status pages are not affected.",
    );
  });

  test('renders the quotes around "Require SSO" once, not double-escaped', () => {
    const html: string = render();

    expect(html).toContain("&quot;Require SSO&quot;");
    expect(html).not.toContain("&amp;quot;");
  });

  test("tells the reader how to renew, and why they received the email", () => {
    const text: string = textOf(render());

    expect(text).toContain(
      "To renew your license, reply to this email or write to sales@oneuptime.com",
    );
    expect(text).toContain(
      "You are receiving this email because you are a master admin of a OneUptime instance using this license.",
    );
  });
});
