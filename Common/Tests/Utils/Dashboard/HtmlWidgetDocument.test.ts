import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import Dictionary from "../../../Types/Dictionary";
import HtmlWidgetDocument, {
  HtmlWidgetContext,
  HtmlWidgetSandboxPermissions,
} from "../../../Utils/Dashboard/HtmlWidgetDocument";

/*
 * The HTML widget renders author-supplied HTML, CSS, and JavaScript, and the
 * dashboard carrying it can be published anonymously from the same origin as
 * /dashboard and /api. The sandbox attribute is the entire security
 * boundary, so the assertions about it here are load-bearing, not
 * documentation: if getSandboxAttribute ever emits allow-same-origin
 * alongside allow-scripts, a widget can reach the parent DOM and the
 * viewer's session, and this suite is what stops that shipping.
 */

function makeVariable(
  overrides: Partial<DashboardVariable>,
): DashboardVariable {
  return {
    id: "var-1",
    name: "cluster",
    type: DashboardVariableType.TelemetryAttribute,
    ...overrides,
  } as DashboardVariable;
}

/* Every on/off combination of the three author-facing permissions. */
function everyPermissionCombination(): Array<HtmlWidgetSandboxPermissions> {
  const combinations: Array<HtmlWidgetSandboxPermissions> = [];

  for (const allowScripts of [true, false]) {
    for (const allowForms of [true, false]) {
      for (const allowPopups of [true, false]) {
        combinations.push({ allowScripts, allowForms, allowPopups });
      }
    }
  }

  return combinations;
}

function parse(document: string): Document {
  return new DOMParser().parseFromString(document, "text/html");
}

describe("HtmlWidgetDocument", () => {
  describe("getSandboxAttribute", () => {
    it("grants nothing when no permission is enabled", () => {
      expect(HtmlWidgetDocument.getSandboxAttribute({})).toBe("");
    });

    it("treats an explicit false the same as an absent flag", () => {
      expect(
        HtmlWidgetDocument.getSandboxAttribute({
          allowScripts: false,
          allowForms: false,
          allowPopups: false,
        }),
      ).toBe("");
    });

    it("grants allow-scripts when scripts are enabled", () => {
      expect(
        HtmlWidgetDocument.getSandboxAttribute({ allowScripts: true }),
      ).toBe("allow-scripts");
    });

    it("grants allow-forms when forms are enabled", () => {
      expect(HtmlWidgetDocument.getSandboxAttribute({ allowForms: true })).toBe(
        "allow-forms",
      );
    });

    /*
     * A popup that inherits the frame's opaque origin loads as a blank
     * sandboxed document, so a link to a runbook would look broken. The
     * escape token is what makes an ordinary link behave like an ordinary
     * link.
     */
    it("pairs allow-popups with allow-popups-to-escape-sandbox", () => {
      const sandbox: string = HtmlWidgetDocument.getSandboxAttribute({
        allowPopups: true,
      });

      expect(sandbox).toContain("allow-popups");
      expect(sandbox).toContain("allow-popups-to-escape-sandbox");
    });

    it("grants every requested token together", () => {
      const tokens: Array<string> = HtmlWidgetDocument.getSandboxAttribute({
        allowScripts: true,
        allowForms: true,
        allowPopups: true,
      }).split(" ");

      expect(tokens).toContain("allow-scripts");
      expect(tokens).toContain("allow-forms");
      expect(tokens).toContain("allow-popups");
      expect(tokens).toContain("allow-popups-to-escape-sandbox");
    });

    /*
     * The one that matters. allow-same-origin together with allow-scripts is
     * equivalent to no sandbox at all: the document can reach up and remove
     * its own sandbox attribute, and until it does it already has the parent
     * origin's cookies, localStorage, and API session.
     */
    it("never grants allow-same-origin, for any combination of inputs", () => {
      for (const permissions of everyPermissionCombination()) {
        expect(
          HtmlWidgetDocument.getSandboxAttribute(permissions),
        ).not.toContain("allow-same-origin");
      }
    });

    it("never grants navigation of the page hosting the dashboard", () => {
      for (const permissions of everyPermissionCombination()) {
        const sandbox: string =
          HtmlWidgetDocument.getSandboxAttribute(permissions);

        expect(sandbox).not.toContain("allow-top-navigation");
        expect(sandbox).not.toContain("allow-downloads");
      }
    });

    /*
     * React emits sandbox="" for an empty string — the maximally restrictive
     * form — but drops the attribute entirely for undefined or null. A
     * dropped attribute is the opposite of restrictive: an unsandboxed
     * srcdoc frame inherits the parent's origin, so a <script> in the
     * author's markup would run with the viewer's session. Returning a
     * string in every case is what makes that unreachable.
     */
    it("always returns a string, so the attribute can never be dropped", () => {
      expect(typeof HtmlWidgetDocument.getSandboxAttribute({})).toBe("string");

      for (const permissions of everyPermissionCombination()) {
        expect(typeof HtmlWidgetDocument.getSandboxAttribute(permissions)).toBe(
          "string",
        );
      }
    });

    it("emits only tokens it was asked for", () => {
      const allowed: Array<string> = [
        "allow-scripts",
        "allow-forms",
        "allow-popups",
        "allow-popups-to-escape-sandbox",
      ];

      for (const permissions of everyPermissionCombination()) {
        const sandbox: string =
          HtmlWidgetDocument.getSandboxAttribute(permissions);

        const tokens: Array<string> = sandbox
          .split(" ")
          .filter((token: string): boolean => {
            return token.length > 0;
          });

        for (const token of tokens) {
          expect(allowed).toContain(token);
        }
      }
    });
  });

  describe("resolveVariables", () => {
    it("returns an empty map when there are no variables", () => {
      expect(HtmlWidgetDocument.resolveVariables(undefined)).toEqual({});
      expect(HtmlWidgetDocument.resolveVariables([])).toEqual({});
    });

    it("uses the selected value", () => {
      expect(
        HtmlWidgetDocument.resolveVariables([
          makeVariable({ name: "env", selectedValue: "production" }),
        ]),
      ).toEqual({ env: "production" });
    });

    it("falls back to the default value when nothing is selected", () => {
      expect(
        HtmlWidgetDocument.resolveVariables([
          makeVariable({ name: "env", defaultValue: "staging" }),
        ]),
      ).toEqual({ env: "staging" });
    });

    it("prefers the selected value over the default", () => {
      expect(
        HtmlWidgetDocument.resolveVariables([
          makeVariable({
            name: "env",
            selectedValue: "production",
            defaultValue: "staging",
          }),
        ]),
      ).toEqual({ env: "production" });
    });

    it("joins a multi-select with commas", () => {
      expect(
        HtmlWidgetDocument.resolveVariables([
          makeVariable({
            name: "clusters",
            isMultiSelect: true,
            selectedValues: ["eu-1", "us-1"],
          }),
        ]),
      ).toEqual({ clusters: "eu-1,us-1" });
    });

    it("falls back to the default when a multi-select has no picks", () => {
      expect(
        HtmlWidgetDocument.resolveVariables([
          makeVariable({
            name: "clusters",
            isMultiSelect: true,
            selectedValues: [],
            defaultValue: "eu-1",
          }),
        ]),
      ).toEqual({ clusters: "eu-1" });
    });

    it("maps an unset variable to an empty string rather than dropping it", () => {
      expect(
        HtmlWidgetDocument.resolveVariables([makeVariable({ name: "env" })]),
      ).toEqual({ env: "" });
    });

    it("skips a variable with no name", () => {
      expect(
        HtmlWidgetDocument.resolveVariables([
          makeVariable({ name: "", selectedValue: "x" }),
        ]),
      ).toEqual({});
    });

    it("resolves every variable it is given", () => {
      expect(
        HtmlWidgetDocument.resolveVariables([
          makeVariable({ id: "a", name: "env", selectedValue: "prod" }),
          makeVariable({ id: "b", name: "region", selectedValue: "eu" }),
        ]),
      ).toEqual({ env: "prod", region: "eu" });
    });
  });

  describe("interpolate", () => {
    it("substitutes a placeholder", () => {
      expect(
        HtmlWidgetDocument.interpolate("<h1>{{env}}</h1>", { env: "prod" }),
      ).toBe("<h1>prod</h1>");
    });

    it("tolerates whitespace inside the braces", () => {
      expect(
        HtmlWidgetDocument.interpolate("{{  env  }}", { env: "prod" }),
      ).toBe("prod");
    });

    it("substitutes every occurrence, not just the first", () => {
      expect(
        HtmlWidgetDocument.interpolate("{{env}}-{{env}}-{{env}}", {
          env: "prod",
        }),
      ).toBe("prod-prod-prod");
    });

    it("is not stateful across calls", () => {
      const values: Dictionary<string> = { env: "prod" };

      expect(HtmlWidgetDocument.interpolate("{{env}}", values)).toBe("prod");
      expect(HtmlWidgetDocument.interpolate("{{env}}", values)).toBe("prod");
    });

    /*
     * Blanking an unknown placeholder would silently delete an author's
     * template literal or Handlebars snippet. Leaving it alone is both the
     * safer failure and the more debuggable one.
     */
    it("leaves an unknown placeholder untouched", () => {
      expect(
        HtmlWidgetDocument.interpolate("{{missing}}", { env: "prod" }),
      ).toBe("{{missing}}");
    });

    it("returns an empty string for empty input", () => {
      expect(HtmlWidgetDocument.interpolate("", { env: "prod" })).toBe("");
    });

    it("leaves text with no placeholders alone", () => {
      expect(
        HtmlWidgetDocument.interpolate("body { color: red; }", { env: "prod" }),
      ).toBe("body { color: red; }");
    });

    /*
     * Matching is driven by the template, so a variable whose name contains
     * regex metacharacters cannot widen what a placeholder matches.
     */
    it("does not let a variable name act as a regex", () => {
      expect(
        HtmlWidgetDocument.interpolate("{{axb}}", { "a.b": "matched" }),
      ).toBe("{{axb}}");
    });

    /*
     * String.replace treats $&, $1 and friends as replacement patterns when
     * the replacement is a string. A function replacer is what keeps a value
     * containing those sequences literal.
     */
    it("treats a value containing $& literally", () => {
      expect(HtmlWidgetDocument.interpolate("{{v}}", { v: "$& $1 $`" })).toBe(
        "$& $1 $`",
      );
    });

    it("does not recursively expand a value that looks like a placeholder", () => {
      expect(
        HtmlWidgetDocument.interpolate("{{a}}", { a: "{{b}}", b: "deep" }),
      ).toBe("{{b}}");
    });

    it("substitutes an empty value", () => {
      expect(HtmlWidgetDocument.interpolate("[{{env}}]", { env: "" })).toBe(
        "[]",
      );
    });
  });

  describe("escapeForStyleElement", () => {
    it("leaves ordinary CSS alone", () => {
      expect(
        HtmlWidgetDocument.escapeForStyleElement("body { color: red; }"),
      ).toBe("body { color: red; }");
    });

    it("returns an empty string for empty input", () => {
      expect(HtmlWidgetDocument.escapeForStyleElement("")).toBe("");
    });

    it("breaks up a closing style tag", () => {
      expect(
        HtmlWidgetDocument.escapeForStyleElement("a{}</style><h1>hi</h1>"),
      ).not.toContain("</style>");
    });

    it("breaks it up whatever the case", () => {
      expect(
        HtmlWidgetDocument.escapeForStyleElement("</STYLE>").toLowerCase(),
      ).not.toContain("</style");
    });

    it("breaks up every occurrence", () => {
      const escaped: string = HtmlWidgetDocument.escapeForStyleElement(
        "</style>a{}</style>",
      );

      expect(escaped).not.toContain("</style");
      expect(escaped.split("<\\/style").length - 1).toBe(2);
    });
  });

  describe("escapeForScriptElement", () => {
    it("leaves ordinary JavaScript alone", () => {
      expect(
        HtmlWidgetDocument.escapeForScriptElement("const a = 1 < 2;"),
      ).toBe("const a = 1 < 2;");
    });

    it("returns an empty string for empty input", () => {
      expect(HtmlWidgetDocument.escapeForScriptElement("")).toBe("");
    });

    it("breaks up a closing script tag inside a string literal", () => {
      const escaped: string = HtmlWidgetDocument.escapeForScriptElement(
        'const s = "</script>";',
      );

      expect(escaped).not.toContain("</script");
      expect(escaped).toBe('const s = "<\\/script>";');
    });

    it("breaks it up whatever the case", () => {
      expect(
        HtmlWidgetDocument.escapeForScriptElement("</ScRiPt>").toLowerCase(),
      ).not.toContain("</script");
    });

    it("breaks up every occurrence", () => {
      expect(
        HtmlWidgetDocument.escapeForScriptElement("</script></script>"),
      ).not.toContain("</script");
    });
  });

  describe("serializeContext", () => {
    const context: HtmlWidgetContext = {
      variables: { env: "prod" },
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-01-02T00:00:00.000Z",
    };

    it("round-trips through JSON.parse unchanged", () => {
      expect(JSON.parse(HtmlWidgetDocument.serializeContext(context))).toEqual(
        context,
      );
    });

    it("emits no raw angle bracket that could open a tag", () => {
      expect(
        HtmlWidgetDocument.serializeContext({
          ...context,
          variables: { env: "</script><img src=x onerror=alert(1)>" },
        }),
      ).not.toContain("<");
    });

    it("keeps the escaped value equal to the original after parsing", () => {
      const hostile: string = "</script><script>alert(1)</script>";

      const parsed: HtmlWidgetContext = JSON.parse(
        HtmlWidgetDocument.serializeContext({
          ...context,
          variables: { env: hostile },
        }),
      );

      expect(parsed.variables["env"]).toBe(hostile);
    });
  });

  describe("getContext", () => {
    it("exposes resolved variables and the time range as ISO strings", () => {
      expect(
        HtmlWidgetDocument.getContext({
          variables: [makeVariable({ name: "env", selectedValue: "prod" })],
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2026-01-02T00:00:00.000Z"),
        }),
      ).toEqual({
        variables: { env: "prod" },
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-01-02T00:00:00.000Z",
      });
    });

    it("reports a missing time range as null rather than omitting it", () => {
      const context: HtmlWidgetContext = HtmlWidgetDocument.getContext({});

      expect(context.startDate).toBeNull();
      expect(context.endDate).toBeNull();
      expect(context.variables).toEqual({});
    });
  });

  describe("build", () => {
    it("produces a complete HTML document", () => {
      const document: string = HtmlWidgetDocument.build({ html: "<p>hi</p>" });

      expect(document.startsWith("<!doctype html>")).toBe(true);
      expect(document).toContain("</html>");
    });

    it("renders the author's markup", () => {
      expect(
        parse(
          HtmlWidgetDocument.build({ html: "<p id='greeting'>hi</p>" }),
        ).querySelector("#greeting")?.textContent,
      ).toBe("hi");
    });

    it("includes the author's CSS", () => {
      expect(
        HtmlWidgetDocument.build({ css: ".widget { color: teal; }" }),
      ).toContain(".widget { color: teal; }");
    });

    /*
     * Links target a new tab because a sandbox without allow-top-navigation
     * blocks same-frame navigation with a console error the author never
     * sees.
     */
    it("targets links at a new tab", () => {
      expect(
        parse(HtmlWidgetDocument.build({ html: "" }))
          .querySelector("base")
          ?.getAttribute("target"),
      ).toBe("_blank");
    });

    it("builds a usable document when nothing is configured", () => {
      const document: Document = parse(HtmlWidgetDocument.build({}));

      expect(document.querySelector("body")).toBeTruthy();
      expect(document.querySelectorAll("script")).toHaveLength(0);
    });

    describe("when scripts are enabled", () => {
      it("includes the author's script", () => {
        expect(
          HtmlWidgetDocument.build({
            javascript: "console.log('ran');",
            allowScripts: true,
          }),
        ).toContain("console.log('ran');");
      });

      it("exposes the dashboard context on window.ONEUPTIME", () => {
        const document: string = HtmlWidgetDocument.build({
          javascript: "",
          allowScripts: true,
          variables: [makeVariable({ name: "env", selectedValue: "prod" })],
        });

        expect(document).toContain("window.ONEUPTIME=");
        expect(document).toContain('"env":"prod"');
      });

      it("declares the context before the author's script runs", () => {
        const document: string = HtmlWidgetDocument.build({
          javascript: "USES_CONTEXT",
          allowScripts: true,
        });

        expect(document.indexOf("window.ONEUPTIME=")).toBeLessThan(
          document.indexOf("USES_CONTEXT"),
        );
      });

      it("keeps a closing script tag in the author's code from ending the element", () => {
        const document: Document = parse(
          HtmlWidgetDocument.build({
            javascript: 'const s = "</script><img src=x onerror=alert(1)>";',
            allowScripts: true,
          }),
        );

        expect(document.querySelector("img")).toBeNull();
        expect(document.querySelectorAll("script")).toHaveLength(2);
      });

      it("keeps a hostile variable value from ending the context script", () => {
        const document: Document = parse(
          HtmlWidgetDocument.build({
            javascript: "",
            allowScripts: true,
            variables: [
              makeVariable({
                name: "env",
                selectedValue: "</script><img src=x onerror=alert(1)>",
              }),
            ],
          }),
        );

        expect(document.querySelector("img")).toBeNull();
        expect(document.querySelectorAll("script")).toHaveLength(2);
      });
    });

    describe("when scripts are disabled", () => {
      /*
       * The sandbox already refuses to execute anything, but leaving the
       * code out of the document keeps it from showing up in view-source as
       * if it were live.
       */
      it("leaves the author's script out of the document entirely", () => {
        const document: string = HtmlWidgetDocument.build({
          javascript: "console.log('should not ship');",
          allowScripts: false,
        });

        expect(document).not.toContain("should not ship");
        expect(parse(document).querySelectorAll("script")).toHaveLength(0);
      });

      it("leaves the context out too", () => {
        expect(
          HtmlWidgetDocument.build({
            javascript: "",
            allowScripts: false,
            variables: [makeVariable({ name: "env", selectedValue: "prod" })],
          }),
        ).not.toContain("window.ONEUPTIME");
      });

      it("still renders the markup and CSS", () => {
        const document: string = HtmlWidgetDocument.build({
          html: "<p id='greeting'>hi</p>",
          css: ".widget { color: teal; }",
          allowScripts: false,
        });

        expect(parse(document).querySelector("#greeting")).toBeTruthy();
        expect(document).toContain(".widget { color: teal; }");
      });
    });

    describe("variable interpolation", () => {
      const variables: Array<DashboardVariable> = [
        makeVariable({ name: "env", selectedValue: "prod" }),
      ];

      it("applies to the markup", () => {
        expect(
          parse(
            HtmlWidgetDocument.build({
              html: "<p id='greeting'>{{env}}</p>",
              variables,
            }),
          ).querySelector("#greeting")?.textContent,
        ).toBe("prod");
      });

      it("applies to the CSS", () => {
        expect(
          HtmlWidgetDocument.build({
            css: ".widget::after { content: '{{env}}'; }",
            variables,
          }),
        ).toContain("content: 'prod';");
      });

      it("applies to the script", () => {
        expect(
          HtmlWidgetDocument.build({
            javascript: "const env = '{{env}}';",
            allowScripts: true,
            variables,
          }),
        ).toContain("const env = 'prod';");
      });
    });

    describe("style element containment", () => {
      it("keeps a closing style tag in the author's CSS from ending the element", () => {
        const document: Document = parse(
          HtmlWidgetDocument.build({
            css: "a{}</style><img src=x onerror=alert(1)>",
          }),
        );

        expect(document.querySelector("img")).toBeNull();
      });
    });
  });
});
