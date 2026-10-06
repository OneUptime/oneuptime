import slugify from "Common/Server/Types/MarkdownSlugify";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * One rule decides whether an incident, an alert or an episode is resolved:
 * its state is the project's resolved state - the first state from the top
 * flagged isResolvedState - or any state placed after it. The incident docs
 * used to define Active Incidents by the flag alone ("the current state is
 * not the resolved state"), which made a state after Resolved - "Closed" -
 * sound active, and said new states were added at the end of the list, where
 * they would now count as resolved. Every docs language now says it the way
 * the product does, with a section on what a resolve does (monitors given
 * back only when the incident holds them), and the 14 upgrade notes say
 * what changes for existing projects.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

const STATES_PAGE: string = "incidents/states-and-severities";
const INDEX_PAGE: string = "incidents/index";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const UPGRADING_PAGE: string = "installation/upgrading";

// The text of the section under `heading`, up to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.slice(start + heading.length + 2);
  const end: number = rest.search(/\n## /);

  return end === -1 ? rest : rest.slice(0, end);
}

// The "## " sections of a page, the text before the first heading first.
function sections(markdown: string): Array<string> {
  return markdown.split(/\n(?=## )/);
}

/*
 * How each language used to say "the current state is not the resolved
 * state" - the flag-only definition of Active Incidents - and "new states
 * are added at the end", which would now put a new state among the resolved
 * ones. Neither may come back.
 */
const OLD_DEFINITION: Record<string, string> = {
  en: "is not the resolved state",
  da: "ikke den løste tilstand",
  de: "nicht der behobene Status",
  es: "no es el estado resuelto",
  fa: "وضعیت برطرف‌شده نیست",
  fr: "n'est pas l'état résolu",
  hi: "resolved state नहीं है",
  it: "non è lo stato risolto",
  ja: "解決状態ではない",
  ko: "해결 상태가 아니",
  nl: "niet de opgeloste status",
  no: "ikke den løste tilstanden",
  pt: "não é o estado resolvido",
  ru: "не является состоянием устранения",
  sv: "inte det lösta tillståndet",
  "zh-CN": "不是已解决状态",
  "zh-TW": "不是已解決狀態",
};

const OLD_ADDED_AT_THE_END: Record<string, string> = {
  en: "new states are appended at the end",
  da: "nye tilstande føjes til slutningen",
  de: "neue Status hängen sich ans Ende",
  es: "los estados nuevos se añaden al final",
  fa: "وضعیت‌های تازه در پایان افزوده می‌شوند",
  fr: "les nouveaux états s'ajoutent à la fin",
  hi: "नई स्थितियाँ अंत में जुड़ती हैं",
  it: "i nuovi stati vengono accodati in fondo",
  ja: "新しい状態は末尾に追加されます",
  ko: "새 상태는 맨 끝에 추가됩니다",
  nl: "nieuwe statussen komen achteraan",
  no: "nye tilstander legges bakerst",
  pt: "novos estados são acrescentados ao fim",
  ru: "новые состояния дописываются в конец",
  sv: "nya tillstånd läggs till sist",
  "zh-CN": "新状态会追加到末尾",
  "zh-TW": "新狀態會被加到最後",
};

describe("the rule the docs describe is the rule the product runs", () => {
  /*
   * The project the docs talk about: the seeded states, a "Mitigated" state
   * added above Resolved and a "Closed" state dragged below it.
   */
  const states: Array<{
    _id: string;
    order: number;
    isCreatedState?: boolean;
    isAcknowledgedState?: boolean;
    isResolvedState?: boolean;
  }> = [
    {
      _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000d0c1",
      order: 1,
      isCreatedState: true,
    },
    {
      _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000d0c2",
      order: 2,
      isAcknowledgedState: true,
    },
    { _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000d0c3", order: 3 },
    {
      _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000d0c4",
      order: 4,
      isResolvedState: true,
    },
    { _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000d0c5", order: 5 },
  ];

  const isResolved: (stateId: string) => boolean = (
    stateId: string,
  ): boolean => {
    return ResolvedStateUtil.isResolved({
      list: StateListType.IncidentState,
      states: states,
      stateId: stateId,
    });
  };

  test("a state above the resolved state keeps the incident active", () => {
    expect(isResolved(states[0]!._id)).toBe(false);
    expect(isResolved(states[1]!._id)).toBe(false);
    // "Mitigated" is not "done".
    expect(isResolved(states[2]!._id)).toBe(false);
  });

  test("the resolved state, and a state after it, flagged or not, are resolved", () => {
    expect(isResolved(states[3]!._id)).toBe(true);
    // "Closed": no flag of its own, placed after Resolved.
    expect(states[4]!.isResolvedState).toBeUndefined();
    expect(isResolved(states[4]!._id)).toBe(true);
  });

  test("the resolved state is the first flagged state from the top", () => {
    const resolvedState: { _id: string } | null =
      ResolvedStateUtil.getResolvedState<{ _id: string }>({
        list: StateListType.IncidentState,
        states: states,
      });

    expect(resolvedState?._id).toBe(states[3]!._id);
  });
});

describe("the English states page", () => {
  const page: string = read("en", STATES_PAGE);

  test("the flag marks the resolved state, and a state after it is resolved too", () => {
    const row: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| `isResolvedState`");
      });

    expect(row).toContain("Marks the project's resolved state");
    expect(row).toContain(
      "An incident in it, or in any state after it, is resolved",
    );
  });

  test("a state added above the resolved state stays active; one dragged below counts as resolved", () => {
    expect(page).toContain(
      "**Above the resolved state, it keeps the incident active.**",
    );
    expect(page).toContain(
      "A state dragged below the resolved state counts as resolved everywhere",
    );
    expect(page).toContain(
      "moving an incident into it from **Resolved** is not a second resolve",
    );
    expect(page).not.toContain("**It stays in Active Incidents.**");
  });

  test("Active Incidents is the incidents above the resolved state", () => {
    const active: string = section(page, "## The Active Incidents list");

    expect(active).toContain(
      "the incident's current state sits above your resolved state — the first state in the order flagged `isResolvedState`",
    );
    expect(active).not.toContain("`isResolvedState` is false");
    expect(active).toContain(
      "one you place after it takes them off, as the resolved state does",
    );
  });

  test("the status page shows incidents above the resolved state", () => {
    expect(page).toContain(
      "**The current state sits above the resolved state.**",
    );
    expect(page).not.toContain("any unresolved state");
  });

  test("What resolving does sits between moving an incident and its timeline", () => {
    const moving: number = page.indexOf(
      "\n## Moving an incident through its states\n",
    );
    const resolving: number = page.indexOf("\n## What resolving does\n");
    const timeline: number = page.indexOf("\n## The state timeline\n");

    expect(moving).toBeGreaterThan(0);
    expect(resolving).toBeGreaterThan(moving);
    expect(timeline).toBeGreaterThan(resolving);
  });

  test("What resolving does says a resolve gives back only the monitors the incident holds", () => {
    const resolving: string = section(page, "## What resolving does");

    expect(resolving).toContain(
      "into the resolved state, or into any state after it",
    );
    expect(resolving).toContain(
      "**Gives back the monitors the incident holds.**",
    );
    expect(resolving).toContain("**Change Monitor Status to**");
    expect(resolving).toContain(
      "unless another open incident is still on them",
    );
    expect(resolving).toContain(
      "an incident declared already resolved gives nothing back, and neither does a second resolve after a reopen",
    );
    expect(resolving).toContain("**Marks the SLA resolved**");
    expect(resolving).toContain(
      "Moving on from **Resolved** to a state after it — **Closed**, say — is not a second resolve",
    );
    expect(resolving).toContain("no new SLA starts");
    expect(resolving).toContain(
      "An incident declared before OneUptime started recording this gives its monitors back on its next resolve, as before.",
    );
  });

  test("the flags and the order decide together", () => {
    expect(page).toContain(
      "Three boolean flags on the state rows, together with the states' order, decide",
    );
  });
});

describe("the English overview and declare pages", () => {
  const index: string = read("en", INDEX_PAGE);
  const declaring: string = read("en", DECLARING_PAGE);

  test("Active Incidents is defined by the order", () => {
    expect(index).toContain(
      '- **Active Incidents** is defined purely as "the current state sits above the resolved state".',
    );
    expect(index).toContain(
      "one you place after it counts as resolved, as the resolved state does",
    );
  });

  test("Resolve gives back the monitors it holds, and links to what resolving does", () => {
    expect(index).toContain("gives back the monitors it holds");
    expect(index).toContain(
      "a status page shows only incidents in a state above the resolved state",
    );
    expect(index).toContain(
      `(/docs/incidents/states-and-severities#${slugify("What resolving does")})`,
    );
  });

  test("the badge and the status page read the order", () => {
    expect(index).toContain(
      "the count of incidents in a state above the resolved state",
    );
    expect(index).toContain(
      "and its current state sits above the resolved state",
    );
  });

  test("the declare page says which states count as active", () => {
    expect(declaring).toContain(
      "(any state above your resolved state counts as active)",
    );
    expect(declaring).not.toContain("`isResolvedState`");
  });
});

describe("the 14 upgrade notes", () => {
  const upgrading: string = read("en", UPGRADING_PAGE);
  const otherChanges: string = section(upgrading, "### Other changes in 14");

  test("say a state after the resolved state counts as resolved everywhere", () => {
    expect(otherChanges).toContain(
      "**A state after your resolved state counts as resolved everywhere.**",
    );
    expect(otherChanges).toContain("used to count as resolved");
    expect(otherChanges).toContain(
      "Projects whose custom states all\n  sit above the resolved state see no change.",
    );
    expect(otherChanges).toContain(
      `(/docs/incidents/states-and-severities#${slugify("The Active Incidents list")})`,
    );
  });

  test("say a resolve gives back only the monitors the incident holds", () => {
    expect(otherChanges).toContain(
      "**Resolving an incident gives back only the monitors it holds.**",
    );
    expect(otherChanges).toContain(
      "Incidents from before the upgrade give their\n  monitors back on their next resolve, as they always did.",
    );
    expect(otherChanges).toContain(
      `(/docs/incidents/states-and-severities#${slugify("What resolving does")})`,
    );
  });

  test("the links land on headings of the states page", () => {
    const states: string = read("en", STATES_PAGE);
    const anchors: Array<string> = states
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("## ");
      })
      .map((line: string): string => {
        return slugify(line.replace(/^##\s*/, ""));
      });

    expect(anchors).toContain("what-resolving-does");
    expect(anchors).toContain("the-active-incidents-list");
  });
});

describe("every docs language", () => {
  test("covers all 17 languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(Object.keys(OLD_DEFINITION).sort()).toEqual([...LANGUAGES].sort());
    expect(Object.keys(OLD_ADDED_AT_THE_END).sort()).toEqual(
      [...LANGUAGES].sort(),
    );
  });

  const englishSections: Array<string> = sections(read("en", STATES_PAGE));
  const englishResolvingIndex: number = englishSections.findIndex(
    (text: string): boolean => {
      return text.startsWith("## What resolving does");
    },
  );

  describe.each(LANGUAGES)("in %s", (language: string) => {
    const states: string = read(language, STATES_PAGE);
    const index: string = read(language, INDEX_PAGE);
    const declaring: string = read(language, DECLARING_PAGE);

    test("no longer defines Active Incidents by the flag alone", () => {
      const oldDefinition: string = OLD_DEFINITION[language]!;

      expect(states).not.toContain(oldDefinition);
      expect(index).not.toContain(oldDefinition);
      expect(declaring).not.toContain(oldDefinition);
      expect(declaring).not.toContain("`isResolvedState`");
    });

    test("no longer says a new state is added at the end of the list", () => {
      expect(states).not.toContain(OLD_ADDED_AT_THE_END[language]!);
    });

    test("says what a resolve does, before the state timeline", () => {
      const translated: Array<string> = sections(states);
      const resolvingIndex: number = translated.findIndex(
        (text: string): boolean => {
          return text.includes("**Change Monitor Status to**");
        },
      );

      expect(englishResolvingIndex).toBeGreaterThan(0);
      // The same place as the English page: right before the state timeline.
      expect(resolvingIndex).toBe(englishResolvingIndex);
      // One section names the monitor status setting: the new one.
      expect(
        translated.filter((text: string): boolean => {
          return text.includes("**Change Monitor Status to**");
        }),
      ).toHaveLength(1);
    });

    test("still names the flag that marks the resolved state", () => {
      expect(states).toContain("| `isResolvedState`");
    });
  });
});
