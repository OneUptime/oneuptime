import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import { htmlAsText } from "../../Helpers/HtmlText";

/*
 * "CAN'T TAKE IT? ESCALATE" - THE PAGES A MESSAGE'S LINKS OPEN, RENDERED.
 *
 * Somebody woken by a page who cannot take it follows a link from the email,
 * the text or the chat message. These render the real templates and read
 * the HTML a browser is handed: the acknowledge page offers escalating
 * beside Acknowledge, for a link that carries the page's own token; the
 * escalate page asks first ("Escalate Incident INC-42?"), with what
 * escalating would do. Both escalate with a form, not a link - mail
 * scanners follow every link in a message, and a page they escalated would
 * wake the next person for nothing. The words are the server's
 * (UserOnCallLogTimelineAPI); the templates draw no words of their own.
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
  explanation: "This will immediately page Platform leads (Level 2 of 2), without waiting. You will not be paged again for this incident.",
  buttonText: "Escalate",
  formUrl: FORM_URL,
  tokenParam: "pageToken",
  token: TOKEN,
};

describe("the acknowledge page", () => {
  test("offers Can't take it? Escalate under Acknowledge, as a form that posts the token", () => {
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
    expect(text).toContain("This will immediately page Platform leads (Level 2 of 2), without waiting. You will not be paged again for this incident.");
    expect(text).toContain("Escalate");
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

  test("escalating is the quieter button: outlined, not the page's yellow", () => {
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
    expect(html).not.toContain("Escalate");
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

describe("the escalate page", () => {
  const PASS_ON_BASE: Record<string, unknown> = {
    title: "Escalate Incident INC-42?",
    message: "This will immediately page Platform leads (Level 2 of 2), without waiting. You will not be paged again for this incident.",
    passOnText: "Escalate",
    passOnFormUrl: FORM_URL,
    pageTokenParam: "pageToken",
    pageToken: TOKEN,
    acknowledgeText: "Acknowledge Incident instead",
    acknowledgeUrl:
      "https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/1",
    resourceNumber: "INC-42",
    resourceTitle: "Checkout is down",
  };

  test("says what escalating would do, about which record", () => {
    const text: string = htmlAsText(render(PASS_ON_VIEW, PASS_ON_BASE));

    expect(text).toContain("Escalate Incident INC-42?");
    expect(text).toContain("This will immediately page Platform leads (Level 2 of 2), without waiting. You will not be paged again for this incident.");
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

/*
 * "Nobody else is left to page": escalating that leaves nobody being paged
 * is said as a warning of its own (Partials/OnCallPassOnWarning.ejs) - on
 * the acknowledge page, the escalate page and the page after it - not in
 * the grey line beside the button, where a person woken at 3 a.m. reads
 * past it.
 */
describe("the warning when nobody is left to page", () => {
  const MESSAGE_VIEW: string = path.join(VIEWS, "ViewMessage.ejs");

  const STOPS: string =
    "Nobody else is left to page: paging stops, and somebody needs to take it.";

  // The warning's element, from its opening tag to its end.
  function warningOf(html: string): string {
    const marker: number = html.indexOf('data-testid="pass-on-warning"');

    expect(marker).toBeGreaterThan(0);

    const start: number = html.lastIndexOf("<div", marker);

    return html.slice(start, html.indexOf("</div>", marker));
  }

  test("the acknowledge page draws it apart, above the Escalate button", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      passOn: {
        ...PASS_ON_BLOCK,
        explanation: "You will not be paged again for this incident.",
        warning: STOPS,
      },
    });

    const warning: string = warningOf(html);

    expect(warning).toContain('role="alert"');
    expect(warning).toContain("bg-amber-50");
    expect(htmlAsText(warning)).toContain(STOPS);
    expect(html.indexOf('data-testid="pass-on-warning"')).toBeLessThan(
      html.indexOf('data-testid="pass-on-button"'),
    );
  });

  test("the escalate page draws it under its question", () => {
    const html: string = render(PASS_ON_VIEW, {
      title: "Escalate Incident INC-42?",
      message: "You will not be paged again for this incident.",
      warning: STOPS,
      passOnText: "Escalate",
      passOnFormUrl: FORM_URL,
      pageTokenParam: "pageToken",
      pageToken: TOKEN,
      acknowledgeText: "Acknowledge Incident instead",
      acknowledgeUrl:
        "https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge/1",
      resourceTitle: "Checkout is down",
    });

    expect(htmlAsText(warningOf(html))).toContain(STOPS);
    expect(html.indexOf("You will not be paged again for this incident.")).toBeLessThan(
      html.indexOf('data-testid="pass-on-warning"'),
    );
  });

  test("the page after escalating draws it too", () => {
    const html: string = render(MESSAGE_VIEW, {
      title: "Incident escalated - Checkout is down",
      message: "You will not be paged again for this incident.",
      warning:
        "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
      viewDetailsText: "View Incident",
      viewDetailsUrl: "https://oneuptime.example.com/dashboard/p/incidents/1",
      resourceTitle: "Checkout is down",
    });

    expect(htmlAsText(warningOf(html))).toContain(
      "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
    );
  });

  test("a page with nothing to warn about draws no box - every other page of a message is as it was", () => {
    expect(
      render(ACKNOWLEDGE_VIEW, { ...ACKNOWLEDGE_BASE, passOn: PASS_ON_BLOCK }),
    ).not.toContain("pass-on-warning");
    expect(
      render(MESSAGE_VIEW, {
        title: "Notification Already Acknowledged - Checkout is down",
        message: "This notification has already been acknowledged.",
        viewDetailsText: "View Incident",
        viewDetailsUrl: "https://oneuptime.example.com/dashboard/p/incidents/1",
      }),
    ).not.toContain("pass-on-warning");
  });

  test("escapes what it is handed", () => {
    const html: string = render(MESSAGE_VIEW, {
      title: "Incident escalated",
      message: "You will not be paged again for this incident.",
      warning: "<img src=x onerror=alert(1)>",
      viewDetailsText: "View Incident",
      viewDetailsUrl: "https://oneuptime.example.com/dashboard/p/incidents/1",
    });

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("the templates themselves", () => {
  test("draw no words of the action of their own: the server hands them every word", () => {
    for (const view of [
      ACKNOWLEDGE_VIEW,
      PASS_ON_VIEW,
      path.join(VIEWS, "ViewMessage.ejs"),
      path.join(VIEWS, "Partials", "OnCallPassOnForm.ejs"),
      path.join(VIEWS, "Partials", "OnCallPassOnWarning.ejs"),
    ]) {
      // Comments say what each block is for; the markup must not say it.
      const markup: string = htmlAsText(
        fs
          .readFileSync(view, "utf8")
          .split("<%#")
          .map((part: string, index: number): string => {
            return index === 0 ? part : part.slice(part.indexOf("%>") + 2);
          })
          .join(""),
      );

      expect({ view, says: markup.includes("Pass it on") }).toEqual({
        view,
        says: false,
      });
      expect({ view, says: markup.includes("Escalate") }).toEqual({
        view,
        says: false,
      });
    }
  });
});
