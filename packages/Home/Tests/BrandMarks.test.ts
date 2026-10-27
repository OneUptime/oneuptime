import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Official logos audit, on the marketing site: where a page names another
 * company's product next to a mark, the mark is that product's own - its
 * official one-colour mark (Simple Icons, CC0), drawn whole.
 *
 * The audit found the status page's Slack pill drawing Twitter's bird, three
 * Slack marks drawing a quarter of Slack's (two of its eight shapes), a bell
 * standing for PagerDuty, and generic icons for Prometheus, OpenTelemetry,
 * Graphite, InfluxDB, Kubernetes, Docker, GitHub and Terraform.
 */

const VIEWS: string = path.join(__dirname, "..", "Views");

const SVG_OPEN: string = "<svg";
const SVG_CLOSE: string = "</svg>";
const PATH_DATA: string = ' d="';

function viewFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...viewFiles(full));
    } else if (entry.name.endsWith(".ejs")) {
      files.push(full);
    }
  }

  return files;
}

interface DrawnSvg {
  start: number;
  end: number;
  paths: Array<string>;
}

// Every <svg> a view draws, and the path data of each of its paths.
function svgsIn(text: string): Array<DrawnSvg> {
  const drawn: Array<DrawnSvg> = [];
  let start: number = text.indexOf(SVG_OPEN);

  while (start !== -1) {
    const close: number = text.indexOf(SVG_CLOSE, start);

    if (close === -1) {
      break;
    }

    const markup: string = text.slice(start, close);
    const paths: Array<string> = [];
    let at: number = markup.indexOf(PATH_DATA);

    while (at !== -1) {
      const valueStart: number = at + PATH_DATA.length;
      const valueEnd: number = markup.indexOf('"', valueStart);
      paths.push(markup.slice(valueStart, valueEnd));
      at = markup.indexOf(PATH_DATA, valueEnd);
    }

    drawn.push({ start, end: close + SVG_CLOSE.length, paths });
    start = text.indexOf(SVG_OPEN, close);
  }

  return drawn;
}

// The subpaths of a path: each starts at a move command.
function subpathStarts(pathData: string): Array<string> {
  const starts: Array<string> = [];
  let current: string = "";

  for (const character of pathData) {
    if ((character === "M" || character === "m") && current.trim()) {
      starts.push(current.trim().slice(0, 14));
      current = "";
    }

    current += character;
  }

  if (current.trim()) {
    starts.push(current.trim().slice(0, 14));
  }

  return starts;
}

// Slack's mark: its eight shapes, as Simple Icons drew it (CC0).
const SLACK: string =
  "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z";

// Twitter's bird, which the status page's Slack pill drew.
const TWITTER_BIRD_START: string = "M22.46 6c-.85.38-1.78.64-2.75.76";

const FILES: Array<string> = viewFiles(VIEWS);
const TEXTS: Map<string, string> = new Map(
  FILES.map((file: string): [string, string] => {
    return [file, fs.readFileSync(file, "utf8")];
  }),
);

function viewText(relative: string): string {
  const text: string | undefined = TEXTS.get(path.join(VIEWS, relative));

  if (text === undefined) {
    throw new Error(`No view ${relative}`);
  }

  return text;
}

// The first path of the mark drawn right before a label, in a view.
function markBefore(relative: string, label: string): string {
  const text: string = viewText(relative);
  const labelAt: number = text.indexOf(label);

  if (labelAt === -1) {
    throw new Error(`No "${label}" in ${relative}`);
  }

  const svg: DrawnSvg | undefined = svgsIn(text)
    .filter((candidate: DrawnSvg): boolean => {
      return candidate.end <= labelAt;
    })
    .pop();

  if (!svg) {
    throw new Error(`No mark before "${label}" in ${relative}`);
  }

  return svg.paths[0] || "";
}

describe("brand marks on the marketing site", () => {
  test("the walk reads the views, so the rules below are not vacuous", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  test("every Slack mark is Slack's whole mark: all eight of its shapes", () => {
    const wanted: Array<string> = subpathStarts(SLACK);
    const partial: Array<string> = [];
    let marks: number = 0;

    for (const [file, text] of TEXTS) {
      for (const svg of svgsIn(text)) {
        const drawn: Array<string> = svg.paths.flatMap(subpathStarts);

        if (!drawn.includes(wanted[0]!)) {
          continue;
        }

        marks++;

        if (
          !wanted.every((start: string): boolean => {
            return drawn.includes(start);
          })
        ) {
          partial.push(
            `${path.relative(VIEWS, file)}:${text.slice(0, svg.start).split("\n").length}`,
          );
        }
      }
    }

    expect(marks).toBeGreaterThan(40);
    expect(partial).toEqual([]);
  });

  test("no page draws Twitter's bird: it stood for Slack on the status page", () => {
    const birds: Array<string> = [];

    for (const [file, text] of TEXTS) {
      if (text.includes(TWITTER_BIRD_START)) {
        birds.push(path.relative(VIEWS, file));
      }
    }

    expect(birds).toEqual([]);
  });

  test.each([
    // The status page's subscriber channels.
    ["status-page.ejs", "\n                    Slack\n", "M5.042 15.165"],
    // The metrics page's alert channels and metric sources.
    ["metrics.ejs", "\n                          Slack\n", "M5.042 15.165"],
    ["metrics.ejs", "\n                          PagerDuty\n", "M16.965 1.18C15"],
    ["metrics.ejs", ">Prometheus</div>", "M12 0C5.373 0 0"],
    ["metrics.ejs", ">OTel</div>", "M12.6974 13.1173"],
    ["metrics.ejs", ">Graphite</div>", "m15.215 0-12 3.2"],
    ["metrics.ejs", ">InfluxDB</div>", "M23.778 14.482l-"],
    // The logs page's sources.
    ["logs-management.ejs", ">Kubernetes</div>", "M10.204 14.35l.0"],
    ["logs-management.ejs", ">Docker</div>", "M13.983 11.078h2"],
    // The AI agent's GitHub card and the developers' Terraform card.
    ["ai-agent.ejs", ">GitHub Integration</h3>", "M12 .297c-6.63 0"],
    ["solutions/developers.ejs", ">Terraform Provider</h3>", "M1.44 0v7.575l6."],
  ])(
    "%s: %j is drawn with the brand's own mark",
    (view: string, label: string, pathStart: string) => {
      expect(markBefore(view, label).startsWith(pathStart)).toBe(true);
    },
  );
});
