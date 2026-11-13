/*
 * Whether a docs screenshot still shows its page (#6823).
 *
 * When a shot is drawn, the renderer keeps its fingerprint beside it
 * (packages/E2E/DocsScreens/Fingerprints/<language>.json): what the shot
 * says and how it is built, not its pixels. A job on main draws every shot
 * again and compares (compareFingerprints): a shot whose page changed is
 * stale, and one issue lists them (staleIssueBody; the job keeps the issue
 * with packages/E2E/DocsScreens/ReportStale.js).
 *
 * Why structure, not pixels: the same page draws different pixels on a Mac
 * and on a Linux runner (font rasterizing, and the fallback fonts Chinese,
 * Japanese, Korean and Hindi are drawn in), so a pixel comparison would
 * call every shot stale, or none once its threshold is loose enough to
 * pass. The words, the order of the headings, buttons and fields, and the
 * shot's size give the same answer on any machine, and change when the
 * page a reader sees changes: a renamed button, a new field, a section
 * that folds or opens.
 */

export interface DocsScreenFingerprint {
  /*
   * Its words, block by block as the browser lays them out (innerText,
   * which does not depend on where a line wraps), then what its fields
   * hold or ask for.
   */
  text: Array<string>;
  // Its headings, buttons, links and fields, in order: "button: Continue".
  outline: Array<string>;
  // Its size in CSS pixels.
  width: number;
  height: number;
}

// Shot -> its fingerprint, for one language.
export type DocsScreenFingerprints = Record<string, DocsScreenFingerprint>;

/*
 * How much a shot's size may move before it counts as changed: a pixel or
 * two of font metrics between machines is not a change; a field, a row or
 * a column is.
 */
export const SIZE_TOLERANCE_RATIO: number = 0.1;
export const SIZE_TOLERANCE_PIXELS: number = 16;

// How many changed lines a reason quotes, at most.
const QUOTED_LINES: number = 3;

const sizeMoved: (before: number, after: number) => boolean = (
  before: number,
  after: number,
): boolean => {
  return (
    Math.abs(after - before) >
    Math.max(SIZE_TOLERANCE_PIXELS, before * SIZE_TOLERANCE_RATIO)
  );
};

// What one list has that the other has not, as a multiset, in order.
const missingFrom: (
  lines: ReadonlyArray<string>,
  other: ReadonlyArray<string>,
) => Array<string> = (
  lines: ReadonlyArray<string>,
  other: ReadonlyArray<string>,
): Array<string> => {
  const left: Array<string> = [...other];
  const missing: Array<string> = [];

  for (const line of lines) {
    const index: number = left.indexOf(line);

    if (index === -1) {
      missing.push(line);
    } else {
      left.splice(index, 1);
    }
  }

  return missing;
};

const quote: (lines: ReadonlyArray<string>) => string = (
  lines: ReadonlyArray<string>,
): string => {
  const quoted: string = lines
    .slice(0, QUOTED_LINES)
    .map((line: string): string => {
      return `"${line}"`;
    })
    .join(", ");

  return lines.length > QUOTED_LINES
    ? `${quoted} and ${lines.length - QUOTED_LINES} more`
    : quoted;
};

const sameList: (
  one: ReadonlyArray<string>,
  other: ReadonlyArray<string>,
) => boolean = (
  one: ReadonlyArray<string>,
  other: ReadonlyArray<string>,
): boolean => {
  return (
    one.length === other.length &&
    one.every((line: string, index: number): boolean => {
      return line === other[index];
    })
  );
};

/*
 * Why a shot no longer shows its page: one line per thing that changed, or
 * nothing when it still does. A shot never drawn before has no recorded
 * fingerprint (null).
 */
export const compareFingerprints: (
  recorded: DocsScreenFingerprint | null | undefined,
  now: DocsScreenFingerprint,
) => Array<string> = (
  recorded: DocsScreenFingerprint | null | undefined,
  now: DocsScreenFingerprint,
): Array<string> => {
  if (!recorded) {
    return ["it has never been drawn"];
  }

  const reasons: Array<string> = [];

  if (!sameList(recorded.text, now.text)) {
    const gone: Array<string> = missingFrom(recorded.text, now.text);
    const added: Array<string> = missingFrom(now.text, recorded.text);

    if (gone.length === 0 && added.length === 0) {
      reasons.push("its words are in another order");
    } else {
      if (gone.length > 0) {
        reasons.push(`no longer says ${quote(gone)}`);
      }
      if (added.length > 0) {
        reasons.push(`now says ${quote(added)}`);
      }
    }
  }

  if (!sameList(recorded.outline, now.outline)) {
    const gone: Array<string> = missingFrom(recorded.outline, now.outline);
    const added: Array<string> = missingFrom(now.outline, recorded.outline);

    reasons.push(
      gone.length === 0 && added.length === 0
        ? "its headings, buttons and fields are in another order"
        : `its headings, buttons and fields changed (${[
            ...gone.map((line: string): string => {
              return `- ${line}`;
            }),
            ...added.map((line: string): string => {
              return `+ ${line}`;
            }),
          ]
            .slice(0, QUOTED_LINES * 2)
            .join("; ")})`,
    );
  }

  if (
    sizeMoved(recorded.width, now.width) ||
    sizeMoved(recorded.height, now.height)
  ) {
    reasons.push(
      `its size went from ${recorded.width}x${recorded.height} to ${now.width}x${now.height}`,
    );
  }

  return reasons;
};

// One shot in one language that no longer shows its page.
export interface StaleScreen {
  name: string;
  lang: string;
  reasons: Array<string>;
}

// What a check of every shot found.
export interface DocsScreensCheck {
  // Shots times languages drawn.
  checked: number;
  stale: Array<StaleScreen>;
  // Shots that could not be drawn at all, with why.
  failed: Array<StaleScreen>;
}

// The command that draws them again, in the issue and the README.
export const REGENERATE_COMMAND: string =
  "cd packages/E2E && npm run docs-screens";

/*
 * The issue's body: each stale shot once, with the languages it is stale
 * in and why (from its first language), then what to run.
 */
export const staleIssueBody: (
  check: DocsScreensCheck,
  runUrl?: string | undefined,
) => string = (
  check: DocsScreensCheck,
  runUrl?: string | undefined,
): string => {
  const byShot: Map<string, Array<StaleScreen>> = new Map();

  for (const entry of check.stale) {
    byShot.set(entry.name, [...(byShot.get(entry.name) || []), entry]);
  }

  const lines: Array<string> = [
    "The pages these docs screenshots show have changed since the screenshots were drawn, so the docs show a screen the reader will not see (#6823).",
    "",
  ];

  if (byShot.size > 0) {
    lines.push(
      `**${byShot.size} ${byShot.size === 1 ? "shot is" : "shots are"} stale**, of ${check.checked} drawn:`,
      "",
    );

    for (const name of Array.from(byShot.keys()).sort()) {
      const entries: Array<StaleScreen> = byShot.get(name)!;
      lines.push(
        `- \`${name}\` (${entries
          .map((entry: StaleScreen): string => {
            return entry.lang;
          })
          .join(", ")}): ${entries[0]!.reasons.join("; ")}`,
      );
    }

    lines.push("");
  }

  if (check.failed.length > 0) {
    lines.push("**Could not be drawn:**", "");

    for (const entry of check.failed) {
      lines.push(
        `- \`${entry.name}\` (${entry.lang}): ${entry.reasons.join("; ")}`,
      );
    }

    lines.push("");
  }

  lines.push(
    "## How to fix it",
    "",
    "Draw them again, and commit the pictures and fingerprints it changes:",
    "",
    "```bash",
    REGENERATE_COMMAND,
    "```",
    "",
    "It needs no server: it starts the offline fixtures itself, and rewrites only the shots whose page changed. If a page changed so much that its shot no longer shows what the docs step says, change the step or the shot list (`packages/App/FeatureSet/Docs/Screens/DocsScreenList.ts`) too. `packages/E2E/DocsScreens/README.md` has the rest.",
    "",
    "This issue is kept by the Docs Screenshots workflow: it rewrites this text on every run that finds a stale shot, and closes the issue once every shot is current.",
  );

  if (runUrl) {
    lines.push("", `Last checked: ${runUrl}`);
  }

  return lines.join("\n");
};
