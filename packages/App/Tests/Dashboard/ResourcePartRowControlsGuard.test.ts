// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A ROW THAT OPENS A PAGE HOLDS NO CONTROL OF ITS OWN INSIDE ITS LINK
 * (#9728).
 *
 * ResourcePartRow draws a row that opens a page as one link, the whole row:
 * a wide target, a tint, a chevron. The OpenStack Regions card drew a
 * region's health and its (i) - a button - inside that link, and a pill
 * that opens why could not be one: a control inside a link is lost to a
 * screen reader, which reads the link's content as its name and offers
 * nothing inside it, and a press on the inner control is the link's too.
 * NestedControlsGuard reads the source by element, and cannot see that a
 * ResourcePartRow handed `to` is a link, or that InfoTooltip and the pills
 * draw buttons. This reads every Dashboard ResourcePartRow that is a link:
 * nothing in it is a control. A row with controls of its own says so
 * (`hasControls`): its name is then its link (ResourcePartRowName),
 * stretched over the row, and its controls sit beside the name
 * (ResourcePartRowControls).
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

// What draws a control, by the name a file writes its element with.
const CONTROL_ELEMENTS: ReadonlyArray<string> = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "Button",
  "Link",
  "InfoTooltip",
  "ResourceAttentionPill",
  "ResourceHealthPill",
  "MoreMenu",
  "Toggle",
  "Dropdown",
  "CopyTextButton",
];

const CONTROL: RegExp = new RegExp(`<(${CONTROL_ELEMENTS.join("|")})\\b`, "g");

interface RowFinding {
  file: string;
  line: number;
  // What it found: a control inside a link, or a row with controls and no name to link.
  problem: string;
}

// The end of a JSX element's opening tag, braces and all.
function openingTagEnd(source: string, start: number): number {
  let depth: number = 0;
  for (let index: number = start; index < source.length; index++) {
    const char: string = source[index]!;
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
    } else if (char === ">" && depth === 0) {
      return index;
    }
  }
  return -1;
}

function findRowsHoldingControls(
  file: string,
  source: string,
): Array<RowFinding> {
  const findings: Array<RowFinding> = [];
  const opening: RegExp = /<ResourcePartRow\b/g;
  let match: RegExpExecArray | null = opening.exec(source);

  while (match) {
    const start: number = match.index;
    const tagEnd: number = openingTagEnd(source, start);
    const close: number = source.indexOf("</ResourcePartRow>", start);
    const line: number = source.slice(0, start).split("\n").length;

    if (tagEnd >= 0 && close > tagEnd) {
      const tag: string = source.slice(start, tagEnd + 1);
      const body: string = source.slice(tagEnd + 1, close);
      const isLink: boolean = (/\bto=/).test(tag);
      const hasControls: boolean = (/\bhasControls\b/).test(tag);

      if (isLink && !hasControls) {
        const controls: Array<string> = Array.from(
          new Set(
            Array.from(body.matchAll(CONTROL)).map(
              (found: RegExpMatchArray): string => {
                return found[1] as string;
              },
            ),
          ),
        );
        if (controls.length > 0) {
          findings.push({
            file: file,
            line: line,
            problem: `a whole-row link holds ${controls.join(", ")}`,
          });
        }
      }

      if (hasControls && !body.includes("<ResourcePartRowName")) {
        findings.push({
          file: file,
          line: line,
          problem: "a row with controls of its own draws no name to link",
        });
      }
    }

    match = opening.exec(source);
  }

  return findings;
}

function dashboardFiles(dir: string): Array<string> {
  const found: Array<string> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...dashboardFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

describe("the detector", () => {
  test("finds a control inside a row that is one link, as the Regions card drew its health", () => {
    expect(
      findRowsHoldingControls(
        "Example.tsx",
        [
          "<ResourcePartRow to={route} className={`row ${a > b ? 'x' : ''}`}>",
          "  <span>RegionTwo</span>",
          '  <InfoTooltip label="Region health" text={text} />',
          "</ResourcePartRow>",
        ].join("\n"),
      ).map((finding: RowFinding): string => {
        return finding.problem;
      }),
    ).toEqual(["a whole-row link holds InfoTooltip"]);
  });

  test("a row that opens no page, or that says it holds controls beside its name, is no finding", () => {
    expect(
      findRowsHoldingControls(
        "Example.tsx",
        [
          "<ResourcePartRow dataTestId='plain'>",
          "  <Button title='Remove' />",
          "</ResourcePartRow>",
          "<ResourcePartRow to={route} hasControls={true}>",
          "  <ResourcePartRowName>RegionTwo</ResourcePartRowName>",
          "  <ResourcePartRowControls><ResourceHealthPill /></ResourcePartRowControls>",
          "</ResourcePartRow>",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a row with controls of its own and no name to link is a finding", () => {
    expect(
      findRowsHoldingControls(
        "Example.tsx",
        [
          "<ResourcePartRow to={route} hasControls={true}>",
          "  <span>RegionTwo</span>",
          "</ResourcePartRow>",
        ].join("\n"),
      ).map((finding: RowFinding): string => {
        return finding.problem;
      }),
    ).toEqual(["a row with controls of its own draws no name to link"]);
  });
});

describe("the Dashboard's rows that open a page", () => {
  test("hold no control of their own inside their link", () => {
    const findings: Array<string> = [];
    for (const file of dashboardFiles(DASHBOARD_SRC)) {
      const source: string = fs.readFileSync(file, "utf8");
      if (!source.includes("<ResourcePartRow")) {
        continue;
      }
      for (const finding of findRowsHoldingControls(
        path.relative(DASHBOARD_SRC, file),
        source,
      )) {
        findings.push(`${finding.file}:${finding.line}: ${finding.problem}`);
      }
    }
    expect(findings).toEqual([]);
  });

  test("the Regions card is a row with controls of its own", () => {
    const card: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components/OpenStack/OpenStackRegionsCard.tsx"),
      "utf8",
    );
    expect(card).toContain("hasControls={true}");
    expect(card).toContain("<ResourcePartRowName");
    expect(card).toContain("<ResourcePartRowControls");
  });
});
