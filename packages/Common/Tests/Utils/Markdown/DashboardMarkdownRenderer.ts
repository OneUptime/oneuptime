import childProcess from "child_process";
import path from "path";

/*
 * What the dashboard makes of a text. The dashboard renders Markdown with
 * react-markdown and remark-gfm, which read it with micromark and its GitHub
 * extensions - footnotes, tables, autolink literals and strikethrough - and
 * it does not always read a text as marked (the emails) does. Jest stubs
 * react-markdown and remark-gfm, whose ES modules this suite does not load,
 * so the same parser is run here in a child process instead: micromark with
 * micromark-extension-gfm, compiled to HTML. Raw HTML comes out escaped, as
 * the dashboard shows it; images, links and a code block's language class
 * come out as the dashboard's would.
 *
 * Every text is rendered in one process, so a suite passes them all at once.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const RENDER_SCRIPT: string = `
  import { micromark } from "micromark";
  import { gfm, gfmHtml } from "micromark-extension-gfm";

  let input = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    const texts = JSON.parse(input);

    process.stdout.write(
      JSON.stringify(
        texts.map((text) => {
          return micromark(text, {
            extensions: [gfm()],
            htmlExtensions: [gfmHtml()],
          });
        }),
      ),
    );
  });
`;

export type RenderAsDashboardFunction = (texts: Array<string>) => Array<string>;

// The HTML the dashboard's parser makes of each text, in order.
export const renderAsDashboard: RenderAsDashboardFunction = (
  texts: Array<string>,
): Array<string> => {
  return JSON.parse(
    childProcess.execFileSync(
      process.execPath,
      ["--input-type=module", "-e", RENDER_SCRIPT],
      {
        cwd: COMMON_ROOT,
        input: JSON.stringify(texts),
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 64 * 1024 * 1024,
      },
    ),
  ) as Array<string>;
};

export type HrefsOfFunction = (html: string) => Array<string>;

// Every link's address in the HTML, with its HTML escapes undone.
export const hrefsOf: HrefsOfFunction = (html: string): Array<string> => {
  return Array.from(html.matchAll(/href="([^"]*)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    },
  );
};
