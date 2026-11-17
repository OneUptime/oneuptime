// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots } from "../ForeignHiddenRuleGuard";
import {
  FaintText,
  REPOSITORY_ROOT,
  findFaintText,
  scanDirectories,
} from "../Helpers/FaintTextScan";
import {
  DARK_SURFACES,
  LIGHT_SURFACES,
  WCAG_AA_TEXT,
  darkContrastOf,
  lightContrastOf,
} from "./GrayTextContrast";

/*
 * TEXT PEOPLE READ IS READABLE: AT LEAST 4.5:1 (#9127).
 *
 * Tailwind's gray-400 (#9ca3af) is 2.5:1 on a white card, and gray-300 is
 * 1.5:1, under the 4.5:1 WCAG AA asks of text. The shared components and
 * the Dashboard drew labels, descriptions, values, hints and timestamps in
 * them: "No saved views yet." in the logs' saved views, a More menu's
 * section headings, a drop filter's "Not configured", "Resumes {date}" on an
 * on-call schedule. About a hundred and fifty in Common's components alone.
 * Many were 10px too.
 *
 * So text a person reads is gray-500 or darker: gray-500 is 4.8:1 on white
 * (held below), and the dark theme paints gray-400 and gray-500 the same
 * slate (Theme.css), so the move changes nothing there. Body text reads
 * better at gray-600.
 *
 * And it is text-xs (12px) or larger (#9192). text-[10px] and smaller are
 * flagged everywhere. 11px (text-[11px]) is kept for a short label that
 * its shape makes legible: an eyebrow in capitals ("uppercase": "RECENT",
 * "LAST 24 HOURS"), or a chip, a badge or a key that frames its word
 * (rounded, on a ground or in a border of its own; a kbd). Those still meet
 * 4.5:1, since their colour is held like any other. A hint, a value, a
 * timestamp or a sentence at 11px is flagged: write text-xs.
 *
 * The scan (Tests/Helpers/FaintTextScan) reads every element whose className
 * names a resting text-gray-300/400 (or slate's), or a size under 12px, and
 * that holds words or a value. It follows a class held in a const of the
 * same file (className={FACET_COUNT_COLUMN_CLASS}). It leaves alone what
 * nobody reads as words: an icon (an Icon, an svg), an aria-hidden or
 * sr-only element, a lone separator, ellipsis or the quiet dash ("/", "·",
 * "…", "—"), an element on a dark ground of its own (bg-gray-700 and
 * darker), and a variant (hover:, placeholder:, dark:). gray-400 stays right
 * for those.
 *
 * To fix one: write text-gray-500 (text-gray-600 for body text), and
 * text-xs for a small size. A use that truly is not read as words (a
 * placeholder drawn by hand, a disabled row) goes in NOT_READ_AS_WORDS below
 * with why.
 *
 * Every app and the shared UI hold none (#9192 fixed the last of them).
 */

/*
 * Every frontend is read: each feature set's browser source, the shared UI
 * and the Enterprise screens when ee/ is there.
 */
const SCANNED_DIRECTORIES: ReadonlyArray<string> = listScanRoots(
  REPOSITORY_ROOT,
).map((directory: string): string => {
  return path.relative(REPOSITORY_ROOT, directory).split(path.sep).join("/");
});

interface NotReadAsWords {
  file: string;
  // The class string the token is written in, as the scan reports it.
  literal: string;
  reason: string;
}

const NOT_READ_AS_WORDS: ReadonlyArray<NotReadAsWords> = [
  {
    file: "packages/Common/UI/Components/Forms/Fields/PermissionPicker.tsx",
    literal: "text-gray-300 cursor-default",
    reason:
      "A permission group the search matched nothing in: dimmed and not pressable, the look of a disabled control.",
  },
  {
    file: "packages/Common/UI/Components/Workflow/ValuePicker/ValuePickerMenu.tsx",
    literal: "truncate text-sm text-gray-400",
    reason:
      "A value an earlier step will give but cannot be picked yet: a disabled row (cursor-not-allowed), under a title of its own that explains why in readable gray (ValuePickerMenuAvailability).",
  },
  {
    file: "packages/Common/UI/Components/Workflow/ValuePicker/ValuePickerMenu.tsx",
    literal:
      "ml-auto shrink-0 rounded border border-gray-200 px-1.5 text-xs font-medium uppercase leading-4 tracking-wide text-gray-400",
    reason: "The type of that same disabled row's value.",
  },
  {
    file: "packages/Common/UI/Components/Table/TableHeaderControls.tsx",
    literal: "flex-1 truncate text-left text-gray-400",
    reason:
      "'Search…' in the narrow table's search button: a field's placeholder drawn by hand, in the placeholder gray of the field it opens.",
  },
  {
    file: "packages/Common/UI/Components/SimpleLogViewer/SimpleLogViewer.tsx",
    literal: "text-slate-300 whitespace-pre-wrap break-all flex-1",
    reason:
      "A log line on the viewer's bg-slate-900 panel, drawn by a function apart from the panel: slate-300 is 12:1 there.",
  },
  {
    file: "packages/Common/UI/Components/SimpleLogViewer/SimpleLogViewer.tsx",
    literal: "text-slate-300 whitespace-pre-wrap break-all",
    reason:
      "The viewer's content when it is handed elements, on the same bg-slate-900 panel.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetupModal.tsx",
    literal: "text-gray-400",
    reason:
      "A check row's label while its checkbox is disabled: the look of a disabled control, with the enabled label in gray-800.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Code/CodeComposer.tsx",
    literal: "text-gray-300",
    reason:
      "The Add context menu's button while the context is locked (the menu isDisabled): a disabled control.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiConnectModal.tsx",
    literal: "bg-white text-gray-400 ring-gray-200",
    reason:
      "A step of the connect dialog not reached yet: its button is disabled until the steps before it are done.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderParts.tsx",
    literal: "text-gray-400",
    reason:
      "The punctuation a translated method label puts between the method's name and its identifier (': '), handed in by renderText, so the scan cannot see it is only a mark.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Settings/MobileApps.tsx",
    literal:
      "text-[11px] font-medium uppercase leading-tight tracking-[0.1em] text-gray-300",
    reason:
      "A store badge's small line (\"Download on the\") on the badge's gray-800 to gray-950 gradient, drawn by a component apart from the badge: gray-300 is about 10:1 there.",
  },
];

function describeFinding(found: FaintText): string {
  return `${found.file}:${found.line} ${found.token} in "${found.literal}"`;
}

function isNotReadAsWords(found: FaintText): boolean {
  return NOT_READ_AS_WORDS.some((entry: NotReadAsWords): boolean => {
    return entry.file === found.file && entry.literal === found.literal;
  });
}

function scan(source: string): Array<string> {
  return findFaintText(source, "Example.tsx").map(
    (found: FaintText): string => {
      return `${found.kind} ${found.token}`;
    },
  );
}

describe("the lightest gray text the guard accepts reads at 4.5:1", () => {
  test.each(LIGHT_SURFACES)(
    "gray-500 on %s",
    (_surface: string, surface: string) => {
      expect(lightContrastOf("500", surface)).toBeGreaterThanOrEqual(
        WCAG_AA_TEXT,
      );
    },
  );

  test.each(DARK_SURFACES)(
    "gray-500 as the dark theme paints it, on %s",
    (_surface: string, surface: string) => {
      expect(darkContrastOf("500", surface)).toBeGreaterThanOrEqual(
        WCAG_AA_TEXT,
      );
    },
  );

  test("gray-400, which the guard flags, does not", () => {
    expect(lightContrastOf("400", "#ffffff")).toBeLessThan(WCAG_AA_TEXT);
  });
});

describe("the scan finds faint and tiny text", () => {
  test("a word in gray-400 or gray-300", () => {
    expect(
      scan(`<p className="text-xs text-gray-400">No saved views yet.</p>`),
    ).toEqual(["faint-gray text-gray-400"]);
    expect(scan(`<span className="text-gray-300">Total</span>`)).toEqual([
      "faint-gray text-gray-300",
    ]);
    expect(scan(`<span className="!text-slate-400">Total</span>`)).toEqual([
      "faint-gray !text-slate-400",
    ]);
  });

  test("a value, a translation, a conditional's words", () => {
    expect(
      scan(`<span className="text-gray-400">{props.title}</span>`),
    ).toHaveLength(1);
    expect(
      scan(
        `<div className="text-gray-400">{t.translateText("Not configured")}</div>`,
      ),
    ).toHaveLength(1);
    expect(
      scan(
        `<span className={\`tabular-nums \${on ? "text-gray-900" : "text-gray-400"}\`}>{on ? <><span aria-hidden="true">2.4M</span><span className="sr-only">{n}</span></> : format(n)}</span>`,
      ),
    ).toEqual(["faint-gray text-gray-400"]);
  });

  test("words inside a child that does not paint its own colour", () => {
    expect(
      scan(
        `<header className="text-gray-400"><span>{label}</span><CopyButton /></header>`,
      ),
    ).toEqual(["faint-gray text-gray-400"]);
  });

  test("text-[10px] and smaller, in any colour", () => {
    expect(
      scan(`<span className="text-[10px] text-indigo-700">Testing only</span>`),
    ).toEqual(["tiny-size text-[10px]"]);
    expect(scan(`<span className="text-[9px]">{count}</span>`)).toEqual([
      "tiny-size text-[9px]",
    ]);
    expect(scan(`<span className="text-[10.5px]">{count}</span>`)).toEqual([
      "tiny-size text-[10.5px]",
    ]);
  });

  test("11px for a hint, a value or a sentence", () => {
    expect(
      scan(`<p className="text-[11px] text-gray-500">No values found.</p>`),
    ).toEqual(["small-size text-[11px]"]);
    expect(
      scan(`<span className="font-mono text-[11px]">{timestamp}</span>`),
    ).toEqual(["small-size text-[11px]"]);
    // A hover ground is not a chip's: at rest it is bare words.
    expect(
      scan(
        `<button className="rounded px-1.5 text-[11px] hover:bg-gray-100">Clear all</button>`,
      ),
    ).toEqual(["small-size text-[11px]"]);
  });

  test("a class held in a const of the file", () => {
    expect(
      scan(
        `const COUNT_CLASS: string = "w-7 font-mono text-[10px]"; <span className={COUNT_CLASS}>{count}</span>`,
      ),
    ).toEqual(["tiny-size text-[10px]"]);
    expect(
      scan(
        `const BASE = "truncate text-gray-400"; <span className={\`\${BASE} \${extra}\`}>{label}</span>`,
      ),
    ).toEqual(["faint-gray text-gray-400"]);
    expect(
      scan(
        `function Row() { const tone = on ? "text-gray-900" : "text-gray-400"; return <span className={tone}>{label}</span>; }`,
      ),
    ).toEqual(["faint-gray text-gray-400"]);
    expect(
      scan(
        `const STYLES = { label: "text-xs text-gray-400" } as const; <span className={STYLES.label}>{label}</span>`,
      ),
    ).toEqual(["faint-gray text-gray-400"]);
  });

  test("the nearest const of a name, as the language reads it", () => {
    expect(
      scan(
        `const tone = "text-gray-400"; function Row() { const tone = "text-gray-700"; return <span className={tone}>{label}</span>; }`,
      ),
    ).toEqual([]);
  });
});

describe("the scan leaves alone what nobody reads as words", () => {
  test("an icon, or a button that holds only an icon and sr-only words", () => {
    expect(
      scan(`<Icon icon={IconProp.Close} className="h-4 w-4 text-gray-400" />`),
    ).toEqual([]);
    expect(
      scan(
        `<button className="text-gray-400 hover:text-gray-500"><span className="sr-only">Close</span><Icon icon={IconProp.Close} /></button>`,
      ),
    ).toEqual([]);
  });

  test("aria-hidden, sr-only", () => {
    expect(
      scan(`<span aria-hidden="true" className="text-gray-400">▾</span>`),
    ).toEqual([]);
    expect(
      scan(`<span className="sr-only text-gray-400">{label}</span>`),
    ).toEqual([]);
    // A field's look drawn for the eye: its placeholder is not read.
    expect(
      scan(
        `<div aria-hidden="true"><div className="rounded-md border"><span className="text-gray-400">{placeholder}</span></div></div>`,
      ),
    ).toEqual([]);
  });

  test("a lone separator or the quiet dash", () => {
    expect(scan(`<span className="text-gray-400 mx-1">/</span>`)).toEqual([]);
    expect(scan(`<div className="text-gray-300">•</div>`)).toEqual([]);
    expect(scan(`<span className="text-gray-400">: </span>`)).toEqual([]);
    expect(scan(`<span className="text-gray-300">&mdash;</span>`)).toEqual([]);
  });

  test("words in a child that paints its own colour", () => {
    expect(
      scan(
        `<Link className="text-gray-400"><span className="text-gray-500">{title}</span></Link>`,
      ),
    ).toEqual([]);
  });

  test("text on a dark ground of its own", () => {
    expect(
      scan(
        `<div className="bg-gray-900"><span className="text-gray-400">{line}</span></div>`,
      ),
    ).toEqual([]);
    expect(
      scan(`<pre className="bg-slate-800 text-slate-300">{code}</pre>`),
    ).toEqual([]);
  });

  test("a variant: hover, placeholder, dark", () => {
    expect(
      scan(
        `<span className="text-gray-600 hover:text-gray-400 placeholder:text-gray-400 dark:text-gray-400">{x}</span>`,
      ),
    ).toEqual([]);
  });

  test("an element with no words", () => {
    expect(scan(`<span className="text-gray-400" />`)).toEqual([]);
    expect(
      scan(`<div className="text-gray-400">{show && <Icon icon={i} />}</div>`),
    ).toEqual([]);
  });
});

describe("text people read is readable (#9127, #9192)", () => {
  const everything: Array<FaintText> = scanDirectories(SCANNED_DIRECTORIES);

  test("the scan reads the shared UI and every app", () => {
    for (const directory of [
      "packages/Common/UI",
      "packages/App/FeatureSet/Dashboard/src",
      "packages/App/FeatureSet/StatusPage/src",
      "packages/App/FeatureSet/AdminDashboard/src",
      "packages/App/FeatureSet/Accounts/src",
    ]) {
      expect(SCANNED_DIRECTORIES).toContain(directory);
    }

    // A path or a parser that went wrong would pass by finding nothing.
    expect(
      everything.some((text: FaintText): boolean => {
        return text.file.startsWith("packages/Common/UI/");
      }),
    ).toBe(true);
  });

  test("no faint or small text that is read as words, in any app", () => {
    expect(
      everything
        .filter((text: FaintText): boolean => {
          return !isNotReadAsWords(text);
        })
        .map(describeFinding),
    ).toEqual([]);
  });

  test.each(
    NOT_READ_AS_WORDS.map((entry: NotReadAsWords): [string, NotReadAsWords] => {
      return [`${entry.file}: ${entry.literal}`, entry];
    }),
  )(
    "each exception still matches a use: %s",
    (_file: string, entry: NotReadAsWords) => {
      // The Enterprise screens are not in every copy of the repository.
      if (
        entry.file.startsWith("ee/") &&
        !fs.existsSync(path.join(REPOSITORY_ROOT, entry.file))
      ) {
        return;
      }

      expect(
        everything.some((text: FaintText): boolean => {
          return text.file === entry.file && text.literal === entry.literal;
        }),
      ).toBe(true);
    },
  );
});
