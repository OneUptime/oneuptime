import Dictionary from "../../Types/Dictionary";
import DashboardVariable from "../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "./VariableInterpolation";

/*
 * Builds the document that the HTML widget renders inside its iframe.
 *
 * Everything here is a pure string transform so the security-critical parts
 * — the sandbox attribute and the escaping — can be tested without a browser.
 * The React side (DashboardHtmlComponent.tsx) does nothing but hand the
 * result to <iframe srcDoc> and sandbox.
 *
 * THE SECURITY MODEL, in one paragraph. The widget body is arbitrary
 * author-supplied HTML/CSS/JS, and a dashboard carrying it can be published
 * to an anonymous audience (App/FeatureSet/PublicDashboard re-exports the
 * same canvas, so every widget type is public the moment it is registered).
 * The public dashboard is served from the same origin as /dashboard and
 * /api, so script running with that origin could call the API with the
 * viewer's cookie session. The whole boundary is therefore the sandbox
 * attribute: the iframe gets `allow-scripts` and NEVER `allow-same-origin`,
 * which puts the document on an opaque origin with no access to the parent
 * DOM, the parent's cookies, or its localStorage. `allow-same-origin` and
 * `allow-scripts` together are equivalent to no sandbox at all — a document
 * with both can reach up and remove its own sandbox attribute — so the two
 * are never emitted together, and getSandboxAttribute() has no input that
 * produces `allow-same-origin`.
 *
 * Internal/Roadmap/SessionReplay.md argues against `allow-scripts` without
 * `allow-same-origin`; that conclusion is specific to session replay, where
 * the rrweb Replayer runs in the PARENT and writes into contentDocument, so
 * it needs same-origin access and no script execution. This widget is the
 * exact inverse: nothing in the parent touches the document, and running the
 * author's script is the entire feature.
 */

/*
 * The sandbox tokens the author can turn on. `allow-same-origin` is
 * deliberately absent and must stay absent.
 */
export interface HtmlWidgetSandboxPermissions {
  allowScripts?: boolean | undefined;
  allowForms?: boolean | undefined;
  allowPopups?: boolean | undefined;
}

export interface HtmlWidgetDocumentOptions
  extends HtmlWidgetSandboxPermissions {
  html?: string | undefined;
  css?: string | undefined;
  javascript?: string | undefined;
  variables?: Array<DashboardVariable> | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
}

/* Shape of `window.ONEUPTIME` inside the iframe. */
export interface HtmlWidgetContext {
  variables: Dictionary<string>;
  startDate: string | null;
  endDate: string | null;
}

/*
 * Placeholder syntax for dashboard variables: {{name}}, with optional inner
 * whitespace. Matching on the template (rather than building a pattern per
 * variable name) means a variable whose name contains regex metacharacters
 * can never widen the match.
 */
const VARIABLE_PLACEHOLDER: RegExp = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/*
 * The reset the author's CSS builds on. Transparent by default so the widget
 * blends into the dashboard card, which is white and has its own rounded
 * border; an author who wants a filled widget sets `body { background: ... }`
 * in their own CSS and wins on cascade order, because their <style> is
 * emitted after this one.
 */
const BASE_CSS: string = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; background: transparent; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #374151;
  overflow: auto;
  -webkit-font-smoothing: antialiased;
}
`;

export default class HtmlWidgetDocument {
  /*
   * The iframe's sandbox attribute.
   *
   * Built by adding tokens to an empty string rather than by removing them
   * from a permissive default, so a new option can only ever widen the
   * sandbox on purpose. `allow-popups-to-escape-sandbox` rides along with
   * `allow-popups` because a popup that inherits the opaque origin loads as
   * a blank sandboxed document — a link to a runbook would appear broken.
   * The escaped popup is an ordinary top-level tab with a URL the viewer can
   * see, which is what a link is.
   */
  public static getSandboxAttribute(
    permissions: HtmlWidgetSandboxPermissions,
  ): string {
    const tokens: Array<string> = [];

    if (permissions.allowScripts) {
      tokens.push("allow-scripts");
    }

    if (permissions.allowForms) {
      tokens.push("allow-forms");
    }

    if (permissions.allowPopups) {
      tokens.push("allow-popups");
      tokens.push("allow-popups-to-escape-sandbox");
    }

    return tokens.join(" ");
  }

  /*
   * Dashboard variables flattened to name → value for templating.
   *
   * Resolution is delegated to DashboardVariableInterpolation so this widget
   * agrees with every query-driven widget about what a variable currently
   * means (selected value, else default, else nothing). Multi-select joins
   * with "," because that is the form an author would paste into a filter.
   */
  public static resolveVariables(
    variables: Array<DashboardVariable> | undefined,
  ): Dictionary<string> {
    const values: Dictionary<string> = {};

    if (!variables || variables.length === 0) {
      return values;
    }

    for (const variable of variables) {
      if (!variable.name) {
        continue;
      }

      const resolved: ResolvedVariableValue | undefined =
        DashboardVariableInterpolation.resolveValue(variable);

      if (!resolved) {
        values[variable.name] = "";
        continue;
      }

      if (resolved.multi && resolved.multi.length > 0) {
        values[variable.name] = resolved.multi.join(",");
        continue;
      }

      values[variable.name] = resolved.scalar ?? "";
    }

    return values;
  }

  /*
   * Substitutes {{name}} placeholders.
   *
   * A placeholder naming a variable that does not exist is left alone rather
   * than blanked: the author is far more likely to have written literal
   * braces (a template literal in their own JS, a Handlebars snippet they
   * are generating) than to have referenced a variable that was deleted, and
   * silently deleting their text is the worse failure.
   *
   * Values are substituted raw, exactly as the metrics widgets substitute
   * them into queries. Escaping is not a security control here — the
   * document is already an opaque-origin sandbox running the author's own
   * script — and escaping would break the common `<div style="color:
   * {{color}}">` case. Authors who need a value inside JS should read
   * window.ONEUPTIME.variables, which is JSON and always well-formed.
   */
  public static interpolate(
    template: string,
    values: Dictionary<string>,
  ): string {
    if (!template) {
      return "";
    }

    return template.replace(
      VARIABLE_PLACEHOLDER,
      (match: string, name: string): string => {
        const value: string | undefined = values[name];
        return value === undefined ? match : value;
      },
    );
  }

  /*
   * Neutralizes the sequence that would end the <style> element early.
   *
   * `\/` is a valid CSS escape for `/` in every context a declaration or
   * selector can appear in, and inside a comment the backslash is just text,
   * so the author's CSS keeps its meaning while the HTML tokenizer stops
   * seeing a closing tag.
   */
  public static escapeForStyleElement(css: string): string {
    if (!css) {
      return "";
    }

    return css.replace(/<\/style/gi, "<\\/style");
  }

  /*
   * Same idea for <script>. `<\/script` is the standard inline-script
   * escape (it is what bundlers emit) and is meaning-preserving wherever the
   * sequence can legally occur in JS — inside a string, template literal, or
   * regex.
   *
   * Not covered: `<!--<script` in the author's source, which puts the
   * tokenizer into the double-escaped state where `</script>` no longer
   * closes the element. Writing that requires legacy HTML-like JS comments,
   * and the blast radius is the author's own widget rendering wrong inside
   * its sandbox — not a privilege boundary.
   */
  public static escapeForScriptElement(javascript: string): string {
    if (!javascript) {
      return "";
    }

    return javascript.replace(/<\/script/gi, "<\\/script");
  }

  /*
   * JSON for embedding in a <script> body. Every `<` is rewritten to its
   * \\u003c escape, which is the same string to a JSON parser but cannot
   * start a tag, so no variable value can terminate the element. In JSON a
   * `<` only ever appears inside a string, so the rewrite is lossless.
   */
  public static serializeContext(context: HtmlWidgetContext): string {
    return JSON.stringify(context).replace(/</g, "\\u003c");
  }

  public static getContext(
    options: HtmlWidgetDocumentOptions,
  ): HtmlWidgetContext {
    return {
      variables: HtmlWidgetDocument.resolveVariables(options.variables),
      startDate: options.startDate ? options.startDate.toISOString() : null,
      endDate: options.endDate ? options.endDate.toISOString() : null,
    };
  }

  /* The complete srcdoc for the widget's iframe. */
  public static build(options: HtmlWidgetDocumentOptions): string {
    const values: Dictionary<string> = HtmlWidgetDocument.resolveVariables(
      options.variables,
    );

    const html: string = HtmlWidgetDocument.interpolate(
      options.html || "",
      values,
    );
    const css: string = HtmlWidgetDocument.escapeForStyleElement(
      HtmlWidgetDocument.interpolate(options.css || "", values),
    );
    const javascript: string = HtmlWidgetDocument.escapeForScriptElement(
      HtmlWidgetDocument.interpolate(options.javascript || "", values),
    );

    /*
     * Both script blocks are omitted entirely when scripts are off. The
     * sandbox already refuses to execute them, but emitting a <script> the
     * browser ignores would leave the author's code visible in view-source
     * and make "why isn't this running" harder to answer than it needs to
     * be.
     */
    const scripts: string = options.allowScripts
      ? `<script>window.ONEUPTIME=${HtmlWidgetDocument.serializeContext(
          HtmlWidgetDocument.getContext(options),
        )};</script>\n<script>\n${javascript}\n</script>`
      : "";

    /*
     * `<base target="_blank">` keeps a plain <a href> from trying to
     * navigate the frame itself, which a sandbox without
     * allow-top-navigation would block with a console error the author
     * cannot see.
     */
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base target="_blank" />
<style>${BASE_CSS}</style>
<style>
${css}
</style>
</head>
<body>
${html}
${scripts}
</body>
</html>`;
  }
}
