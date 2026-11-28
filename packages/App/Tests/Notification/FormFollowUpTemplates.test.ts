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

/*
 * The emails of a form's follow-ups (Common/Server/Utils/Form/FormFollowUp):
 *
 *   FormFollowUpStarted      to the person who submitted: their link
 *   FormFollowUpPersonAdded  to somebody added: who added them, their link
 *   FormFollowUpMessage      to everybody following but the author: a new
 *                            message, and the reader's own link
 *
 * Every name and title in them was written by a person - the form's team,
 * the submitter, whoever added someone - so each is printed escaped; the
 * message is the HTML its Markdown was rendered into. Each has one action,
 * to the reader's own link, and the link again to copy.
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

const LINK: string = `https://oneuptime.acme.test/accounts/form/7c9e6679-7425-40de-944b-e07fc1f90ae7?followUp=3f2504e0-4f89-41d3-9a0c-0305e82c3301-${"ab".repeat(32)}`;

const render: (
  template: EmailTemplateType,
  vars?: Record<string, unknown>,
) => string = (
  template: EmailTemplateType,
  vars?: Record<string, unknown>,
): string => {
  return handlebars.compile(
    fs.readFileSync(Path.join(TEMPLATES_DIR, template), "utf8"),
  )({
    homeURL: "https://oneuptime.acme.test",
    year: "2026",
    formName: "Support",
    requestTitle: "INC-42: Checkout fails",
    requestUrl: LINK,
    isSignInRequired: "",
    ...(vars || {}),
  });
};

const anchorsTo: (html: string, href: string) => Array<RegExpMatchArray> = (
  html: string,
  href: string,
): Array<RegExpMatchArray> => {
  return Array.from(
    html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi),
  ).filter((anchor: RegExpMatchArray): boolean => {
    return anchor[1] === Handlebars.escapeExpression(href);
  });
};

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

describe.each([
  [EmailTemplateType.FormFollowUpStarted],
  [EmailTemplateType.FormFollowUpPersonAdded],
  [EmailTemplateType.FormFollowUpMessage],
])("%s", (template: EmailTemplateType) => {
  test("is the template its type names", () => {
    expect(fs.existsSync(Path.join(TEMPLATES_DIR, template))).toBe(true);
  });

  test("names the request and its form", () => {
    const text: string = htmlAsText(render(template));

    expect(text).toContain("INC-42: Checkout fails");
    expect(text).toContain("Support");
  });

  test("leads to the reader's own link, twice: the button and the link to copy", () => {
    expect(anchorsTo(render(template), LINK).length).toBeGreaterThanOrEqual(2);
  });

  test("prints what people wrote escaped, never as HTML", () => {
    const html: string = render(template, {
      formName: '<img src="https://tracker.example/x.png">',
      requestTitle: "<script>alert(1)</script>",
      addedBy: "<b>Mallory</b>",
      authorName: "<i>Mallory</i>",
    });

    expect(html).not.toContain('<img src="https://tracker.example/x.png">');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>Mallory</b>");
    expect(html).not.toContain("<i>Mallory</i>");
  });

  test("tells somebody of a form that asks its visitors to sign in to sign in with this address", () => {
    expect(
      htmlAsText(render(template, { isSignInRequired: "true" })),
    ).toContain("Sign in with this email address to open it.");
    expect(htmlAsText(render(template))).not.toContain(
      "Sign in with this email address to open it.",
    );
  });

  test("leaves nothing unfilled", () => {
    expect(
      render(template, {
        addedBy: "Jane",
        authorName: "Jane",
        message: "<p>Hi</p>",
        fileNames: "a.txt",
      }),
    ).not.toContain("{{");
  });
});

describe("FormFollowUpPersonAdded.hbs", () => {
  test("says who added the reader", () => {
    expect(
      htmlAsText(
        render(EmailTemplateType.FormFollowUpPersonAdded, { addedBy: "Jane" }),
      ),
    ).toContain(
      "Jane added you to the people following a request sent through Support.",
    );
  });

  test("tells them how to stop", () => {
    expect(
      htmlAsText(
        render(EmailTemplateType.FormFollowUpPersonAdded, { addedBy: "Jane" }),
      ),
    ).toContain("Stop following");
  });
});

describe("FormFollowUpMessage.hbs", () => {
  test("shows who wrote, and the message as the HTML its Markdown became", () => {
    const html: string = render(EmailTemplateType.FormFollowUpMessage, {
      authorName: "Sam",
      message: "<p>We <strong>found</strong> it.</p>",
      fileNames: "",
    });

    expect(htmlAsText(html)).toContain(
      "Sam wrote on a request you follow, sent through Support.",
    );
    expect(html).toContain("<strong>found</strong>");
  });

  test("names the files a message carried, and no Files row without any", () => {
    expect(
      htmlAsText(
        render(EmailTemplateType.FormFollowUpMessage, {
          authorName: "Jane",
          message: "",
          fileNames: "steps.txt, shot.png",
        }),
      ),
    ).toContain("steps.txt, shot.png");

    expect(
      htmlAsText(
        render(EmailTemplateType.FormFollowUpMessage, {
          authorName: "Jane",
          message: "<p>Hi</p>",
          fileNames: "",
        }),
      ),
    ).not.toContain("Files");
  });

  test("says why it was sent, and how to stop", () => {
    expect(
      htmlAsText(
        render(EmailTemplateType.FormFollowUpMessage, { authorName: "Jane" }),
      ),
    ).toContain(
      "You get this email because you follow this request. To stop, open it and choose Stop following.",
    );
  });
});

describe("FormFollowUpStarted.hbs", () => {
  test("says the request was received, and what the link does", () => {
    const text: string = htmlAsText(
      render(EmailTemplateType.FormFollowUpStarted),
    );

    expect(text).toContain("We got your request");
    expect(text).toContain("Your request was sent through Support.");
  });

  test("tells somebody who never sent it that they can ignore it", () => {
    expect(htmlAsText(render(EmailTemplateType.FormFollowUpStarted))).toContain(
      "You can safely ignore this email.",
    );
  });
});
