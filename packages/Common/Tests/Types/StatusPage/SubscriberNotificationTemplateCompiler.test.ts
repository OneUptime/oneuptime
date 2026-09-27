import SafeHtml from "../../../Types/SafeHtml";
import SubscriberNotificationTemplateCompiler from "../../../Types/StatusPage/SubscriberNotificationTemplateCompiler";
import { describe, expect, test } from "@jest/globals";

/*
 * A custom subscriber notification template is filled one of two ways,
 * depending on what its channel renders:
 *
 *   - the body of an EMAIL template is HTML, so a plain value (a title, a
 *     name, a URL) is escaped into it and only a SafeHtml value goes in as
 *     markup;
 *   - an email subject, SMS, Slack and Teams show text as written, so they
 *     get every value unchanged.
 */

const TITLE_WITH_LINK: string =
  '<a href="https://evil.example/reset">Reset your password</a>';
const TITLE_WITH_SCRIPT: string = "<script>alert('x')</script>";
const TITLE_WITH_QUOTES: string = `Payments "EU" & 'UK' down`;

describe("SubscriberNotificationTemplateCompiler.compileEmailBodyTemplate", () => {
  const compile: (
    template: string,
    variables: Record<string, string | SafeHtml>,
  ) => string = (
    template: string,
    variables: Record<string, string | SafeHtml>,
  ): string => {
    return SubscriberNotificationTemplateCompiler.compileEmailBodyTemplate(
      template,
      variables,
    );
  };

  test("escapes a plain value that holds a link", () => {
    const body: string = compile("<h1>{{incidentTitle}}</h1>", {
      incidentTitle: TITLE_WITH_LINK,
    });

    expect(body).toBe(
      "<h1>&lt;a href=&quot;https://evil.example/reset&quot;&gt;Reset your password&lt;/a&gt;</h1>",
    );
    expect(body).not.toContain("<a ");
  });

  test("escapes a plain value that holds a script", () => {
    const body: string = compile("<p>{{incidentTitle}}</p>", {
      incidentTitle: TITLE_WITH_SCRIPT,
    });

    expect(body).toBe("<p>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</p>");
    expect(body).not.toContain("<script");
  });

  test("escapes quotes and ampersands, so a value cannot break out of an attribute", () => {
    const body: string = compile(
      `<a href="{{detailsUrl}}" title='{{incidentTitle}}'>Details</a>`,
      {
        detailsUrl: 'https://status.example.com/" onmouseover="alert(1)',
        incidentTitle: TITLE_WITH_QUOTES,
      },
    );

    expect(body).toBe(
      `<a href="https://status.example.com/&quot; onmouseover=&quot;alert(1)" title='Payments &quot;EU&quot; &amp; &#39;UK&#39; down'>Details</a>`,
    );
  });

  test("keeps the ampersands of a URL working: the attribute decodes them back", () => {
    const body: string = compile(`<a href="{{detailsUrl}}">x</a>`, {
      detailsUrl: "https://status.example.com/incidents/1?view=details&lang=en",
    });

    expect(body).toBe(
      `<a href="https://status.example.com/incidents/1?view=details&amp;lang=en">x</a>`,
    );
  });

  test("inserts a SafeHtml value as it is", () => {
    const body: string = compile(
      "<div>{{incidentDescription}}</div><div>{{resourcesAffected}}</div>",
      {
        incidentDescription: SafeHtml.fromTrustedHtml(
          '<p>Card payments <strong>fail</strong> in <a href="https://acme.com/eu">Europe</a>.</p>',
        ),
        resourcesAffected: SafeHtml.fromTrustedHtml(
          "Europe: Checkout API<br/>Americas: Payments &amp; Billing",
        ),
      },
    );

    expect(body).toBe(
      '<div><p>Card payments <strong>fail</strong> in <a href="https://acme.com/eu">Europe</a>.</p></div>' +
        "<div>Europe: Checkout API<br/>Americas: Payments &amp; Billing</div>",
    );
  });

  test("escapes plain values and keeps HTML ones in the same template", () => {
    const body: string = compile(
      "<h1>{{incidentTitle}}</h1>{{incidentDescription}}<p>{{statusPageName}}</p>",
      {
        incidentTitle: TITLE_WITH_SCRIPT,
        incidentDescription: SafeHtml.fromTrustedHtml("<p><em>ok</em></p>"),
        statusPageName: "Acme <Status>",
      },
    );

    expect(body).toBe(
      "<h1>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</h1><p><em>ok</em></p><p>Acme &lt;Status&gt;</p>",
    );
  });

  test("the template's own HTML is sent as written: the admin who wrote it is trusted", () => {
    const template: string =
      '<table><tr><td style="color:red">{{incidentTitle}}</td></tr></table><a href="https://acme.com">Acme</a>';

    expect(compile(template, { incidentTitle: "Down" })).toBe(
      '<table><tr><td style="color:red">Down</td></tr></table><a href="https://acme.com">Acme</a>',
    );
  });

  test("a placeholder with no variable is left as written", () => {
    expect(
      compile("Hello {{unknownVariable}} {{incidentTitle}}", {
        incidentTitle: "Down",
      }),
    ).toBe("Hello {{unknownVariable}} Down");
  });

  test("a missing or empty value renders as nothing", () => {
    expect(
      compile("[{{a}}][{{b}}][{{c}}]", {
        a: "",
        b: undefined as unknown as string,
        c: SafeHtml.fromTrustedHtml(""),
      }),
    ).toBe("[][][]");
  });

  test("placeholders inside a value are not expanded", () => {
    expect(
      compile("{{note}} | {{unsubscribeUrl}}", {
        note: SafeHtml.fromTrustedHtml("<p>See {{unsubscribeUrl}}</p>"),
        unsubscribeUrl: "https://status.example.com/u/1",
      }),
    ).toBe("<p>See {{unsubscribeUrl}}</p> | https://status.example.com/u/1");

    expect(
      compile("{{incidentTitle}} | {{unsubscribeUrl}}", {
        incidentTitle: "Quoting {{unsubscribeUrl}}",
        unsubscribeUrl: "https://status.example.com/u/1",
      }),
    ).toBe("Quoting {{unsubscribeUrl}} | https://status.example.com/u/1");
  });

  test.each([
    ["$$", "Refunds of $$5 issued"],
    ["$&", "Store $& Co"],
    ["$`", "cost $` now"],
    ["$'", "cost $' now"],
  ])(
    "inserts a value containing %s literally",
    (_label: string, text: string) => {
      expect(compile("Before {{note}} after", { note: text })).toBe(
        `Before ${SafeHtml.escape(text)} after`,
      );
      expect(
        compile("Before {{note}} after", {
          note: SafeHtml.fromTrustedHtml(text),
        }),
      ).toBe(`Before ${text} after`);
    },
  );

  test("does not read inherited properties as variables", () => {
    expect(compile("{{toString}} {{constructor}}", {})).toBe(
      "{{toString}} {{constructor}}",
    );
  });

  test("a plain object that only looks like SafeHtml is escaped, not trusted", () => {
    const lookalike: SafeHtml = {
      toHtml: (): string => {
        return "<b>trusted?</b>";
      },
      toString: (): string => {
        return "<b>trusted?</b>";
      },
    } as unknown as SafeHtml;

    expect(compile("{{x}}", { x: lookalike })).toBe(
      "&lt;b&gt;trusted?&lt;/b&gt;",
    );
  });
});

describe("SubscriberNotificationTemplateCompiler.compileTemplate", () => {
  /*
   * An email subject, SMS, Slack and Teams do not render HTML: escaping would
   * show the reader "&amp;" and "&lt;". They get every value as written.
   */
  test("inserts text channel values exactly as written, never escaped", () => {
    expect(
      SubscriberNotificationTemplateCompiler.compileTemplate(
        "[Incident] {{incidentTitle}} on {{statusPageName}}",
        {
          incidentTitle: TITLE_WITH_QUOTES,
          statusPageName: "Acme <Status>",
        },
      ),
    ).toBe(`[Incident] Payments "EU" & 'UK' down on Acme <Status>`);
  });

  test("leaves an unknown placeholder alone and fills the known ones", () => {
    expect(
      SubscriberNotificationTemplateCompiler.compileTemplate(
        "{{a}} {{ b }} {{c}}",
        { a: "1", b: "2" },
      ),
    ).toBe("1 2 {{c}}");
  });
});

describe("SubscriberNotificationTemplateCompiler.getPlaceholderNames", () => {
  test("names exactly the placeholders the compile fills, each once", () => {
    const templates: Array<string | null | undefined> = [
      "<p>{{incidentTitle}} {{ customFields.root_cause }}</p>",
      "{{customFields.root_cause}} {{incidentLabels}}",
      null,
      undefined,
      "",
      // Not placeholders the compile fills: left as written.
      "{{customFields.root-cause}} {{ }} {{customFields.café}} {incidentTitle}",
    ];

    expect(
      Array.from(
        SubscriberNotificationTemplateCompiler.getPlaceholderNames(templates),
      ),
    ).toEqual(["incidentTitle", "customFields.root_cause", "incidentLabels"]);

    // Every name it finds is one the compile replaces, and no other.
    const variables: Record<string, string> = {};

    for (const name of SubscriberNotificationTemplateCompiler.getPlaceholderNames(
      templates,
    )) {
      variables[name] = "X";
    }

    const compiled: string = templates
      .map((template: string | null | undefined): string => {
        return SubscriberNotificationTemplateCompiler.compileTemplate(
          template || "",
          variables,
        );
      })
      .join("\n");

    expect(compiled).not.toContain("{{incidentTitle}}");
    expect(compiled).not.toContain("customFields.root_cause");
    expect(compiled).toContain("{{customFields.root-cause}}");
  });

  test("can be called again and again: no pattern state carries over", () => {
    for (let i: number = 0; i < 3; i++) {
      expect(
        Array.from(
          SubscriberNotificationTemplateCompiler.getPlaceholderNames([
            "{{a}}",
            "{{a}} {{b}}",
          ]),
        ),
      ).toEqual(["a", "b"]);
    }
  });
});
