import {
  ALERT_BANNER_ACTION_PLACE_CLASS_NAME,
  ALERT_BANNER_BODY_PLACE_CLASS_NAME,
  ALERT_BANNER_CONTENT_CLASS_NAME,
  ALERT_BANNER_LAYOUT_CLASS_NAME,
  ALERT_BANNER_TITLE_PLACE_CLASS_NAME,
} from "../../../UI/Components/AlertBanner/AlertBanner";
import {
  addClassNames,
  declarationsOf,
  EmittedRule,
  loadPlayCdn,
  unloadPlayCdn,
} from "../../Helpers/TailwindPlayCdn";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE A BANNER'S ACTION GOES, AS THE DASHBOARD'S OWN TAILWIND WRITES IT
 * (#8034).
 *
 * A banner's action comes after the sentence it acts on, under it at its
 * start while the banner is narrow, and at the end of the title's line once
 * the banner's words have 32rem - the banner's own width, read by a
 * container query, never the window's. The frontends style themselves with
 * the Play CDN build of Tailwind, and a class it does not know draws
 * nothing, so the runtime runs here, as a page runs it, and these read the
 * CSS it writes for the banner's classes.
 */

const QUERY: string = "@container(min-width:32rem)";

let rules: Array<EmittedRule> = [];

const BACKSLASH: string = String.fromCharCode(92);
const HEX_DIGITS: string = "0123456789abcdefABCDEF";

// A selector as written, with Tailwind's escapes taken out.
function unescaped(selector: string): string {
  let result: string = "";
  let index: number = 0;

  while (index < selector.length) {
    const character: string = selector[index]!;

    if (character !== BACKSLASH) {
      result += character;
      index += 1;
      continue;
    }

    let hex: string = "";

    while (
      hex.length < 6 &&
      index + 1 + hex.length < selector.length &&
      HEX_DIGITS.includes(selector[index + 1 + hex.length]!)
    ) {
      hex += selector[index + 1 + hex.length]!;
    }

    if (hex.length === 0) {
      result += selector[index + 1] || "";
      index += 2;
      continue;
    }

    result += String.fromCodePoint(parseInt(hex, 16));
    index += 1 + hex.length;

    if (selector[index] === " ") {
      index += 1;
    }
  }

  return result;
}

interface WrittenRule {
  query: string;
  declarations: Record<string, string>;
}

// The one rule written for a class: the container query it is under, if any.
function onlyRuleFor(className: string): WrittenRule {
  const found: Array<EmittedRule> = rules.filter(
    (rule: EmittedRule): boolean => {
      return unescaped(rule.selector) === `.${className}`;
    },
  );

  expect(`${className}: ${found.length} rule(s)`).toBe(
    `${className}: 1 rule(s)`,
  );

  return {
    query: found[0]!.atRules
      .filter((atRule: string): boolean => {
        return atRule.startsWith("@container");
      })
      .join("")
      .split(" ")
      .join(""),
    declarations: declarationsOf(found[0]!),
  };
}

/*
 * jsdom's own stylesheet reader does not know @container, and says so on
 * console.error each time the runtime writes its sheet; the sheet's text,
 * which these read, is whole. Only that one complaint is kept quiet.
 */
let consoleError: ReturnType<typeof jest.spyOn> | null = null;

function isContainerQueryParseError(args: Array<unknown>): boolean {
  const first: unknown = args[0];

  return (
    first instanceof Error &&
    first.message === "Could not parse CSS stylesheet" &&
    String((first as Error & { detail?: unknown }).detail || "").includes(
      "@container",
    )
  );
}

beforeAll(async () => {
  // eslint-disable-next-line no-console
  const originalError: typeof console.error = console.error;

  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation((...args: Array<unknown>): void => {
      if (!isContainerQueryParseError(args)) {
        originalError(...args);
      }
    });

  // The Dashboard's config, as its index.ejs writes it.
  await loadPlayCdn({
    withReadingDirection: true,
    config: { darkMode: "class" },
  });

  rules = await addClassNames([
    ALERT_BANNER_CONTENT_CLASS_NAME,
    ALERT_BANNER_LAYOUT_CLASS_NAME,
    ALERT_BANNER_TITLE_PLACE_CLASS_NAME,
    ALERT_BANNER_BODY_PLACE_CLASS_NAME,
    ALERT_BANNER_ACTION_PLACE_CLASS_NAME,
  ]);
}, 60000);

afterAll(() => {
  unloadPlayCdn();
  consoleError?.mockRestore();
});

describe("a banner's action, in the Dashboard's own Tailwind", () => {
  test("the banner's words are a container their inline size is measured by", () => {
    expect(onlyRuleFor("[container-type:inline-size]")).toEqual({
      query: "",
      declarations: { "container-type": "inline-size" },
    });
  });

  test("narrow: one column, the action under the sentence, at its start", () => {
    expect(onlyRuleFor("grid")).toEqual({
      query: "",
      declarations: { display: "grid" },
    });
    expect(onlyRuleFor("grid-cols-[minmax(0,1fr)]")).toEqual({
      query: "",
      declarations: { "grid-template-columns": "minmax(0,1fr)" },
    });
    expect(onlyRuleFor("justify-self-start")).toEqual({
      query: "",
      declarations: { "justify-self": "start" },
    });
    expect(onlyRuleFor("self-start")).toEqual({
      query: "",
      declarations: { "align-self": "flex-start" },
    });
    expect(onlyRuleFor("mt-3")).toEqual({
      query: "",
      declarations: { "margin-top": "0.75rem" },
    });
  });

  test("from 32rem of its own: the title and the action share a line, the sentence under both", () => {
    const wide: (className: string) => string = (className: string) => {
      return `[@container(min-width:32rem)]:${className}`;
    };

    expect(onlyRuleFor(wide("grid-cols-[minmax(0,1fr)_auto]"))).toEqual({
      query: QUERY,
      declarations: { "grid-template-columns": "minmax(0,1fr) auto" },
    });
    expect(onlyRuleFor(wide("gap-x-4"))).toEqual({
      query: QUERY,
      declarations: { "column-gap": "1rem" },
    });
    expect(onlyRuleFor(wide("col-start-1"))).toEqual({
      query: QUERY,
      declarations: { "grid-column-start": "1" },
    });
    expect(onlyRuleFor(wide("col-start-2"))).toEqual({
      query: QUERY,
      declarations: { "grid-column-start": "2" },
    });
    expect(onlyRuleFor(wide("row-start-1"))).toEqual({
      query: QUERY,
      declarations: { "grid-row-start": "1" },
    });
    expect(onlyRuleFor(wide("row-start-2"))).toEqual({
      query: QUERY,
      declarations: { "grid-row-start": "2" },
    });
    expect(onlyRuleFor(wide("col-span-2"))).toEqual({
      query: QUERY,
      declarations: { "grid-column": "span 2 / span 2" },
    });
    expect(onlyRuleFor(wide("justify-self-end"))).toEqual({
      query: QUERY,
      declarations: { "justify-self": "end" },
    });
    expect(onlyRuleFor(wide("mt-0"))).toEqual({
      query: QUERY,
      declarations: { "margin-top": "0px" },
    });
  });

  /*
   * The wide rules come after the narrow ones in the sheet, so where both
   * apply - a wide banner - the wide one wins.
   */
  test("a wide banner's rules win over a narrow one's", () => {
    const orderOf: (className: string) => number = (className: string) => {
      const found: EmittedRule | undefined = rules.find(
        (rule: EmittedRule): boolean => {
          return unescaped(rule.selector) === `.${className}`;
        },
      );

      expect(found).toBeDefined();

      return found!.order;
    };

    expect(
      orderOf("[@container(min-width:32rem)]:justify-self-end"),
    ).toBeGreaterThan(orderOf("justify-self-start"));
    expect(orderOf("[@container(min-width:32rem)]:mt-0")).toBeGreaterThan(
      orderOf("mt-3"),
    );
    expect(
      orderOf("[@container(min-width:32rem)]:grid-cols-[minmax(0,1fr)_auto]"),
    ).toBeGreaterThan(orderOf("grid-cols-[minmax(0,1fr)]"));
  });
});
