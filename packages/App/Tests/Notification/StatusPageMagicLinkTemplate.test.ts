import Handlebars from "handlebars";
import { registerEmailLanguageHelpers } from "../../FeatureSet/Notification/Utils/EmailLanguage";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  registerEmailBrandHelpers,
  registerJoiningConcat,
} from "./Fixtures/EmailBrandHelpers";
import { htmlAsText } from "Common/Tests/Helpers/HtmlText";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES } from "Common/Types/StatusPage/StatusPageMagicLink";

/*
 * StatusPageMagicLink.hbs - a private status page's sign-in link (#5600),
 * mailed by Identity's POST /status-page/send-magic-link.
 *
 *  - It says what the link does, with the page's name, and has one action:
 *    Log In, the link again under it to copy.
 *  - It says how long the link works and that it works once - the numbers
 *    the server holds it to - and that a newer link replaces it.
 *  - It may reach somebody who never asked (anyone can type an address), so
 *    it says what happens when it is ignored.
 *  - The page's name is its team's, so it is escaped wherever it is printed.
 */

const handlebars: typeof Handlebars = Handlebars.create();
registerEmailLanguageHelpers(handlebars);

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const LINK: string =
  "https://status.acme.test/magic-link-login/6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

function render(vars: Record<string, unknown> = {}): string {
  return handlebars.compile(
    fs.readFileSync(
      Path.join(TEMPLATES_DIR, EmailTemplateType.StatusPageMagicLink),
      "utf8",
    ),
  )({
    statusPageName: "Acme Status",
    tokenVerifyUrl: LINK,
    homeURL: "https://status.acme.test",
    expiresInMinutes: String(STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES),
    logoUrl: "",
    ...vars,
  });
}

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (filename.endsWith(".hbs")) {
      handlebars.registerPartial(
        filename.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, filename), "utf8"),
      );
    }
  }

  handlebars.registerHelper(
    "ifCond",
    function (
      this: unknown,
      left: unknown,
      right: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return left === right ? options.fn(this) : options.inverse(this);
    },
  );
  handlebars.registerHelper(
    "ifNotCond",
    function (
      this: unknown,
      left: unknown,
      right: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return left !== right ? options.fn(this) : options.inverse(this);
    },
  );

  registerJoiningConcat(handlebars);
  registerEmailBrandHelpers(handlebars);
});

describe("StatusPageMagicLink.hbs", () => {
  test("is the template the template type names", () => {
    expect(
      fs.existsSync(
        Path.join(TEMPLATES_DIR, EmailTemplateType.StatusPageMagicLink),
      ),
    ).toBe(true);
  });

  test("says what it is for, on which page", () => {
    const text: string = htmlAsText(render());

    expect(text).toContain("Log in to Acme Status");
    expect(text).toContain(
      "Use the button below to log in to Acme Status. You don't need your password.",
    );
  });

  test("has one action, Log In, to the link - and the link again to copy", () => {
    const html: string = render();
    const anchors: Array<RegExpMatchArray> = Array.from(
      html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi),
    );
    const toLink: Array<RegExpMatchArray> = anchors.filter(
      (anchor: RegExpMatchArray): boolean => {
        return anchor[1] === LINK;
      },
    );

    expect(toLink).toHaveLength(2);
    expect(htmlAsText(toLink[0]![2]!).trim()).toBe("Log In");
    expect(htmlAsText(toLink[1]![2]!).trim()).toBe(LINK);
  });

  test("says how long the link works, as the server holds it, and that it works once", () => {
    const text: string = htmlAsText(render());

    expect(text).toContain(
      `The link works once and expires in ${STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES} minutes.`,
    );
    expect(text).toContain("Asking for another link replaces this one.");
  });

  test("tells somebody who never asked that ignoring it is safe", () => {
    expect(htmlAsText(render())).toContain(
      "If you didn't ask to log in, you can ignore this email. Nobody can log in without the link.",
    );
  });

  test("escapes the page's name wherever it is printed", () => {
    const html: string = render({
      statusPageName: '<img src=x onerror="alert(1)">Acme & Co',
    });

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;img src");
    expect(html).toContain("Acme &amp; Co");

    // And it reads as its team wrote it, in every line that names it.
    expect(htmlAsText(html)).toContain(
      'Log in to <img src=x onerror="alert(1)">Acme & Co',
    );
  });

  test("loads nothing from outside the installation", () => {
    const html: string = render();
    const absoluteAddress: RegExp = /^https?:/i;
    const loads: Array<string> = Array.from(
      html.matchAll(/\b(?:src|background)\s*=\s*"([^"]+)"/gi),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      loads.filter((value: string): boolean => {
        return absoluteAddress.test(value) || value.startsWith("//");
      }),
    ).toEqual([]);
  });
});
