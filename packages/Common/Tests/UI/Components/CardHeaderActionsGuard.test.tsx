import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Card, {
  CARD_HEADER_ACTIONS_CLASS_NAME,
  CARD_HEADER_ACTION_CLASS_NAME,
  CARD_HEADER_LAYOUTS,
  CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME,
  CARD_HEADER_TITLE_BLOCK_CLASS_NAME,
  CardHeaderLayout,
  ComponentProps,
} from "../../../UI/Components/Card/Card";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  StackingCardHeader,
  scanStackingCardHeaders,
} from "../../Helpers/CardHeaderScan";
import { resolveFlex } from "../../ResponsiveFlexLayout";
import { resolveSpacing } from "../../ResponsiveSpacing";
import { isVisibleAtWidth } from "../../ResponsiveVisibility";
import { WIDTHS_IN_PX } from "../../RenderedMarkup";

/*
 * The rule every card header keeps, whatever its layout, its width or what
 * it holds: "Why are edit buttons not on the right?"
 *
 *   1. What the card offers sits in one box, in the same left-to-right row
 *      as the title, after it.
 *   2. That box is at the row's right edge (margin-left: auto), and so is
 *      each of its own lines (justify-content: flex-end) - also when it
 *      wraps onto a line of its own.
 *   3. Nothing from the box out to the card lays it out in a column or
 *      centres it.
 *   4. A description on screen never sits between the title and the
 *      actions: where the row can wrap, the description is not in it (or
 *      not on screen at that width), so the actions can only wrap under the
 *      title, never under the description.
 *
 * It runs over every layout Card has (CARD_HEADER_LAYOUTS is built from the
 * CardHeaderLayout type, so a new layout is checked here the moment it
 * exists) and at every breakpoint's first pixel and the pixel before it.
 */

interface HeaderShape {
  name: string;
  props: ComponentProps;
}

const EDIT: Required<ComponentProps>["buttons"][number] = {
  title: "Edit",
  icon: IconProp.Edit,
  buttonStyle: ButtonStyleType.NORMAL,
  onClick: (): void => {},
};

const SHAPES: Array<HeaderShape> = [
  {
    name: "a details card with Edit",
    props: {
      title: "Incident Details",
      description: "Key facts about this incident.",
      buttons: [EDIT],
    },
  },
  {
    name: "a list with a right element, a main action and an outline one",
    props: {
      title: "Incident Severity",
      description:
        "Severities rank incidents so the most urgent ones get attention first.",
      rightElement: <span>3 severities</span>,
      buttons: [
        {
          title: "Create Incident Severity",
          icon: IconProp.Add,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: (): void => {},
        },
        {
          title: "",
          icon: IconProp.More,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: (): void => {},
        },
      ],
    },
  },
  {
    name: "a status badge and nothing else",
    props: {
      title: "AI Investigation",
      description: "OneUptime AI's root-cause report for this incident.",
      rightElement: <span>Completed</span>,
    },
  },
  {
    name: "a locked Edit that explains itself",
    props: {
      title: "Owners",
      description: "People and teams who own this monitor.",
      buttons: [
        {
          ...EDIT,
          disabled: true,
          tooltip: "You do not have permission to update this Monitor.",
        },
      ],
    },
  },
  {
    name: "a long title and three actions",
    props: {
      title: "Scheduled maintenance events this status page announces",
      description: "What subscribers of this status page are told, and when.",
      buttons: [
        EDIT,
        {
          title: "Preview",
          icon: IconProp.Play,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: (): void => {},
        },
        <a key="docs" href="/docs">
          Docs
        </a>,
      ],
    },
  },
];

function classOf(element: Element): string {
  return element.getAttribute("class") || "";
}

describe.each([...CARD_HEADER_LAYOUTS] as Array<CardHeaderLayout>)(
  "the %s card header",
  (headerLayout: CardHeaderLayout) => {
    afterEach(() => {
      cleanup();
    });

    describe.each(SHAPES)("$name", (shape: HeaderShape) => {
      test.each(WIDTHS_IN_PX)(
        "at %ipx keeps the actions at the right edge of the title's row",
        (width: number) => {
          render(<Card {...shape.props} headerLayout={headerLayout} />);

          const card: HTMLElement = screen.getByTestId("card");
          const header: HTMLElement = screen.getByTestId("card-header");
          const actions: HTMLElement = screen.getByTestId(
            "card-header-actions",
          );
          const title: HTMLElement = screen.getByTestId("card-details-heading");
          const row: HTMLElement = actions.parentElement!;

          // 1. One box, in a left-to-right row with the title, after it.
          expect(header).toContainElement(row);
          expect(row).toContainElement(title);
          expect(resolveFlex(classOf(row), width, "flex-direction")).toBe(
            "row",
          );
          expect(row.lastElementChild).toBe(actions);
          expect(
            title.compareDocumentPosition(actions) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();

          // 2. At the right edge, and so is each of its lines.
          expect(
            Number.isNaN(
              resolveSpacing(classOf(actions), width, "margin").left,
            ),
          ).toBe(true);
          expect(resolveFlex(classOf(actions), width, "justify-content")).toBe(
            "flex-end",
          );

          // 3. Never a column, never centred, from the box out to the card.
          let node: HTMLElement | null = actions;
          while (node && node !== card.parentElement) {
            expect(
              resolveFlex(classOf(node), width, "flex-direction"),
            ).not.toBe("column");
            expect(
              resolveFlex(classOf(node), width, "justify-content"),
            ).not.toBe("center");
            expect(node).not.toHaveClass("mx-auto");
            expect(node).not.toHaveClass("self-center");
            node = node.parentElement;
          }

          // 4. Never under the description.
          const description: HTMLElement | null =
            screen.queryByTestId("card-description");

          if (
            description &&
            isVisibleAtWidth(description, width) &&
            row.contains(description)
          ) {
            expect(resolveFlex(classOf(row), width, "flex-wrap")).toBe(
              "nowrap",
            );
          }
        },
      );
    });

    test("every action has a box of its own that clears the button's own left margin", () => {
      render(<Card {...SHAPES[1]!.props} headerLayout={headerLayout} />);

      const actions: HTMLElement = screen.getByTestId("card-header-actions");
      const boxes: Array<Element> = Array.from(actions.children);

      // The right element first, then one box per button.
      expect(boxes).toHaveLength(3);
      for (const box of boxes.slice(1)) {
        expect(classOf(box)).toBe(CARD_HEADER_ACTION_CLASS_NAME);
      }
      expect(classOf(actions)).toContain(CARD_HEADER_ACTIONS_CLASS_NAME);
    });

    test("the title keeps its share of the line it shares with the actions", () => {
      render(<Card {...SHAPES[0]!.props} headerLayout={headerLayout} />);

      const titleBlockClassName: string = classOf(
        screen.getByTestId("card-header-title-block"),
      );

      expect(titleBlockClassName).toBe(
        headerLayout === "stacked"
          ? CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME
          : CARD_HEADER_TITLE_BLOCK_CLASS_NAME,
      );
      /*
       * Below md no utility lets the title grow into, or shrink for, the
       * actions' room: a phone's title keeps its width and the actions
       * wrap under it, at the right edge.
       */
      for (const token of titleBlockClassName.split(" ")) {
        expect(token).toMatch(/^(min-w-0|md:.+)$/);
      }
    });
  },
);

describe("the rule's own classes", () => {
  test("the actions box is pushed to the right edge, wraps, and lines each of its rows up on the right", () => {
    const tokens: Array<string> = CARD_HEADER_ACTIONS_CLASS_NAME.split(" ");

    expect(tokens).toEqual(
      expect.arrayContaining([
        "ml-auto",
        "flex",
        "flex-wrap",
        "justify-end",
        "max-w-full",
      ]),
    );
    expect(tokens).not.toEqual(expect.arrayContaining(["justify-start"]));
    expect(tokens).not.toContain("justify-center");
    expect(tokens).not.toContain("mx-auto");
  });

  test("an action's box clears the left margin of the button it holds, and only that button", () => {
    const tokens: Array<string> = CARD_HEADER_ACTION_CLASS_NAME.split(" ");

    expect(tokens).toEqual(
      expect.arrayContaining([
        "[&>button]:ml-0",
        "[&>button]:md:ml-0",
        "[&>*>button]:ml-0",
        "[&>*>button]:md:ml-0",
      ]),
    );
    // A descendant selector would reach the buttons of a picker or a dialog.
    for (const token of tokens) {
      expect(token).not.toMatch(/^\[&_/);
    }
  });
});

/*
 * Headers built by hand, outside Card: a title (and a description) first,
 * buttons after, stacked in a column until a screen lays them side by side
 * (`flex flex-col ... sm:flex-row sm:justify-between`). Below that screen
 * the buttons used to fall under the description at the LEFT. They keep to
 * the right edge now (self-end, or items-end on the stack), as Card's
 * actions do. See Tests/Helpers/CardHeaderScan.ts for what is read.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

/*
 * The stacked headers that are not a card's header, by file, each with its
 * reason: a page's hero, a toolbar, a panel's header, a guide's call to
 * action. Their second part is the page's main controls or a link that
 * reads as part of the copy, laid out full width or after the text on
 * purpose. A new stacking header fails the guard until its actions keep
 * right or it is listed here; an entry that no longer matches fails too.
 */
const NOT_A_CARD_HEADER: Record<string, { count: number; reason: string }> = {
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewHero.tsx":
    {
      count: 1,
      reason:
        "The monitor overview's hero: its status, uptime and actions are the page's.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceHeader.tsx":
    {
      count: 1,
      reason:
        "A trace's hero: on a phone its actions are a two-column grid of full-width buttons, the page's main controls.",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index.tsx": {
    count: 1,
    reason:
      "An insight's hero: its Resolve / Dismiss / Investigate bar takes the full width under the title below lg, like an incident's hero.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineToolbar.tsx":
    {
      count: 1,
      reason:
        "The schedule timeline's toolbar: date navigation and zoom, not a card's actions.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/SpanDetailsPanel.tsx":
    {
      count: 1,
      reason:
        "A side panel's header: its controls are the panel's, and the panel is as narrow as a phone at every width.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceSignals.tsx":
    {
      count: 1,
      reason:
        "A tab strip under the section title, not actions: tabs read from the left.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard.tsx":
    {
      count: 1,
      reason:
        "The severity levels' 'How ... are chosen' link, a link that reads as part of the section's copy. (The card's own header keeps right.)",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuideCard.tsx":
    {
      count: 1,
      reason:
        "A setup guide's call to action under its pitch, like an empty state's.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewHero.tsx": {
    count: 1,
    reason: "The SLO overview's hero: its figures and actions are the page's.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthDashboard.tsx":
    {
      count: 1,
      reason:
        "The recording health verdict banner: its call to action follows the verdict.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph.tsx":
    {
      count: 1,
      reason:
        "The service map's Map / List view switch: a view control that reads from the left.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer.tsx":
    {
      count: 1,
      reason:
        "The infrastructure explorer's Map / List view switch: a view control that reads from the left.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/FormBuilder.tsx":
    {
      count: 1,
      reason:
        "The form's title bar: on a phone its Edit form details button is a full-width button under a long form name (Button's normal style is full width below md), at the right of the name from sm up.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSettings.tsx":
    {
      count: 1,
      reason:
        "A settings row: the switch follows the setting's text, as every switch row's does.",
    },
  "packages/Common/UI/Components/LogsViewer/components/LogDetailsPanel.tsx": {
    count: 1,
    reason:
      "A side panel's header: its controls are the panel's, and the panel is as narrow as a phone at every width.",
  },
  "ee/Dashboard/TeamCompliance/ComplianceHero.tsx": {
    count: 1,
    reason: "The team compliance page's hero: its actions are the page's.",
  },
};

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

let cachedHeaders: Array<StackingCardHeader> | null = null;

function scanHandBuiltHeaders(): Array<StackingCardHeader> {
  if (cachedHeaders) {
    return cachedHeaders;
  }

  cachedHeaders = listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .flatMap((file: string): Array<StackingCardHeader> => {
      return scanStackingCardHeaders(
        relative(file),
        fs.readFileSync(file, "utf8"),
      );
    });

  return cachedHeaders;
}

describe("hand-built card headers", () => {
  test("every stacking card header keeps its actions at the right edge", () => {
    const misplaced: Array<string> = scanHandBuiltHeaders()
      .filter((header: StackingCardHeader): boolean => {
        return !header.keepsActionsRight && !NOT_A_CARD_HEADER[header.file];
      })
      .map((header: StackingCardHeader): string => {
        return `${header.file}:${header.line} (stacks below ${header.breakpoint}; actions class "${header.actionsClassName ?? "worked out at run time"}")`;
      });

    /*
     * Put `self-end` (and `<screen>:self-auto`) on the element holding the
     * header's buttons - or better, draw the header with Card - so they sit
     * at the right edge while the header is stacked.
     */
    expect(misplaced).toEqual([]);
  });

  test("the headers that are not a card's header are still there, and no more of them", () => {
    const counts: Map<string, number> = new Map<string, number>();

    for (const header of scanHandBuiltHeaders()) {
      if (!header.keepsActionsRight) {
        counts.set(header.file, (counts.get(header.file) || 0) + 1);
      }
    }

    const stale: Array<string> = Object.entries(NOT_A_CARD_HEADER)
      .filter(([file, entry]: [string, { count: number }]): boolean => {
        return (counts.get(file) || 0) !== entry.count;
      })
      .map(([file, entry]: [string, { count: number }]): string => {
        return `${file}: listed ${entry.count}, found ${counts.get(file) || 0}`;
      });

    expect(stale).toEqual([]);

    for (const entry of Object.values(NOT_A_CARD_HEADER)) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  /*
   * The hand-built card headers this was fixed in: under the description
   * while stacked, at the right edge (self-end), and back beside the title
   * from their screen up (<screen>:self-auto). Read from the source, as the
   * scan cannot see a button drawn by a helper function (Layers' "Add
   * layer").
   */
  const FIXED_HAND_BUILT_HEADERS: Record<string, string> = {
    "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatPolicy.tsx":
      'className="self-end sm:shrink-0 sm:self-auto"',
    "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ResponderReadinessCard.tsx":
      'className="flex-shrink-0 self-end sm:self-auto"',
    "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules.tsx":
      'className="flex flex-wrap items-center justify-end gap-2 self-end sm:shrink-0 sm:self-auto"',
    "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx":
      'className="flex-shrink-0 self-end sm:self-auto"',
    "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotes.tsx":
      'className="flex shrink-0 items-center gap-2 self-end lg:self-auto"',
    "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard.tsx":
      'className="flex flex-shrink-0 items-center gap-2 self-end sm:self-auto"',
    "packages/App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer.tsx":
      "flex-shrink-0 self-end border border-gray-200 text-gray-600 hover:bg-gray-50 sm:self-auto",
    "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIAssistance.tsx":
      'className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2"',
  };

  test.each(Object.entries(FIXED_HAND_BUILT_HEADERS))(
    "%s keeps its header's actions at the right edge while stacked",
    (file: string, actionsClassName: string) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect(source).toContain(actionsClassName);
    },
  );
});

describe("the hand-built header scan", () => {
  test("finds a header that drops its buttons under the description at the left", () => {
    const headers: Array<StackingCardHeader> = scanStackingCardHeaders(
      "Example.tsx",
      `const A = () => (
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div>
            <h2>Repeat Policy</h2>
            <p>What happens after every escalation level.</p>
          </div>
          <div className="sm:shrink-0">
            <Button title="Edit" />
          </div>
        </div>
      );`,
    );

    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({
      breakpoint: "sm",
      actionsClassName: "sm:shrink-0",
      keepsActionsRight: false,
      line: 2,
    });
  });

  test("passes the same header once its buttons are pushed right, or the stack lines up on the right", () => {
    const pushed: Array<StackingCardHeader> = scanStackingCardHeaders(
      "Example.tsx",
      `const A = () => (
        <div className="flex flex-col lg:flex-row lg:justify-between">
          <div><h2>Notes</h2></div>
          {isReady ? (
            <div className="self-end lg:self-auto"><button>Refresh</button></div>
          ) : (
            <></>
          )}
        </div>
      );`,
    );
    const linedUp: Array<StackingCardHeader> = scanStackingCardHeaders(
      "Example.tsx",
      `const A = () => (
        <div className={\`flex flex-col items-end md:flex-row \${extra}\`}>
          <h3>Notes</h3>
          <Link to={route}>Open</Link>
        </div>
      );`,
    );

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      breakpoint: "lg",
      keepsActionsRight: true,
    });
    expect(linedUp).toHaveLength(1);
    expect(linedUp[0]!.keepsActionsRight).toBe(true);
  });

  test("leaves alone a stack with no heading, or with nothing to press after it", () => {
    expect(
      scanStackingCardHeaders(
        "Example.tsx",
        `const A = () => (
          <div className="flex flex-col sm:flex-row">
            <span>Label</span>
            <button>Go</button>
          </div>
        );`,
      ),
    ).toEqual([]);
    expect(
      scanStackingCardHeaders(
        "Example.tsx",
        `const A = () => (
          <div className="flex flex-col sm:flex-row">
            <button>Back</button>
            <h2>Title</h2>
          </div>
        );`,
      ),
    ).toEqual([]);
  });
});
