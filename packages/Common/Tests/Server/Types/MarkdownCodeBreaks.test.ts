import { describe, expect, test } from "@jest/globals";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import addCodeBreakOpportunities, {
  CODE_BREAK,
  CODE_BREAK_MIN_RUN,
} from "../../../Server/Types/MarkdownCodeBreaks";
import { slugifyMarkdownHeading } from "../../../Server/Types/MarkdownSlugify";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * A long code span in the docs wraps between its parts: before the dots of a
 * Helm value, after the underscores of an environment variable, after the
 * slashes of a path. It broke mid-word on phones (#5090's review), and the
 * environment-variable tables of three self-hosted guides scrolled sideways
 * at 1280px for want of anywhere to break (#5220's review).
 */

const withoutBreaks: (html: string) => string = (html: string): string => {
  return html.split(CODE_BREAK).join("");
};

const docs: (markdown: string) => Promise<string> = (
  markdown: string,
): Promise<string> => {
  return Markdown.convertToHTML(markdown, MarkdownContentType.Docs);
};

describe("addCodeBreakOpportunities", () => {
  test("a Helm value breaks before each dot between two names", () => {
    expect(
      addCodeBreakOpportunities("vapid.existingSecret.privateKeyKey"),
    ).toBe("vapid<wbr>.existingSecret<wbr>.privateKeyKey");
    expect(addCodeBreakOpportunities("microsoftTeamsApp.clientSecret")).toBe(
      "microsoftTeamsApp<wbr>.clientSecret",
    );
  });

  test("an environment variable breaks after each underscore between two words", () => {
    expect(addCodeBreakOpportunities("MICROSOFT_TEAMS_APP_CLIENT_SECRET")).toBe(
      "MICROSOFT_<wbr>TEAMS_<wbr>APP_<wbr>CLIENT_<wbr>SECRET",
    );
  });

  test("a path breaks after each slash before a name, an address after its //", () => {
    expect(
      addCodeBreakOpportunities("/api/microsoft-teams/admin-consent/callback"),
    ).toBe("/api/<wbr>microsoft-teams/<wbr>admin-consent/<wbr>callback");
    expect(
      addCodeBreakOpportunities(
        "https://your-oneuptime-domain.com/api/github/webhook",
      ),
    ).toBe(
      "https://<wbr>your-oneuptime-domain<wbr>.com/<wbr>api/<wbr>github/<wbr>webhook",
    );
  });

  test("a template value breaks at its dot, its braces stay with it", () => {
    expect(addCodeBreakOpportunities("{{monitorSecrets.NAME}}")).toBe(
      "{{monitorSecrets<wbr>.NAME}}",
    );
  });

  test(`a run shorter than ${CODE_BREAK_MIN_RUN} characters is left whole: it fits a line and a column`, () => {
    for (const short of [
      "helm",
      "config.env",
      "probe-1",
      "slackApp.clientId",
      "SLACK_APP_CLIENT_ID",
      "a".repeat(CODE_BREAK_MIN_RUN - 3) + ".b",
    ]) {
      expect(Array.from(short).length).toBeLessThan(CODE_BREAK_MIN_RUN);
      expect(addCodeBreakOpportunities(short)).toBe(short);
    }

    const atTheLimit: string = "a".repeat(CODE_BREAK_MIN_RUN - 3) + ".bc";
    expect(Array.from(atTheLimit).length).toBe(CODE_BREAK_MIN_RUN);
    expect(addCodeBreakOpportunities(atTheLimit)).toContain(CODE_BREAK);
  });

  test("each run is measured on its own: spaces split a command into runs", () => {
    expect(
      addCodeBreakOpportunities(
        "helm upgrade --set vapid.existingSecret.name=oneuptime-vapid",
      ),
    ).toBe(
      "helm upgrade --set vapid<wbr>.existingSecret<wbr>.name=oneuptime-vapid",
    );
    expect(addCodeBreakOpportunities("oneuptime &lt;resource&gt; list")).toBe(
      "oneuptime &lt;resource&gt; list",
    );
  });

  test("punctuation that does not sit between two names is left alone", () => {
    for (const run of [
      "__proto__________________",
      "...........................",
      "/leading/slash-then-a-long-name",
      "a-long-sentence-that-ends-with-a-dot.",
      ".hidden-file-with-a-long-name",
      "double__underscore__between__words",
    ]) {
      const result: string = addCodeBreakOpportunities(run);

      expect(withoutBreaks(result)).toBe(run);
      expect(result.startsWith(CODE_BREAK)).toBe(false);
      expect(result.endsWith(CODE_BREAK)).toBe(false);
    }

    expect(addCodeBreakOpportunities("__proto__________________")).toBe(
      "__proto__________________",
    );
    expect(addCodeBreakOpportunities("...........................")).toBe(
      "...........................",
    );
    expect(
      addCodeBreakOpportunities("double__underscore__between__words"),
    ).toBe("double__underscore__between__words");
    // The first slash, with nothing before it, keeps the next name.
    expect(addCodeBreakOpportunities("/leading/slash-then-a-long-name")).toBe(
      "/leading/<wbr>slash-then-a-long-name",
    );
  });

  test("an entity is one character, never split, and counted as one", () => {
    const escaped: string = "&lt;release&gt;.existingSecret.privateKeyKey";

    expect(addCodeBreakOpportunities(escaped)).toBe(
      // The dot after "&gt;" is not between two names: no break there.
      "&lt;release&gt;.existingSecret<wbr>.privateKeyKey",
    );

    // 19 characters as read, although 25 as escaped: left whole.
    const shortWhenRead: string = "&quot;a.b&quot;&amp;&lt;&gt;xyz";
    expect(Array.from('"a.b"&<>xyz').length).toBeLessThan(CODE_BREAK_MIN_RUN);
    expect(addCodeBreakOpportunities(shortWhenRead)).toBe(shortWhenRead);
  });

  test("letters of any script count as names", () => {
    expect(addCodeBreakOpportunities("überwachung.geheimnisse.schlüssel")).toBe(
      "überwachung<wbr>.geheimnisse<wbr>.schlüssel",
    );
  });

  /*
   * Property: whatever the text, a break adds no character, never lands in
   * an entity, never in a run shorter than the minimum, and only beside a
   * dot, an underscore or a slash.
   */
  test("on 20,000 generated texts: the text is unchanged but for <wbr>, placed only where the rules say", () => {
    const ALPHABET: Array<string> = [
      "a",
      "Z",
      "7",
      "é",
      ".",
      "_",
      "/",
      "-",
      " ",
      "&lt;",
      "&amp;",
      "&#39;",
      "&",
      ";",
      "{{",
      "}}",
      "ab",
    ];

    for (const text of generatedTexts(20000, 5090, ALPHABET, 40)) {
      const result: string = addCodeBreakOpportunities(text);

      expect(withoutBreaks(result)).toBe(text);

      const pieces: Array<string> = result.split(CODE_BREAK);
      for (let index: number = 1; index < pieces.length; index++) {
        const before: string = pieces[index - 1]!;
        const after: string = pieces[index]!;
        const placed: boolean =
          after.startsWith(".") || before.endsWith("_") || before.endsWith("/");

        /*
         * Beside a dot, an underscore or a slash, none of which an entity
         * holds, so never inside one.
         */
        expect(`${text} -> ${result}: ${placed}`).toBe(
          `${text} -> ${result}: true`,
        );
      }

      // Only a run long enough to need it: as escaped it is at least as long.
      for (const run of result.split(" ")) {
        if (run.includes(CODE_BREAK)) {
          expect(Array.from(withoutBreaks(run)).length).toBeGreaterThanOrEqual(
            CODE_BREAK_MIN_RUN,
          );
        }
      }
    }
  });

  test("400,000 characters of its worst case take well under two seconds", () => {
    const worstCase: string = "a.b_c/".repeat(400000 / 6);

    const run: FastestRun<string> = fastestRun({
      run: (): string => {
        return addCodeBreakOpportunities(worstCase);
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(withoutBreaks(run.result)).toBe(worstCase);
  });
});

describe("the docs renderer", () => {
  test("a long code span in a paragraph gets its breaks", async () => {
    const html: string = await docs(
      "Set `vapid.existingSecret.privateKeyKey` to the key's name.",
    );

    expect(html).toContain(
      '<code class="docs-code-inline">vapid<wbr>.existingSecret<wbr>.privateKeyKey</code>',
    );
  });

  test("an environment-variable table's code can narrow its columns", async () => {
    const html: string = await docs(
      [
        "| Docker Compose (`config.env`) | Helm (`values.yaml`) | Value |",
        "| --- | --- | --- |",
        "| `MICROSOFT_TEAMS_APP_CLIENT_SECRET` | `microsoftTeamsApp.clientSecret` | The client secret's **Value**. |",
      ].join("\n"),
    );

    expect(html).toContain(
      '<code class="docs-code-inline">MICROSOFT_<wbr>TEAMS_<wbr>APP_<wbr>CLIENT_<wbr>SECRET</code>',
    );
    expect(html).toContain(
      '<code class="docs-code-inline">microsoftTeamsApp<wbr>.clientSecret</code>',
    );
    // Short ones in the header are drawn as before.
    expect(html).toContain('<code class="docs-code-inline">config.env</code>');
  });

  test("a heading keeps its anchor: the breaks are markup, not text", async () => {
    const heading: string =
      "## Set `vapid.existingSecret.privateKeyKey` for your release";
    const html: string = await docs(heading);
    const anchor: string = slugifyMarkdownHeading(heading.replace(/^## /, ""));

    expect(anchor).toBe(
      "set-vapidexistingsecretprivatekeykey-for-your-release",
    );
    expect(html).toContain(`id="${anchor}"`);
    expect(html).toContain("vapid<wbr>.existingSecret");
  });

  test("a code block is copied as written: blocks get no breaks", async () => {
    const html: string = await docs(
      "```bash\nhelm upgrade --set vapid.existingSecret.privateKeyKey=privateKey\n```",
    );

    expect(html).not.toContain(CODE_BREAK);
  });

  test("the blog and email renderers are unchanged", async () => {
    const markdown: string = "Set `vapid.existingSecret.privateKeyKey` now.";

    expect(
      await Markdown.convertToHTML(markdown, MarkdownContentType.Blog),
    ).not.toContain(CODE_BREAK);
    expect(
      await Markdown.convertToHTML(markdown, MarkdownContentType.Email),
    ).not.toContain(CODE_BREAK);
  });
});
