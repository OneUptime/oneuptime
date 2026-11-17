// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import { describe, expect, test } from "@jest/globals";
import {
  FaintText,
  FaintTextKind,
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
 * better at gray-600. And it is at least 11px: text-[10px] and smaller are
 * flagged.
 *
 * The scan (Tests/Helpers/FaintTextScan) reads every element whose className
 * names a resting text-gray-300/400 (or slate's), or text-[10px] and under,
 * and that holds words or a value. It leaves alone what nobody reads as
 * words: an icon (an Icon, an svg), an aria-hidden or sr-only element, a
 * lone separator or the quiet dash ("/", "·", "—"), an element on a dark
 * ground of its own (bg-gray-700 and darker), and a variant (hover:,
 * placeholder:, dark:). gray-400 stays right for those.
 *
 * To fix one: write text-gray-500 (text-gray-600 for body text), and
 * text-xs for a tiny size. A use that truly is not read as words (a
 * placeholder drawn by hand, a disabled row) goes in NOT_READ_AS_WORDS below
 * with why. The scan covers Common's components and the Dashboard's Logs,
 * Traces, Exceptions and On-Call screens; more of the Dashboard joins as it
 * is fixed.
 */

const SCANNED_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/UI/Components",
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions",
  "packages/App/FeatureSet/Dashboard/src/Components/Logs",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallDutySchedule",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallRule",
  "packages/App/FeatureSet/Dashboard/src/Components/Span",
  "packages/App/FeatureSet/Dashboard/src/Components/Traces",
  "packages/App/FeatureSet/Dashboard/src/Pages/Exceptions",
  "packages/App/FeatureSet/Dashboard/src/Pages/Logs",
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty",
  "packages/App/FeatureSet/Dashboard/src/Pages/Traces",
];

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
    expect(scan(`<span className="text-[11px]">{count}</span>`)).toEqual([]);
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

describe("text people read is readable (#9127)", () => {
  const found: Array<FaintText> = scanDirectories(SCANNED_DIRECTORIES);

  test("the scan reads the shared components", () => {
    // A path or a parser that went wrong would pass by finding nothing.
    expect(
      found.filter((text: FaintText): boolean => {
        return text.file.startsWith("packages/Common/UI/Components/");
      }).length,
    ).toBeGreaterThan(0);
  });

  test("no gray-300 or gray-400 text that is read as words", () => {
    const faint: Array<string> = found
      .filter((text: FaintText): boolean => {
        return text.kind === FaintTextKind.FaintGray && !isNotReadAsWords(text);
      })
      .map(describeFinding);

    expect(faint).toEqual([]);
  });

  test("no text smaller than 11px", () => {
    const tiny: Array<string> = found
      .filter((text: FaintText): boolean => {
        return text.kind === FaintTextKind.TinySize;
      })
      .map(describeFinding);

    expect(tiny).toEqual([]);
  });

  test.each(
    NOT_READ_AS_WORDS.map((entry: NotReadAsWords) => {
      return [`${entry.file}: ${entry.literal}`, entry];
    }),
  )(
    "each exception still matches a use: %s",
    (_file: string, entry: NotReadAsWords) => {
      expect(
        found.some((text: FaintText): boolean => {
          return text.file === entry.file && text.literal === entry.literal;
        }),
      ).toBe(true);
    },
  );
});
