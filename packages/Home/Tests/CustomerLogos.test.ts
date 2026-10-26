import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";
import postcss, { AtRule, ChildNode, Declaration, Root, Rule } from "postcss";

/*
 * The customer logo strip (Views/logo-roll.ejs), which some fifty pages
 * include under their hero: two rows of logos that drift past in opposite
 * directions. Each row is drawn twice, side by side, and moves left by half
 * its length before it starts again - so the copy has to be the row exactly,
 * one gap after it, or the loop jumps. The copy is for the eye only. Hovering
 * stops the motion, and visitors who ask for less motion get every logo once,
 * standing still.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const CUSTOMERS: string = path.join(
  __dirname,
  "..",
  "Static",
  "img",
  "customers",
);
const SRC_PREFIX: string = "/img/customers/";

interface Logo {
  name: string;
  file: string;
  width: number;
  height: number;
  cssWidth: string;
}

interface ArtworkSize {
  width: number;
  height: number;
}

// The size a logo's file declares: an SVG's width and height, a PNG's IHDR.
const artworkSize: (file: string) => ArtworkSize = (
  file: string,
): ArtworkSize => {
  const full: string = path.join(CUSTOMERS, file);

  if (file.endsWith(".svg")) {
    const svg: Element = new JSDOM(fs.readFileSync(full, "utf8"), {
      contentType: "image/svg+xml",
    }).window.document.documentElement;

    return {
      width: Number(svg.getAttribute("width")),
      height: Number(svg.getAttribute("height")),
    };
  }

  const png: Buffer = fs.readFileSync(full);

  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

const logosIn: (list: Element) => Array<Logo> = (
  list: Element,
): Array<Logo> => {
  return Array.from(list.querySelectorAll("img")).map(
    (image: HTMLImageElement): Logo => {
      return {
        name: image.getAttribute("alt") || "",
        file: (image.getAttribute("src") || "").replace(SRC_PREFIX, ""),
        width: Number(image.getAttribute("width")),
        height: Number(image.getAttribute("height")),
        cssWidth: image.style.getPropertyValue("--customer-logo-width"),
      };
    },
  );
};

const declarationsOf: (rule: Rule) => Record<string, string> = (
  rule: Rule,
): Record<string, string> => {
  const declarations: Record<string, string> = {};

  rule.each((node: ChildNode) => {
    if (node.type === "decl") {
      declarations[(node as Declaration).prop] = (node as Declaration).value;
    }
  });

  return declarations;
};

// The rules directly inside `container` (the sheet, or an @media block) that list `selector`.
const rulesFor: (
  container: Root | AtRule,
  selector: string,
) => Array<Record<string, string>> = (
  container: Root | AtRule,
  selector: string,
): Array<Record<string, string>> => {
  const found: Array<Record<string, string>> = [];

  container.each((node: ChildNode) => {
    if (
      node.type === "rule" &&
      (node as Rule).selectors.includes(selector)
    ) {
      found.push(declarationsOf(node as Rule));
    }
  });

  return found;
};

const mediaBlock: (sheet: Root, params: string) => AtRule = (
  sheet: Root,
  params: string,
): AtRule => {
  let block: AtRule | null = null;

  sheet.walkAtRules("media", (rule: AtRule) => {
    if (rule.params === params) {
      block = rule;
    }
  });

  expect([params, block !== null]).toEqual([params, true]);
  return block!;
};

let html: string;
let document: Document;
let section: Element;
let tracks: Array<Element>;
let sheet: Root;

beforeAll(async () => {
  html = (await ejs.renderFile(
    path.join(VIEWS_ROOT, "logo-roll.ejs"),
    {},
    { views: [VIEWS_ROOT] },
  )) as string;
  document = new JSDOM(html).window.document;
  section = document.querySelector(
    "section[aria-labelledby='customer-logos-title']",
  )!;
  tracks = Array.from(document.querySelectorAll(".customer-logos-track"));
  sheet = postcss.parse(document.querySelector("style")!.textContent || "");
});

describe("the customers it shows", () => {
  test("renders, as one section", () => {
    expect(html).not.toContain("<%");
    expect(document.querySelectorAll("section")).toHaveLength(1);
    expect(section).not.toBeNull();
    expect(tracks).toHaveLength(2);
  });

  test("leads with the largest companies, then the rest", () => {
    const names: Array<Array<string>> = tracks.map(
      (track: Element): Array<string> => {
        return logosIn(track.querySelector("ul")!).map((logo: Logo) => {
          return logo.name;
        });
      },
    );

    expect(names).toEqual([
      [
        "IBM",
        "Siemens",
        "Airbus",
        "Tesco",
        "Thermo Fisher Scientific",
        "Comcast",
        "PayPal",
        "Vodafone",
        "ZF",
        "Booz Allen Hamilton",
        "ServiceNow",
        "Optum",
        "FIS",
        "Applied Materials",
        "Bristol Myers Squibb",
        "Deloitte",
      ],
      [
        "Mistral AI",
        "Trend Micro",
        "Nutanix",
        "Keyfactor",
        "Aptean",
        "Securonix",
        "Syniti",
        "The Access Group",
        "Synology",
        "AirAsia",
        "PayU",
        "Portainer",
        "Aareon",
        "NT-ware",
        "Avolve Software",
        "CSCS",
      ],
    ]);
  });

  test("shows each customer once, from a file of its own", () => {
    const logos: Array<Logo> = tracks.flatMap((track: Element) => {
      return logosIn(track.querySelector("ul")!);
    });

    expect(new Set(logos.map((logo: Logo) => {return logo.name})).size).toBe(
      logos.length,
    );
    expect(new Set(logos.map((logo: Logo) => {return logo.file})).size).toBe(
      logos.length,
    );
  });

  test("draws every logo from Static/img/customers, and every file there is drawn", () => {
    const sources: Array<string> = Array.from(
      section.querySelectorAll("img"),
    ).map((image: Element): string => {
      return image.getAttribute("src") || "";
    });

    for (const source of sources) {
      expect(source.startsWith(SRC_PREFIX)).toBe(true);
    }

    const drawn: Array<string> = Array.from(
      new Set(
        sources.map((source: string): string => {
          return source.replace(SRC_PREFIX, "");
        }),
      ),
    ).sort();

    expect(drawn).toEqual(
      fs
        .readdirSync(CUSTOMERS)
        .filter((file: string) => {
          return !file.startsWith(".");
        })
        .sort(),
    );
  });

  test("links nowhere: a logo is not a way off the page", () => {
    expect(section.querySelectorAll("a")).toHaveLength(0);
  });
});

describe("for screen readers", () => {
  test("is labelled by its caption", () => {
    const caption: Element | null = document.getElementById(
      section.getAttribute("aria-labelledby")!,
    );

    expect(caption!.textContent!.trim()).toBe("Trusted by engineering teams at");
  });

  test("names each customer once, and hides the copy that closes the loop", () => {
    for (const track of tracks) {
      const [row, copy] = Array.from(track.querySelectorAll("ul"));

      expect(track.querySelectorAll("ul")).toHaveLength(2);
      expect(row!.hasAttribute("aria-hidden")).toBe(false);
      expect(copy!.getAttribute("aria-hidden")).toBe("true");

      for (const logo of logosIn(row!)) {
        expect(logo.name.length).toBeGreaterThan(0);
      }

      for (const logo of logosIn(copy!)) {
        expect([logo.file, logo.name]).toEqual([logo.file, ""]);
      }
    }
  });
});

describe("the loop", () => {
  test("draws the copy exactly as the row it follows", () => {
    for (const track of tracks) {
      const [row, copy] = Array.from(track.querySelectorAll("ul"));
      const withoutNames: (logo: Logo) => Omit<Logo, "name"> = (
        logo: Logo,
      ): Omit<Logo, "name"> => {
        return {
          file: logo.file,
          width: logo.width,
          height: logo.height,
          cssWidth: logo.cssWidth,
        };
      };

      expect(logosIn(copy!).map(withoutNames)).toEqual(
        logosIn(row!).map(withoutNames),
      );
      expect(copy!.getAttribute("class")).toBe(row!.getAttribute("class"));
    }
  });

  test("moves each row by exactly one copy, then starts again", () => {
    let keyframes: AtRule | null = null;

    sheet.walkAtRules("keyframes", (rule: AtRule) => {
      if (rule.params === "customer-logos-drift") {
        keyframes = rule;
      }
    });

    expect(keyframes).not.toBeNull();

    const steps: Array<Rule> = [];

    keyframes!.each((node: ChildNode) => {
      if (node.type === "rule") {
        steps.push(node as Rule);
      }
    });

    // From where it is drawn (no transform) to half its width: one copy along.
    expect(steps.map((step: Rule) => {return step.selector})).toEqual(["to"]);
    expect(declarationsOf(steps[0]!)).toEqual({
      transform: "translate3d(-50%, 0, 0)",
    });

    const [track] = rulesFor(sheet, ".customer-logos-track");

    expect(track!["display"]).toBe("flex");
    expect(track!["width"]).toBe("max-content");
    expect(track!["animation"]).toBe(
      "customer-logos-drift var(--customer-logos-seconds, 80s) linear infinite",
    );
  });

  test("ends each copy with the gap between its logos, so the next starts a gap on", () => {
    const small: AtRule = mediaBlock(sheet, "(min-width: 640px)");

    for (const container of [sheet, small]) {
      const [list] = rulesFor(container, ".customer-logos-list");

      expect(list!["gap"]).toBeDefined();
      expect(list!["padding-right"]).toBe(list!["gap"]);
    }
  });

  test("runs the rows in opposite directions", () => {
    expect(
      tracks.map((track: Element) => {
        return track.getAttribute("data-direction");
      }),
    ).toEqual(["left", "right"]);
    expect(
      rulesFor(sheet, '.customer-logos-track[data-direction="right"]'),
    ).toEqual([{ "animation-direction": "reverse" }]);
  });

  test("moves every row at the same, unhurried speed", () => {
    const [list] = rulesFor(
      mediaBlock(sheet, "(min-width: 640px)"),
      ".customer-logos-list",
    );
    const gap: number = parseFloat(list!["gap"]!) * 16;

    const speeds: Array<number> = tracks.map((track: Element): number => {
      const seconds: number = parseFloat(
        (track as HTMLElement).style.getPropertyValue(
          "--customer-logos-seconds",
        ),
      );
      const length: number = logosIn(track.querySelector("ul")!).reduce(
        (total: number, logo: Logo): number => {
          return total + logo.width + gap;
        },
        0,
      );

      // A lap takes over a minute, so a logo is on screen long enough to read.
      expect(seconds).toBeGreaterThan(60);
      return length / seconds;
    });

    for (const speed of speeds) {
      // Pixels a second; the seconds are rounded to whole ones.
      expect(speed).toBeGreaterThan(35);
      expect(speed).toBeLessThan(37);
    }
  });

  test("fades the rows out at both ends, and keeps their width out of the page's layout", () => {
    const viewport: Element = section.querySelector(
      ".customer-logos-viewport",
    )!;
    const [rule] = rulesFor(sheet, ".customer-logos-viewport");

    expect(viewport.classList.contains("overflow-hidden")).toBe(true);
    expect(rule!["contain"]).toBe("inline-size");
    expect(rule!["mask-image"]).toMatch(
      /^linear-gradient\(to right, transparent, .+, transparent\)$/,
    );
    expect(rule!["-webkit-mask-image"]).toBe(rule!["mask-image"]);
  });
});

describe("stopping it", () => {
  test("pauses both rows while the pointer is over them", () => {
    let paused: Rule | null = null;

    sheet.each((node: ChildNode) => {
      if (
        node.type === "rule" &&
        declarationsOf(node as Rule)["animation-play-state"] === "paused"
      ) {
        paused = node as Rule;
      }
    });

    expect(paused).not.toBeNull();
    expect(paused!.selectors).toEqual([
      ".customer-logos-viewport:hover .customer-logos-track",
    ]);
  });

  test("has no pause button: nothing in the strip is there to be pressed", () => {
    expect(
      section.querySelectorAll("input, label, button, [tabindex]"),
    ).toHaveLength(0);
  });
});

describe("for visitors who ask for less motion", () => {
  let reduced: AtRule;

  beforeAll(() => {
    reduced = mediaBlock(sheet, "(prefers-reduced-motion: reduce)");
  });

  test("stands the rows still, at their own width", () => {
    expect(rulesFor(reduced, ".customer-logos-track")).toEqual([
      { width: "auto", animation: "none" },
    ]);
  });

  test("shows every logo once, wrapped and centred, with nothing faded", () => {
    const [list] = rulesFor(reduced, ".customer-logos-list");

    expect(list!["flex-wrap"]).toBe("wrap");
    expect(list!["justify-content"]).toBe("center");
    expect(rulesFor(reduced, ".customer-logos-viewport")).toEqual([
      { "-webkit-mask-image": "none", "mask-image": "none" },
    ]);
  });

  test("drops the copy, which has nothing left to do", () => {
    let hidden: Rule | null = null;

    reduced.each((node: ChildNode) => {
      if (
        node.type === "rule" &&
        declarationsOf(node as Rule)["display"] === "none"
      ) {
        hidden = node as Rule;
      }
    });

    expect(hidden!.selectors).toEqual([
      '.customer-logos-list[aria-hidden="true"]',
    ]);
  });
});

describe("each logo", () => {
  let images: Array<HTMLImageElement>;

  beforeAll(() => {
    images = Array.from(section.querySelectorAll("img"));
  });

  test("loads with the page, after everything else, and decodes off the main thread", () => {
    /*
     * Not lazily. The rows move on the compositor, which draws no new frame
     * on the page itself, and a lazy image only asks whether it is near the
     * screen when the page draws one: while the visitor sat still, a logo
     * sliding in was never fetched, and the rows drifted past with gaps
     * where their logos should be.
     */
    expect(images.length).toBe(64);

    for (const image of images) {
      expect([image.getAttribute("src"), image.getAttribute("loading")]).toEqual(
        [image.getAttribute("src"), "eager"],
      );
      expect(image.getAttribute("fetchpriority")).toBe("low");
      expect(image.getAttribute("decoding")).toBe("async");
      expect(image.classList.contains("customer-logo")).toBe(true);
    }
  });

  test("gets a box in its artwork's own proportions", () => {
    for (const logo of tracks.flatMap((track: Element) => {
      return logosIn(track);
    })) {
      const artwork: ArtworkSize = artworkSize(logo.file);
      const proportionalWidth: number =
        (logo.height * artwork.width) / artwork.height;

      // The width is the height in the file's proportions, to the nearest pixel.
      expect([
        logo.file,
        Math.abs(logo.width - proportionalWidth) <= 0.5,
      ]).toEqual([logo.file, true]);
      expect([logo.file, logo.cssWidth]).toEqual([
        logo.file,
        `${logo.width}px`,
      ]);
    }
  });

  test("is drawn the same size as the rest, none of them a speck or a banner", () => {
    for (const logo of tracks.flatMap((track: Element) => {
      return logosIn(track);
    })) {
      expect([logo.file, logo.height >= 17 && logo.height <= 36]).toEqual([
        logo.file,
        true,
      ]);
      expect([logo.file, logo.width >= 30 && logo.width <= 180]).toEqual([
        logo.file,
        true,
      ]);
      // Area, not height, is what makes two logos look the same size.
      expect([
        logo.file,
        logo.width * logo.height >= 900 && logo.width * logo.height <= 4100,
      ]).toEqual([logo.file, true]);
    }
  });

  test("is sharp on a high-density screen: a picture has twice the pixels it is shown at", () => {
    for (const logo of tracks.flatMap((track: Element) => {
      return logosIn(track);
    })) {
      if (logo.file.endsWith(".svg")) {
        continue;
      }

      expect(artworkSize(logo.file).height).toBeGreaterThanOrEqual(
        2 * logo.height,
      );
    }
  });

  test("is grey until the pointer is over it", () => {
    const [rest] = rulesFor(sheet, ".customer-logo");
    const [hover] = rulesFor(sheet, ".customer-logo:hover");

    expect(Number(rest!["opacity"])).toBeLessThan(0.7);
    expect(Number(hover!["opacity"])).toBeGreaterThan(Number(rest!["opacity"]));
    // Its width, not its height, is set: the height follows the artwork.
    expect(rest!["height"]).toBe("auto");
    expect(rest!["max-width"]).toBe("none");
    expect(
      rulesFor(mediaBlock(sheet, "(min-width: 640px)"), ".customer-logo"),
    ).toEqual([{ width: "var(--customer-logo-width)" }]);
  });
});

describe("the pages that show it", () => {
  const templatesIncluding: (directory: string) => Array<string> = (
    directory: string,
  ): Array<string> => {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry: fs.Dirent): Array<string> => {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          return templatesIncluding(full);
        }

        return entry.name.endsWith(".ejs") ? [full] : [];
      });
  };

  const includesOf: (template: string) => number = (
    template: string,
  ): number => {
    return (
      fs
        .readFileSync(template, "utf8")
        .match(/include\(\s*['"](?:\.\.\/)*logo-roll['"]/g) || []
    ).length;
  };

  test("include it at most once each: its caption has an id", () => {
    const including: Array<string> = templatesIncluding(VIEWS_ROOT).filter(
      (template: string) => {
        return includesOf(template) > 0;
      },
    );

    // The homepage and the product, solution and industry pages.
    expect(including.length).toBeGreaterThan(40);

    for (const template of including) {
      expect([path.relative(VIEWS_ROOT, template), includesOf(template)]).toEqual(
        [path.relative(VIEWS_ROOT, template), 1],
      );
    }
  });

  test("the homepage shows it straight under the hero", () => {
    const homepage: string = fs.readFileSync(
      path.join(VIEWS_ROOT, "index.ejs"),
      "utf8",
    );

    expect(homepage).toMatch(
      /include\('\.\/Partials\/home-hero'\) -%>\s*<%- include\('logo-roll'\) -%>/,
    );
  });
});
