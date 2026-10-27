import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  addClassNames,
  declarationsForSelector,
  EmittedRule,
  loadPlayCdn,
  READING_DIRECTION_SCRIPT_PATH,
  unloadPlayCdn,
} from "../../Helpers/TailwindPlayCdn";

/*
 * Left and right follow the reading direction (Common/UI/Styles/
 * TailwindReadingDirection.js). Every frontend lays its pages out with
 * Tailwind's left and right utilities; a Persian page sets dir="rtl", and a
 * physical margin, padding or position would stay on what is now the far
 * side. The config every index.ejs loads after Tailwind's runtime writes
 * those utilities with logical properties instead: the same side as ever
 * left to right, the mirrored side right to left.
 *
 * The runtime itself runs here, in jsdom, as the page runs it, and the
 * tests read the CSS it writes. How the browser lays that out, left to
 * right and right to left, is the offline ReadingDirection browser suite's
 * (packages/E2E/ReadingDirection).
 */

interface ReadingDirectionModule {
  withReadingDirection: (
    config: Record<string, unknown> | undefined,
  ) => Record<string, unknown>;
  followReadingDirection: (root: Record<string, unknown> | null) => boolean;
  readingDirectionPlugin: (api: unknown) => void;
  REPLACED_CORE_PLUGINS: Array<string>;
}

/*
 * The script is plain JavaScript the browser loads as it is (a UMD module,
 * no build step), so it is required rather than imported.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const readingDirection: ReadingDirectionModule = require(
  READING_DIRECTION_SCRIPT_PATH,
) as ReadingDirectionModule;

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet",
);

const FRONTENDS: Array<{ folder: string; prefix: string }> = [
  { folder: "Dashboard", prefix: "dashboard" },
  { folder: "AdminDashboard", prefix: "admin" },
  { folder: "Accounts", prefix: "accounts" },
  { folder: "StatusPage", prefix: "status-page" },
  { folder: "PublicDashboard", prefix: "public-dashboard" },
];

// The Dashboard's config, as its index.ejs writes it.
const DASHBOARD_CONFIG: Record<string, unknown> = {
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ["Inter", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
};

describe("a frontend's config, taken with the reading direction", () => {
  test("swaps Tailwind's own side utilities for its plugin, and keeps everything else", () => {
    const taken: Record<string, unknown> =
      readingDirection.withReadingDirection(DASHBOARD_CONFIG);

    expect(taken["darkMode"]).toBe("class");
    expect(taken["theme"]).toBe(DASHBOARD_CONFIG["theme"]);
    expect(taken["corePlugins"]).toEqual({
      margin: false,
      padding: false,
      inset: false,
      textAlign: false,
      borderWidth: false,
      borderRadius: false,
      space: false,
      divideWidth: false,
    });
    expect(taken["plugins"]).toEqual([readingDirection.readingDirectionPlugin]);
    // What it was given is left as it was.
    expect(DASHBOARD_CONFIG["corePlugins"]).toBeUndefined();
    expect(DASHBOARD_CONFIG["plugins"]).toBeUndefined();
  });

  test("keeps a frontend's own plugins and core plugin switches", () => {
    const ownPlugin: () => void = (): void => {};
    const taken: Record<string, unknown> =
      readingDirection.withReadingDirection({
        plugins: [ownPlugin],
        corePlugins: { preflight: false, margin: true },
      });

    expect(taken["plugins"]).toEqual([
      ownPlugin,
      readingDirection.readingDirectionPlugin,
    ]);
    expect(taken["corePlugins"]).toEqual(
      expect.objectContaining({ preflight: false, margin: false }),
    );
  });

  test("a list of core plugins to keep loses the ones it writes again", () => {
    const taken: Record<string, unknown> =
      readingDirection.withReadingDirection({
        corePlugins: ["margin", "display", "padding", "textColor"],
      });

    expect(taken["corePlugins"]).toEqual(["display", "textColor"]);
  });

  test("a config taken twice is taken once", () => {
    const once: Record<string, unknown> =
      readingDirection.withReadingDirection(DASHBOARD_CONFIG);
    const twice: Record<string, unknown> =
      readingDirection.withReadingDirection(once);

    expect(twice["plugins"]).toEqual([readingDirection.readingDirectionPlugin]);
    expect(twice["corePlugins"]).toEqual(once["corePlugins"]);
  });

  test("no config at all is an empty one with the reading direction", () => {
    const taken: Record<string, unknown> =
      readingDirection.withReadingDirection(undefined);

    expect(taken["plugins"]).toEqual([readingDirection.readingDirectionPlugin]);
    expect(
      Object.keys(taken["corePlugins"] as Record<string, unknown>).sort(),
    ).toEqual([...readingDirection.REPLACED_CORE_PLUGINS].sort());
  });
});

describe("following the reading direction from the runtime's own global", () => {
  test("every config the page sets afterwards is taken with it", () => {
    const runtime: Record<string, unknown> = { config: {} };
    const root: Record<string, unknown> = { tailwind: runtime };

    expect(readingDirection.followReadingDirection(root)).toBe(true);

    // The runtime's empty default is taken too, before the page sets its own.
    expect((runtime["config"] as Record<string, unknown>)["plugins"]).toEqual([
      readingDirection.readingDirectionPlugin,
    ]);

    (root["tailwind"] as Record<string, unknown>)["config"] = DASHBOARD_CONFIG;

    const set: Record<string, unknown> = runtime["config"] as Record<
      string,
      unknown
    >;

    expect(set["darkMode"]).toBe("class");
    expect(set["plugins"]).toEqual([readingDirection.readingDirectionPlugin]);
    expect((set["corePlugins"] as Record<string, boolean>)["margin"]).toBe(
      false,
    );
  });

  test("anything else set on the runtime passes through as it is", () => {
    const runtime: Record<string, unknown> = { config: {} };
    const root: Record<string, unknown> = { tailwind: runtime };

    readingDirection.followReadingDirection(root);
    (root["tailwind"] as Record<string, unknown>)["other"] = 42;

    expect(runtime["other"]).toBe(42);
  });

  test("a config the page set before is left for the page's next one", () => {
    const runtime: Record<string, unknown> = { config: { darkMode: "class" } };

    readingDirection.followReadingDirection({ tailwind: runtime });

    expect(runtime["config"]).toEqual({ darkMode: "class" });
  });

  test("is done once, and needs a runtime to follow", () => {
    const root: Record<string, unknown> = { tailwind: { config: {} } };

    expect(readingDirection.followReadingDirection(root)).toBe(true);
    expect(readingDirection.followReadingDirection(root)).toBe(false);
    expect(readingDirection.followReadingDirection({})).toBe(false);
    expect(readingDirection.followReadingDirection(null)).toBe(false);
  });
});

describe("every frontend loads it right after Tailwind's runtime", () => {
  test.each(FRONTENDS)(
    "$folder's index.ejs",
    (frontend: { folder: string; prefix: string }) => {
      const view: string = fs.readFileSync(
        path.join(FEATURE_SETS, frontend.folder, "views", "index.ejs"),
        "utf8",
      );

      const runtime: string = `<script src="/${frontend.prefix}/assets/js/tailwind-3.4.5.js"></script>`;
      const direction: string = `<script src="/${frontend.prefix}/assets/js/tailwind-reading-direction.js"></script>`;

      expect(view).toContain(runtime);
      expect(view).toContain(direction);

      const runtimeAt: number = view.indexOf(runtime);
      const directionAt: number = view.indexOf(direction);
      const configAt: number = view.indexOf("tailwind.config =");

      // After the runtime, with nothing but a template comment between them...
      expect(directionAt).toBeGreaterThan(runtimeAt);
      expect(
        view
          .slice(runtimeAt + runtime.length, directionAt)
          .replace(
            "<%# Left and right follow the reading direction (Common/UI/Styles/TailwindReadingDirection.js) -%>",
            "",
          )
          .trim(),
      ).toBe("");
      // ...and before the page sets its config.
      expect(configAt).toBeGreaterThan(directionAt);
    },
  );

  test("the build copies it next to the runtime", () => {
    const build: string = fs.readFileSync(
      path.resolve(__dirname, "../../../UI/esbuild-config.js"),
      "utf8",
    );

    expect(build).toContain(
      'const TAILWIND_READING_DIRECTION_FILENAME = "tailwind-reading-direction.js";',
    );
    expect(build).toContain('"TailwindReadingDirection.js"');
  });
});

/*
 * The real runtime, the reading-direction config, the Dashboard's config,
 * and the class names the frontends write.
 */
const CLASS_NAMES: Array<string> = [
  "ml-3 mr-2 -ml-2 mx-4 my-1 ms-5 me-1 m-2 ml-auto",
  "pl-6 pr-3 px-5 py-2 ps-4 pe-2 p-1 pl-[13px]",
  "left-0 right-0 -left-1 left-1/2 right-full inset-x-0 inset-y-0 inset-0 start-2 end-3 top-1 bottom-2",
  "text-left text-right text-center text-start text-end text-justify",
  "border border-l border-r-2 border-x border-y-2 border-t border-s border-e-4 border-l-[3px]",
  "border-l-indigo-500 border-r-transparent border-r-[#ff0000]",
  "rounded rounded-l-md rounded-r rounded-t-lg rounded-b rounded-tl-lg rounded-tr rounded-br-sm rounded-bl-xl rounded-s rounded-ee",
  "space-x-2 space-y-3 -space-x-1 space-x-reverse",
  "divide-x divide-y-2 divide-x-reverse",
  "md:pr-6 hover:ml-1 !ml-0 sm:text-left",
  "dark:bg-gray-900 translate-x-5 float-left",
  "[text-align:left] rtl:[text-align:right] [margin-left:2px]",
];

let rules: Array<EmittedRule> = [];

const css: (selector: string) => Record<string, string> = (
  selector: string,
): Record<string, string> => {
  return declarationsForSelector(rules, selector);
};

describe("the CSS Tailwind's runtime writes with it", () => {
  beforeAll(async () => {
    await loadPlayCdn({
      withReadingDirection: true,
      config: DASHBOARD_CONFIG,
    });

    rules = await addClassNames(CLASS_NAMES);
  }, 60000);

  afterAll(() => {
    unloadPlayCdn();
  });

  test("ml- and mr- are the start's and the end's margin", () => {
    expect(css(".ml-3")).toEqual({ "margin-inline-start": "0.75rem" });
    expect(css(".mr-2")).toEqual({ "margin-inline-end": "0.5rem" });
    expect(css(".-ml-2")).toEqual({ "margin-inline-start": "-0.5rem" });
    expect(css(".ml-auto")).toEqual({ "margin-inline-start": "auto" });
  });

  test("margins on both sides, and the logical ones, are as Tailwind writes them", () => {
    expect(css(".mx-4")).toEqual({
      "margin-left": "1rem",
      "margin-right": "1rem",
    });
    expect(css(".my-1")).toEqual({
      "margin-top": "0.25rem",
      "margin-bottom": "0.25rem",
    });
    expect(css(".m-2")).toEqual({ margin: "0.5rem" });
    expect(css(".ms-5")).toEqual({ "margin-inline-start": "1.25rem" });
    expect(css(".me-1")).toEqual({ "margin-inline-end": "0.25rem" });
  });

  test("pl- and pr- are the start's and the end's padding, an arbitrary value too", () => {
    expect(css(".pl-6")).toEqual({ "padding-inline-start": "1.5rem" });
    expect(css(".pr-3")).toEqual({ "padding-inline-end": "0.75rem" });
    expect(css(".pl-\\[13px\\]")).toEqual({ "padding-inline-start": "13px" });
    expect(css(".px-5")).toEqual({
      "padding-left": "1.25rem",
      "padding-right": "1.25rem",
    });
    expect(css(".ps-4")).toEqual({ "padding-inline-start": "1rem" });
    expect(css(".pe-2")).toEqual({ "padding-inline-end": "0.5rem" });
    expect(css(".p-1")).toEqual({ padding: "0.25rem" });
  });

  test("left- and right- are the start's and the end's position", () => {
    expect(css(".left-0")).toEqual({ "inset-inline-start": "0px" });
    expect(css(".right-0")).toEqual({ "inset-inline-end": "0px" });
    expect(css(".-left-1")).toEqual({ "inset-inline-start": "-0.25rem" });
    expect(css(".left-1\\/2")).toEqual({ "inset-inline-start": "50%" });
    expect(css(".right-full")).toEqual({ "inset-inline-end": "100%" });
    expect(css(".start-2")).toEqual({ "inset-inline-start": "0.5rem" });
    expect(css(".end-3")).toEqual({ "inset-inline-end": "0.75rem" });
    // Both sides, and top and bottom, are as Tailwind writes them.
    expect(css(".inset-x-0")).toEqual({ left: "0px", right: "0px" });
    expect(css(".inset-y-0")).toEqual({ top: "0px", bottom: "0px" });
    expect(css(".inset-0")).toEqual({ inset: "0px" });
    expect(css(".top-1")).toEqual({ top: "0.25rem" });
    expect(css(".bottom-2")).toEqual({ bottom: "0.5rem" });
  });

  test("text-left and text-right start and end the line", () => {
    expect(css(".text-left")).toEqual({ "text-align": "start" });
    expect(css(".text-right")).toEqual({ "text-align": "end" });
    expect(css(".text-start")).toEqual({ "text-align": "start" });
    expect(css(".text-end")).toEqual({ "text-align": "end" });
    expect(css(".text-center")).toEqual({ "text-align": "center" });
    expect(css(".text-justify")).toEqual({ "text-align": "justify" });
  });

  test("border-l and border-r are the start's and the end's border, an arbitrary width too", () => {
    expect(css(".border-l")).toEqual({ "border-inline-start-width": "1px" });
    expect(css(".border-r-2")).toEqual({ "border-inline-end-width": "2px" });
    expect(css(".border-l-\\[3px\\]")).toEqual({
      "border-inline-start-width": "3px",
    });
    expect(css(".border-s")).toEqual({ "border-inline-start-width": "1px" });
    expect(css(".border-e-4")).toEqual({ "border-inline-end-width": "4px" });
    expect(css(".border")).toEqual({ "border-width": "1px" });
    expect(css(".border-x")).toEqual({
      "border-left-width": "1px",
      "border-right-width": "1px",
    });
    expect(css(".border-t")).toEqual({ "border-top-width": "1px" });
  });

  test("a side border's colour is drawn on the side its width is", () => {
    // Tailwind's own physical colour stays, where no width is drawn.
    expect(css(".border-l-indigo-500")).toEqual(
      expect.objectContaining({
        "border-left-color": expect.any(String),
        "border-inline-start-color": "#6366f1",
      }),
    );
    expect(css(".border-r-transparent")).toEqual(
      expect.objectContaining({ "border-inline-end-color": "transparent" }),
    );
    // An arbitrary colour is Tailwind's own, never claimed twice and dropped.
    expect(css(".border-r-\\[\\#ff0000\\]")).toEqual(
      expect.objectContaining({ "border-right-color": expect.any(String) }),
    );
  });

  test("rounded corners on a side are the start's and the end's", () => {
    expect(css(".rounded-l-md")).toEqual({
      "border-start-start-radius": "0.375rem",
      "border-end-start-radius": "0.375rem",
    });
    expect(css(".rounded-r")).toEqual({
      "border-start-end-radius": "0.25rem",
      "border-end-end-radius": "0.25rem",
    });
    expect(css(".rounded-tl-lg")).toEqual({
      "border-start-start-radius": "0.5rem",
    });
    expect(css(".rounded-tr")).toEqual({
      "border-start-end-radius": "0.25rem",
    });
    expect(css(".rounded-br-sm")).toEqual({
      "border-end-end-radius": "0.125rem",
    });
    expect(css(".rounded-bl-xl")).toEqual({
      "border-end-start-radius": "0.75rem",
    });
    expect(css(".rounded-t-lg")).toEqual({
      "border-top-left-radius": "0.5rem",
      "border-top-right-radius": "0.5rem",
    });
    expect(css(".rounded")).toEqual({ "border-radius": "0.25rem" });
    expect(css(".rounded-s")).toEqual({
      "border-start-start-radius": "0.25rem",
      "border-end-start-radius": "0.25rem",
    });
  });

  test("space-x and divide-x run from the start, and reverse as Tailwind's do", () => {
    const between: string = " > :not([hidden]) ~ :not([hidden])";

    expect(css(`.space-x-2${between}`)).toEqual({
      "--tw-space-x-reverse": "0",
      "margin-inline-end": "calc(0.5rem * var(--tw-space-x-reverse))",
      "margin-inline-start":
        "calc(0.5rem * calc(1 - var(--tw-space-x-reverse)))",
    });
    expect(css(`.-space-x-1${between}`)).toEqual(
      expect.objectContaining({
        "margin-inline-start":
          "calc(-0.25rem * calc(1 - var(--tw-space-x-reverse)))",
      }),
    );
    expect(css(`.space-y-3${between}`)).toEqual({
      "--tw-space-y-reverse": "0",
      "margin-top": "calc(0.75rem * calc(1 - var(--tw-space-y-reverse)))",
      "margin-bottom": "calc(0.75rem * var(--tw-space-y-reverse))",
    });
    expect(css(`.space-x-reverse${between}`)).toEqual({
      "--tw-space-x-reverse": "1",
    });
    expect(css(`.divide-x${between}`)).toEqual(
      expect.objectContaining({
        "border-inline-end-width": "calc(1px * var(--tw-divide-x-reverse))",
        "border-inline-start-width":
          "calc(1px * calc(1 - var(--tw-divide-x-reverse)))",
      }),
    );
    expect(css(`.divide-y-2${between}`)).toEqual(
      expect.objectContaining({
        "border-top-width": "calc(2px * calc(1 - var(--tw-divide-y-reverse)))",
      }),
    );
    expect(css(`.divide-x-reverse${between}`)).toEqual(
      expect.objectContaining({ "--tw-divide-x-reverse": "1" }),
    );
  });

  test("variants and !important work on them as on any utility", () => {
    const mdPadding: Array<EmittedRule> = rules.filter((rule: EmittedRule) => {
      return rule.selector === ".md\\:pr-6";
    });

    expect(mdPadding).toHaveLength(1);
    expect(mdPadding[0]!.atRules).toEqual(["@media (min-width: 768px)"]);
    expect(css(".md\\:pr-6")).toEqual({ "padding-inline-end": "1.5rem" });
    expect(css(".hover\\:ml-1:hover")).toEqual({
      "margin-inline-start": "0.25rem",
    });
    expect(css(".\\!ml-0")).toEqual({
      "margin-inline-start": "0px !important",
    });
    expect(css(".sm\\:text-left")).toEqual({ "text-align": "start" });
  });

  test("no rule writes a physical side for a left or right utility", () => {
    const physical: Array<string> = [
      "margin-left",
      "margin-right",
      "padding-left",
      "padding-right",
      "left",
      "right",
      "border-left-width",
      "border-right-width",
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-left-radius",
      "border-bottom-right-radius",
    ];

    for (const selector of [
      ".ml-3",
      ".mr-2",
      ".-ml-2",
      ".pl-6",
      ".pr-3",
      ".left-0",
      ".right-0",
      ".border-l",
      ".border-r-2",
      ".rounded-l-md",
      ".rounded-r",
      ".rounded-tl-lg",
      ".rounded-br-sm",
    ]) {
      const written: Array<string> = Object.keys(css(selector));

      expect({
        selector,
        physical: written.filter((property: string): boolean => {
          return physical.includes(property);
        }),
      }).toEqual({ selector, physical: [] });
    }
  });

  test("the rest of the page's config still holds: dark mode by class", () => {
    const dark: Array<EmittedRule> = rules.filter((rule: EmittedRule) => {
      return rule.selector.includes("dark\\:bg-gray-900");
    });

    expect(dark).toHaveLength(1);
    expect(dark[0]!.selector).toContain(".dark");
  });

  test("what does not follow the reading direction is left as Tailwind writes it", () => {
    expect(css(".translate-x-5")).toEqual(
      expect.objectContaining({ "--tw-translate-x": "1.25rem" }),
    );
    expect(css(".float-left")).toEqual({ float: "left" });
  });

  test("an arbitrary property is the physical side it names, the page's side whatever a box reads", () => {
    expect(css(".\\[text-align\\:left\\]")).toEqual({
      "text-align": "left",
    });
    expect(css(".\\[margin-left\\:2px\\]")).toEqual({
      "margin-left": "2px",
    });

    const rightToLeft: Array<EmittedRule> = rules.filter(
      (rule: EmittedRule): boolean => {
        return rule.selector.startsWith(".rtl\\:\\[text-align\\:right\\]");
      },
    );

    expect(rightToLeft).toHaveLength(1);
    expect(rightToLeft[0]!.selector).toContain('[dir="rtl"]');
    expect(css(rightToLeft[0]!.selector)).toEqual({ "text-align": "right" });
  });
});
