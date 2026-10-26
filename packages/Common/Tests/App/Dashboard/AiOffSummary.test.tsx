import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import AiOffSummary, {
  AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES,
  AI_OFF_SUMMARY_TEST_ID,
  AiOffStepGroup,
  getAiOffStepGroups,
  keepMenuPathArrowsInLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummary";
import {
  AiLaneSwitchStates,
  AiOffStep,
  AiOffSubjectType,
  AiOffSummary as AiOffSummaryCopy,
  getAiOffSummary,
  RemediationOffReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummaryData";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Route from "../../../Types/API/Route";
import { InvestigationNotStartedCode } from "../../../Types/AI/InvestigationNotStartedReason";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";

/*
 * The AI card as one line (AiOffSummary): what is off and why, a chevron
 * that opens what can be done, and - while AI is on - Ask OneUptime AI.
 * Opened, each change is a sentence, and the changes made in one place go
 * together with that place under them: its link for someone who may make
 * them, who can for everyone else - one link per page. Then that none of
 * it reaches back to this record.
 */

function summaryFor(data: {
  subjectType?: AiOffSubjectType;
  code: InvestigationNotStartedCode;
  remediationReason?: RemediationOffReason;
  isAiOn?: boolean;
  switches?: AiLaneSwitchStates;
}): AiOffSummaryCopy {
  return getAiOffSummary({
    subjectType: data.subjectType || "incident",
    reason: {
      code: data.code,
      title: "Server title",
      description: "Server description.",
      nextStep: "Server next step.",
      source: "recorded",
      evaluatedAt: "2026-09-14T18:01:20.000Z",
    },
    remediationReason: data.remediationReason || "fixing_off",
    isAiOn: data.isAiOn ?? true,
    switches: data.switches || {},
    translator: getGlobalTranslator(),
  });
}

function holds(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

function renderLine(data: {
  summary: AiOffSummaryCopy;
  isOpen?: boolean;
  onToggle?: () => void;
  onAskAi?: (() => void) | undefined;
}): ReturnType<typeof render> {
  return render(
    <AiOffSummary
      summary={data.summary}
      isOpen={data.isOpen ?? false}
      onToggle={data.onToggle || ((): void => {})}
      onAskAi={data.onAskAi}
    />,
  );
}

function line(): HTMLElement {
  return screen.getByTestId(AI_OFF_SUMMARY_TEST_ID);
}

function toggle(): HTMLElement {
  return screen.getByTestId("ai-off-summary-toggle");
}

function steps(): HTMLElement {
  return screen.getByTestId("ai-off-summary-steps");
}

function stepTexts(): Array<string> {
  return within(steps())
    .queryAllByTestId("ai-off-summary-step")
    .map((item: HTMLElement): string => {
      return item.textContent?.trim() || "";
    });
}

interface GroupRow {
  // The steps in the group, by key.
  steps: Array<string | null>;
  // The link under them: its words and where it goes.
  link: string | null;
  href: string | null;
  // Who can make them, said instead of a link.
  who: string | null;
}

const WHITESPACE: RegExp = /\s+/g;

// The opened steps as groups: what is in each, and what follows it.
function groupRows(): Array<GroupRow> {
  return within(steps())
    .queryAllByTestId("ai-off-summary-group")
    .map((group: HTMLElement): GroupRow => {
      const link: HTMLAnchorElement | null = group.querySelector("a");
      const who: HTMLElement | null =
        within(group).queryByTestId("ai-off-summary-who");

      return {
        steps: within(group)
          .getAllByTestId("ai-off-summary-step")
          .map((item: HTMLElement): string | null => {
            return item.getAttribute("data-step");
          }),
        link: link ? (link.textContent || "").trim() : null,
        href: link ? link.getAttribute("href") : null,
        who: who ? (who.textContent || "").replace(WHITESPACE, " ") : null,
      };
    });
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
  holds([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the folded line", () => {
  test("says what is off as the card's heading, and why under it", () => {
    renderLine({
      summary: summaryFor({ code: "automatic_investigation_disabled" }),
    });

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "AI investigation is off",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("ai-off-summary-reason")).toHaveTextContent(
      "“Investigate new incidents” was off when this incident was created.",
    );
    // OneUptime AI's mark, a decoration.
    expect(screen.getByTestId("ai-off-summary-mark")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(line()).toHaveAttribute("data-open", "false");
  });

  test("opens on its chevron, which says what it opens and that it is closed", () => {
    const onToggle: MockFunction = getJestMockFunction();

    renderLine({
      summary: summaryFor({ code: "automatic_investigation_disabled" }),
      onToggle: onToggle as unknown as () => void,
    });

    const button: HTMLElement = screen.getByRole("button", {
      name: "What you can do",
    });

    expect(button).toBe(toggle());
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("title", "What you can do");
    // It controls the part that opens, which is hidden while folded.
    expect(button.getAttribute("aria-controls")).toBe(steps().id);
    expect(steps()).not.toBeVisible();
    expect(steps()).toHaveAttribute("hidden");

    fireEvent.click(button);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  /*
   * As a folded section's header does, the line opens where it is clicked:
   * on what is off, on why, on its mark. The chevron stays the one control
   * a keyboard and a screen reader use.
   */
  test("opens on a click anywhere on the line, once per click", () => {
    const onToggle: MockFunction = getJestMockFunction();
    const onAskAi: MockFunction = getJestMockFunction();

    renderLine({
      summary: summaryFor({ code: "automatic_investigation_disabled" }),
      onToggle: onToggle as unknown as () => void,
      onAskAi: onAskAi as unknown as () => void,
    });

    for (const target of [
      "ai-off-summary-title",
      "ai-off-summary-reason",
      "ai-off-summary-mark",
      "ai-off-summary-header",
    ]) {
      onToggle.mockClear();
      fireEvent.click(screen.getByTestId(target));
      expect({ target, toggled: onToggle.mock.calls.length }).toEqual({
        target,
        toggled: 1,
      });
    }

    // The chevron's own click is not counted twice by the line.
    onToggle.mockClear();
    fireEvent.click(toggle());
    expect(onToggle).toHaveBeenCalledTimes(1);

    // Ask OneUptime AI asks, and does not open the fold.
    onToggle.mockClear();
    fireEvent.click(screen.getByTestId("ai-off-summary-ask"));
    expect(onAskAi).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    // Only the line: the words under it once open are not a toggle.
    expect(screen.getByTestId("ai-off-summary-header")).not.toContainElement(
      steps(),
    );
    // A pointer over the line says it opens, and the chevron brightens.
    expect(screen.getByTestId("ai-off-summary-header").className).toContain(
      "cursor-pointer",
    );
    expect(screen.getByTestId("ai-off-summary-header").className).toContain(
      "group",
    );
    expect(toggle().className).toContain("group-hover:text-gray-700");
    // Not a second control: the line itself is not focusable.
    expect(screen.getByTestId("ai-off-summary-header")).not.toHaveAttribute(
      "tabindex",
    );
  });

  test("a click that ends selecting the words does not open it", () => {
    const onToggle: MockFunction = getJestMockFunction();

    renderLine({
      summary: summaryFor({ code: "automatic_investigation_disabled" }),
      onToggle: onToggle as unknown as () => void,
    });

    jest.spyOn(window, "getSelection").mockReturnValue({
      toString: (): string => {
        return "was off when this incident was created";
      },
    } as unknown as Selection);

    fireEvent.click(screen.getByTestId("ai-off-summary-reason"));

    expect(onToggle).not.toHaveBeenCalled();
  });

  test("open, the chevron says so and the steps show", () => {
    renderLine({
      summary: summaryFor({ code: "automatic_investigation_disabled" }),
      isOpen: true,
    });

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(steps()).toBeVisible();
    expect(steps()).not.toHaveAttribute("hidden");
    expect(line()).toHaveAttribute("data-open", "true");
  });

  test("offers Ask OneUptime AI only when asked to, and asks on a click", () => {
    const onAskAi: MockFunction = getJestMockFunction();
    const { rerender } = renderLine({
      summary: summaryFor({ code: "automatic_investigation_disabled" }),
    });

    expect(screen.queryByTestId("ai-off-summary-ask")).toBeNull();

    rerender(
      <AiOffSummary
        summary={summaryFor({ code: "automatic_investigation_disabled" })}
        isOpen={false}
        onToggle={(): void => {}}
        onAskAi={onAskAi as unknown as () => void}
      />,
    );

    const ask: HTMLElement = screen.getByRole("button", {
      name: "Ask OneUptime AI",
    });

    fireEvent.click(ask);

    expect(onAskAi).toHaveBeenCalledTimes(1);
  });

  /*
   * The parts in the order they are read, tabbed to and heard - on every
   * width: what is off, its chevron, why, then Ask OneUptime AI. They were
   * reordered by CSS, which put Ask before the chevron in tab order while
   * a phone drew it after why.
   */
  test("its parts are in the order they are read, tabbed to and heard: title, chevron, why, then Ask", () => {
    renderLine({
      summary: summaryFor({ code: "automatic_investigation_disabled" }),
      onAskAi: (): void => {},
    });

    const title: HTMLElement = screen.getByTestId("ai-off-summary-title");
    const ask: HTMLElement = screen.getByTestId("ai-off-summary-ask");
    const reason: HTMLElement = screen.getByTestId("ai-off-summary-reason");
    const header: HTMLElement = screen.getByTestId("ai-off-summary-header");

    // Document order: what a keyboard and a screen reader follow.
    const parts: Array<HTMLElement> = [title, toggle(), reason, ask];

    for (let index: number = 1; index < parts.length; index++) {
      expect(
        parts[index - 1]!.compareDocumentPosition(parts[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    // The focusable ones, as Tab meets them: the chevron, then Ask.
    expect(
      Array.from(header.querySelectorAll("button")).map(
        (button: HTMLButtonElement): string => {
          return button.getAttribute("data-testid") || "";
        },
      ),
    ).toEqual(["ai-off-summary-toggle", "ai-off-summary-ask"]);

    // Nothing is moved by CSS: the eye meets them in the same order.
    for (const element of [title, toggle(), reason, ask]) {
      expect(element.className).not.toMatch(/(?:^|\s|:)order-/);
    }

    // The chevron shares the title's row; Ask follows why, at its start.
    expect(title.parentElement).toBe(toggle().parentElement);
    expect(reason.parentElement).toBe(ask.parentElement);

    for (const [element, className] of [
      [title, AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.title],
      [ask, AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.ask],
      [toggle(), AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.toggle],
      [reason, AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.reason],
      [title.parentElement!, AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.titleRow],
      [reason.parentElement!, AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.reasonRow],
    ] as Array<[HTMLElement, string]>) {
      for (const token of className.split(" ")) {
        expect(element.className.split(" ")).toContain(token);
      }
    }

    expect(AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES).toEqual({
      titleRow: "flex items-start gap-x-1",
      title: "min-w-0 grow basis-0",
      toggle: "-me-1.5 flex-none",
      reasonRow: "flex flex-wrap items-start gap-y-0.5",
      reason: "min-w-0 basis-full",
      ask: "-ms-2",
    });
  });
});

describe("what can be done, for someone who may do it", () => {
  test("each change a sentence; the changes made in one place together, with that place's link under them", () => {
    renderLine({
      summary: summaryFor({
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    expect(stepTexts()).toEqual([
      "Turn on “Investigate new incidents”.",
      "Turn on “Fix new incidents automatically”.",
    ]);
    // Both switches are on one page: one group, one link under both.
    expect(groupRows()).toEqual([
      {
        steps: ["investigate-switch", "fix-switch"],
        link: "Incident AI settings",
        href: routeFor(PageMap.INCIDENTS_SETTINGS_AI),
        who: null,
      },
    ]);
    expect(within(steps()).getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByTestId("ai-off-summary-who")).toBeNull();
    expect(screen.getByTestId("ai-off-summary-note")).toHaveTextContent(
      "This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    );
  });

  test("the link comes after the steps it is for, lined up with their words", () => {
    renderLine({
      summary: summaryFor({
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    const group: HTMLElement = within(steps()).getByTestId(
      "ai-off-summary-group",
    );
    const link: HTMLElement = within(group).getByRole("link");
    const lastStep: HTMLElement = within(group).getAllByTestId(
      "ai-off-summary-step",
    )[1]!;

    // After the steps, in the same list item.
    expect(
      lastStep.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(link.closest("li")).toBe(group);
    // Past the steps' marks: an empty mark-wide column, then the link.
    const row: HTMLElement = screen.getByTestId(
      "ai-off-summary-links",
    ).parentElement!;

    expect(row.className).toBe("flex items-start gap-2.5");
    expect(row.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(row.firstElementChild?.className).toBe("w-4 flex-none");
  });

  test("Enable AI and the record's settings are two places: each link under its own steps, Enable AI's first", () => {
    renderLine({
      summary: summaryFor({
        code: "ai_disabled",
        remediationReason: "ai_off",
        isAiOn: false,
        switches: { investigate: false, fix: false },
      }),
      isOpen: true,
    });

    expect(groupRows()).toEqual([
      {
        steps: ["enable-ai"],
        link: "AI Features",
        href: routeFor(PageMap.SETTINGS_AI_FEATURES),
        who: null,
      },
      {
        steps: ["investigate-switch", "fix-switch"],
        link: "Incident AI settings",
        href: routeFor(PageMap.INCIDENTS_SETTINGS_AI),
        who: null,
      },
    ]);
  });

  test("the minimum severity's card and the switches: two links, each under its step", () => {
    renderLine({
      summary: summaryFor({
        code: "severity_below_threshold",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    expect(groupRows()).toEqual([
      {
        steps: ["minimum-severity"],
        link: "Which incidents are investigated",
        href: `${routeFor(PageMap.INCIDENTS_SETTINGS_AI)}#WhichAreInvestigated`,
        who: null,
      },
      {
        steps: ["fix-switch"],
        link: "Incident AI settings",
        href: routeFor(PageMap.INCIDENTS_SETTINGS_AI),
        who: null,
      },
    ]);
  });

  /*
   * On a phone a long name wraps: its arrow is part of the words' line,
   * glued to the last one by a no-break space, so it ends the name rather
   * than sitting alone at the card's far edge (an inline-flex link put it
   * there). Screen readers hear only the name.
   */
  test("a link's arrow follows its last word, glued by a no-break space, and is not read out", () => {
    renderLine({
      summary: summaryFor({
        code: "severity_below_threshold",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    const links: Array<HTMLElement> = within(steps()).getAllByRole("link");

    expect(
      links.map((link: HTMLElement): string => {
        return link.textContent?.trim() || "";
      }),
    ).toEqual(["Which incidents are investigated", "Incident AI settings"]);
    expect(
      screen.getByRole("link", { name: "Which incidents are investigated" }),
    ).toHaveAttribute(
      "href",
      `${routeFor(PageMap.INCIDENTS_SETTINGS_AI)}#WhichAreInvestigated`,
    );

    for (const link of links) {
      const arrow: HTMLElement = within(link).getByTestId(
        "ai-off-summary-link-arrow",
      );

      // Inline, in the words' flow: not a flex row that parks it at the edge.
      expect(link.className).not.toMatch(/(^|\s)(inline-)?flex(\s|$)/);
      expect(arrow.className).toContain("inline-block");
      expect(arrow).toHaveAttribute("aria-hidden", "true");
      // The words, a no-break space, then the arrow: nothing between.
      expect(arrow.previousSibling?.textContent).toBe(" ");
      expect(link.textContent?.endsWith(" ")).toBe(true);
      // And no line can break between the space and the arrow.
      expect(arrow.parentElement?.className).toBe("whitespace-nowrap");
      expect(arrow.parentElement?.parentElement).toBe(link);
    }
  });

  test("the AI rules link opens the settings page at the rules", () => {
    renderLine({
      summary: summaryFor({
        subjectType: "alert",
        code: "no_investigation_rule_matched",
        remediationReason: "no_rule_matched",
      }),
      isOpen: true,
    });

    expect(
      screen.getByRole("link", { name: "Alert AI rules" }),
    ).toHaveAttribute(
      "href",
      `${routeFor(PageMap.ALERTS_SETTINGS_AI)}#AiRules`,
    );
  });

  test("a change made since is said with a check, on its own, and sends nobody anywhere", () => {
    renderLine({
      summary: summaryFor({
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
        switches: { investigate: true, fix: false },
      }),
      isOpen: true,
    });

    const items: Array<HTMLElement> = within(steps()).getAllByTestId(
      "ai-off-summary-step",
    );

    expect(
      items.map((item: HTMLElement): [string | null, string | null] => {
        return [item.getAttribute("data-step"), item.getAttribute("data-done")];
      }),
    ).toEqual([
      ["investigate-switch", "true"],
      ["fix-switch", "false"],
    ]);
    expect(items[0]).toHaveTextContent(
      "“Investigate new incidents” is on now.",
    );
    // The one left to do still has its page, under it alone.
    expect(groupRows()).toEqual([
      { steps: ["investigate-switch"], link: null, href: null, who: null },
      {
        steps: ["fix-switch"],
        link: "Incident AI settings",
        href: routeFor(PageMap.INCIDENTS_SETTINGS_AI),
        who: null,
      },
    ]);
  });

  test("with every change made since, one group of checks, no link and no who-can", () => {
    renderLine({
      summary: summaryFor({
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
        switches: { investigate: true, fix: true },
      }),
      isOpen: true,
    });

    expect(groupRows()).toEqual([
      {
        steps: ["investigate-switch", "fix-switch"],
        link: null,
        href: null,
        who: null,
      },
    ]);
    expect(screen.queryByTestId("ai-off-summary-links")).toBeNull();
    expect(screen.queryByTestId("ai-off-summary-who")).toBeNull();
    expect(screen.getByTestId("ai-off-summary-note")).toBeVisible();
  });
});

describe("what can be done, for someone who may not", () => {
  beforeEach(() => {
    holds([Permission.ProjectMember]);
  });

  test("no link to a page whose save would be refused; who can, once, under the steps", () => {
    renderLine({
      summary: summaryFor({
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    expect(stepTexts()).toHaveLength(2);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("ai-off-summary-links")).toBeNull();
    // Both switches take the same people: one group, said once.
    expect(groupRows()).toEqual([
      {
        steps: ["investigate-switch", "fix-switch"],
        link: null,
        href: null,
        who: "A project owner or admin can make these changes in Incidents → AI → Settings.",
      },
    ]);
  });

  test("a rule and a switch take different people: each said, under its own step", () => {
    renderLine({
      summary: summaryFor({
        subjectType: "alert",
        code: "no_investigation_rule_matched",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    expect(groupRows()).toEqual([
      {
        steps: ["investigate-rules"],
        link: null,
        href: null,
        who: "A project owner or admin, or someone who may edit AI rules, can change them in Alerts → AI → Settings.",
      },
      {
        steps: ["fix-switch"],
        link: null,
        href: null,
        who: "A project owner or admin can make these changes in Alerts → AI → Settings.",
      },
    ]);
  });

  test("the minimum severity and the fixing switch take the same people: said once, under both", () => {
    renderLine({
      summary: summaryFor({
        code: "severity_below_threshold",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    expect(groupRows()).toEqual([
      {
        steps: ["minimum-severity", "fix-switch"],
        link: null,
        href: null,
        who: "A project owner or admin can make these changes in Incidents → AI → Settings.",
      },
    ]);
  });

  test("someone whose role may edit AI rules gets the rules' link, and who can for the switch", () => {
    holds([Permission.EditAutoRemediationRule]);

    renderLine({
      summary: summaryFor({
        code: "no_investigation_rule_matched",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    expect(
      screen.getByRole("link", { name: "Incident AI rules" }),
    ).toBeVisible();
    expect(groupRows()).toEqual([
      {
        steps: ["investigate-rules"],
        link: "Incident AI rules",
        href: `${routeFor(PageMap.INCIDENTS_SETTINGS_AI)}#AiRules`,
        who: null,
      },
      {
        steps: ["fix-switch"],
        link: null,
        href: null,
        who: "A project owner or admin can make these changes in Incidents → AI → Settings.",
      },
    ]);
  });

  test("Manage Billing may turn AI on, and is told who may change the rest", () => {
    holds([Permission.ManageProjectBilling]);

    renderLine({
      summary: summaryFor({
        code: "ai_disabled",
        remediationReason: "ai_off",
        isAiOn: false,
        switches: { investigate: false, fix: false },
      }),
      isOpen: true,
    });

    expect(screen.getByRole("link", { name: "AI Features" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Incident AI settings" }),
    ).toBeNull();
    expect(groupRows()).toEqual([
      {
        steps: ["enable-ai"],
        link: "AI Features",
        href: routeFor(PageMap.SETTINGS_AI_FEATURES),
        who: null,
      },
      {
        steps: ["investigate-switch", "fix-switch"],
        link: null,
        href: null,
        who: "A project owner or admin can make these changes in Incidents → AI → Settings.",
      },
    ]);
  });

  /*
   * "… in Incidents → AI → Settings." wraps on a phone: a line may end with
   * an arrow, never start with one.
   */
  test("a menu path's arrows never start a line", () => {
    renderLine({
      summary: summaryFor({
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    const sentence: string =
      screen.getByTestId("ai-off-summary-who").textContent || "";

    expect(sentence).toBe(
      "A project owner or admin can make these changes in Incidents → AI → Settings.",
    );
    expect(sentence).not.toContain(" →");
  });
});

describe("the steps, grouped by where they are made", () => {
  function stepOf(data: {
    key: AiOffStep["key"];
    route: string;
    isDone?: boolean;
    whoCanChange: string;
  }): AiOffStep {
    return {
      key: data.key,
      text: data.key,
      isDone: Boolean(data.isDone),
      link: { text: data.route, route: new Route(data.route) },
      permissions: [],
      whoCanChange: data.whoCanChange,
    };
  }

  function shape(
    groups: Array<AiOffStepGroup>,
  ): Array<[Array<string>, string | null, string | null]> {
    return groups.map(
      (
        group: AiOffStepGroup,
      ): [Array<string>, string | null, string | null] => {
        return [
          group.steps.map((step: AiOffStep): string => {
            return step.key;
          }),
          group.link ? group.link.route.toString() : null,
          group.whoCanChange,
        ];
      },
    );
  }

  const all: Array<AiOffStep> = [
    stepOf({
      key: "enable-ai",
      route: "/a",
      whoCanChange: "Owner or billing.",
    }),
    stepOf({
      key: "investigate-switch",
      route: "/b",
      whoCanChange: "Owner or admin.",
    }),
    stepOf({ key: "fix-switch", route: "/b", whoCanChange: "Owner or admin." }),
    stepOf({
      key: "investigate-rules",
      route: "/b#AiRules",
      whoCanChange: "Rule editors.",
    }),
    stepOf({
      key: "minimum-severity",
      route: "/c",
      isDone: true,
      whoCanChange: "Done people.",
    }),
  ];

  test("each place once, under the run of steps made there; never for a done step", () => {
    expect(
      shape(
        getAiOffStepGroups(all, (): boolean => {
          return true;
        }),
      ),
    ).toEqual([
      [["enable-ai"], "/a", null],
      [["investigate-switch", "fix-switch"], "/b", null],
      [["investigate-rules"], "/b#AiRules", null],
      [["minimum-severity"], null, null],
    ]);
  });

  test("who can, under the steps the reader may not make, once per sentence", () => {
    expect(
      shape(
        getAiOffStepGroups(all, (step: AiOffStep): boolean => {
          return step.key === "enable-ai";
        }),
      ),
    ).toEqual([
      [["enable-ai"], "/a", null],
      [["investigate-switch", "fix-switch"], null, "Owner or admin."],
      [["investigate-rules"], null, "Rule editors."],
      [["minimum-severity"], null, null],
    ]);
  });

  test("steps done since go together, with nothing after them", () => {
    expect(
      shape(
        getAiOffStepGroups(
          [
            stepOf({
              key: "investigate-switch",
              route: "/b",
              isDone: true,
              whoCanChange: "Owner or admin.",
            }),
            stepOf({
              key: "fix-switch",
              route: "/b",
              isDone: true,
              whoCanChange: "Owner or admin.",
            }),
          ],
          (): boolean => {
            return true;
          },
        ),
      ),
    ).toEqual([[["investigate-switch", "fix-switch"], null, null]]);
  });

  test("a place or a sentence met again later is not said twice", () => {
    expect(
      shape(
        getAiOffStepGroups(
          [
            stepOf({
              key: "investigate-switch",
              route: "/b",
              whoCanChange: "Owner or admin.",
            }),
            stepOf({
              key: "investigate-rules",
              route: "/b#AiRules",
              whoCanChange: "Rule editors.",
            }),
            stepOf({
              key: "fix-switch",
              route: "/b",
              whoCanChange: "Owner or admin.",
            }),
          ],
          (step: AiOffStep): boolean => {
            return step.key !== "investigate-rules";
          },
        ),
      ),
    ).toEqual([
      [["investigate-switch"], "/b", null],
      [["investigate-rules"], null, "Rule editors."],
      [["fix-switch"], null, null],
    ]);
  });

  test("a menu path keeps each arrow with the menu before it, in either direction", () => {
    expect(keepMenuPathArrowsInLine("in Incidents → AI → Settings.")).toBe(
      "in Incidents → AI → Settings.",
    );
    expect(keepMenuPathArrowsInLine("در حوادث ← هوش مصنوعی ← تنظیمات")).toBe(
      "در حوادث ← هوش مصنوعی ← تنظیمات",
    );
    expect(keepMenuPathArrowsInLine("No menu here.")).toBe("No menu here.");
  });
});
