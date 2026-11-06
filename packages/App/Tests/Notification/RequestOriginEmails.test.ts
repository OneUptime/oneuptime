import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import "../../FeatureSet/Notification/Utils/Handlebars";
import { markupAsSpacesWithOutlookContent } from "Common/Tests/Helpers/HtmlText";
import { beforeAll, describe, expect, it, test } from "@jest/globals";

/*
 * THE SECURITY EMAILS SAY WHERE THE REQUEST BEHIND THEM CAME FROM.
 *
 * A password reset, a changed password, a sign-in link for an account or a
 * status page, a single sign-on to confirm, wrong two factor codes, a spent
 * backup code:
 * each of these emails goes out because of a request somebody else could
 * have made, so each says when, from which IP address, roughly where and on
 * which device (issue #5599) - the time in a row of its own, the rest
 * through Partials/RequestOriginFields.hbs, all of it in the email's detail
 * card. This renders every one of them with the partials and helpers
 * MailService renders with, and holds:
 *
 *  - every row shows its value, under the label it is read by;
 *  - a row with nothing to say does not show: an installation that names no
 *    geo header has no location row, an email with no request behind it
 *    shows only when - and the emails whose card is new have no card at all
 *    when they are sent without a time;
 *  - every value is written as text, never as markup;
 *  - the card draws a divider between its rows, never above its first.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");
const WHITESPACE_RUN: RegExp = /\s+/g;
const DIVIDER: string = "border-top: 1px solid #e2e8f0";
// How a card's row opens (Partials/DetailBoxField.hbs).
const ROW_START: string = '<div class="st-DetailCard-field"';
// How a card opens; the <style> block names its classes too, but never so.
const CARD_START: string = 'class="st-DetailCard"';

const ORIGIN: Record<string, string> = {
  requestedAt: "Nov 3, 2026, 2:15 PM CET",
  requestIpAddress: "203.0.113.7",
  requestLocation: "Berlin, Germany",
  requestDevice: "Chrome 130 on macOS",
};

const NO_ORIGIN: Record<string, string> = {
  requestedAt: "",
  requestIpAddress: "",
  requestLocation: "",
  requestDevice: "",
};

// What every one of these emails is sent with, whatever it is about.
const BASE_VARS: Record<string, string> = {
  brandProductName: "OneUptime",
  statusPageName: "Acme Status",
  homeURL: "https://oneuptime.example.com/",
  homeUrl: "https://oneuptime.example.com/",
  tokenVerifyUrl:
    "https://oneuptime.example.com/accounts/reset-password/6ac38353-b0a0",
  forgotPasswordUrl: "https://oneuptime.example.com/accounts/forgot-password",
  confirmationUrl:
    "https://oneuptime.example.com/identity/sso/confirm?token=preview",
  twoFactorAuthUrl:
    "https://oneuptime.example.com/dashboard/user-profile/two-factor-auth",
  expiresInMinutes: "15",
  signInSummary:
    'Someone just signed in through the single sign-on of the OneUptime project "Acme" as owner@example.com.',
  expiryNote: "This link expires in 24 hours and can only be used once.",
  remainingCodeMessage: "You can generate a new set from your user profile.",
};

/*
 * The emails whose detail card is the request's: the time row's label, and
 * the line that introduces the card, if there is one.
 */
const REQUEST_CARD_EMAILS: Array<[string, string, string | null]> = [
  ["ForgotPassword", "Requested at:", "Details of the request:"],
  ["PasswordChanged", "Changed at:", null],
  ["StatusPageForgotPassword", "Requested at:", "Details of the request:"],
  ["StatusPagePasswordChanged", "Changed at:", null],
  ["StatusPageMagicLink", "Requested at:", "Details of the request:"],
  ["MagicLink", "Requested at:", "Details of the request:"],
  ["ConfirmProjectSsoSignIn", "Signed in at:", "Details of the sign-in:"],
];

/*
 * The emails that had a card of their own already: the request's rows join
 * the rows it had, after them.
 */
const OWN_CARD_EMAILS: Array<[string, Record<string, string>, Array<string>]> =
  [
    [
      "TwoFactorWrongCodes",
      { wrongCodeCount: "5", enteredAt: "Oct 18 2026, 12:07 UTC" },
      ["Wrong codes in a row: 5", "Last wrong code at: Oct 18 2026, 12:07 UTC"],
    ],
    [
      "TwoFactorBackupCodeUsed",
      { signedInAt: "Oct 18 2026, 12:07 UTC", remainingCodeCount: "7" },
      ["Signed in at: Oct 18 2026, 12:07 UTC", "Backup codes remaining: 7"],
    ],
    [
      "TwoFactorBackupCodesCreated",
      { generatedAt: "Oct 18 2026, 12:07 UTC", newCodeCount: "10" },
      ["Created at: Oct 18 2026, 12:07 UTC", "Codes issued: 10"],
    ],
    [
      "TwoFactorBackupCodesRegenerated",
      { generatedAt: "Oct 18 2026, 12:07 UTC", newCodeCount: "10" },
      ["Generated at: Oct 18 2026, 12:07 UTC", "New codes issued: 10"],
    ],
  ];

const ALL_EMAILS: Array<string> = [
  ...REQUEST_CARD_EMAILS.map((email: [string, string, string | null]) => {
    return email[0];
  }),
  ...OWN_CARD_EMAILS.map(
    (email: [string, Record<string, string>, Array<string>]) => {
      return email[0];
    },
  ),
];

function render(template: string, vars: Record<string, string>): string {
  return Handlebars.compile(
    fs.readFileSync(Path.join(TEMPLATES_DIR, `${template}.hbs`), "utf8"),
  )({ ...BASE_VARS, ...vars });
}

function textOf(html: string): string {
  return markupAsSpacesWithOutlookContent(html).replace(WHITESPACE_RUN, " ");
}

function ownCardVars(template: string): Record<string, string> {
  const email: [string, Record<string, string>, Array<string>] | undefined =
    OWN_CARD_EMAILS.find(
      (candidate: [string, Record<string, string>, Array<string>]) => {
        return candidate[0] === template;
      },
    );

  return email ? email[1] : {};
}

/*
 * The card's rows, in order, each as the text it reads. A card's rows sit in
 * its one cell (Partials/DetailBoxStart.hbs) and hold no cell of their own,
 * so the card ends at the first </td> after it opens.
 */
function cardRows(html: string): Array<string> {
  const start: number = html.indexOf('class="st-DetailCard-content"');

  if (start === -1) {
    return [];
  }

  return html
    .slice(start, html.indexOf("</td>", start))
    .split(ROW_START)
    .slice(1)
    .map((row: string): string => {
      return textOf(`${ROW_START}${row}`).trim();
    });
}

beforeAll(async () => {
  const partialNames: Array<string> = fs
    .readdirSync(PARTIALS_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  // The production util registers its partials asynchronously; wait for them.
  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Production email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

describe.each(REQUEST_CARD_EMAILS)(
  "%s",
  (template: string, timeLabel: string, introduction: string | null) => {
    it("says when, from which address, roughly where and on which device", () => {
      const text: string = textOf(render(template, ORIGIN));

      expect(text).toContain(`${timeLabel} Nov 3, 2026, 2:15 PM CET`);
      expect(text).toContain("IP address: 203.0.113.7");
      expect(text).toContain("Approximate location: Berlin, Germany");
      expect(text).toContain("Device: Chrome 130 on macOS");

      if (introduction) {
        expect(text).toContain(introduction);
      }
    });

    it("lays the four rows out in one card, the time first", () => {
      expect(cardRows(render(template, ORIGIN))).toEqual([
        `${timeLabel} Nov 3, 2026, 2:15 PM CET`,
        "IP address: 203.0.113.7",
        "Approximate location: Berlin, Germany",
        "Device: Chrome 130 on macOS",
      ]);
    });

    it("has no location row where no CDN names the place", () => {
      const rows: Array<string> = cardRows(
        render(template, { ...ORIGIN, requestLocation: "" }),
      );

      expect(rows).toEqual([
        `${timeLabel} Nov 3, 2026, 2:15 PM CET`,
        "IP address: 203.0.113.7",
        "Device: Chrome 130 on macOS",
      ]);
    });

    it("says only when, with no request behind it", () => {
      expect(
        cardRows(
          render(template, {
            ...NO_ORIGIN,
            requestedAt: ORIGIN["requestedAt"]!,
          }),
        ),
      ).toEqual([`${timeLabel} Nov 3, 2026, 2:15 PM CET`]);
    });

    it("has no card at all when it is sent without a time", () => {
      const html: string = render(template, NO_ORIGIN);

      expect(html).not.toContain(CARD_START);
      expect(textOf(html)).not.toContain("IP address:");

      if (introduction) {
        expect(textOf(html)).not.toContain(introduction);
      }
    });
  },
);

describe.each(OWN_CARD_EMAILS)(
  "%s",
  (template: string, vars: Record<string, string>, ownRows: Array<string>) => {
    it("adds the address, the place and the device after the rows it had", () => {
      expect(cardRows(render(template, { ...vars, ...ORIGIN }))).toEqual([
        ...ownRows,
        "IP address: 203.0.113.7",
        "Approximate location: Berlin, Germany",
        "Device: Chrome 130 on macOS",
      ]);
    });

    it("keeps only the rows it had when no request is described", () => {
      expect(cardRows(render(template, { ...vars, ...NO_ORIGIN }))).toEqual(
        ownRows,
      );
    });

    it("keeps only the rows it had when sent without these variables at all", () => {
      expect(cardRows(render(template, vars))).toEqual(ownRows);
    });
  },
);

describe.each(ALL_EMAILS)(
  "%s writes its values as text",
  (template: string) => {
    it("never as markup", () => {
      const html: string = render(template, {
        ...ownCardVars(template),
        requestedAt: "<script>alert(1)</script>",
        requestIpAddress: "<img src=x onerror=alert(1)>",
        requestLocation: "<a href='https://evil.example'>Berlin</a>",
        requestDevice: "<b>Chrome</b>",
      });

      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<a href='https://evil.example'>");
      expect(html).not.toContain("<b>Chrome</b>");
      expect(html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");

      // A template's own time keeps its own slot; the request's is text.
      if (
        REQUEST_CARD_EMAILS.some((email: [string, string, string | null]) => {
          return email[0] === template;
        })
      ) {
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
      }
    });

    it("draws a divider between its card's rows, never above the first", () => {
      const html: string = render(template, {
        ...ownCardVars(template),
        ...ORIGIN,
      });
      const rows: Array<string> = html
        .split('class="st-DetailCard-field"')
        .slice(1);

      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(rows[0]!.slice(0, rows[0]!.indexOf(">"))).not.toContain(DIVIDER);

      for (const row of rows.slice(1)) {
        expect(row.slice(0, row.indexOf(">"))).toContain(DIVIDER);
      }
    });
  },
);

describe("the password reset email", () => {
  it("tells somebody who did not ask what happens if they do nothing", () => {
    const rendered: string = textOf(render("ForgotPassword", ORIGIN));

    expect(rendered).toContain(
      "Didn't ask for this? You can safely ignore this email. Your password stays the same, and nobody can change it without the link above. Someone may have typed your email address by mistake.",
    );
    expect(rendered).toContain(
      "Note: This password reset link will expire in 24 hours.",
    );
  });

  it("puts the request's details after the link, not in the way of the button", () => {
    const rendered: string = textOf(render("ForgotPassword", ORIGIN));

    expect(rendered.indexOf("Reset Password")).toBeLessThan(
      rendered.indexOf("Details of the request:"),
    );
    expect(rendered.indexOf(BASE_VARS["tokenVerifyUrl"]!)).toBeLessThan(
      rendered.indexOf("Details of the request:"),
    );
    expect(rendered.indexOf("Details of the request:")).toBeLessThan(
      rendered.indexOf("Didn't ask for this?"),
    );
  });
});

describe("a private status page's password changed email", () => {
  it("says what changed and what was signed out", () => {
    const rendered: string = textOf(
      render("StatusPagePasswordChanged", {
        ...ORIGIN,
        statusPageName: "Acme Status",
      }),
    );

    expect(rendered).toContain("Your password was changed.");
    expect(rendered).toContain(
      "The password you use to log in to Acme Status was just changed, and every device that was signed in with it has been signed out.",
    );
  });
});

describe("the password changed email", () => {
  it("says what changed and what was signed out", () => {
    const rendered: string = textOf(render("PasswordChanged", ORIGIN));

    expect(rendered).toContain("Your password was changed.");
    expect(rendered).toContain(
      "The password of your OneUptime account was just changed, and every device that was signed in to it has been signed out.",
    );
  });

  it("says what to do if it was not them, and offers a reset", () => {
    const rendered: string = textOf(render("PasswordChanged", ORIGIN));

    expect(rendered).toContain("If this was you");
    expect(rendered).toContain(", there is nothing else to do.");
    expect(rendered).toContain("If this was not you");
    expect(rendered).toContain(
      ", someone else can get into your account. Reset your password now with the button below, and tell your administrator.",
    );
    expect(rendered).toContain("Reset your password");
  });
});

describe("the status page emails", () => {
  test.each([
    ["StatusPageForgotPassword"],
    ["StatusPagePasswordChanged"],
    ["StatusPageMagicLink"],
  ])("%s writes the page's name as text", (template: string) => {
    const html: string = render(template, {
      ...ORIGIN,
      statusPageName: "<i>Acme</i> Status",
    });

    expect(html).not.toContain("<i>Acme</i>");
    expect(html).toContain("&lt;i&gt;Acme&lt;/i&gt; Status");
  });
});
