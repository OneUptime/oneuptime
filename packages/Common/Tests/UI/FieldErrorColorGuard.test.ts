// UX rule: Docs/ux/README.md#errors
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FIELD_ERROR_CLASS_NAME,
  FIELD_ERROR_COLOR_CLASS_NAME,
  FIELD_ERROR_PLACE_CLASS_NAME,
  getFieldErrorClassName,
} from "../../UI/Components/Forms/Fields/FieldError";
import escapeRegExp from "../../Utils/RegExpEscape";
import {
  AA_TEXT_CONTRAST,
  colourOfClass,
  contrastOfClasses,
  contrastRatio,
} from "../Helpers/TailwindContrast";
import {
  CORE_FRONTEND_DIRECTORIES,
  ERROR_LINES_ON_A_DARK_GROUND,
  ErrorLineOnADarkGround,
  FIELD_ERROR_COLOR_ADVICE,
  FieldErrorColorFinding,
  FieldErrorColorFindingKind,
  REPOSITORY_ROOT,
  describeFieldErrorColorFinding,
  findFieldErrorColorFindings,
  isTextColourClass,
  listFrontendFiles,
  readSources,
  restingRedShadeOf,
  utilityOfClassToken,
} from "../Helpers/FieldErrorColorScan";

/*
 * A FIELD'S ERROR IS DRAWN IN ONE RED, AND IT CAN BE READ.
 *
 * "The product-wide field error text (text-red-400) is about 2.8:1 against
 * its background, below the 4.5:1 text needs." Every field drew its error
 * in a light red, and the fields that placed their error line their own way
 * coloured it too, in four reds: a Create Monitor step said "Monitor Type
 * is required." in red-600 over "Name is required." in red-400.
 *
 * FieldError draws every field's error in one red of its own,
 * FIELD_ERROR_COLOR_CLASS_NAME - the product's danger text, read here as
 * Tailwind and Theme.css draw it, in both themes - and a field's className
 * only places the line. An error line drawn by hand is never lighter than
 * red-600. The source reading is Tests/Helpers/FieldErrorColorScan; ee's
 * frontends are read by its twin (ee/Tests/Server/FieldErrorColorGuard),
 * the only run with ee/ checked out.
 */

// Block comments: prose in Theme.css is not a rule.
const CSS_COMMENT_PATTERN: RegExp = /\/\*[\s\S]*?\*\//g;

const THEME_CSS: string = fs
  .readFileSync(
    path.join(REPOSITORY_ROOT, "packages/Common/UI/Styles/Theme.css"),
    "utf8",
  )
  .replace(CSS_COMMENT_PATTERN, " ");

// One CSS rule: what it selects, and what it says.
interface CssRule {
  selector: string;
  body: string;
}

const CSS_RULE_PATTERN: RegExp = /([^{}]+)\{([^{}]*)\}/g;

const CSS_RULES: Array<CssRule> = Array.from(
  THEME_CSS.matchAll(CSS_RULE_PATTERN),
).map((match: RegExpMatchArray): CssRule => {
  return { selector: (match[1] || "").trim(), body: match[2] || "" };
});

const COLOR_DECLARATION_PATTERN: RegExp = /(?:^|[;\s])color:\s*(#[0-9a-f]{6})/i;

const IDENTIFIER_CHARACTER_PATTERN: RegExp = /[\w-]/;

// Whether a selector names a class, whole: .text-red-700, not .text-red-7000.
const selectsClass: (selector: string, className: string) => boolean = (
  selector: string,
  className: string,
): boolean => {
  let from: number = selector.indexOf(`.${className}`);

  while (from !== -1) {
    const next: string = selector.charAt(from + className.length + 1) || " ";

    if (!IDENTIFIER_CHARACTER_PATTERN.test(next)) {
      return true;
    }

    from = selector.indexOf(`.${className}`, from + 1);
  }

  return false;
};

// The colour Theme.css gives a text class in the dark theme.
const darkColourOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return CSS_RULES.filter((rule: CssRule): boolean => {
    return (
      rule.selector.startsWith("html.dark") &&
      selectsClass(rule.selector, className)
    );
  })
    .map((rule: CssRule): string => {
      return rule.body.match(COLOR_DECLARATION_PATTERN)?.[1] || "";
    })
    .filter((colour: string): boolean => {
      return colour.length > 0;
    });
};

// A theme token's colour: --ou-surface-primary in html.dark or :root.
const tokenColourOf: (scope: ":root" | "html.dark", token: string) => string = (
  scope: ":root" | "html.dark",
  token: string,
): string => {
  const rule: CssRule | undefined = CSS_RULES.find((candidate: CssRule) => {
    return candidate.selector === scope;
  });
  const declaration: RegExpMatchArray | null | undefined = rule?.body.match(
    new RegExp(`${escapeRegExp(token)}:\\s*(#[0-9a-f]{6})`, "i"),
  );

  if (!declaration?.[1]) {
    throw new Error(`Theme.css has no ${token} in ${scope}.`);
  }

  return declaration[1];
};

const rounded: (ratio: number) => number = (ratio: number): number => {
  return Math.round(ratio * 10) / 10;
};

describe("a field's error, as FieldError colours it", () => {
  test("in one red of its own, whatever place a field gives the line", () => {
    expect(FIELD_ERROR_COLOR_CLASS_NAME).toBe("text-red-700");
    expect(FIELD_ERROR_CLASS_NAME).toBe(
      `${FIELD_ERROR_PLACE_CLASS_NAME} ${FIELD_ERROR_COLOR_CLASS_NAME}`,
    );
    expect(getFieldErrorClassName()).toBe("mt-1 text-sm text-red-700");
    expect(getFieldErrorClassName("mt-2 pl-14 text-sm")).toBe(
      "mt-2 pl-14 text-sm text-red-700",
    );
    expect(getFieldErrorClassName("")).toBe("text-red-700");
    // The place a field gives is only a place: no colour of FieldError's own.
    expect(
      FIELD_ERROR_PLACE_CLASS_NAME.split(" ").filter(isTextColourClass),
    ).toEqual([]);
  });

  /*
   * The grounds a field is drawn on in the light theme: a card or a dialog
   * (white), a band or a panel (gray-50, gray-100), and the page itself.
   */
  test.each([
    ["a card or a dialog", "bg-white", 6.5],
    ["a band, the criteria editor's", "bg-gray-50", 6.2],
    ["a grey panel", "bg-gray-100", 5.9],
  ])(
    "it reads at 4.5:1 or more on %s (%s): %s:1",
    (_where: string, ground: string, ratio: number) => {
      const contrast: number = contrastOfClasses(
        FIELD_ERROR_COLOR_CLASS_NAME,
        ground,
      );

      expect(contrast).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
      expect(rounded(contrast)).toBe(ratio);
    },
  );

  test("and on the page's own ground", () => {
    const page: string = tokenColourOf(":root", "--ou-background-primary");

    expect(
      contrastRatio(colourOfClass(FIELD_ERROR_COLOR_CLASS_NAME), page),
    ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });

  test("it is the product's danger text, the colour Theme.css names so", () => {
    expect(colourOfClass(FIELD_ERROR_COLOR_CLASS_NAME)).toBe(
      tokenColourOf(":root", "--ou-danger-text"),
    );
  });

  test("the red-400 it was read at 2.8:1 on a white card: the reason for the change", () => {
    // Not in TailwindContrast's palette: Tailwind's red-400.
    expect(rounded(contrastRatio("#f87171", "#ffffff"))).toBe(2.8);
  });

  test("in the dark theme Theme.css draws it in one colour, the dark theme's danger text", () => {
    const darkColours: Array<string> = darkColourOf(
      FIELD_ERROR_COLOR_CLASS_NAME,
    );

    expect(darkColours).toEqual([
      tokenColourOf("html.dark", "--ou-danger-text"),
    ]);
  });

  test.each([
    ["a card or a dialog", "--ou-surface-primary", 8.6],
    ["a band", "--ou-surface-secondary", 7.7],
    ["a grey panel", "--ou-surface-tertiary", 6.6],
    ["the page", "--ou-background-primary", 9.4],
  ])(
    "and reads at 4.5:1 or more there, on %s (%s): %s:1",
    (_where: string, token: string, ratio: number) => {
      const contrast: number = contrastRatio(
        darkColourOf(FIELD_ERROR_COLOR_CLASS_NAME)[0] || "",
        tokenColourOf("html.dark", token),
      );

      expect(contrast).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
      expect(rounded(contrast)).toBe(ratio);
    },
  );
});

describe("reading a class token", () => {
  test.each([
    ["text-red-700", true],
    ["hover:text-red-800", true],
    ["!text-red-600", true],
    ["md:text-gray-500", true],
    ["text-white", true],
    ["text-[#b91c1c]", true],
    ["text-sm", false],
    ["text-xs", false],
    ["text-[11px]", false],
    ["text-left", false],
    ["md:text-lg", false],
    ["pl-14", false],
  ])("%s is a text colour: %s", (token: string, isColour: boolean) => {
    expect(isTextColourClass(token)).toBe(isColour);
  });

  test("a variant's brackets do not end the variant early", () => {
    expect(utilityOfClassToken("[&>p]:text-red-500")).toBe("text-red-500");
    expect(utilityOfClassToken("sm:hover:text-red-500")).toBe("text-red-500");
  });

  test("only a red at rest has a shade a reader reads", () => {
    expect(restingRedShadeOf("text-red-500")).toBe(500);
    expect(restingRedShadeOf("text-red-700")).toBe(700);
    expect(restingRedShadeOf("hover:text-red-500")).toBeNull();
    expect(restingRedShadeOf("text-rose-500")).toBeNull();
    expect(restingRedShadeOf("bg-red-500")).toBeNull();
  });
});

type FindingsInFunction = (text: string) => Array<FieldErrorColorFinding>;

const findingsIn: FindingsInFunction = (
  text: string,
): Array<FieldErrorColorFinding> => {
  return findFieldErrorColorFindings([
    { file: "packages/Common/UI/Components/Example.tsx", text: text },
  ]);
};

const kindsIn: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return findingsIn(text).map((finding: FieldErrorColorFinding): string => {
    return `${finding.kind} ${finding.classes.join(" ")}`;
  });
};

describe("the detector: a FieldError a field colours", () => {
  test("finds a colour in every way a className is written", () => {
    expect(
      kindsIn(
        '<FieldError message={error} className="mt-2 text-sm text-red-600" />',
      ),
    ).toEqual(["coloured-field-error text-red-600"]);
    expect(
      kindsIn(
        '<FieldError message={error} className={`mt-1 ${indent ? "pl-14" : ""} text-red-400`} />',
      ),
    ).toEqual(["coloured-field-error text-red-400"]);
    expect(
      kindsIn(
        '<FieldError message={error} className={isSmall ? "text-xs text-red-500" : "text-sm"} />',
      ),
    ).toEqual(["coloured-field-error text-red-500"]);
    expect(
      kindsIn(
        '<FieldError message={error} className={props.className || "text-sm text-gray-500"} />',
      ),
    ).toEqual([
      "coloured-field-error text-gray-500",
      "unread-field-error-class props.className",
    ]);
  });

  test("passes a field that only places its error, or leaves it be", () => {
    expect(kindsIn("<FieldError message={error} />")).toEqual([]);
    expect(
      kindsIn('<FieldError message={error} className="mt-2 pl-14 text-sm" />'),
    ).toEqual([]);
    expect(
      kindsIn(
        '<FieldError message={error} className={`mt-1 text-sm ${hasTitle ? "pl-14" : ""}`} />',
      ),
    ).toEqual([]);
    expect(
      kindsIn(
        '<FieldError message={error} className="text-[11px] font-medium" />',
      ),
    ).toEqual([]);
  });

  test("a className it cannot read is a finding: a place must be written out", () => {
    expect(
      kindsIn("<FieldError message={error} className={errorClassName} />"),
    ).toEqual(["unread-field-error-class errorClassName"]);
  });

  test("FieldError itself is where the red is written, and is not read", () => {
    expect(
      findFieldErrorColorFindings([
        {
          file: "packages/Common/UI/Components/Forms/Fields/FieldError.tsx",
          text: '<FieldError message="x" className="text-red-700" />',
        },
      ]),
    ).toEqual([]);
  });
});

describe("the detector: an error line drawn by hand", () => {
  test.each([
    ['<p className="text-sm text-red-500">{error}</p>', "error"],
    [
      '<span className="text-xs text-red-400">{props.nameError}</span>',
      "props.nameError",
    ],
    [
      '<p className="mt-1 text-[11px] text-red-500">{translator.translateText(issue)}</p>',
      "translator.translateText(issue)",
    ],
    [
      '<p className={`text-sm ${wide ? "w-full" : ""} text-red-300`}>\n  {loadError}\n</p>',
      "loadError",
    ],
  ])("finds %s", (markup: string, value: string) => {
    const findings: Array<FieldErrorColorFinding> = findingsIn(markup);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe(FieldErrorColorFindingKind.LightErrorLine);
    expect(findings[0]?.value).toBe(value);
  });

  test.each([
    // Red that reads.
    '<p className="text-sm text-red-600">{error}</p>',
    '<p className="text-sm text-red-700">{error}</p>',
    // A light red under a hover only.
    '<p className="text-sm text-gray-700 hover:text-red-500">{error}</p>',
    // Words of its own besides the value: not a line that holds only it.
    '<p className="text-sm text-red-500">Failed: {error}</p>',
    // A value that names no error.
    '<span className="text-red-500">{count}</span>',
    // An icon.
    '<Icon icon={IconProp.Alert} className="h-4 w-4 text-red-500" />',
  ])("passes %s", (markup: string) => {
    expect(findingsIn(markup)).toEqual([]);
  });
});

describe("the frontends", () => {
  const coreFiles: Array<string> = CORE_FRONTEND_DIRECTORIES.flatMap(
    (directory: string): Array<string> => {
      return listFrontendFiles(directory);
    },
  );

  test("are read: every core frontend's components", () => {
    expect(coreFiles.length).toBeGreaterThan(2000);
    expect(coreFiles).toEqual(
      expect.arrayContaining([
        "packages/Common/UI/Components/Forms/Fields/FieldError.tsx",
        "packages/Common/UI/Components/Toggle/Toggle.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/Permission/RolePicker.tsx",
        "packages/App/FeatureSet/AdminDashboard/src/Components/GlobalProvider/ProjectScopedTeamsPicker.tsx",
        "packages/App/FeatureSet/Accounts/src/Pages/Login.tsx",
      ]),
    );
  });

  test("colour no field's error but FieldError's, and draw no error line in a red lighter than red-600", () => {
    const findings: Array<string> = findFieldErrorColorFindings(
      readSources(coreFiles),
    ).map(describeFieldErrorColorFinding);

    if (findings.length > 0) {
      throw new Error(
        `${findings.length} error lines are drawn in a red of their own or one too light to read:\n\n${findings.join("\n")}\n\n${FIELD_ERROR_COLOR_ADVICE}`,
      );
    }

    expect(findings).toEqual([]);
  });

  test("the lines left on a dark ground are all in ee/, whose twin holds them", () => {
    expect(
      ERROR_LINES_ON_A_DARK_GROUND.map(
        (entry: ErrorLineOnADarkGround): string => {
          return entry.file.split("/")[0] || "";
        },
      ),
    ).toEqual(["ee"]);
  });
});
