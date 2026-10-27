import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";
import postcss, { AtRule, Declaration, Root, Rule } from "postcss";

/*
 * THE HOMEPAGE HERO ANSWERS THE POINTER, AND ITS INCIDENT IS LIVE.
 *
 * Where a mouse moves over the hero, a fine grid of dots shows in a soft
 * circle around it: Views/Partials/home-hero.ejs draws them on a square the
 * size of that circle, which its script moves after the pointer, a beat
 * behind, shifting the dots back by as much so they keep their places on the
 * page while the light passes over them. The square fades when the pointer
 * leaves. Touch screens, visitors who ask for less motion and pages without
 * JavaScript get the plain background they had.
 *
 * The hero's own script runs here, in jsdom, which lays nothing out: the
 * hero's box and the square's width are given as a laptop would measure
 * them, frames run when a test says so and at the times it says, and
 * matchMedia answers as a laptop, a phone or a visitor who asks for less
 * motion would.
 *
 * The Dashboard drawn in the hero is a few minutes into incident #1042, and
 * a ring ripples out of its incident banner's disc, as the real Home page's
 * does while an incident is open (ProjectHealthCard.tsx).
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HERO_TEMPLATE: string = path.join(
  VIEWS_ROOT,
  "Partials",
  "home-hero.ejs",
);
const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");
const PROJECT_HEALTH_CARD: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Home/ProjectHealthCard.tsx";

// The square's width at 1440px (36rem), and the hero's box as a laptop lays it out.
const SQUARE: number = 576;
const HERO_WIDTH: number = 1440;
const HERO_HEIGHT: number = 1210;
const HERO_TOP: number = 91;

// The dots' spacing and how long the light takes to fade, as the hero's stylesheet has them.
const SPACING: number = 22;
const FADE_MS: number = 600;

const SIXTIETH: number = 1000 / 60;

interface Device {
  // A mouse or trackpad: (hover: hover) and (pointer: fine).
  finePointer: boolean;
  reducedMotion: boolean;
}

const LAPTOP: Device = { finePointer: true, reducedMotion: false };

interface Light {
  lit: boolean;
  // The middle of the lit circle, in the hero's own coordinates.
  x: number;
  y: number;
  // Where the square is, and how far its dots are shifted back.
  left: number;
  top: number;
  shiftX: number;
  shiftY: number;
}

interface OpenedHero {
  window: DOMWindow;
  hero: HTMLElement;
  dots: HTMLElement;
  device: Device;
  // The frames the page has asked for, run by runFrames.
  frames: Array<(now: number) => void>;
  clock: number;
  heroTop: number;
  errors: Array<string>;
}

let heroHtml: string;
let opened: OpenedHero | null = null;

beforeAll(async () => {
  heroHtml = (await ejs.renderFile(
    HERO_TEMPLATE,
    { githubStars: "7.4k" },
    { views: [VIEWS_ROOT] },
  )) as string;
});

afterEach(() => {
  opened?.window.close();
  opened = null;
});

const open: (device?: Device) => OpenedHero = (
  device: Device = LAPTOP,
): OpenedHero => {
  const errors: Array<string> = [];
  const virtualConsole: VirtualConsole = new VirtualConsole();

  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(error.message);
  });

  const page: OpenedHero = {
    device: { ...device },
    frames: [],
    clock: 10000,
    heroTop: HERO_TOP,
    errors,
  } as unknown as OpenedHero;

  const dom: JSDOM = new JSDOM(
    `<!DOCTYPE html><html><body>${heroHtml}</body></html>`,
    {
      url: "https://oneuptime.com/",
      runScripts: "dangerously",
      virtualConsole,
      beforeParse: (window: DOMWindow): void => {
        const queries: Record<string, () => boolean> = {
          "(hover: hover) and (pointer: fine)": (): boolean => {
            return page.device.finePointer;
          },
          "(prefers-reduced-motion: reduce)": (): boolean => {
            return page.device.reducedMotion;
          },
        };

        (window as unknown as Record<string, unknown>)["matchMedia"] = (
          query: string,
        ): Record<string, unknown> => {
          const answer: (() => boolean) | undefined = queries[query];

          if (!answer) {
            throw new Error(
              `The hero asked an unexpected media query: ${query}`,
            );
          }

          return {
            media: query,
            get matches(): boolean {
              return answer();
            },
            addEventListener: (): void => {},
            removeEventListener: (): void => {},
          };
        };

        window.requestAnimationFrame = (
          callback: (now: number) => void,
        ): number => {
          page.frames.push(callback);
          return page.frames.length;
        };

        window.performance.now = (): number => {
          return page.clock;
        };
      },
    },
  );

  page.window = dom.window;
  page.hero = dom.window.document.getElementById("hero-section")!;
  page.dots = page.hero.querySelector("[data-hero-dots]") as HTMLElement;

  // What a browser would measure; jsdom lays nothing out.
  Object.defineProperty(page.hero, "getBoundingClientRect", {
    value: (): Record<string, number> => {
      return {
        left: 0,
        top: page.heroTop,
        width: HERO_WIDTH,
        height: HERO_HEIGHT,
        right: HERO_WIDTH,
        bottom: page.heroTop + HERO_HEIGHT,
        x: 0,
        y: page.heroTop,
      };
    },
  });
  Object.defineProperty(page.dots, "offsetWidth", { value: SQUARE });

  opened = page;
  return page;
};

// A pointer event at a point on the screen, from something inside the hero, so it bubbles up as a browser's would.
const point: (
  page: OpenedHero,
  type: "pointermove" | "pointerleave",
  clientX: number,
  clientY: number,
  pointerType?: string,
) => void = (
  page: OpenedHero,
  type: "pointermove" | "pointerleave",
  clientX: number,
  clientY: number,
  pointerType: string = "mouse",
): void => {
  const event: Event = new page.window.MouseEvent(type, {
    bubbles: type === "pointermove",
    clientX,
    clientY,
  });

  Object.defineProperty(event, "pointerType", { value: pointerType });

  (type === "pointermove"
    ? page.hero.querySelector("h1")!
    : page.hero
  ).dispatchEvent(event);
};

const runFrames: (page: OpenedHero, count: number, ms?: number) => void = (
  page: OpenedHero,
  count: number,
  ms: number = SIXTIETH,
): void => {
  for (let frame: number = 0; frame < count; frame++) {
    page.clock += ms;

    for (const callback of page.frames.splice(0)) {
      callback(page.clock);
    }
  }
};

// Frames until the light stops asking for them; how many that took.
const settle: (page: OpenedHero) => number = (page: OpenedHero): number => {
  let frames: number = 0;

  while (page.frames.length > 0) {
    runFrames(page, 1);
    frames++;

    if (frames > 600) {
      throw new Error("The light never settled.");
    }
  }

  return frames;
};

const lightOf: (page: OpenedHero) => Light = (page: OpenedHero): Light => {
  const transform: RegExpMatchArray | null = page.dots.style.transform.match(
    /^translate3d\((-?\d+)px, (-?\d+)px, 0\)$/,
  );
  const shift: Array<number> = page.dots.style.backgroundPosition
    .split(" ")
    .map((value: string): number => {
      return parseFloat(value);
    });

  expect(transform).not.toBeNull();

  const left: number = Number(transform![1]);
  const top: number = Number(transform![2]);

  return {
    lit: page.dots.classList.contains("is-lit"),
    x: left + SQUARE / 2,
    y: top + SQUARE / 2,
    left,
    top,
    shiftX: shift[0]!,
    shiftY: shift[1]!,
  };
};

// Where a dot is drawn on the page, along one axis, modulo the spacing: the same wherever the square is.
const dotPhase: (squareAt: number, shift: number) => number = (
  squareAt: number,
  shift: number,
): number => {
  return (((squareAt + shift) % SPACING) + SPACING) % SPACING;
};

describe("the hero's pointer-lit dots", () => {
  test("draw nothing until a mouse moves over the hero", () => {
    const page: OpenedHero = open();

    expect(page.dots.getAttribute("aria-hidden")).toBe("true");
    expect(page.dots.classList.contains("is-lit")).toBe(false);
    expect(page.dots.style.transform).toBe("");
    expect(page.frames).toHaveLength(0);
    expect(page.errors).toEqual([]);
  });

  test("light where the mouse comes in, centred on it", () => {
    const page: OpenedHero = open();

    point(page, "pointermove", 600, HERO_TOP + 320);

    const light: Light = lightOf(page);

    expect(light.lit).toBe(true);
    expect([light.x, light.y]).toEqual([600, 320]);
    // 312 = 14 x 22 + 4, 32 = 22 + 10: the dots move back by what the square moved past a whole step.
    expect([light.left, light.top]).toEqual([312, 32]);
    expect([light.shiftX, light.shiftY]).toEqual([-4, -10]);
  });

  test("follow the pointer a beat behind, as far in a sixtieth of a second at 120Hz as at 60Hz", () => {
    const sixty: OpenedHero = open();

    point(sixty, "pointermove", 200, HERO_TOP + 400);
    point(sixty, "pointermove", 1200, HERO_TOP + 400);
    runFrames(sixty, 1, SIXTIETH);

    const afterOneFrame: Light = lightOf(sixty);

    // A fifth of the way there, and not yet there.
    expect(afterOneFrame.x).toBe(400);
    sixty.window.close();

    const hundredTwenty: OpenedHero = open();

    point(hundredTwenty, "pointermove", 200, HERO_TOP + 400);
    point(hundredTwenty, "pointermove", 1200, HERO_TOP + 400);
    runFrames(hundredTwenty, 2, SIXTIETH / 2);

    expect(lightOf(hundredTwenty).x).toBe(afterOneFrame.x);
  });

  test("settle on the pointer, and stop asking for frames", () => {
    const page: OpenedHero = open();

    point(page, "pointermove", 200, HERO_TOP + 400);
    point(page, "pointermove", 1200, HERO_TOP + 700);

    const frames: number = settle(page);
    const light: Light = lightOf(page);

    expect([light.x, light.y]).toEqual([1200, 700]);
    // About half a second at 60Hz, not a light that hangs on for seconds.
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(40);
    expect(page.frames).toHaveLength(0);
  });

  test("keep every dot in its place on the page, wherever the light goes and while it glides", () => {
    const page: OpenedHero = open();
    const random: SeededRandom = seededRandom(20261027);

    point(page, "pointermove", 700, HERO_TOP + 300);

    for (let move: number = 0; move < 200; move++) {
      const x: number = random(HERO_WIDTH + 1);
      const y: number = random(HERO_HEIGHT + 1);

      point(page, "pointermove", x, HERO_TOP + y);

      // Mid-glide, the square sits on a whole pixel and the dots on the page's grid.
      for (let frame: number = 0; frame < 1 + random(4); frame++) {
        runFrames(page, 1, 4 + random(30));

        const gliding: Light = lightOf(page);

        expect([
          dotPhase(gliding.left, gliding.shiftX),
          dotPhase(gliding.top, gliding.shiftY),
        ]).toEqual([0, 0]);
      }

      settle(page);

      const light: Light = lightOf(page);

      expect([light.x, light.y]).toEqual([x, y]);
      expect([
        dotPhase(light.left, light.shiftX),
        dotPhase(light.top, light.shiftY),
      ]).toEqual([0, 0]);
      // Shifted back by less than a step, never forward.
      expect(light.shiftX).toBeLessThanOrEqual(0);
      expect(light.shiftX).toBeGreaterThan(-SPACING);
      expect(light.shiftY).toBeLessThanOrEqual(0);
      expect(light.shiftY).toBeGreaterThan(-SPACING);
    }

    expect(page.errors).toEqual([]);
  });

  test("fade when the pointer leaves the hero", () => {
    const page: OpenedHero = open();

    point(page, "pointermove", 600, HERO_TOP + 320);
    settle(page);
    point(page, "pointerleave", 600, HERO_TOP - 10);

    expect(page.dots.classList.contains("is-lit")).toBe(false);
  });

  test("light again where the pointer comes back in, once the fade is over", () => {
    const page: OpenedHero = open();

    point(page, "pointermove", 300, HERO_TOP + 200);
    settle(page);
    point(page, "pointerleave", 300, HERO_TOP - 10);
    page.clock += FADE_MS;
    point(page, "pointermove", 1100, HERO_TOP + 600);

    const light: Light = lightOf(page);

    expect(light.lit).toBe(true);
    expect([light.x, light.y]).toEqual([1100, 600]);
  });

  test("glide over from where they were when the pointer comes back while they are still fading", () => {
    const page: OpenedHero = open();

    point(page, "pointermove", 300, HERO_TOP + 200);
    settle(page);
    point(page, "pointerleave", 300, HERO_TOP - 10);
    page.clock += FADE_MS / 6;
    point(page, "pointermove", 1100, HERO_TOP + 600);

    // Lit again, still where it was: no jump across the hero.
    expect(lightOf(page)).toMatchObject({ lit: true, x: 300, y: 200 });

    runFrames(page, 1);

    const gliding: Light = lightOf(page);

    expect(gliding.x).toBeGreaterThan(300);
    expect(gliding.x).toBeLessThan(1100);

    settle(page);
    expect(lightOf(page)).toMatchObject({ x: 1100, y: 600 });
  });

  test("stay with a still pointer while the page scrolls under it", () => {
    const page: OpenedHero = open();

    point(page, "pointermove", 600, HERO_TOP + 320);
    settle(page);

    // The page scrolls 200px: the hero moves up, the pointer stays put.
    page.heroTop = HERO_TOP - 200;
    page.window.dispatchEvent(new page.window.Event("scroll"));
    settle(page);

    expect(lightOf(page)).toMatchObject({ lit: true, x: 600, y: 520 });
  });

  test("fade when the page scrolls the hero out from under the pointer", () => {
    const page: OpenedHero = open();

    point(page, "pointermove", 600, HERO_TOP + 320);
    settle(page);

    page.heroTop = HERO_TOP + 400;
    page.window.dispatchEvent(new page.window.Event("scroll"));

    expect(page.dots.classList.contains("is-lit")).toBe(false);
  });

  test("are never lit by a finger or a pen", () => {
    const page: OpenedHero = open();

    for (const pointerType of ["touch", "pen"]) {
      point(page, "pointermove", 600, HERO_TOP + 320, pointerType);
    }

    expect(page.dots.classList.contains("is-lit")).toBe(false);
    expect(page.frames).toHaveLength(0);
  });

  test("are never lit where the main pointer cannot hover finely", () => {
    const page: OpenedHero = open({ finePointer: false, reducedMotion: false });

    // A tablet with a trackpad attached still reports its touch screen as the main pointer.
    point(page, "pointermove", 600, HERO_TOP + 320);

    expect(page.dots.classList.contains("is-lit")).toBe(false);
  });

  test("are never lit for visitors who ask for less motion, and go out when they ask mid-visit", () => {
    const still: OpenedHero = open({ finePointer: true, reducedMotion: true });

    point(still, "pointermove", 600, HERO_TOP + 320);
    expect(still.dots.classList.contains("is-lit")).toBe(false);
    still.window.close();

    const page: OpenedHero = open();

    point(page, "pointermove", 600, HERO_TOP + 320);
    expect(page.dots.classList.contains("is-lit")).toBe(true);

    page.device.reducedMotion = true;
    point(page, "pointermove", 640, HERO_TOP + 320);
    expect(page.dots.classList.contains("is-lit")).toBe(false);
  });
});

describe("the hero's stylesheet", () => {
  let sheet: Root;
  let script: string;

  beforeAll(() => {
    const document: Document = new JSDOM(heroHtml).window.document;

    sheet = postcss.parse(document.querySelector("style")!.textContent || "");
    script = document.querySelector("script")!.textContent || "";
  });

  const declarationsOf: (
    container: Root | AtRule,
    selector: string,
  ) => Record<string, string> = (
    container: Root | AtRule,
    selector: string,
  ): Record<string, string> => {
    const declarations: Record<string, string> = {};

    container.each((node: postcss.ChildNode) => {
      if (node.type === "rule" && (node as Rule).selector === selector) {
        (node as Rule).walkDecls((declaration: Declaration) => {
          declarations[declaration.prop] = declaration.value;
        });
      }
    });

    return declarations;
  };

  test("never draws the dots on a touch screen or for less motion, whatever the script does", () => {
    const blocks: Array<AtRule> = [];

    sheet.walkAtRules("media", (rule: AtRule) => {
      blocks.push(rule);
    });

    const hiding: Array<AtRule> = blocks.filter((rule: AtRule): boolean => {
      return declarationsOf(rule, ".hero-dots")["display"] === "none";
    });

    expect(hiding).toHaveLength(1);

    const conditions: Array<string> = hiding[0]!.params
      .split(",")
      .map((condition: string): string => {
        return condition.trim();
      });

    expect(conditions.sort()).toEqual(
      [
        "(hover: none)",
        "(pointer: coarse)",
        "(prefers-reduced-motion: reduce)",
      ].sort(),
    );
  });

  test("keeps the dots behind the words and the product, and out of the pointer's way", () => {
    const dots: Record<string, string> = declarationsOf(sheet, ".hero-dots");

    expect(dots["z-index"]).toBe("-10");
    expect(dots["pointer-events"]).toBe("none");
    expect(dots["opacity"]).toBe("0");
    expect(declarationsOf(sheet, ".hero-dots.is-lit")["opacity"]).toBe("1");
  });

  test("spaces the dots and times the fade as the script expects", () => {
    const dots: Record<string, string> = declarationsOf(sheet, ".hero-dots");

    expect(dots["background-size"]).toBe(`${SPACING}px ${SPACING}px`);
    expect(dots["width"]).toBe("36rem");
    expect(dots["height"]).toBe("36rem");
    expect(dots["transition"]).toBe(`opacity ${FADE_MS / 1000}s ease`);
    expect(script).toContain(`const spacing = ${SPACING};`);
    expect(script).toContain(`const fadeMs = ${FADE_MS};`);
  });
});

describe("the incident on the hero's Dashboard", () => {
  const classesOf: (classAttribute: string) => Array<string> = (
    classAttribute: string,
  ): Array<string> => {
    return classAttribute.split(/\s+/).filter(Boolean).sort();
  };

  test("ripples out of the banner's disc as on the real Home page, and only when motion is welcome", () => {
    const document: Document = new JSDOM(heroHtml).window.document;
    const rings: Array<Element> = Array.from(
      document.querySelectorAll("#hero-section [class*='animate-ping']"),
    );

    expect(rings).toHaveLength(1);

    const ring: Element = rings[0]!;
    const disc: Element = ring.parentElement!;

    // The banner's red disc, its icon drawn over the ring.
    expect(disc.classList.contains("bg-red-600")).toBe(true);
    expect(disc.classList.contains("relative")).toBe(true);
    expect(disc.querySelector("svg")!.classList.contains("relative")).toBe(
      true,
    );
    expect(disc.closest(".bg-red-50")!.textContent).toContain(
      "1 active incident",
    );

    const realRing: RegExpMatchArray | null = fs
      .readFileSync(path.join(REPO_ROOT, PROJECT_HEALTH_CARD), "utf8")
      .match(/className="([^"]*animate-ping[^"]*)"/);

    expect(realRing).not.toBeNull();
    expect(classesOf(ring.getAttribute("class") || "")).toEqual(
      classesOf(realRing![1]!),
    );
    expect(ring.classList.contains("motion-safe:animate-ping")).toBe(true);
    expect(ring.classList.contains("animate-ping")).toBe(false);
  });
});
