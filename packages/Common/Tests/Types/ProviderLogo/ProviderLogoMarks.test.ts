import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo, {
  ALL_PROVIDER_LOGOS,
  PROVIDER_LOGO_NAMES,
} from "../../../Types/ProviderLogo/ProviderLogo";
import ALL_PROVIDER_LOGO_MARKS from "../../../Types/ProviderLogo/AllProviderLogoMarks";
import {
  ProviderLogoMarkShape,
  ProviderLogoMarkShapes,
} from "../../../Types/ProviderLogo/ProviderLogoMark";
import {
  getProviderLogoMark,
  getProviderLogoMarkBox,
  getProviderLogoMarkSize,
  getProviderLogoStandInIcon,
  PROVIDER_LOGO_MARK_BOXES,
  PROVIDER_LOGO_STAND_IN_ICONS,
  PROVIDER_LOGO_WORDMARK_RATIO,
  PROVIDER_LOGOS_DRAWN_BY_THEIR_MAKERS_MARK,
  ProviderLogoMarkBox,
} from "../../../Types/ProviderLogo/ProviderLogoMarks";

/*
 * ICONS AS ONE-COLOUR SVGS (icons-svg-one-color, doc 8 block 44).
 *
 * "We don't need images. We need SVGs, and we need official logos in SVGs
 * as well." Every product the registry names is drawn as OneUptime's own
 * icons are: by a one-colour mark - path data only, every shape filled with
 * the colour around it - or, where the brand's rules allow no logo in a
 * product like this, by one of OneUptime's icons. These hold every mark to
 * that, the boxes to the marks, and the README to both, so a mark added
 * later (fu-official-logos, the OpenTelemetry guides' follow-ups) cannot be
 * a colour logo, an image, or undocumented.
 */

const PROVIDER_LOGO_FOLDER: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Types",
  "ProviderLogo",
);
const MARKS_FOLDER: string = path.join(PROVIDER_LOGO_FOLDER, "Marks");
const README: string = fs.readFileSync(
  path.join(PROVIDER_LOGO_FOLDER, "README.md"),
  "utf8",
);
const OLD_IMAGE_FOLDER: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "UI",
  "Images",
  "ProviderLogos",
);

// Path data and nothing else: commands, numbers, separators.
const PATH_DATA: RegExp = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\- ]+$/;
// The first point a path moves to: "M12.5 3" or "m12.5-3" or "M12.5,3".
const FIRST_POINT: RegExp =
  /^[Mm]\s*(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)/;
// What a mark's module may never hold: a colour, a style, an address, markup.
const NOT_IN_A_MARK: ReadonlyArray<string> = [
  "#",
  "rgb(",
  "hsl(",
  "url(",
  "fill",
  "stroke",
  "style",
  "transform",
  "gradient",
  "Gradient",
  "http",
  "<",
  "data:",
  "class",
];

const MARK_FILES: Array<string> = fs
  .readdirSync(MARKS_FOLDER)
  .filter((name: string): boolean => {
    return name.endsWith(".ts");
  })
  .map((name: string): string => {
    return name.slice(0, -".ts".length);
  })
  .sort();

const MARKS: Array<ProviderLogo> = Object.keys(
  PROVIDER_LOGO_MARK_BOXES,
).sort() as Array<ProviderLogo>;

function shapesOf(mark: ProviderLogo): ProviderLogoMarkShapes {
  return ALL_PROVIDER_LOGO_MARKS[mark] || [];
}

function sourceOf(mark: string): string {
  return fs.readFileSync(path.join(MARKS_FOLDER, `${mark}.ts`), "utf8");
}

// The README's section that starts at a heading, up to the next one.
function readmeSection(heading: string): string {
  const start: number = README.indexOf(`## ${heading}`);
  const end: number = README.indexOf("\n## ", start + 3);

  return start === -1 ? "" : README.slice(start, end === -1 ? undefined : end);
}

describe("how every product is drawn", () => {
  test("the walk reads the registry, so the rules below are not vacuous", () => {
    expect(ALL_PROVIDER_LOGOS.length).toBeGreaterThan(90);
    expect(MARKS.length).toBeGreaterThan(80);
    expect(MARK_FILES.length).toBe(MARKS.length);
  });

  test.each(ALL_PROVIDER_LOGOS)(
    "%s is drawn exactly one way: its own mark, its maker's, or an icon of OneUptime's",
    (logo: ProviderLogo) => {
      const ways: Array<string> = [
        PROVIDER_LOGO_MARK_BOXES[logo] ? "own mark" : "",
        PROVIDER_LOGOS_DRAWN_BY_THEIR_MAKERS_MARK[logo] ? "maker's mark" : "",
        PROVIDER_LOGO_STAND_IN_ICONS[logo] ? "icon" : "",
      ].filter(Boolean);

      expect({ logo, ways: ways.length }).toEqual({ logo, ways: 1 });
    },
  );

  test("a maker's mark is a mark of its own, never another maker's or an icon", () => {
    for (const [product, maker] of Object.entries(
      PROVIDER_LOGOS_DRAWN_BY_THEIR_MAKERS_MARK,
    )) {
      expect({ product, makerHasMark: Boolean(PROVIDER_LOGO_MARK_BOXES[maker!]) })
        .toEqual({ product, makerHasMark: true });
    }
  });

  test("a stand-in is one of OneUptime's icons", () => {
    for (const [product, icon] of Object.entries(PROVIDER_LOGO_STAND_IN_ICONS)) {
      expect({ product, isIcon: Object.values(IconProp).includes(icon!) })
        .toEqual({ product, isIcon: true });
    }
  });

  test("the brands whose rules allow no logo here are drawn by icons, and only they", () => {
    expect(Object.keys(PROVIDER_LOGO_STAND_IN_ICONS).sort()).toEqual(
      [
        ProviderLogo.Aws,
        ProviderLogo.AmazonS3,
        ProviderLogo.AmazonBedrock,
        ProviderLogo.AwsSecurityHub,
        ProviderLogo.CrowdStrike,
        ProviderLogo.Groq,
        ProviderLogo.MicrosoftCopilot,
      ].sort(),
    );
  });

  test("Google Cloud's and Azure's services are drawn by their makers' marks", () => {
    expect(getProviderLogoMark(ProviderLogo.GoogleCloudStorage)).toBe(
      ProviderLogo.GoogleCloud,
    );
    expect(getProviderLogoMark(ProviderLogo.GoogleVertexAI)).toBe(
      ProviderLogo.GoogleCloud,
    );
    expect(getProviderLogoMark(ProviderLogo.GoogleSecurityOperations)).toBe(
      ProviderLogo.GoogleCloud,
    );
    expect(getProviderLogoMark(ProviderLogo.AzureBlobStorage)).toBe(
      ProviderLogo.Azure,
    );
    expect(getProviderLogoMark(ProviderLogo.AzureOpenAI)).toBe(
      ProviderLogo.Azure,
    );
    expect(getProviderLogoMark(ProviderLogo.MicrosoftSentinel)).toBe(
      ProviderLogo.Azure,
    );
  });

  test("a product drawn by an icon has no mark and no box; one with a mark has no icon", () => {
    expect(getProviderLogoMark(ProviderLogo.Aws)).toBeUndefined();
    expect(getProviderLogoMarkBox(ProviderLogo.Aws)).toBeUndefined();
    expect(getProviderLogoStandInIcon(ProviderLogo.Aws)).toBe(IconProp.Cloud);
    expect(getProviderLogoStandInIcon(ProviderLogo.AmazonS3)).toBe(
      IconProp.Archive,
    );
    expect(getProviderLogoStandInIcon(ProviderLogo.Slack)).toBeUndefined();
    expect(getProviderLogoMark(ProviderLogo.Slack)).toBe(ProviderLogo.Slack);
  });

  test("a mark's box is its own, and its maker's for a product drawn by it", () => {
    expect(getProviderLogoMarkBox(ProviderLogo.AzureOpenAI)).toEqual(
      getProviderLogoMarkBox(ProviderLogo.Azure),
    );
    expect(getProviderLogoMarkBox(ProviderLogo.Zoom)).toEqual({
      viewBox: "0 9.271 24 5.459",
      width: 24,
      height: 5.459,
    });
  });

  test("Java is drawn by Duke, OpenJDK's mark: Oracle allows no copy of its cup", () => {
    expect(getProviderLogoMark(ProviderLogo.Java)).toBe(ProviderLogo.Java);
    expect(sourceOf("java")).toContain("OpenJDK");
  });
});

describe("every mark is one colour, path data only", () => {
  test("no colour logo is left of the old images, nor any mark for dark backgrounds", () => {
    expect(fs.existsSync(OLD_IMAGE_FOLDER)).toBe(false);
    for (const file of MARK_FILES) {
      expect(file.endsWith("-dark")).toBe(false);
    }
  });

  test.each(MARK_FILES)(
    "%s.ts holds its shapes and nothing else: no colour, no style, no address",
    (mark: string) => {
      const source: string = sourceOf(mark);

      expect(source).toContain(
        'import { ProviderLogoMarkShapes } from "../ProviderLogoMark";',
      );
      expect(source).toContain("const MARK: ProviderLogoMarkShapes = [");
      expect(source.trim().endsWith("export default MARK;")).toBe(true);

      const code: string = source.slice(source.indexOf("const MARK"));

      for (const banned of NOT_IN_A_MARK) {
        expect({ mark, banned, found: code.includes(banned) }).toEqual({
          mark,
          banned,
          found: false,
        });
      }
    },
  );

  test.each(MARKS)("%s's shapes are path data, each one shape", (mark: ProviderLogo) => {
    const shapes: ProviderLogoMarkShapes = shapesOf(mark);

    expect(shapes.length).toBeGreaterThan(0);

    for (const shape of shapes) {
      expect(Object.keys(shape).sort()).toEqual(
        shape.opacity === undefined ? ["d"] : ["d", "opacity"],
      );
      expect(shape.d).toMatch(PATH_DATA);
      expect(shape.d.trim()[0]).toMatch(/[Mm]/);

      if (shape.opacity !== undefined) {
        // A lighter tint of the one colour, never another colour.
        expect(shape.opacity).toBeGreaterThan(0);
        expect(shape.opacity).toBeLessThan(1);
      }
    }
  });

  test("only UptimeRobot's halo is drawn lighter, as its own icon draws it", () => {
    const tinted: Array<string> = MARKS.filter((mark: ProviderLogo) => {
      return shapesOf(mark).some((shape: ProviderLogoMarkShape): boolean => {
        return shape.opacity !== undefined;
      });
    });

    expect(tinted).toEqual([ProviderLogo.UptimeRobot]);
  });

  test("every mark is small, and all of them together stay light", () => {
    let total: number = 0;

    for (const mark of MARKS) {
      const size: number = shapesOf(mark).reduce(
        (sum: number, shape: ProviderLogoMarkShape): number => {
          return sum + shape.d.length;
        },
        0,
      );

      // Gin's drawing, the busiest, is about eleven thousand characters.
      expect({ mark, small: size <= 12000 }).toEqual({ mark, small: true });
      total += size;
    }

    expect(total).toBeLessThan(160000);
  });
});

describe("every mark's box", () => {
  test.each(MARKS)("%s's box is four numbers, wider and taller than nothing", (mark: ProviderLogo) => {
    const viewBox: string = PROVIDER_LOGO_MARK_BOXES[mark]!;
    const parts: Array<number> = viewBox.split(" ").map(Number);

    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(Number.isFinite(part)).toBe(true);
    }
    expect(parts[2]).toBeGreaterThan(0);
    expect(parts[3]).toBeGreaterThan(0);
  });

  test.each(MARKS)("%s's first stroke starts inside its box", (mark: ProviderLogo) => {
    const box: ProviderLogoMarkBox = getProviderLogoMarkBox(mark)!;
    const [x, y] = box.viewBox.split(" ").map(Number) as [number, number];
    const first: RegExpMatchArray | null = shapesOf(mark)[0]!.d.match(
      FIRST_POINT,
    );

    expect(first).not.toBeNull();

    const pointX: number = Number(first![1]);
    const pointY: number = Number(first![2]);
    const slack: number = Math.max(box.width, box.height) * 0.01;

    expect(pointX).toBeGreaterThanOrEqual(x - slack);
    expect(pointX).toBeLessThanOrEqual(x + box.width + slack);
    expect(pointY).toBeGreaterThanOrEqual(y - slack);
    expect(pointY).toBeLessThanOrEqual(y + box.height + slack);
  });

  test("the wordmarks are wide, the symbols are not", () => {
    const ratio: (logo: ProviderLogo) => number = (logo: ProviderLogo) => {
      const box: ProviderLogoMarkBox = getProviderLogoMarkBox(logo)!;
      return box.width / box.height;
    };

    for (const wordmark of [
      ProviderLogo.Zoom,
      ProviderLogo.Splunk,
      ProviderLogo.Cisco,
      ProviderLogo.Go,
      ProviderLogo.Php,
      ProviderLogo.Koa,
      ProviderLogo.DotNet,
    ]) {
      expect({ wordmark, wide: ratio(wordmark) > PROVIDER_LOGO_WORDMARK_RATIO })
        .toEqual({ wordmark, wide: true });
    }

    for (const symbol of [
      ProviderLogo.Slack,
      ProviderLogo.Okta,
      ProviderLogo.Kubernetes,
      ProviderLogo.MinIO,
      ProviderLogo.Python,
    ]) {
      expect({ symbol, wide: ratio(symbol) > PROVIDER_LOGO_WORDMARK_RATIO })
        .toEqual({ symbol, wide: false });
    }
  });
});

describe("the size a mark is drawn at", () => {
  const box: (width: number, height: number) => ProviderLogoMarkBox = (
    width: number,
    height: number,
  ): ProviderLogoMarkBox => {
    return { viewBox: `0 0 ${width} ${height}`, width, height };
  };

  test("a square symbol fills the icon's square", () => {
    expect(
      getProviderLogoMarkSize({ box: box(24, 24), size: 20, maxWidth: 30 }),
    ).toEqual({ width: 20, height: 20 });
  });

  test("a tall symbol is as tall as the icon, at its own width", () => {
    expect(
      getProviderLogoMarkSize({ box: box(12, 24), size: 20, maxWidth: 30 }),
    ).toEqual({ width: 10, height: 20 });
  });

  test("a symbol a little wider than tall is as wide as the icon", () => {
    expect(
      getProviderLogoMarkSize({ box: box(26, 20), size: 20, maxWidth: 30 }),
    ).toEqual({ width: 20, height: 15.4 });
  });

  test("a wordmark is given more width, as much as its shape needs", () => {
    const drawn: { width: number; height: number } = getProviderLogoMarkSize({
      box: box(26, 10),
      size: 20,
      maxWidth: 40,
    });

    expect(drawn.width).toBeCloseTo(20 * Math.sqrt(2.6 / 1.3), 0);
    expect(drawn.height).toBeCloseTo(drawn.width / 2.6, 0);
  });

  test("a long wordmark never runs past the room there is", () => {
    expect(
      getProviderLogoMarkSize({ box: box(44, 10), size: 20, maxWidth: 30 }),
    ).toEqual({ width: 30, height: 6.8 });
  });

  test("where the room is smaller than the icon, the icon's size wins", () => {
    expect(
      getProviderLogoMarkSize({ box: box(44, 10), size: 20, maxWidth: 12 })
        .width,
    ).toBe(20);
  });

  test("a box with no height is drawn as a square", () => {
    expect(
      getProviderLogoMarkSize({ box: box(24, 0), size: 16, maxWidth: 24 }),
    ).toEqual({ width: 16, height: 16 });
  });
});

describe("the README says where every mark comes from", () => {
  test.each(MARK_FILES)("%s.ts has its row, with its source", (mark: string) => {
    const row: string | undefined = README.split("\n").find(
      (line: string): boolean => {
        return line.startsWith(`| \`${mark}.ts\` |`);
      },
    );

    expect(row).toBeDefined();

    const cells: Array<string> = row!
      .split("|")
      .map((cell: string): string => {
        return cell.trim();
      })
      .filter(Boolean);

    // The mark, the product, its source, the brand's rules.
    expect(cells.length).toBe(4);
    expect(cells[1]).toBe(PROVIDER_LOGO_NAMES[mark as ProviderLogo]);
    expect(cells[2]!.length).toBeGreaterThan(10);
  });

  test("every product drawn by an icon is named with its brand's rule", () => {
    const section: string = readmeSection("Drawn by one of OneUptime's icons");

    expect(section.length).toBeGreaterThan(0);
    for (const logo of Object.keys(PROVIDER_LOGO_STAND_IN_ICONS)) {
      expect(section).toContain(PROVIDER_LOGO_NAMES[logo as ProviderLogo]);
    }
  });

  test("every product drawn by its maker's mark is named there", () => {
    const section: string = readmeSection("Drawn by the maker's mark");

    expect(section.length).toBeGreaterThan(0);
    for (const logo of Object.keys(PROVIDER_LOGOS_DRAWN_BY_THEIR_MAKERS_MARK)) {
      expect(section).toContain(PROVIDER_LOGO_NAMES[logo as ProviderLogo]);
    }
  });

  test("the rule for a new mark is written down for whoever adds one", () => {
    const rule: string = readmeSection("Adding a mark");

    expect(rule).toContain("one-colour");
    expect(rule).toContain("Never a colour logo");
    expect(rule).toContain("PROVIDER_LOGO_STAND_IN_ICONS");
    expect(readmeSection("The rule: one colour, as an icon")).toContain(
      "Never an image",
    );
  });

  test("what keeps its colours on purpose is listed, with its reason", () => {
    const kept: string = readmeSection(
      "Kept in colour on purpose, outside this registry",
    );

    expect(kept).toContain("Sign in with Microsoft");
    expect(kept).toContain("Google Play");
    expect(kept).toContain("OneUptime's own logo");
    expect(kept).toContain("Emails");
  });
});
