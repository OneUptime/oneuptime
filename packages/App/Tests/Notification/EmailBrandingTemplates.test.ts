import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { markupAsSpacesWithOutlookContent } from "Common/Tests/Helpers/HtmlText";
import {
  screenReaderPieces,
  timesSaid,
} from "Common/Tests/Helpers/ScreenReaderText";
import EmailLogo from "Common/Server/Utils/Mail/EmailLogo";
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  registerEmailBrandHelpers,
  registerJoiningConcat,
} from "./Fixtures/EmailBrandHelpers";

/*
 * Every email names the product the way the installation goes by: the
 * partials every email is built from (Logo, Header, Footer, Thanks,
 * UnsubscribeOwnerEmail) and the templates whose own copy names the product
 * (an invitation, a welcome, a sign-in confirmation, a probe or database
 * warning) read the variables MailService.render adds
 * (Utils/EmailBranding.ts):
 *
 *   brandProductName  "OneUptime", or the name the installation goes by
 *   isBrandRenamed    "true" when it goes by another name
 *   brandWebsiteUrl   where "Powered by" links when renamed
 *   brandLogoUrl      the logo, when it has one a mail client can draw
 *   oneUptimeLogoUrl  OneUptime's own logo, the image itself (a data: URL
 *                     sent inside the email), where the header shows it
 *
 * Pinned: an installation that is not renamed gets exactly the email it got
 * before (the partials do not even need the brand helpers for it); a renamed
 * one never says OneUptime outside the emails about OneUptime's own license
 * and billing; the name is escaped once - never twice, never not at all - in
 * text, in attributes and in the arguments a template hands its partials.
 *
 * Rendered with the production helpers (Utils/Handlebars.ts, imported above)
 * and the production partials it registers.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

const NAME: string = "Acme & Co";
const NAME_IN_HTML: string = "Acme &amp; Co";

const RENAMED: Record<string, string> = {
  brandProductName: NAME,
  isBrandRenamed: "true",
};

// The templates whose own copy names the product.
const TEMPLATES_THAT_NAME_THE_PRODUCT: ReadonlyArray<string> = [
  "ClickhouseCapacityWarning",
  "CompleteRegistration",
  "ConfirmProjectSsoSignIn",
  "InviteMember",
  "MonitorsAffectedByProbeStatus",
  "PostgresHealthWarning",
  "ProbeOffline",
  "RedisHealthWarning",
  "SignupWelcomeEmail",
  "TwoFactorBackupCodeUsed",
  "TwoFactorBackupCodesCreated",
  "TwoFactorBackupCodesRegenerated",
  "TwoFactorWrongCodes",
];

/*
 * The emails about OneUptime's own license and billing: they are from
 * OneUptime, about OneUptime, to whoever holds the license or pays for the
 * project, and say so whatever the installation is called.
 */
const EMAILS_ABOUT_ONEUPTIME_ITSELF: ReadonlyArray<string> = [
  "EnterpriseLicenseExpiryReminder",
  "EnterpriseLicenseUserLimitBreach",
  "Invoice",
  "ProjectSubscriptionOverdue",
];

const WHITESPACE_RUN: RegExp = /\s+/g;
const ONEUPTIME_WORD: RegExp = /.{0,40}\bOneUptime\b.{0,40}/g;
const DOUBLE_ESCAPED_AMPERSAND: RegExp = /&amp;amp;/;
const RAW_NAME: RegExp = /Acme & Co/;

const templateNames: () => Array<string> = (): Array<string> => {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".hbs");
    })
    .map((file: string): string => {
      return file.slice(0, -4);
    })
    .sort();
};

const readTemplate: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, `${name}.hbs`), "utf8");
};

const readPartial: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(PARTIALS_DIR, `${name}.hbs`), "utf8");
};

const HELPER_NAMES: ReadonlySet<string> = new Set<string>([
  "if",
  "unless",
  "each",
  "with",
  "ifCond",
  "ifNotCond",
  "concat",
  "log",
  "brandName",
  "brandNameHtml",
]);

/*
 * A value for every variable a template reads, so each renders with all
 * of its content: `value` says what (a truthy text, or "" for every else
 * branch).
 */
const variablesFor: (
  source: string,
  value: (name: string) => string,
) => Record<string, unknown> = (
  source: string,
  value: (name: string) => string,
): Record<string, unknown> => {
  const variables: Record<string, unknown> = {};

  const visit: (node: unknown) => void = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }

    const typed: { type?: string; data?: boolean; parts?: Array<string> } =
      node as { type?: string; data?: boolean; parts?: Array<string> };

    if (
      typed.type === "PathExpression" &&
      !typed.data &&
      typed.parts &&
      typed.parts.length > 0 &&
      typed.parts[0] !== "this" &&
      !HELPER_NAMES.has(typed.parts[0]!)
    ) {
      let target: Record<string, unknown> = variables;

      for (const part of typed.parts.slice(0, -1)) {
        if (!target[part] || typeof target[part] !== "object") {
          target[part] = {};
        }

        target = target[part] as Record<string, unknown>;
      }

      target[typed.parts[typed.parts.length - 1]!] = value(
        typed.parts[typed.parts.length - 1]!,
      );
    }

    for (const child of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  };

  visit(Handlebars.parse(source));

  return variables;
};

const FILLED: (name: string) => string = (name: string): string => {
  return `X-${name}`;
};

const EMPTY: () => string = (): string => {
  return "";
};

const render: (
  name: string,
  variables: Record<string, unknown>,
  engine?: typeof Handlebars,
) => string = (
  name: string,
  variables: Record<string, unknown>,
  engine: typeof Handlebars = Handlebars,
): string => {
  return engine.compile(readTemplate(name))(variables);
};

/*
 * The words people read: the email's text, without its markup, in every
 * client - what only Outlook shows included.
 */
const textOf: (html: string) => string = (html: string): string => {
  return markupAsSpacesWithOutlookContent(html).replace(WHITESPACE_RUN, " ");
};

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

describe("an installation that is not renamed", () => {
  test.each(templateNames())(
    "%s is exactly the email it was, with or without the brand variables",
    (name: string) => {
      for (const value of [FILLED, EMPTY]) {
        const variables: Record<string, unknown> = variablesFor(
          readTemplate(name),
          value,
        );

        expect(
          render(name, { ...variables, brandProductName: "OneUptime" }),
        ).toBe(render(name, variables));
      }
    },
  );

  test.each([...TEMPLATES_THAT_NAME_THE_PRODUCT])(
    "%s names OneUptime",
    (name: string) => {
      const html: string = render(name, {
        ...variablesFor(readTemplate(name), FILLED),
        brandProductName: "OneUptime",
      });

      expect(textOf(html)).toContain("OneUptime");
    },
  );
});

describe("a renamed installation", () => {
  test.each(templateNames())(
    "%s never says OneUptime, unless it is about OneUptime's own license or billing",
    (name: string) => {
      for (const value of [FILLED, EMPTY]) {
        const html: string = render(name, {
          ...variablesFor(readTemplate(name), value),
          ...RENAMED,
          brandWebsiteUrl: "https://acme.example",
        });

        const mentions: Array<string> = (
          textOf(html).match(ONEUPTIME_WORD) || []
        ).filter((mention: string): boolean => {
          // A value the template was handed, not its own copy.
          return !mention.includes("X-");
        });

        if (EMAILS_ABOUT_ONEUPTIME_ITSELF.includes(name)) {
          continue;
        }

        // No link to OneUptime's site or support desk either.
        expect({
          template: name,
          linksToOneUptime: html.includes("oneuptime.com"),
        }).toEqual({
          template: name,
          linksToOneUptime: false,
        });

        /*
         * A template's own copy that names the product uses the brand
         * helpers: {{brandName}} in text, (brandName) for an argument a
         * partial escapes (title=, buttonText=, plainInfo=) and
         * (brandNameHtml) for one it prints as it is (info=, text=).
         */
        expect({ template: name, mentions }).toEqual({
          template: name,
          mentions: [],
        });
      }
    },
  );

  test.each([...TEMPLATES_THAT_NAME_THE_PRODUCT])(
    "%s names the installation, escaped exactly once",
    (name: string) => {
      const html: string = render(name, {
        ...variablesFor(readTemplate(name), FILLED),
        ...RENAMED,
      });

      expect(html).toContain(NAME_IN_HTML);
      expect(html).not.toMatch(DOUBLE_ESCAPED_AMPERSAND);
      expect(html).not.toMatch(RAW_NAME);
    },
  );

  test.each([...TEMPLATES_THAT_NAME_THE_PRODUCT])(
    "%s never lets markup in a name through",
    (name: string) => {
      const html: string = render(name, {
        ...variablesFor(readTemplate(name), FILLED),
        brandProductName: "<script>alert(1)</script>",
        isBrandRenamed: "true",
      });

      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    },
  );

  test.each([...EMAILS_ABOUT_ONEUPTIME_ITSELF])(
    "%s still says OneUptime: it is about OneUptime's own license or billing",
    (name: string) => {
      const html: string = render(name, {
        ...variablesFor(readTemplate(name), FILLED),
        ...RENAMED,
      });

      expect(textOf(html)).toContain("OneUptime");
    },
  );
});

describe("the partials every email is built from", () => {
  // A Handlebars with the partials and no helpers at all: they need none.
  const plain: typeof Handlebars = Handlebars.create();

  beforeAll(() => {
    for (const file of fs.readdirSync(PARTIALS_DIR)) {
      if (file.endsWith(".hbs")) {
        plain.registerPartial(
          file.slice(0, -4),
          readPartial(file.slice(0, -4)),
        );
      }
    }
  });

  const renderPartial: (
    name: string,
    variables: Record<string, unknown>,
  ) => string = (name: string, variables: Record<string, unknown>): string => {
    return plain.compile(readPartial(name))(variables);
  };

  describe("Footer", () => {
    test("by default: Powered by OneUptime, linking to oneuptime.com, and OneUptime's copyright", () => {
      const html: string = renderPartial("Footer", { year: "2026" });

      expect(html).toContain(
        'Powered by <a href="https://oneuptime.com" style="color: #475569; text-decoration: underline; font-weight: 600;">OneUptime</a>',
      );
      expect(html).toContain("&copy; 2026 OneUptime");
    });

    test("renamed, with a website: Powered by the installation, linking to its website", () => {
      const html: string = renderPartial("Footer", {
        year: "2026",
        ...RENAMED,
        brandWebsiteUrl: "https://acme.example",
      });

      expect(html).toContain(
        `<a href="https://acme.example" style="color: #475569; text-decoration: underline; font-weight: 600;">${NAME_IN_HTML}</a>`,
      );
      expect(html).toContain(`&copy; 2026 ${NAME_IN_HTML}`);
      expect(html).not.toContain("oneuptime.com");
      expect(textOf(html)).not.toContain("OneUptime");
    });

    test("renamed, without a website: the installation's name, linking nowhere", () => {
      const html: string = renderPartial("Footer", {
        year: "2026",
        ...RENAMED,
      });

      expect(html).toContain(
        `Powered by <strong style="color: #475569; font-weight: 600;">${NAME_IN_HTML}</strong>`,
      );
      expect(html).not.toContain("<a ");
    });

    test("a website address is escaped in the link", () => {
      const html: string = renderPartial("Footer", {
        ...RENAMED,
        brandWebsiteUrl: 'https://acme.example/"><script>x()</script>',
      });

      expect(html).not.toContain("<script>");
    });
  });

  describe("Logo", () => {
    // OneUptime's logo, as MailService.render hands it to every email.
    const ONEUPTIME_LOGO: string = EmailLogo.getDataUrl() as string;

    test("by default: OneUptime's logo - the image itself, from no host - and name", () => {
      const html: string = renderPartial("Logo", {
        oneUptimeLogoUrl: ONEUPTIME_LOGO,
      });

      expect(html).toContain(
        `<img src="${ONEUPTIME_LOGO}" width="32" height="32" alt="OneUptime"`,
      );
      expect(textOf(html)).toContain("OneUptime");
      // The only image is that one.
      expect(html.split("<img ")).toHaveLength(2);
    });

    test("by default, when OneUptime's logo could not be read: its name alone, never a broken image", () => {
      const html: string = renderPartial("Logo", {});

      expect(html).not.toContain("<img");
      expect(textOf(html).trim()).toBe("OneUptime");
    });

    test("a logo of its own wins over OneUptime's", () => {
      const html: string = renderPartial("Logo", {
        brandLogoUrl: "https://status.acme.example/api/branding/logo?v=1",
        oneUptimeLogoUrl: ONEUPTIME_LOGO,
      });

      expect(html).toContain(
        `src="${Handlebars.escapeExpression(
          "https://status.acme.example/api/branding/logo?v=1",
        )}"`,
      );
      expect(html).not.toContain("data:");
    });

    test("renamed: never OneUptime's logo, even when handed it", () => {
      const html: string = renderPartial("Logo", {
        ...RENAMED,
        oneUptimeLogoUrl: ONEUPTIME_LOGO,
      });

      expect(html).not.toContain("<img");
      expect(textOf(html).trim()).toBe(NAME_IN_HTML);
    });

    test("with a logo of its own: that image, named after the installation", () => {
      const html: string = renderPartial("Logo", {
        ...RENAMED,
        brandLogoUrl: "https://status.acme.example/api/branding/logo?v=1",
        homeUrl: "https://status.acme.example",
      });

      expect(html).toContain(
        `<img src="${Handlebars.escapeExpression(
          "https://status.acme.example/api/branding/logo?v=1",
        )}" height="32" alt="${NAME_IN_HTML}"`,
      );
      expect(html).toContain('<a href="https://status.acme.example"');
      expect(html).not.toContain("OneUptime");
    });

    test("with a logo of its own and OneUptime's name: the image, named OneUptime", () => {
      const html: string = renderPartial("Logo", {
        brandProductName: "OneUptime",
        brandLogoUrl: "https://status.acme.example/api/branding/logo?v=1",
      });

      expect(html).toContain('alt="OneUptime"');
      expect(textOf(html).trim()).toBe("");
    });

    test("renamed without a logo: the name as text, never OneUptime's logo", () => {
      const html: string = renderPartial("Logo", RENAMED);

      expect(html).not.toContain("<img");
      expect(textOf(html).trim()).toBe(NAME_IN_HTML);
    });

    /*
     * A screen reader says the product's name once: beside OneUptime's
     * logo, whose alt text says it (and names the link home), the name
     * written next to it is hidden from screen readers - aria-hidden, which
     * Gmail, Outlook and Apple Mail keep - and still drawn on screen.
     */
    describe("as a screen reader says it: the name once", () => {
      test.each([
        [
          "OneUptime's logo, linked home",
          { oneUptimeLogoUrl: ONEUPTIME_LOGO, homeURL: "https://x.example" },
          ["OneUptime"],
        ],
        [
          "OneUptime's logo, linked home (homeUrl)",
          { oneUptimeLogoUrl: ONEUPTIME_LOGO, homeUrl: "https://x.example" },
          ["OneUptime"],
        ],
        [
          "OneUptime's logo, no link",
          { oneUptimeLogoUrl: ONEUPTIME_LOGO },
          ["OneUptime"],
        ],
        ["no logo could be read: the name alone", {}, ["OneUptime"]],
        [
          "a logo of its own",
          { brandLogoUrl: "https://status.acme.example/api/branding/logo" },
          ["OneUptime"],
        ],
        [
          "renamed, with a logo of its own",
          {
            ...RENAMED,
            brandLogoUrl: "https://status.acme.example/api/branding/logo",
            homeUrl: "https://status.acme.example",
          },
          [NAME],
        ],
        ["renamed, without a logo", RENAMED, [NAME]],
      ])(
        "%s",
        (
          _case: string,
          variables: Record<string, string>,
          spoken: Array<string>,
        ) => {
          const html: string = renderPartial("Logo", variables);

          expect(screenReaderPieces(html)).toEqual(spoken);
        },
      );

      test("the name beside OneUptime's logo is still drawn, only not read out", () => {
        const html: string = renderPartial("Logo", {
          oneUptimeLogoUrl: ONEUPTIME_LOGO,
          homeURL: "https://x.example",
        });

        // On screen: the logo and the name beside it, as before.
        expect(textOf(html).trim()).toBe("OneUptime");
        expect(html).toContain('alt="OneUptime"');
        // Hidden from screen readers only - never from sight.
        expect(html).toContain('<td aria-hidden="true" style="padding-left');
        expect(html).not.toContain("display: none");
        expect(timesSaid(html, "OneUptime")).toBe(1);
      });

      test("standing alone, the name is never hidden from a screen reader", () => {
        for (const variables of [{}, RENAMED]) {
          expect(renderPartial("Logo", variables)).not.toContain("aria-hidden");
        }
      });

      test("every email with OneUptime's header says the name there once", () => {
        const withHeader: Array<string> = templateNames().filter(
          (name: string): boolean => {
            return readTemplate(name).includes("{{> Logo");
          },
        );

        expect(withHeader.length).toBeGreaterThan(50);

        for (const name of withHeader) {
          const html: string = render(name, {
            ...variablesFor(readTemplate(name), FILLED),
            brandProductName: "OneUptime",
            oneUptimeLogoUrl: ONEUPTIME_LOGO,
          });
          // The header: the st-Header table, to the end of the one it holds.
          const start: number = html.indexOf(
            '<table role="presentation" class="st-Header',
          );
          const innerEnd: number = html.indexOf("</table>", start);
          const end: number = html.indexOf("</table>", innerEnd + 1);

          expect(start).toBeGreaterThan(-1);
          expect({
            name: name,
            said: timesSaid(html.slice(start, end), "OneUptime"),
          }).toEqual({ name: name, said: 1 });
        }
      });
    });
  });

  test.each([
    ["Thanks", {}, "The OneUptime Team", `The ${NAME_IN_HTML} Team`],
    [
      "Header",
      {},
      "<title>OneUptime</title>",
      `<title>${NAME_IN_HTML}</title>`,
    ],
    [
      "UnsubscribeOwnerEmail",
      {},
      "Go to OneUptime Dashboard",
      `Go to ${NAME_IN_HTML} Dashboard`,
    ],
  ] as Array<[string, Record<string, unknown>, string, string]>)(
    "%s names OneUptime by default and the installation when renamed",
    (
      name: string,
      variables: Record<string, unknown>,
      byDefault: string,
      renamed: string,
    ) => {
      expect(renderPartial(name, variables)).toContain(byDefault);

      const html: string = renderPartial(name, { ...variables, ...RENAMED });

      expect(html).toContain(renamed);
      expect(html).not.toContain("OneUptime");
    },
  );

  test("SupportBlock sends people to OneUptime's support by default, and is left out when renamed", () => {
    expect(renderPartial("SupportBlock", {})).toContain(
      'Need help? <a href="mailto:support@oneuptime.com"',
    );
    expect(renderPartial("SupportBlock", RENAMED).trim()).toBe("");
  });

  test("Header keeps an email's own title", () => {
    expect(
      renderPartial("Header", { title: "Reset your password", ...RENAMED }),
    ).toContain("<title>Reset your password</title>");
  });
});

describe("the brand helpers", () => {
  const renderSource: (
    source: string,
    variables: Record<string, unknown>,
    engine?: typeof Handlebars,
  ) => string = (
    source: string,
    variables: Record<string, unknown>,
    engine: typeof Handlebars = Handlebars,
  ): string => {
    return engine.compile(source)(variables);
  };

  test("{{brandName}} is the installation's name, escaped like any value", () => {
    expect(renderSource("{{brandName}}", RENAMED)).toBe(NAME_IN_HTML);
  });

  test("{{brandName}} is OneUptime without the variables", () => {
    expect(renderSource("{{brandName}}", {})).toBe("OneUptime");
    expect(renderSource("{{brandName}}", { brandProductName: "  " })).toBe(
      "OneUptime",
    );
  });

  test("reads the email's root inside any block", () => {
    expect(
      renderSource("{{#each items}}{{brandName}};{{/each}}", {
        ...RENAMED,
        items: [1, 2],
      }),
    ).toBe(`${NAME_IN_HTML};${NAME_IN_HTML};`);
  });

  test("(brandNameHtml) is escaped once for an argument printed as it is", () => {
    expect(
      renderSource('{{{concat "Welcome to " (brandNameHtml) "."}}}', RENAMED),
    ).toBe(`Welcome to ${NAME_IN_HTML}.`);
  });

  test("(brandName) is escaped once by the partial that prints the argument", () => {
    expect(renderSource('{{concat "Sign In to " (brandName)}}', RENAMED)).toBe(
      `Sign In to ${NAME_IN_HTML}`,
    );
  });

  test("a name is never read as template syntax", () => {
    expect(
      renderSource("{{brandName}}", {
        brandProductName: "{{secret}}",
        secret: "leaked",
      }),
    ).toBe("{{secret}}");
  });

  test("the template tests' copies of the helpers render what the production ones do", () => {
    const engine: typeof Handlebars = Handlebars.create();

    registerJoiningConcat(engine);
    registerEmailBrandHelpers(engine);

    for (const [source, variables] of [
      ["{{brandName}}", RENAMED],
      ["{{brandName}}", {}],
      ['{{{concat "a " (brandNameHtml) " b"}}}', RENAMED],
      ['{{concat "a " (brandName) " b"}}', RENAMED],
      ['{{concat "a" " " "b" " " "c"}}', {}],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(renderSource(source, variables, engine)).toBe(
        renderSource(source, variables),
      );
    }
  });
});
