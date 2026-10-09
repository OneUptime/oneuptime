import slugify from "Common/Server/Types/MarkdownSlugify";
import AcknowledgedStateUtil from "Common/Utils/AcknowledgedState";
import { StateListType } from "Common/Utils/StateOrder";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { dashboardLabel } from "./DocsDashboardLabels";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * One rule decides whether an incident, an alert or an episode is
 * acknowledged: its state is the project's acknowledged state - the first
 * from the top flagged isAcknowledgedState - any state placed after it, or a
 * resolved one (Common/Utils/AcknowledgedState). The states page used to say
 * the flag "powers the Acknowledge button" and that only a move into that
 * one state marks the SLA responded, which is what the mobile app and
 * Microsoft Teams read too. Every docs language now says what acknowledging
 * does, and the 14 upgrade notes say what changes for existing projects.
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
const UPGRADING_PAGE: string = "installation/upgrading";
const SETTINGS_PAGE: string = "incidents/settings";

// The "## " sections of a page, the text before the first heading first.
function sections(markdown: string): Array<string> {
  return markdown.split(/\n(?=## )/);
}

// How each language's isAcknowledgedState row used to begin.
const OLD_ROW: Record<string, string> = {
  en: "Powers the **Acknowledge** button",
  da: "Driver knappen **Acknowledge** og nøgletalsfeltet",
  de: "Treibt die Schaltfläche **Acknowledge**",
  es: "Gobierna el botón **Acknowledge**",
  fa: "دکمه **Acknowledge** و کاشی آماری",
  fr: "Alimente le bouton **Acknowledge**",
  hi: "**Acknowledge** बटन और घटना के",
  it: "Alimenta il pulsante **Acknowledge**",
  ja: "**Acknowledge** ボタンと、インシデントの",
  ko: "**Acknowledge** 버튼과 인시던트",
  nl: "Voedt de knop **Acknowledge**",
  no: "Driver knappen **Acknowledge** og statistikkflisen",
  pt: "Alimenta o botão **Acknowledge**",
  ru: "Питает кнопку **Acknowledge**",
  sv: "Driver knappen **Acknowledge** och nyckeltalsrutan",
  "zh-CN": "驱动 **Acknowledge** 按钮",
  "zh-TW": "驅動 **Acknowledge** 按鈕",
};

describe("the rule the docs describe is the rule the product runs", () => {
  /*
   * The project the docs talk about: the seeded states and an
   * "Investigating" state placed between Acknowledged and Resolved.
   */
  const states: Array<{
    _id: string;
    order: number;
    isCreatedState?: boolean;
    isAcknowledgedState?: boolean;
    isResolvedState?: boolean;
  }> = [
    {
      _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000e0c1",
      order: 1,
      isCreatedState: true,
    },
    {
      _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000e0c2",
      order: 2,
      isAcknowledgedState: true,
    },
    { _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000e0c3", order: 3 },
    {
      _id: "5a0f6c1e-0d3b-4c1e-9b7a-00000000e0c4",
      order: 4,
      isResolvedState: true,
    },
  ];

  const isAcknowledged: (stateId: string) => boolean = (
    stateId: string,
  ): boolean => {
    return AcknowledgedStateUtil.isAcknowledged({
      list: StateListType.IncidentState,
      states: states,
      stateId: stateId,
    });
  };

  test("the created state is not acknowledged", () => {
    expect(isAcknowledged(states[0]!._id)).toBe(false);
  });

  test("the acknowledged state, a state after it and a resolved state are", () => {
    expect(isAcknowledged(states[1]!._id)).toBe(true);
    // "Investigating": no flag of its own, placed after Acknowledged.
    expect(states[2]!.isAcknowledgedState).toBeUndefined();
    expect(isAcknowledged(states[2]!._id)).toBe(true);
    expect(isAcknowledged(states[3]!._id)).toBe(true);
  });

  test("acknowledging a record that is acknowledged already is refused as the docs quote it", () => {
    expect(
      AcknowledgedStateUtil.getAcknowledgeRefusal({
        list: StateListType.IncidentState,
        states: states,
        stateId: states[2]!._id,
        subject: "Incident",
      }),
    ).toBe("Incident is already acknowledged.");
    expect(
      AcknowledgedStateUtil.getAcknowledgeRefusal({
        list: StateListType.IncidentState,
        states: states,
        stateId: states[3]!._id,
        subject: "Incident",
      }),
    ).toBe("Incident is already resolved.");
  });
});

describe("the English states page", () => {
  const page: string = read("en", STATES_PAGE);

  test("the flag marks the acknowledged state, and a state after it is acknowledged too", () => {
    const row: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| `isAcknowledgedState`");
      });

    expect(row).toContain("Marks the project's acknowledged state");
    expect(row).toContain(
      "An incident in it, in any state after it, or resolved, is acknowledged",
    );
  });

  test("says what acknowledging does", () => {
    const section: string | undefined = sections(page).find(
      (candidate: string): boolean => {
        return candidate.startsWith("## What acknowledging does\n");
      },
    );

    expect(section).toBeDefined();

    for (const phrase of [
      "**Acknowledge is no longer offered.**",
      "the mobile app",
      "Slack or Microsoft Teams",
      "`acknowledge_incident`",
      '"Incident is already acknowledged."',
      "**On-call stops paging for it.**",
      "**The SLA is marked responded**",
      "**Time to acknowledge runs to that first move**",
      "**Time to Acknowledge** metric",
      "**An Acknowledged filter**",
      "Alerts and episodes follow the same rule",
    ]) {
      expect(section).toContain(phrase);
    }
  });

  test("comes right before what resolving does", () => {
    const headings: Array<string> = sections(page)
      .map((section: string): string => {
        return section.split("\n")[0]!;
      })
      .filter((heading: string): boolean => {
        return heading.startsWith("## ");
      });

    const at: number = headings.indexOf("## What acknowledging does");

    expect(at).toBeGreaterThan(-1);
    expect(headings[at + 1]).toBe("## What resolving does");
  });
});

describe.each(LANGUAGES)("the %s states page", (language: string) => {
  const page: string = read(language, STATES_PAGE);

  test("no longer says the flag only powers the button", () => {
    const row: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| `isAcknowledgedState`");
      });

    expect(row).toBeDefined();
    expect(row).not.toContain(OLD_ROW[language]!);
    // The header's button, named as this language's Dashboard draws it.
    expect(row).toContain(`**${dashboardLabel(language, "Acknowledge")}**`);
  });

  test("has a section on what acknowledging does, right before what resolving does", () => {
    const all: Array<string> = sections(page);
    const at: number = all.findIndex((section: string): boolean => {
      // The refusal is quoted as the product sends it, in any quote marks.
      return (
        section.startsWith("## ") &&
        section.includes("`acknowledge_incident`") &&
        section.includes("Incident is already acknowledged.")
      );
    });

    expect(at).toBeGreaterThan(0);
    expect(all[at]).toContain("**Time to Acknowledge**");

    // The next section is the resolve one, whose heading the page kept.
    const english: Array<string> = sections(read("en", STATES_PAGE));
    const englishAt: number = english.findIndex((section: string): boolean => {
      return section.startsWith("## What acknowledging does\n");
    });

    expect(all.length).toBe(english.length);
    expect(at).toBe(englishAt);
  });
});

describe("the 14 upgrade note", () => {
  const page: string = read("en", UPGRADING_PAGE);

  test("says what changes for existing projects, and links to the section", () => {
    const start: number = page.indexOf(
      "- **A state after your acknowledged state counts as acknowledged",
    );

    expect(start).toBeGreaterThan(-1);

    const note: string = page.slice(start, page.indexOf("\n- **", start + 1));

    for (const phrase of [
      "moved it back to **Acknowledged**",
      "is no longer\n  offered for such a record anywhere",
      "marks the incident's SLA responded",
      "**Time to Acknowledge**",
      "Projects whose custom states all sit above the acknowledged state see no\n  change.",
    ]) {
      expect(note).toContain(phrase);
    }

    expect(note).toContain(
      "(/docs/incidents/states-and-severities#what-acknowledging-does)",
    );
  });

  test("the link lands on a heading", () => {
    expect(slugify("What acknowledging does")).toBe("what-acknowledging-does");
    expect(read("en", STATES_PAGE)).toContain("\n## What acknowledging does\n");
  });
});

describe("the measurement moments table", () => {
  test("the acknowledged moment counts a state after the acknowledged state", () => {
    const row: string | undefined = read("en", SETTINGS_PAGE)
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| **The incident is acknowledged**");
      });

    expect(row).toContain(
      "When it reaches your acknowledged state, or any state after it",
    );
  });
});
