import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import RemediationDecisionList, {
  goToPagePlace,
  REMEDIATION_DECISION_TONE_MARK,
  RemediationDecisionToneMark,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionList";
import {
  AFFECTED_RESOURCES_PLACE_ID,
  getRemediationDecisionLines,
  RemediationDecisionLine,
  RemediationDecisionTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import {
  PAGE_ANCHOR_FOCUSED_ATTRIBUTE,
  PAGE_ANCHOR_LANDED_ATTRIBUTE,
} from "../../../UI/Utils/PageAnchor";
import Route from "../../../Types/API/Route";
import {
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import IconProp from "../../../Types/Icon/IconProp";
import Icon, {
  ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
} from "../../../UI/Components/Icon/Icon";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * What auto-remediation did with an incident or alert, as the AI card's
 * Remediation step draws it: one line per fix path, divided by hairlines.
 *
 * - Each line starts with a tinted mark of its tone - green for what
 *   OneUptime did, amber for what needs looking at, indigo for a wait, gray
 *   for how things stand - told apart by glyph as well as by colour, and
 *   hidden from screen readers, which read the sentence.
 * - A blocked cluster's or resource's gap reads as "Why" and "What to do",
 *   a definition list set off by a rule under the sentence.
 * - Links say where they go, carry an arrow that is drawn and not read,
 *   and wrap.
 * - The list has no heading of its own: the step's title says what it is.
 */

const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_MONITOR_ID: string = "44444444-4444-4444-8444-444444444445";

const TONES: Array<RemediationDecisionTone> = [
  "acted",
  "attention",
  "info",
  "waiting",
];

function line(
  overrides: Partial<RemediationDecisionLine> & { key: string },
): RemediationDecisionLine {
  return {
    tone: "info",
    text: `Line ${overrides.key}.`,
    links: [],
    ...overrides,
  };
}

function lines(): Array<HTMLElement> {
  return screen.getAllByTestId("remediation-decision-line");
}

// The d attribute an Icon draws, to tell one glyph from another.
function pathOf(icon: IconProp): string {
  const view: ReturnType<typeof render> = render(<Icon icon={icon} />);
  const path: string =
    view.container.querySelector("path")?.getAttribute("d") || "";
  view.unmount();
  return path;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

afterEach(() => {
  cleanup();
});

describe("RemediationDecisionList", () => {
  test("draws nothing without a line", () => {
    const view: ReturnType<typeof render> = render(
      <RemediationDecisionList lines={[]} />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  test("draws one list item per line, in order, each with its tone", () => {
    render(
      <RemediationDecisionList
        lines={[
          line({ key: "a", tone: "attention", text: "First." }),
          line({ key: "b", tone: "acted", text: "Second." }),
          line({ key: "c", tone: "info", text: "Third." }),
        ]}
      />,
    );

    const list: HTMLElement = screen.getByRole("list");
    const items: Array<HTMLElement> = within(list).getAllByRole("listitem");

    expect(items).toEqual(lines());
    expect(
      items.map((item: HTMLElement) => {
        return [
          item.getAttribute("data-tone"),
          within(item).getByTestId("remediation-decision-text").textContent,
        ];
      }),
    ).toEqual([
      ["attention", "First."],
      ["acted", "Second."],
      ["info", "Third."],
    ]);
  });

  test("divides the lines by hairlines, with no padding outside the first and last", () => {
    render(
      <RemediationDecisionList
        lines={[line({ key: "a" }), line({ key: "b" })]}
      />,
    );

    expect(screen.getByRole("list")).toHaveClass("divide-y", "divide-gray-100");
    for (const item of lines()) {
      expect(item).toHaveClass("py-4", "first:pt-0", "last:pb-0");
    }
  });

  // The Remediation step's title heads the lines: none of their own.
  test("has no heading of its own", () => {
    render(<RemediationDecisionList lines={[line({ key: "a" })]} />);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(
      screen.queryByText("What auto-remediation did"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("remediation-decision").firstElementChild).toBe(
      screen.getByRole("list"),
    );
  });

  test.each(TONES)(
    "starts each %s line with its own tinted mark, hidden from screen readers",
    (tone: RemediationDecisionTone) => {
      render(<RemediationDecisionList lines={[line({ key: "a", tone })]} />);

      const mark: HTMLElement = within(lines()[0]!).getByTestId(
        "remediation-decision-mark",
      );
      const expected: RemediationDecisionToneMark =
        REMEDIATION_DECISION_TONE_MARK[tone];

      expect(mark).toHaveAttribute("aria-hidden", "true");
      expect(mark).toHaveClass(...expected.className.split(" "));
      expect(mark).toHaveClass("h-8", "w-8", "rounded-lg", "flex-none");
      expect(mark.querySelector("path")?.getAttribute("d")).toBe(
        pathOf(expected.icon),
      );
      // The mark comes first, the words after it.
      expect(lines()[0]!.firstElementChild).toBe(mark);
    },
  );

  test("tells the tones apart by glyph as well as by colour", () => {
    expect(REMEDIATION_DECISION_TONE_MARK).toEqual({
      acted: {
        icon: IconProp.CheckCircle,
        className: "bg-emerald-50 text-emerald-600",
      },
      attention: {
        icon: IconProp.Alert,
        className: "bg-amber-50 text-amber-600",
      },
      info: { icon: IconProp.Info, className: "bg-gray-100 text-gray-500" },
      waiting: {
        icon: IconProp.Clock,
        className: "bg-indigo-50 text-indigo-600",
      },
    });

    const glyphs: Set<string> = new Set(
      TONES.map((tone: RemediationDecisionTone): string => {
        return pathOf(REMEDIATION_DECISION_TONE_MARK[tone].icon);
      }),
    );
    expect(glyphs.size).toBe(TONES.length);
  });

  test("sets the first line of words level with the middle of the mark", () => {
    render(<RemediationDecisionList lines={[line({ key: "a" })]} />);

    const text: HTMLElement = screen.getByTestId("remediation-decision-text");
    /*
     * A 32px mark (h-8); the words' block starts 4px down (pt-1) and its
     * first line is 24px tall (leading-6): 4 + 24 / 2 = 32 / 2.
     */
    expect(screen.getByTestId("remediation-decision-mark")).toHaveClass("h-8");
    expect(text.parentElement).toHaveClass("pt-1", "min-w-0", "flex-1");
    expect(text).toHaveClass("text-sm", "leading-6", "text-gray-900");
  });

  test("says why and what to do as a definition list set off by a rule", () => {
    render(
      <RemediationDecisionList
        lines={[
          line({
            key: "a",
            tone: "attention",
            text: 'Fixes are on for cluster "prod-east", but OneUptime AI cannot apply them yet.',
            why: "The AI agent is read-only. The chart was installed without write access",
            whatToDo:
              "Upgrade the chart with aiAgent.remediation.enabled=true.",
          }),
        ]}
      />,
    );

    const gap: HTMLElement = screen.getByTestId("remediation-decision-gap");
    expect(gap.tagName).toBe("DL");
    expect(gap).toHaveClass("border-l-2", "border-gray-200", "pl-3");

    const terms: Array<string> = Array.from(gap.querySelectorAll("dt")).map(
      (term: Element): string => {
        return (term.textContent || "").trim();
      },
    );
    const details: Array<string> = Array.from(gap.querySelectorAll("dd")).map(
      (detail: Element): string => {
        return detail.textContent || "";
      },
    );

    expect(terms).toEqual(["Why:", "What to do:"]);
    expect(details).toEqual([
      "The AI agent is read-only. The chart was installed without write access",
      "Upgrade the chart with aiAgent.remediation.enabled=true.",
    ]);
    expect(screen.getByTestId("remediation-decision-why")).toHaveTextContent(
      "Why: The AI agent is read-only.",
    );
    expect(
      screen.getByTestId("remediation-decision-what-to-do"),
    ).toHaveTextContent("What to do: Upgrade the chart");

    // Under the sentence, not before it.
    expect(
      screen.getByTestId("remediation-decision-text").nextElementSibling,
    ).toBe(gap);
  });

  test("shows only the half of a gap the line has", () => {
    const whyOnly: ReturnType<typeof render> = render(
      <RemediationDecisionList
        lines={[line({ key: "a", why: "The agent is offline" })]}
      />,
    );

    expect(screen.getByTestId("remediation-decision-why")).toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-decision-what-to-do"),
    ).not.toBeInTheDocument();
    whyOnly.unmount();

    render(
      <RemediationDecisionList
        lines={[line({ key: "a", whatToDo: "Start the agent." })]}
      />,
    );

    expect(
      screen.queryByTestId("remediation-decision-why"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("remediation-decision-what-to-do"),
    ).toHaveTextContent("What to do: Start the agent.");
  });

  test("draws no gap for a line without one", () => {
    render(<RemediationDecisionList lines={[line({ key: "a" })]} />);

    expect(
      screen.queryByTestId("remediation-decision-gap"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Why:")).not.toBeInTheDocument();
  });

  test("links each page that changes a line, in order, named by its words alone", () => {
    render(
      <RemediationDecisionList
        lines={[
          line({
            key: "a",
            links: [
              {
                text: "Link Checkout website",
                route: new Route(`/dashboard/${PROJECT_ID}/monitors/1`),
              },
              {
                text: "Link the monitor",
                route: new Route(`/dashboard/${PROJECT_ID}/monitors/2`),
              },
            ],
          }),
        ]}
      />,
    );

    const links: Array<HTMLElement> = within(lines()[0]!).getAllByRole("link");

    expect(
      links.map((link: HTMLElement) => {
        return [link.textContent?.trim(), link.getAttribute("href")];
      }),
    ).toEqual([
      ["Link Checkout website", `/dashboard/${PROJECT_ID}/monitors/1`],
      ["Link the monitor", `/dashboard/${PROJECT_ID}/monitors/2`],
    ]);
    // Named by their words alone: the arrow is not read out.
    expect(
      screen.getByRole("link", { name: "Link the monitor" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/monitors/2`);

    for (const link of links) {
      // The arrow says "go there" to the eye; the words say it to the ear.
      const arrow: SVGElement | null = link.querySelector("svg");
      expect(arrow).toHaveAttribute("aria-hidden", "true");
      expect(arrow?.querySelector("path")?.getAttribute("d")).toBe(
        pathOf(IconProp.ArrowRight),
      );
      expect(link).toHaveClass(
        "text-indigo-600",
        "hover:text-indigo-800",
        "focus-visible:ring-2",
      );
    }

    // Side by side while they fit, one under another when they do not.
    expect(links[0]!.parentElement).toHaveClass("flex", "flex-wrap");
    expect(links[0]!.parentElement).toBe(links[1]!.parentElement);
  });

  /*
   * A long setting's name wraps on a phone: its arrow is part of the
   * words' line, glued to the last one by a no-break space that cannot
   * wrap away from it (ArrowGluedText), so it ends the name rather than
   * sitting alone at the card's far edge - an inline-flex link put it
   * there, as the AI card's line did before (#5226).
   */
  test("a link's arrow follows its last word, glued by a no-break space, and is not read out", () => {
    render(
      <RemediationDecisionList
        lines={[
          line({
            key: "a",
            links: [
              {
                text: "Which incidents are investigated",
                route: new Route(`/dashboard/${PROJECT_ID}/ai/settings`),
              },
            ],
          }),
        ]}
      />,
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: "Which incidents are investigated",
    });
    const arrow: HTMLElement = within(link).getByTestId(
      "remediation-decision-link-arrow",
    );
    const glue: HTMLElement = arrow.parentElement!;

    // The words, then - in one piece that never wraps - the glue and the arrow.
    expect(link.firstChild?.textContent).toBe(
      "Which incidents are investigated",
    );
    expect(glue).toHaveClass("whitespace-nowrap");
    expect(glue.firstChild?.textContent).toBe("\u00a0");
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(arrow).toHaveClass("inline-block");
    /*
     * On a page that reads right to left it points the way the words run:
     * Icon draws the arrow mirrored there, so the box around it does not
     * turn it as well (it would point back).
     */
    expect(arrow.querySelector("svg")).toHaveClass(
      ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
    );
    expect(arrow.className).not.toContain("rtl:");
    expect(link).not.toHaveClass("inline-flex");
  });

  test("draws no link row for a line without links", () => {
    render(<RemediationDecisionList lines={[line({ key: "a" })]} />);

    expect(within(lines()[0]!).queryAllByRole("link")).toEqual([]);
    expect(
      screen.getByTestId("remediation-decision-text").nextElementSibling,
    ).toBeNull();
  });

  test("breaks a long name rather than the card", () => {
    const longName: string = "x".repeat(400);

    render(
      <RemediationDecisionList
        lines={[
          line({
            key: "a",
            text: `Fixes are off for cluster "${longName}".`,
            why: longName,
            links: [
              {
                text: `Link ${longName}`,
                route: new Route(`/dashboard/${PROJECT_ID}/monitors/1`),
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("remediation-decision-text")).toHaveClass(
      "break-words",
    );
    expect(
      screen.getByTestId("remediation-decision-why").querySelector("dd"),
    ).toHaveClass("break-words");
    // The link's words break, as text: no flex item of its own to squeeze.
    expect(screen.getByRole("link")).toHaveClass("break-words", "min-w-0");
    expect(screen.getByRole("link")).not.toHaveClass("inline-flex");
    expect(screen.getByRole("link").textContent?.trim()).toBe(
      `Link ${longName}`,
    );
    // The words may shrink beside the mark; the mark never does.
    expect(
      screen.getByTestId("remediation-decision-text").parentElement,
    ).toHaveClass("min-w-0");
  });

  test("draws the engine's real lines: a signal linked to nothing, and no rule", () => {
    render(
      <RemediationDecisionList
        lines={getRemediationDecisionLines({
          decision: {
            stage: AutoRemediationDecisionStage.Evaluated,
            entries: [
              {
                lane: AutoRemediationDecisionLane.KubernetesCluster,
                reason: AutoRemediationDecisionReason.ClusterNoneLinked,
                monitors: [
                  { id: MONITOR_ID, name: "Checkout website" },
                  { id: OTHER_MONITOR_ID, name: "" },
                ],
              },
              {
                lane: AutoRemediationDecisionLane.Resource,
                reason: AutoRemediationDecisionReason.ResourceNoneLinked,
              },
              {
                lane: AutoRemediationDecisionLane.Rule,
                reason: AutoRemediationDecisionReason.NoRulesConfigured,
              },
            ],
          },
          signal: "incident",
          translator: getGlobalTranslator(),
        })}
      />,
    );

    const [unlinked, rules] = lines() as [HTMLElement, HTMLElement];

    expect(unlinked).toHaveAttribute("data-tone", "attention");
    expect(
      within(unlinked)
        .getAllByRole("link")
        .map((link: HTMLElement) => {
          return [link.textContent?.trim(), link.getAttribute("href")];
        }),
    ).toEqual([
      [
        "Link Checkout website",
        `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
      ],
      [
        "Link the monitor",
        `/dashboard/${PROJECT_ID}/monitors/${OTHER_MONITOR_ID}`,
      ],
    ]);

    expect(rules).toHaveAttribute("data-tone", "info");
    expect(
      within(rules).getByRole("link", {
        name: "Incident AI rules",
      }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/incidents/ai/settings`);
  });

  test("draws the wait for the investigation as one indigo line", () => {
    render(
      <RemediationDecisionList
        lines={getRemediationDecisionLines({
          decision: {
            stage: AutoRemediationDecisionStage.WaitingForInvestigation,
            entries: [],
          },
          signal: "alert",
          translator: getGlobalTranslator(),
        })}
      />,
    );

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toHaveAttribute("data-tone", "waiting");
    expect(screen.getByTestId("remediation-decision-mark")).toHaveClass(
      "bg-indigo-50",
      "text-indigo-600",
    );
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});

/*
 * Issue #5293: an incident linked to nothing says what to do - add what it
 * is about under Affected Resources. The line takes the reader there: a
 * button first in its row, "Go to Affected Resources", that brings the
 * page's Affected Resources card into view and tints it a moment, the way a
 * link to a place on a page lands. On a phone that card is far below.
 */
describe("RemediationDecisionList - the place a line sends the reader to", () => {
  function nothingLinkedLines(): Array<RemediationDecisionLine> {
    return getRemediationDecisionLines({
      decision: {
        stage: AutoRemediationDecisionStage.Evaluated,
        entries: [
          {
            lane: AutoRemediationDecisionLane.KubernetesCluster,
            reason: AutoRemediationDecisionReason.ClusterNoneLinked,
            monitors: [{ id: MONITOR_ID, name: "Checkout website" }],
          },
          {
            lane: AutoRemediationDecisionLane.Resource,
            reason: AutoRemediationDecisionReason.ResourceNoneLinked,
          },
        ],
      },
      signal: "incident",
      translator: getGlobalTranslator(),
    });
  }

  function placeOnPage(): HTMLElement {
    const place: HTMLElement = document.createElement("div");
    place.id = AFFECTED_RESOURCES_PLACE_ID;
    place.scrollIntoView = jest.fn();
    document.body.appendChild(place);
    return place;
  }

  afterEach(() => {
    document.getElementById(AFFECTED_RESOURCES_PLACE_ID)?.remove();
  });

  test("a button first in the line's row, before the monitor links, named by its words", () => {
    render(<RemediationDecisionList lines={nothingLinkedLines()} />);

    const [unlinked] = lines() as [HTMLElement];
    const go: HTMLElement = within(unlinked).getByRole("button", {
      name: "Go to Affected Resources",
    });

    expect(go).toHaveAttribute("type", "button");
    expect(go).toHaveAttribute("data-testid", "remediation-decision-place");
    // The row's first item: what lets OneUptime AI fix this one comes first.
    expect(go.parentElement?.firstElementChild).toBe(go);
    expect(
      within(unlinked).getByRole("link", { name: "Link Checkout website" }),
    ).toBeInTheDocument();
    // Drawn as the links beside it are, its arrow glued and not read out.
    const link: HTMLElement = within(unlinked).getByRole("link", {
      name: "Link Checkout website",
    });
    for (const className of [
      "text-sm",
      "font-medium",
      "text-indigo-600",
      "focus-visible:ring-2",
    ]) {
      expect(go.className).toContain(className);
      expect(link.className).toContain(className);
    }
    expect(go.className).toContain("text-start");
    expect(
      within(go).getByTestId("remediation-decision-link-arrow"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  test("brings the Affected Resources card into view and marks where it landed", async () => {
    const place: HTMLElement = placeOnPage();

    render(<RemediationDecisionList lines={nothingLinkedLines()} />);

    within(lines()[0]!)
      .getByRole("button", { name: "Go to Affected Resources" })
      .click();

    expect(place).toHaveAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE, "true");
    // Its top under the sticky header, once the browser has drawn it.
    await waitFor(() => {
      expect(place.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    });
  });

  /*
   * Clicking or pressing the button gives it the focus. The card takes it
   * on, as a link to a place on a page hands it on: Tab goes on from the
   * card's Edit, not from a button scrolled out of sight, and a screen
   * reader reads where the page went.
   */
  test("hands the button's focus on to the card it lands on", () => {
    const place: HTMLElement = placeOnPage();

    render(<RemediationDecisionList lines={nothingLinkedLines()} />);

    const go: HTMLElement = within(lines()[0]!).getByRole("button", {
      name: "Go to Affected Resources",
    });
    go.focus();
    expect(document.activeElement).toBe(go);

    fireEvent.click(go);

    expect(document.activeElement).toBe(place);
    expect(place).toHaveAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE, "true");
  });

  test("never takes focus held anywhere else", () => {
    const place: HTMLElement = placeOnPage();
    const field: HTMLInputElement = document.createElement("input");
    document.body.appendChild(field);
    field.focus();

    expect(goToPagePlace(AFFECTED_RESOURCES_PLACE_ID, null)).toBe(true);

    expect(document.activeElement).toBe(field);
    expect(place).toHaveAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE, "true");
    expect(place).not.toHaveAttribute(PAGE_ANCHOR_FOCUSED_ATTRIBUTE);

    field.remove();
  });

  test("goToPagePlace says whether the place was on the page, and changes nothing when it was not", () => {
    expect(goToPagePlace(AFFECTED_RESOURCES_PLACE_ID)).toBe(false);

    const place: HTMLElement = placeOnPage();

    expect(goToPagePlace(AFFECTED_RESOURCES_PLACE_ID)).toBe(true);
    expect(place).toHaveAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE, "true");
  });

  test("a line with no place draws no button", () => {
    render(<RemediationDecisionList lines={[line({ key: "a", links: [] })]} />);

    expect(
      screen.queryByTestId("remediation-decision-place"),
    ).not.toBeInTheDocument();
  });
});
