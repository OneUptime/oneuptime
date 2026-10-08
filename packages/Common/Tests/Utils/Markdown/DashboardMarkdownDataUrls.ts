import childProcess from "child_process";
import path from "path";

/*
 * Where the dashboard's Markdown parser finds the images, links, autolinks
 * and link reference definitions whose address is a data: URL. The
 * dashboard (react-markdown with remark-gfm) and Slack's conversion
 * (slackify-markdown) both read Markdown with micromark and its GitHub
 * extensions; Jest does not load micromark's ES modules, so it is run here in
 * a child process: mdast-util-from-markdown with micromark-extension-gfm,
 * which gives every node where it is in the text.
 *
 * A reference ("![alt][label]", "[text]") is reported with the definition's
 * address. A definition ends, in micromark, where its destination or title
 * does; MarkdownDataUrls ends one at the end of its line, so callers compare
 * a definition by where it starts.
 *
 * Every text is read in one process, so a suite passes them all at once.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const FIND_SCRIPT: string = `
  import { fromMarkdown } from "mdast-util-from-markdown";
  import { gfm } from "micromark-extension-gfm";
  import { gfmFromMarkdown } from "mdast-util-gfm";

  const walk = (node, visit) => {
    visit(node);
    for (const child of node.children || []) {
      walk(child, visit);
    }
  };

  let input = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    const texts = JSON.parse(input);

    const results = texts.map((text) => {
      const tree = fromMarkdown(text, {
        extensions: [gfm()],
        mdastExtensions: [gfmFromMarkdown()],
      });
      const definitions = new Map();

      walk(tree, (node) => {
        if (node.type === "definition" && !definitions.has(node.identifier)) {
          definitions.set(node.identifier, node);
        }
      });

      const uses = [];

      walk(tree, (node) => {
        let url = null;
        let kind = null;

        if (node.type === "image") {
          url = node.url;
          kind = "Image";
        } else if (node.type === "imageReference") {
          url = definitions.get(node.identifier)?.url ?? null;
          kind = "Image";
        } else if (node.type === "link") {
          url = node.url;
          kind = text[node.position.start.offset] === "<" ? "Autolink" : "Link";
        } else if (node.type === "linkReference") {
          url = definitions.get(node.identifier)?.url ?? null;
          kind = "Link";
        } else if (node.type === "definition") {
          url = node.url;
          kind = "Definition";
        }

        if (kind && url !== null && /^data:/i.test(url)) {
          uses.push({
            kind: kind,
            start: node.position.start.offset,
            end: node.position.end.offset,
          });
        }
      });

      return uses;
    });

    process.stdout.write(JSON.stringify(results));
  });
`;

export interface DashboardDataUrlUse {
  kind: "Image" | "Link" | "Autolink" | "Definition";
  start: number;
  end: number;
}

export type DataUrlUsesAsDashboardFunction = (
  texts: Array<string>,
) => Array<Array<DashboardDataUrlUse>>;

// What the dashboard's parser finds in each text, in order.
export const dataUrlUsesAsDashboard: DataUrlUsesAsDashboardFunction = (
  texts: Array<string>,
): Array<Array<DashboardDataUrlUse>> => {
  return JSON.parse(
    childProcess.execFileSync(
      process.execPath,
      ["--input-type=module", "-e", FIND_SCRIPT],
      {
        cwd: COMMON_ROOT,
        input: JSON.stringify(texts),
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 256 * 1024 * 1024,
      },
    ),
  ) as Array<Array<DashboardDataUrlUse>>;
};
