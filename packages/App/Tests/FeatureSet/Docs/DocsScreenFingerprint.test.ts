import {
  compareFingerprints,
  DocsScreenFingerprint,
  DocsScreensCheck,
  REGENERATE_COMMAND,
  SIZE_TOLERANCE_PIXELS,
  SIZE_TOLERANCE_RATIO,
  staleIssueBody,
} from "../../../FeatureSet/Docs/Screens/DocsScreenFingerprint";
import { describe, expect, it } from "@jest/globals";

/*
 * Whether a docs screenshot still shows its page (#6823,
 * Docs/Screens/DocsScreenFingerprint.ts): a page whose words, outline or
 * size changed is noticed, one that did not - drawn again on another
 * machine, a pixel taller - is not; and the one issue the job on main keeps
 * says which shots, in which languages, and what to run.
 */

const DRAWN: DocsScreenFingerprint = {
  text: [
    "1",
    "Who should be told?",
    "Who is paged",
    "Add teammates",
    "Ada Lovelace",
    "Save and continue",
  ],
  outline: [
    "heading: Who should be told?",
    "button: Add teammates",
    "button: Save and continue",
  ],
  width: 780,
  height: 314,
};

describe("a shot whose page did not change", () => {
  it("is current, read again word for word", () => {
    expect(compareFingerprints(DRAWN, { ...DRAWN })).toEqual([]);
  });

  it("is current a few pixels off, as another machine's fonts draw it", () => {
    expect(
      compareFingerprints(DRAWN, {
        ...DRAWN,
        width: DRAWN.width + SIZE_TOLERANCE_PIXELS,
        height: DRAWN.height - SIZE_TOLERANCE_PIXELS,
      }),
    ).toEqual([]);
    // A tall shot moves by its share, not by a fixed number of pixels.
    const tall: DocsScreenFingerprint = { ...DRAWN, height: 1000 };
    expect(
      compareFingerprints(tall, {
        ...tall,
        height: 1000 + 1000 * SIZE_TOLERANCE_RATIO,
      }),
    ).toEqual([]);
  });
});

describe("a shot whose page changed", () => {
  it("is stale when a button is renamed, saying what it no longer and now says", () => {
    const renamed: DocsScreenFingerprint = {
      ...DRAWN,
      text: DRAWN.text.map((line: string): string => {
        return line === "Save and continue" ? "Save and go on" : line;
      }),
      outline: DRAWN.outline.map((line: string): string => {
        return line === "button: Save and continue"
          ? "button: Save and go on"
          : line;
      }),
    };

    expect(compareFingerprints(DRAWN, renamed)).toEqual([
      'no longer says "Save and continue"',
      'now says "Save and go on"',
      "its headings, buttons and fields changed (- button: Save and continue; + button: Save and go on)",
    ]);
  });

  it("is stale when a field is added, by its words, its outline and its height", () => {
    const grown: DocsScreenFingerprint = {
      text: [...DRAWN.text.slice(0, 5), "Message", "Save and continue"],
      outline: [
        "heading: Who should be told?",
        "button: Add teammates",
        "field text: Message",
        "button: Save and continue",
      ],
      width: 780,
      height: 400,
    };

    expect(compareFingerprints(DRAWN, grown)).toEqual([
      'now says "Message"',
      "its headings, buttons and fields changed (+ field text: Message)",
      "its size went from 780x314 to 780x400",
    ]);
  });

  it("is stale when the same words move, or the same buttons swap places", () => {
    expect(
      compareFingerprints(DRAWN, {
        ...DRAWN,
        text: [...DRAWN.text].reverse(),
      }),
    ).toEqual(["its words are in another order"]);
    expect(
      compareFingerprints(DRAWN, {
        ...DRAWN,
        outline: [DRAWN.outline[0]!, DRAWN.outline[2]!, DRAWN.outline[1]!],
      }),
    ).toEqual(["its headings, buttons and fields are in another order"]);
  });

  it("is stale when it only grows or narrows past the tolerance: a section opened, a column added", () => {
    expect(compareFingerprints(DRAWN, { ...DRAWN, width: 1100 })).toEqual([
      "its size went from 780x314 to 1100x314",
    ]);
    expect(
      compareFingerprints(DRAWN, {
        ...DRAWN,
        height:
          DRAWN.height +
          SIZE_TOLERANCE_PIXELS +
          1 +
          DRAWN.height * SIZE_TOLERANCE_RATIO,
      }),
    ).toHaveLength(1);
  });

  it("quotes at most three changed lines, and counts the rest", () => {
    const rewritten: DocsScreenFingerprint = {
      ...DRAWN,
      text: ["A", "B", "C", "D", "E", ...DRAWN.text],
    };

    expect(compareFingerprints(DRAWN, rewritten)).toEqual([
      'now says "A", "B", "C" and 2 more',
    ]);
  });

  it("is stale when it was never drawn", () => {
    expect(compareFingerprints(undefined, DRAWN)).toEqual([
      "it has never been drawn",
    ]);
    expect(compareFingerprints(null, DRAWN)).toEqual([
      "it has never been drawn",
    ]);
  });
});

describe("the staleness issue", () => {
  const check: DocsScreensCheck = {
    checked: 323,
    stale: [
      {
        name: "website-down-who",
        lang: "en",
        reasons: [
          'no longer says "Save and continue"',
          'now says "Save and go on"',
        ],
      },
      {
        name: "website-down-who",
        lang: "de",
        reasons: ['no longer says "Speichern und weiter"'],
      },
      {
        name: "paging-test",
        lang: "ja",
        reasons: ["its size went from 780x190 to 780x260"],
      },
    ],
    failed: [
      {
        name: "status-page-pick",
        lang: "fr",
        reasons: ["locator.click: Timeout 15000ms exceeded."],
      },
    ],
  };
  const body: string = staleIssueBody(
    check,
    "https://github.com/OneUptime/oneuptime/actions/runs/1",
  );

  it("lists each stale shot once, its languages, and why, by the first language's reasons", () => {
    expect(body).toContain("**2 shots are stale**, of 323 drawn:");
    expect(body).toContain(
      '- `website-down-who` (en, de): no longer says "Save and continue"; now says "Save and go on"',
    );
    expect(body).toContain(
      "- `paging-test` (ja): its size went from 780x190 to 780x260",
    );
    // In order of the shots' names.
    expect(body.indexOf("`paging-test`")).toBeLessThan(
      body.indexOf("`website-down-who`"),
    );
  });

  it("lists the shots that could not be drawn apart from the stale ones", () => {
    expect(body).toContain("**Could not be drawn:**");
    expect(body).toContain(
      "- `status-page-pick` (fr): locator.click: Timeout 15000ms exceeded.",
    );
  });

  it("says what to run, that it needs no server, and where the run was", () => {
    expect(REGENERATE_COMMAND).toBe("cd packages/E2E && npm run docs-screens");
    expect(body).toContain(`\`\`\`bash\n${REGENERATE_COMMAND}\n\`\`\``);
    expect(body).toContain("It needs no server");
    expect(body).toContain(
      "packages/App/FeatureSet/Docs/Screens/DocsScreenList.ts",
    );
    expect(body).toContain(
      "Last checked: https://github.com/OneUptime/oneuptime/actions/runs/1",
    );
  });

  it("says one shot in the singular, and leaves out what it has nothing to say about", () => {
    const one: string = staleIssueBody({
      checked: 19,
      stale: [{ name: "paging-test", lang: "en", reasons: ["x"] }],
      failed: [],
    });

    expect(one).toContain("**1 shot is stale**, of 19 drawn:");
    expect(one).not.toContain("Could not be drawn");
    expect(one).not.toContain("Last checked");
  });
});
