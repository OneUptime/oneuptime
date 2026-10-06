import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A person's colour on the on-call screens has one source.
 *
 * Avatars, calendar blocks, timeline bars and legend dots colour a person from
 * their user id, and a reader follows a person from card to card by that
 * colour. It used to be worked out twice: LayerUserColors hashed people into
 * BrandColors.BrightColors (black first, a grey in the middle), and the
 * Schedule Timeline lifted the black ones to slate on its own - so a person
 * drawn black on the layer card was slate on the timeline. Now
 * LayerUserColors is the only place a person's colour is worked out, from
 * Utils/DistinctColor's palette, and every card asks it.
 *
 * Read from source, so a new card is held to it the day it is written:
 *
 *   - no on-call file but LayerUserColors picks colours itself: no palette
 *     (BrightColors, ChartColors, DistinctColor, the colour field's swatches)
 *     and no hashing;
 *   - LayerUserColors picks from DistinctColor, and gives initials their
 *     colour with the colour field's mark rule;
 *   - text on a person's colour comes with its mark colour: an element with
 *     children never takes the bare colour as its background, and a card that
 *     draws initials draws them with the avatar pair.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

// Every screen that draws an on-call person.
const SCANNED_ROOTS: Array<string> = [
  path.join(DASHBOARD_SOURCE, "Components", "OnCallPolicy"),
  path.join(DASHBOARD_SOURCE, "Pages", "OnCallDuty"),
];

const PERSON_COLORS_FILE: string = path.join(
  DASHBOARD_SOURCE,
  "Components",
  "OnCallPolicy",
  "OnCallScheduleLayer",
  "LayerUserColors.ts",
);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSources(fullPath));
    } else if (TYPESCRIPT_FILE.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

// Comments hold prose ("BrightColors starts with black"), not code.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

interface Source {
  file: string;
  relative: string;
  code: string;
}

const SOURCES: Array<Source> = SCANNED_ROOTS.flatMap(listSources).map(
  (file: string): Source => {
    return {
      file,
      relative: path.relative(DASHBOARD_SOURCE, file),
      code: stripComments(fs.readFileSync(file, "utf8")),
    };
  },
);

const IMPORT_STATEMENT: RegExp =
  /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["'`]([^"'`]+)["'`]/g;

interface ImportStatement {
  names: string;
  from: string;
}

function importsOf(code: string): Array<ImportStatement> {
  return Array.from(
    code.matchAll(IMPORT_STATEMENT),
    (match: RegExpMatchArray): ImportStatement => {
      return { names: match[1] || "", from: match[2] || "" };
    },
  );
}

const PALETTE_NAMES: RegExp = /\b(BrightColors|ChartColors)\b/;
const PALETTE_MODULES: RegExp =
  /(^|\/)(Utils\/DistinctColor|UI\/Components\/ColorPicker\/ColorPalette)$/;
const HASH_MODULE: RegExp = /(^|\/)Types\/HashCode$/;

// The colour pickers' own sources, by what is imported from where.
function findColorSources(code: string): Array<string> {
  return importsOf(code)
    .filter((statement: ImportStatement): boolean => {
      return (
        (statement.from.endsWith("Types/BrandColors") &&
          PALETTE_NAMES.test(statement.names)) ||
        PALETTE_MODULES.test(statement.from) ||
        HASH_MODULE.test(statement.from)
      );
    })
    .map((statement: ImportStatement): string => {
      return statement.from;
    });
}

// A second "colour for a person" function, by its name.
const PERSON_COLOR_FUNCTION: RegExp =
  /\b(?:function|const|let)\s+(get\w*Colou?rFor\w*User\w*|get\w*Timeline\w*Colou?r\w*|get\w*Person\w*Colou?r\w*)\b/g;

function findPersonColorFunctions(code: string): Array<string> {
  return Array.from(
    code.matchAll(PERSON_COLOR_FUNCTION),
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
}

/*
 * The opening tags of a JSX file, each up to its closing ">" - braces are
 * followed, so the "=>" of an inline handler does not end a tag early.
 */
function openingTags(code: string): Array<string> {
  const tags: Array<string> = [];
  const tagStart: RegExp = /<[A-Za-z][\w.]*/g;
  let match: RegExpExecArray | null = tagStart.exec(code);

  while (match) {
    let depth: number = 0;
    let quote: string | null = null;
    let end: number = -1;

    for (let index: number = match.index + 1; index < code.length; index++) {
      const character: string = code[index]!;

      if (quote) {
        if (character === quote && code[index - 1] !== "\\") {
          quote = null;
        }
        continue;
      }

      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
      } else if (character === ">" && depth === 0) {
        end = index;
        break;
      }
    }

    if (end === -1) {
      break;
    }

    tags.push(code.slice(match.index, end + 1));
    tagStart.lastIndex = end + 1;
    match = tagStart.exec(code);
  }

  return tags;
}

const BARE_PERSON_BACKGROUND: RegExp =
  /backgroundColor:\s*[^,}]*getColorForUserId\(/;
const AVATAR_PAIR: RegExp = /getUserAvatarStyle\(|\bavatarStyle\b/;
const TEXT_WHITE: RegExp = /\btext-white\b/;

// Elements that would put text on a person's colour without its mark colour.
function findBareColorsBehindText(code: string): Array<string> {
  return openingTags(code).filter((tag: string): boolean => {
    const isSelfClosing: boolean = tag.endsWith("/>");

    return (
      (BARE_PERSON_BACKGROUND.test(tag) && !isSelfClosing) ||
      (AVATAR_PAIR.test(tag) && TEXT_WHITE.test(tag))
    );
  });
}

const DRAWS_INITIALS: RegExp = /\bgetUserInitials\(/;
const USES_AVATAR_PAIR: RegExp = /\bgetUserAvatarStyle\(/;

function sourceOf(relative: string): Source {
  const source: Source | undefined = SOURCES.find(
    (candidate: Source): boolean => {
      return candidate.relative === relative;
    },
  );

  expect(source).toBeDefined();

  return source!;
}

describe("a person's colour on the on-call screens has one source", () => {
  test("the scan reads every card that draws a person", () => {
    expect(
      SOURCES.map((source: Source): string => {
        return source.relative;
      }),
    ).toEqual(
      expect.arrayContaining(
        [
          "OnCallScheduleLayer/LayerUserColors.ts",
          "OnCallScheduleLayer/LayerCard.tsx",
          "OnCallScheduleLayer/LayerUser.tsx",
          "OnCallScheduleLayer/AddLayerUserModal.tsx",
          "OnCallScheduleLayer/LayerRotationSummary.tsx",
          "OnCallScheduleLayer/FinalScheduleSummary.tsx",
          "OnCallScheduleLayer/ActiveOverridesCard.tsx",
          "OnCallScheduleLayer/LayersPreview.tsx",
          "ScheduleTimeline/TimelineBar.tsx",
          "ScheduleTimeline/TimelineRow.tsx",
          "ScheduleTimeline/TimelineModel.ts",
          "ScheduleTimeline/TimelineLegend.tsx",
        ].map((file: string): string => {
          return path.join("Components", "OnCallPolicy", file);
        }),
      ),
    );
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  test("no on-call file but LayerUserColors picks a palette or hashes", () => {
    const offenders: Array<string> = SOURCES.filter(
      (source: Source): boolean => {
        return (
          source.file !== PERSON_COLORS_FILE &&
          findColorSources(source.code).length > 0
        );
      },
    ).map((source: Source): string => {
      return `${source.relative}: ${findColorSources(source.code).join(", ")}`;
    });

    expect(offenders).toEqual([]);
  });

  test("no on-call file but LayerUserColors defines a colour for a person", () => {
    const offenders: Array<string> = SOURCES.filter(
      (source: Source): boolean => {
        return (
          source.file !== PERSON_COLORS_FILE &&
          findPersonColorFunctions(source.code).length > 0
        );
      },
    ).map((source: Source): string => {
      return `${source.relative}: ${findPersonColorFunctions(source.code).join(", ")}`;
    });

    expect(offenders).toEqual([]);
  });

  test("the timeline has no colour rule of its own any more", () => {
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SOURCE,
          "Components",
          "OnCallPolicy",
          "ScheduleTimeline",
          "TimelineColors.ts",
        ),
      ),
    ).toBe(false);

    for (const file of [
      "Components/OnCallPolicy/ScheduleTimeline/TimelineBar.tsx",
      "Components/OnCallPolicy/ScheduleTimeline/TimelineRow.tsx",
      "Components/OnCallPolicy/ScheduleTimeline/TimelineModel.ts",
    ]) {
      expect({
        file,
        asksLayerUserColors: importsOf(
          sourceOf(path.normalize(file)).code,
        ).some((statement: ImportStatement): boolean => {
          return statement.from.endsWith("OnCallScheduleLayer/LayerUserColors");
        }),
      }).toEqual({ file, asksLayerUserColors: true });
    }
  });
});

describe("LayerUserColors", () => {
  const code: string = stripComments(
    fs.readFileSync(PERSON_COLORS_FILE, "utf8"),
  );
  const PICKS_BY_NAME: RegExp = /\bpickColorForName\b/;
  const MARK_RULE: RegExp = /\bgetMarkColor\b/;

  test("picks from the shared distinct palette, never BrightColors", () => {
    expect(
      importsOf(code).some((statement: ImportStatement): boolean => {
        return (
          statement.from === "Common/Utils/DistinctColor" &&
          PICKS_BY_NAME.test(statement.names)
        );
      }),
    ).toBe(true);
    expect(code).not.toMatch(/\bBrightColors\b/);
    expect(code).not.toMatch(/\bHashCode\b/);
  });

  test("gives initials their colour with the colour field's mark rule", () => {
    expect(
      importsOf(code).some((statement: ImportStatement): boolean => {
        return (
          statement.from === "Common/UI/Components/ColorPicker/ColorValue" &&
          MARK_RULE.test(statement.names)
        );
      }),
    ).toBe(true);
    expect(code).toMatch(/color:\s*getMarkColor\(/);
  });
});

describe("text on a person's colour comes with its mark colour", () => {
  test("no element with children takes a person's bare colour as its background", () => {
    const offenders: Array<string> = SOURCES.filter(
      (source: Source): boolean => {
        return findBareColorsBehindText(source.code).length > 0;
      },
    ).map((source: Source): string => {
      return `${source.relative}: ${findBareColorsBehindText(source.code).join(" | ")}`;
    });

    expect(offenders).toEqual([]);
  });

  test("every card that draws initials draws them with the avatar pair", () => {
    const drawsInitials: Array<Source> = SOURCES.filter(
      (source: Source): boolean => {
        return (
          source.file !== PERSON_COLORS_FILE &&
          source.file.endsWith(".tsx") &&
          DRAWS_INITIALS.test(source.code)
        );
      },
    );

    /*
     * The layer card, users list, Add user dialog, rotation summary, final
     * schedule summary, overrides card and the timeline's bar.
     */
    expect(drawsInitials.length).toBeGreaterThanOrEqual(7);

    const offenders: Array<string> = drawsInitials
      .filter((source: Source): boolean => {
        return !USES_AVATAR_PAIR.test(source.code);
      })
      .map((source: Source): string => {
        return source.relative;
      });

    expect(offenders).toEqual([]);
  });
});

/*
 * The finders catch what they are for - so an empty list above means the
 * screens are clean, not that a pattern stopped matching.
 */
describe("the guard's finders", () => {
  test("find palettes and hashing brought in for colours", () => {
    expect(
      findColorSources(
        'import { Blue500, BrightColors } from "Common/Types/BrandColors";',
      ),
    ).toEqual(["Common/Types/BrandColors"]);
    expect(
      findColorSources('import HashCode from "Common/Types/HashCode";'),
    ).toEqual(["Common/Types/HashCode"]);
    expect(
      findColorSources(
        'import { pickColorForName } from "Common/Utils/DistinctColor";',
      ),
    ).toEqual(["Common/Utils/DistinctColor"]);
    expect(
      findColorSources(
        'import { COLOR_PICKER_SWATCHES } from "Common/UI/Components/ColorPicker/ColorPalette";',
      ),
    ).toEqual(["Common/UI/Components/ColorPicker/ColorPalette"]);
    // A pill's named colour is not a person's colour.
    expect(
      findColorSources(
        'import { Green, Red } from "Common/Types/BrandColors";',
      ),
    ).toEqual([]);
  });

  test("find a second colour-for-a-person function", () => {
    expect(
      findPersonColorFunctions(
        "export function getTimelineColorForUserId(userId: string): string {",
      ),
    ).toEqual(["getTimelineColorForUserId"]);
    expect(
      findPersonColorFunctions("const getColorForUser = (id) => id;"),
    ).toEqual(["getColorForUser"]);
    expect(findPersonColorFunctions("function getPersonColour(id) {}")).toEqual(
      ["getPersonColour"],
    );
    expect(findPersonColorFunctions("function getUserInitials() {}")).toEqual(
      [],
    );
  });

  test("read whole opening tags, past an inline arrow function", () => {
    expect(
      openingTags(
        '<button onClick={() => { go(); }} className="a">Go</button>',
      ),
    ).toEqual(['<button onClick={() => { go(); }} className="a">']);
    expect(openingTags('<span className="dot" />')).toEqual([
      '<span className="dot" />',
    ]);
  });

  test("find text put on a person's bare colour, or a redundant text-white", () => {
    expect(
      findBareColorsBehindText(
        '<span className="h-6 w-6 text-white" style={{ backgroundColor: getColorForUserId(id) }}>{initials}</span>',
      ),
    ).toHaveLength(1);
    expect(
      findBareColorsBehindText(
        '<span className="h-6 w-6 text-white" style={getUserAvatarStyle(id)}>{initials}</span>',
      ),
    ).toHaveLength(1);
    // A dot holds no text: the bare colour is right for it.
    expect(
      findBareColorsBehindText(
        '<span className="h-2 w-2" style={{ backgroundColor: getColorForUserId(id) }} />',
      ),
    ).toEqual([]);
    expect(
      findBareColorsBehindText(
        '<span className="h-6 w-6" style={getUserAvatarStyle(id)}>{initials}</span>',
      ),
    ).toEqual([]);
  });

  test("read past what comments say", () => {
    expect(
      findColorSources(
        stripComments(
          '/* import { BrightColors } from "Common/Types/BrandColors"; */',
        ),
      ),
    ).toEqual([]);
  });
});
