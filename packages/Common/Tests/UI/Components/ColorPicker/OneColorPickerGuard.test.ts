import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * One color picker, everywhere.
 *
 * "Please make the color picker better in the entire project" - the
 * maintainer. The color field (Common/UI/Components/Forms/Fields/ColorPicker,
 * with its parts in Common/UI/Components/ColorPicker) is the friendly one:
 * named swatches first, Custom color for an exact code, checked as it is
 * typed, keyboard, screen reader and dark theme. A page that draws its own
 * color input - the browser's native one, a picker library, a hex text box,
 * a hand-made color wheel, or the field's inner parts assembled anew - is a
 * second, worse picker. This holds every frontend to the one field.
 *
 * Read from source, so a new page is held to it the day it is written.
 */

const REPOSITORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);
const PACKAGES: string = path.join(REPOSITORY, "packages");

// Every frontend's own code, and the shared UI they all draw with.
const SOURCE_ROOTS: Array<string> = [
  path.join(PACKAGES, "Common", "UI"),
  ...fs
    .readdirSync(path.join(PACKAGES, "App", "FeatureSet"))
    .map((name: string): string => {
      return path.join(PACKAGES, "App", "FeatureSet", name, "src");
    }),
  path.join(REPOSITORY, "ee", "Dashboard"),
  path.join(REPOSITORY, "ee", "AdminDashboard"),
].filter((root: string): boolean => {
  return fs.existsSync(root);
});

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
];

// The color field and its parts: the one place a color input is drawn.
const PICKER_FIELD: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Components",
  "Forms",
  "Fields",
  "ColorPicker.tsx",
);
const PICKER_PARTS: string = path.join(
  PACKAGES,
  "Common",
  "UI",
  "Components",
  "ColorPicker",
);

const isPickerItself: (file: string) => boolean = (file: string): boolean => {
  return file === PICKER_FIELD || file.startsWith(PICKER_PARTS + path.sep);
};

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

const listSources: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSources(fullPath));
      }
      continue;
    }

    if (
      TYPESCRIPT_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name)
    ) {
      files.push(fullPath);
    }
  }

  return files;
};

// Comments hold prose - "a native <input type="color">" - not code.
const stripComments: (source: string) => string = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
};

const NATIVE_COLOR_INPUT_PATTERNS: Array<RegExp> = [
  // <input type="color">, type={"color"}, element.type = "color"
  /\btype\s*=\s*\{?\s*["'`]color["'`]/g,
  // { type: "color" } handed to an input or a createElement
  /\btype\s*:\s*["'`]color["'`]/g,
  // element.setAttribute("type", "color")
  /setAttribute\(\s*["'`]type["'`]\s*,\s*["'`]color["'`]/g,
];

const findNativeColorInputs: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return NATIVE_COLOR_INPUT_PATTERNS.flatMap(
    (pattern: RegExp): Array<string> => {
      return Array.from(code.matchAll(pattern), (match: RegExpMatchArray) => {
        return match[0];
      });
    },
  );
};

const PICKER_LIBRARIES: RegExp =
  /^(react-color|react-colorful|react-color-palette|rc-color-picker|@rc-component\/color-picker|@uiw\/react-color[\w-]*|@simonwep\/pickr|vanilla-colorful|@jaames\/iro|react-best-gradient-color-picker)(\/|$)/;

const IMPORT_SPECIFIER: RegExp =
  /(?:import|export)\s[^;]*?from\s*["'`]([^"'`]+)["'`]|import\(\s*["'`]([^"'`]+)["'`]\s*\)|require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

const importSpecifiers: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return Array.from(
    code.matchAll(IMPORT_SPECIFIER),
    (match: RegExpMatchArray) => {
      return (match[1] || match[2] || match[3]) as string;
    },
  );
};

const findPickerLibraries: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return importSpecifiers(code).filter((specifier: string): boolean => {
    return PICKER_LIBRARIES.test(specifier);
  });
};

// The field's inner parts: drawn by the field, not assembled anew.
const PICKER_INNER_PARTS: RegExp =
  /(^|\/)ColorPicker\/(CustomColorPanel|ColorSwatchGroup)$/;

const findPickerPartImports: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return importSpecifiers(code).filter((specifier: string): boolean => {
    return PICKER_INNER_PARTS.test(specifier);
  });
};

// A text box offering to take a hex code: placeholder "#6366f1".
const HEX_PLACEHOLDER: RegExp =
  /\bplaceholder\s*[=:]\s*\{?\s*["'`]#[0-9a-fA-F]{3,8}["'`]/g;

const findHexCodeBoxes: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return Array.from(
    code.matchAll(HEX_PLACEHOLDER),
    (match: RegExpMatchArray) => {
      return match[0];
    },
  );
};

// A hand-made "any color" wheel, the custom swatch of a home-made picker.
const findColorWheels: (code: string) => Array<string> = (
  code: string,
): Array<string> => {
  return Array.from(
    code.matchAll(/conic-gradient\(/g),
    (match: RegExpMatchArray) => {
      return match[0];
    },
  );
};

interface Source {
  file: string;
  code: string;
}

// An import of the shared color field, by package path or from beside it.
const SHARED_FIELD_IMPORT: RegExp =
  /(^|\/)Forms\/Fields\/ColorPicker$|^\.\.\/Fields\/ColorPicker$/;

const SOURCES: Array<Source> = SOURCE_ROOTS.flatMap(listSources).map(
  (file: string): Source => {
    return { file, code: stripComments(fs.readFileSync(file, "utf8")) };
  },
);

const relative: (file: string) => string = (file: string): string => {
  return path.relative(REPOSITORY, file);
};

type OffendersFunction = (
  find: (code: string) => Array<string>,
  options?: { allowPicker?: boolean },
) => Array<string>;

const offenders: OffendersFunction = (
  find: (code: string) => Array<string>,
  options: { allowPicker?: boolean } = {},
): Array<string> => {
  return SOURCES.filter((source: Source): boolean => {
    if (options.allowPicker && isPickerItself(source.file)) {
      return false;
    }

    return find(source.code).length > 0;
  }).map((source: Source): string => {
    return `${relative(source.file)}: ${find(source.code).join(", ")}`;
  });
};

describe("one color picker in every frontend", () => {
  test("reads every frontend's source, and the field among it", () => {
    const files: Array<string> = SOURCES.map((source: Source): string => {
      return relative(source.file);
    });

    expect(SOURCES.length).toBeGreaterThan(1000);
    expect(files).toEqual(
      expect.arrayContaining([
        relative(PICKER_FIELD),
        "packages/App/FeatureSet/Dashboard/src/Pages/Settings/Labels.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/Metrics/SeriesColorSelector.tsx",
        "packages/Common/UI/Components/CustomFields/DropdownOptionsInput.tsx",
        "packages/Common/UI/Components/Workflow/ColumnEditor/ColumnValueInput.tsx",
      ]),
    );
  });

  test("no page draws the browser's own color input", () => {
    expect(offenders(findNativeColorInputs)).toEqual([]);
  });

  test("no page brings in a color picker library", () => {
    expect(offenders(findPickerLibraries)).toEqual([]);
  });

  test("no page assembles the field's parts into a picker of its own", () => {
    expect(offenders(findPickerPartImports, { allowPicker: true })).toEqual([]);
  });

  test("no page offers a text box for a hex code", () => {
    expect(offenders(findHexCodeBoxes, { allowPicker: true })).toEqual([]);
  });

  test("no page draws a color wheel of its own", () => {
    expect(offenders(findColorWheels, { allowPicker: true })).toEqual([]);
  });

  test.each([
    "packages/Common/UI/Components/Forms/Fields/FormField.tsx",
    "packages/Common/UI/Components/CustomFields/DropdownOptionsInput.tsx",
    "packages/Common/UI/Components/Workflow/ColumnEditor/ColumnValueInput.tsx",
    "packages/App/FeatureSet/Dashboard/src/Components/Metrics/SeriesColorSelector.tsx",
  ])("%s chooses colors with the shared field", (file: string) => {
    const source: Source | undefined = SOURCES.find(
      (candidate: Source): boolean => {
        return relative(candidate.file) === file;
      },
    );

    expect(source).toBeDefined();
    expect(
      importSpecifiers(source!.code).some((specifier: string): boolean => {
        return SHARED_FIELD_IMPORT.test(specifier);
      }),
    ).toBe(true);
  });
});

/*
 * The finders catch what they are for - so an empty list above means the
 * product is clean, not that a pattern stopped matching.
 */
describe("the guard's finders", () => {
  test("find native color inputs, written any way", () => {
    expect(findNativeColorInputs('<input type="color" />')).toHaveLength(1);
    expect(findNativeColorInputs("<input type={'color'} />")).toHaveLength(1);
    expect(findNativeColorInputs('{ type: "color", value }')).toHaveLength(1);
    expect(
      findNativeColorInputs('input.setAttribute("type", "color");'),
    ).toHaveLength(1);
    expect(findNativeColorInputs('input.type = "color";')).toHaveLength(1);
    expect(findNativeColorInputs('<input type="text" />')).toEqual([]);
    expect(findNativeColorInputs('{ type: "colorful" }')).toEqual([]);
  });

  test("find picker libraries, and only those", () => {
    expect(
      findPickerLibraries(
        'import ChromePicker from "react-color/lib/components/chrome/Chrome";',
      ),
    ).toEqual(["react-color/lib/components/chrome/Chrome"]);
    expect(
      findPickerLibraries('import { HexColorPicker } from "react-colorful";'),
    ).toEqual(["react-colorful"]);
    expect(
      findPickerLibraries('const x = require("@uiw/react-color-sketch");'),
    ).toEqual(["@uiw/react-color-sketch"]);
    expect(
      findPickerLibraries('import Color from "Common/Types/Color";'),
    ).toEqual([]);
  });

  test("find the field's parts imported from elsewhere", () => {
    expect(
      findPickerPartImports(
        'import CustomColorPanel from "Common/UI/Components/ColorPicker/CustomColorPanel";',
      ),
    ).toHaveLength(1);
    expect(
      findPickerPartImports(
        'import ColorSwatchGroup from "../ColorPicker/ColorSwatchGroup";',
      ),
    ).toHaveLength(1);
    // The palette and the arithmetic are for anyone.
    expect(
      findPickerPartImports(
        'import { COLOR_PICKER_SWATCHES } from "Common/UI/Components/ColorPicker/ColorPalette";',
      ),
    ).toEqual([]);
  });

  test("find hex code boxes and color wheels", () => {
    expect(findHexCodeBoxes('<input placeholder="#6366f1" />')).toHaveLength(1);
    expect(findHexCodeBoxes('{ placeholder: "#000" }')).toHaveLength(1);
    expect(findHexCodeBoxes('<input placeholder="#1 on the list" />')).toEqual(
      [],
    );
    expect(
      findColorWheels('style={{ background: "conic-gradient(red, blue)" }}'),
    ).toHaveLength(1);
  });

  test("read past what comments say", () => {
    expect(
      findNativeColorInputs(
        stripComments('/* <input type="color"> */ const a = 1;'),
      ),
    ).toEqual([]);
    expect(
      findNativeColorInputs(
        stripComments('// <input type="color">\nconst a = 1;'),
      ),
    ).toEqual([]);
    // A URL's // is not a comment.
    expect(stripComments('const url = "https://example.com";')).toContain(
      "https://example.com",
    );
  });
});
