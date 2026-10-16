import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import { htmlAsText } from "../../Helpers/HtmlText";

/*
 * "CAN'T TAKE IT? PASS IT ON" - THE PAGES A MESSAGE'S LINKS OPEN, RENDERED.
 *
 * Somebody woken by a page who cannot take it follows a link from the email,
 * the text or the chat message. These render the real templates and read
 * the HTML a browser is handed: the acknowledge page offers passing on
 * beside Acknowledge, for a link that carries the page's own token; the
 * pass-on page asks first, with what passing on would do. Both pass it on
 * with a form, not a link - mail scanners follow every link in a message,
 * and a page they passed on would wake the next person for nothing.
 */

const VIEWS: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Views",
);

const ACKNOWLEDGE_VIEW: string = path.join(
  VIEWS,
  "AcknowledgeUserOnCallNotification.ejs",
);
const PASS_ON_VIEW: string = path.join(
  VIEWS,
  "PassOnUserOnCallNotification.ejs",
);

function render(viewPath: string, variables: Record<string, unknown>): string {
  return ejs.render(fs.readFileSync(viewPath, "utf8"), variables, {
    filename: viewPath,
  });
}

const FORM_URL: string =
  "https://oneuptime.example.com/api/user-notification-log-timeline/pass-on/1";
const TOKEN: string =
  "eyJhbGciOiJIUzI1NiJ9.eyJwdXJwb3NlIjoib24tY2FsbC1wYWdlIn0.sig";

const ACKNOWLEDGE_BASE: Record<string, unknown> = {
  title: "Acknowledge Incident - Checkout is down",
  message: "Do you want to acknowledge this Incident?",
  acknowledgeText: "Acknowledge Incident",
  acknowledgeUrl:
    "https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/1",
  resourceTitle: "Checkout is down",
};

const PASS_ON_BLOCK: Record<string, unknown> = {
  lead: "Can't take it?",
  explanation:
    "You won't be paged about it again. Escalation rule 2 of 2 (Level 2) is paged right away, without waiting.",
  buttonText: "Pass it on",
  formUrl: FORM_URL,
  tokenParam: "pageToken",
  token: TOKEN,
};

describe("the acknowledge page", () => {
  test("offers Can't take it? Pass it on under Acknowledge, as a form that posts the token", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      passOn: PASS_ON_BLOCK,
    });

    expect(html).toContain('data-testid="pass-on"');
    expect(html).toContain(`<form method="POST" action="${FORM_URL}"`);
    expect(html).toContain(
      `<input type="hidden" name="pageToken" value="${TOKEN}">`,
    );
    expect(html).toContain(
      '<button type="submit" data-testid="pass-on-button"',
    );

    const text: string = htmlAsText(html);

    expect(text).toContain("Can't take it?");
    expect(text).toContain(
      "You won't be paged about it again. Escalation rule 2 of 2 (Level 2) is paged right away, without waiting.",
    );
    expect(text).toContain("Pass it on");
  });

  test("puts Acknowledge first: it is still what most people do", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      passOn: PASS_ON_BLOCK,
    });

    expect(
      html.indexOf(`href="${String(ACKNOWLEDGE_BASE["acknowledgeUrl"])}"`),
    ).toBeGreaterThan(0);
    expect(
      html.indexOf(`href="${String(ACKNOWLEDGE_BASE["acknowledgeUrl"])}"`),
    ).toBeLessThan(html.indexOf('data-testid="pass-on"'));
  });

  test("passing on is the quieter button: outlined, not the page's yellow", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      passOn: PASS_ON_BLOCK,
    });
    const button: string = html.slice(
      html.indexOf('data-testid="pass-on-button"'),
      html.indexOf("</button>"),
    );

    expect(button).toContain("bg-white");
    expect(button).toContain("border-gray-300");
    expect(button).not.toContain("bg-yellow-600");
  });

  test("without it - a link sent before, or a page that is over - is the page it always was", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, ACKNOWLEDGE_BASE);

    expect(html).not.toContain("<form");
    expect(html).not.toContain("Pass it on");
    expect(html).toContain("Acknowledge Incident");
  });

  test("escapes what it is handed: a token is no way into the page", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      passOn: {
        ...PASS_ON_BLOCK,
        token: '"><script>alert(1)</script>',
        explanation: "<img src=x onerror=alert(1)>",
      },
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the pass-on page", () => {
  const PASS_ON_BASE: Record<string, unknown> = {
    title: "Pass on Incident INC-42?",
    message:
      "Can't take it? You won't be paged about it again. Escalation rule 2 of 2 (Level 2) is paged right away, without waiting.",
    passOnText: "Pass it on",
    passOnFormUrl: FORM_URL,
    pageTokenParam: "pageToken",
    pageToken: TOKEN,
    acknowledgeText: "Acknowledge Incident instead",
    acknowledgeUrl:
      "https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/1",
    resourceNumber: "INC-42",
    resourceTitle: "Checkout is down",
  };

  test("says what passing on would do, about which record", () => {
    const text: string = htmlAsText(render(PASS_ON_VIEW, PASS_ON_BASE));

    expect(text).toContain("Pass on Incident INC-42?");
    expect(text).toContain(
      "Can't take it? You won't be paged about it again. Escalation rule 2 of 2 (Level 2) is paged right away, without waiting.",
    );
    expect(text).toContain("INC-42");
    expect(text).toContain("Checkout is down");
  });

  test("its button is the page's one primary action, a form that posts the token", () => {
    const html: string = render(PASS_ON_VIEW, PASS_ON_BASE);

    expect(html).toContain(`<form method="POST" action="${FORM_URL}"`);
    expect(html).toContain(
      `<input type="hidden" name="pageToken" value="${TOKEN}">`,
    );

    const button: string = html.slice(
      html.indexOf('data-testid="pass-on-button"'),
      html.indexOf("</button>"),
    );

    expect(button).toContain("bg-gray-900");
    expect(button).toContain("text-white");
  });

  test("offers acknowledging instead, for somebody who can take it after all", () => {
    const html: string = render(PASS_ON_VIEW, PASS_ON_BASE);

    expect(html).toContain('data-testid="acknowledge-instead"');
    expect(html).toContain(
      'href="https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/1"',
    );
    expect(htmlAsText(html)).toContain("Acknowledge Incident instead");
  });

  test("draws the product's logo, as every page a message opens does", () => {
    const source: string = fs.readFileSync(PASS_ON_VIEW, "utf8");

    expect(source).toContain("include('./Partials/ProductLogo.ejs')");
    expect(source).toContain("include('./Partials/Head.ejs')");
    expect(source).not.toContain("oneuptime-logo.svg");
  });
});
