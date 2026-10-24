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
  getAiOffSummaryLinks,
  getAiOffSummaryWhoCanChange,
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
 * Opened, each change is a sentence; where it is made is one link per page
 * for someone who may make it, and who can is said instead to everyone
 * else; then that none of it reaches back to this record.
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

  test("lays out by the line's own width: the chevron on the first row, Ask beside it or after the reason", () => {
    renderLine({
      summary: summaryFor({ code: "automatic_investigation_disabled" }),
      onAskAi: (): void => {},
    });

    const title: HTMLElement = screen.getByTestId("ai-off-summary-title");
    const ask: HTMLElement = screen.getByTestId("ai-off-summary-ask");
    const reason: HTMLElement = screen.getByTestId("ai-off-summary-reason");

    // The column the container queries measure.
    expect(title.parentElement?.parentElement?.className).toContain(
      "[container-type:inline-size]",
    );

    for (const [element, className] of [
      [title, AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.title],
      [ask, AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.ask],
      [toggle(), AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.toggle],
      [reason, AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES.reason],
    ] as Array<[HTMLElement, string]>) {
      for (const token of className.split(" ")) {
        expect(element.className.split(" ")).toContain(token);
      }
    }

    // Narrow: title, chevron, reason, then Ask. From 28rem: title, Ask, chevron, reason.
    expect(AI_OFF_SUMMARY_LAYOUT_CLASS_NAMES).toEqual({
      title: "order-1 min-w-0 grow basis-0",
      ask: "order-4 -ml-2 [@container(min-width:28rem)]:order-2 [@container(min-width:28rem)]:ml-0",
      toggle: "order-2 -mr-1.5 [@container(min-width:28rem)]:order-3",
      reason: "order-3 basis-full [@container(min-width:28rem)]:order-4",
    });
  });
});

describe("what can be done, for someone who may do it", () => {
  test("each change a sentence, then where - one link per page, in order", () => {
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

    const links: Array<HTMLElement> = within(
      screen.getByTestId("ai-off-summary-links"),
    ).getAllByRole("link");

    // Both switches are on one page: one link.
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Incident AI settings");
    expect(links[0]).toHaveAttribute(
      "href",
      routeFor(PageMap.INCIDENTS_SETTINGS_AI),
    );
    expect(screen.queryByTestId("ai-off-summary-who")).toBeNull();
    expect(screen.getByTestId("ai-off-summary-note")).toHaveTextContent(
      "This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.",
    );
  });

  test("Enable AI and the record's settings are two places: two links, Enable AI's first", () => {
    renderLine({
      summary: summaryFor({
        code: "ai_disabled",
        remediationReason: "ai_off",
        isAiOn: false,
        switches: { investigate: false, fix: false },
      }),
      isOpen: true,
    });

    const links: Array<HTMLElement> = within(
      screen.getByTestId("ai-off-summary-links"),
    ).getAllByRole("link");

    expect(
      links.map((link: HTMLElement): [string, string | null] => {
        return [link.textContent?.trim() || "", link.getAttribute("href")];
      }),
    ).toEqual([
      ["AI Features", routeFor(PageMap.SETTINGS_AI_FEATURES)],
      ["Incident AI settings", routeFor(PageMap.INCIDENTS_SETTINGS_AI)],
    ]);
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

  test("a change made since is said with a check, and sends nobody anywhere", () => {
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
    // The one left to do still has its page.
    expect(
      within(screen.getByTestId("ai-off-summary-links")).getAllByRole("link"),
    ).toHaveLength(1);
  });

  test("with every change made since, no link and no who-can", () => {
    renderLine({
      summary: summaryFor({
        code: "automatic_investigation_disabled",
        remediationReason: "fixing_off",
        switches: { investigate: true, fix: true },
      }),
      isOpen: true,
    });

    expect(screen.queryByTestId("ai-off-summary-links")).toBeNull();
    expect(screen.queryByTestId("ai-off-summary-who")).toBeNull();
    expect(screen.getByTestId("ai-off-summary-note")).toBeVisible();
  });
});

describe("what can be done, for someone who may not", () => {
  beforeEach(() => {
    holds([Permission.ProjectMember]);
  });

  test("no link to a page whose save would be refused; who can, once", () => {
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

    const who: HTMLElement = screen.getByTestId("ai-off-summary-who");

    // Both switches take the same people: said once.
    expect(within(who).getAllByText(/./)).toHaveLength(1);
    expect(who).toHaveTextContent(
      "A project owner or admin can make these changes in Incidents → AI → Settings.",
    );
  });

  test("a rule and a switch take different people: each said", () => {
    renderLine({
      summary: summaryFor({
        subjectType: "alert",
        code: "no_investigation_rule_matched",
        remediationReason: "fixing_off",
      }),
      isOpen: true,
    });

    expect(
      Array.from(
        screen.getByTestId("ai-off-summary-who").querySelectorAll("p"),
      ).map((sentence: HTMLParagraphElement): string => {
        return sentence.textContent || "";
      }),
    ).toEqual([
      "A project owner or admin, or someone who may edit AI rules, can change them in Alerts → AI → Settings.",
      "A project owner or admin can make these changes in Alerts → AI → Settings.",
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
    expect(screen.getByTestId("ai-off-summary-who")).toHaveTextContent(
      "A project owner or admin can make these changes in Incidents → AI → Settings.",
    );
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
    expect(screen.getByTestId("ai-off-summary-who")).toHaveTextContent(
      "A project owner or admin can make these changes in Incidents → AI → Settings.",
    );
  });
});

describe("the links and who-can, as lists", () => {
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

  test("each page once, in the order the steps first name it; never for a done step", () => {
    expect(
      getAiOffSummaryLinks(all, (): boolean => {
        return true;
      }).map((link: { route: Route }): string => {
        return link.route.toString();
      }),
    ).toEqual(["/a", "/b", "/b#AiRules"]);
  });

  test("only the steps the reader may make", () => {
    expect(
      getAiOffSummaryLinks(all, (step: AiOffStep): boolean => {
        return step.key === "investigate-rules";
      }).map((link: { route: Route }): string => {
        return link.route.toString();
      }),
    ).toEqual(["/b#AiRules"]);
  });

  test("who can, once per sentence, for the steps the reader may not make", () => {
    expect(
      getAiOffSummaryWhoCanChange(all, (step: AiOffStep): boolean => {
        return step.key === "enable-ai";
      }),
    ).toEqual(["Owner or admin.", "Rule editors."]);
    expect(
      getAiOffSummaryWhoCanChange(all, (): boolean => {
        return true;
      }),
    ).toEqual([]);
  });
});
