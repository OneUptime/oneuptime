import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test } from "@jest/globals";

import {
  CRITERIA_ACCENT_CLASS_NAME,
  CRITERIA_ACTION_FORM_CLASS_NAME,
  CRITERIA_BODY_CLASS_NAME,
  CRITERIA_BOX_CLASS_NAME,
  CRITERIA_DISABLED_ACCENT_CLASS_NAME,
  CRITERIA_FILTER_BOX_CLASS_NAME,
  CRITERIA_SECTION_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaEditorLayout";
import MonitorCriteriaElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { COLLAPSIBLE_SECTION_BORDERED_FLUSH_ON_PHONES_FRAME_CLASS_NAME } from "../../../UI/Components/CollapsibleSection/CollapsibleSection";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import {
  BoxSpacing,
  resolveMargin,
  resolvePadding,
} from "../../ResponsiveSpacing";
import { ResolvedFrame, resolveFrame } from "../../ResponsiveFrame";
import {
  classesWithoutDarkTheme,
  isRemappedForDarkTheme,
} from "../../UI/Styles/DarkThemeCoverage";

/*
 * THE MONITOR CRITERIA EDITOR ON A PHONE.
 *
 * "The criteria editor on phones is still nested several boxes deep: a
 * redesign." (follow-up to #5292). At 390px an alert's fields sat in the
 * page's card, the step's Monitor Criteria card, the criteria's box, the
 * Actions section and the action's own box - each a frame with padding -
 * and its description editor was 166px wide inside its fold, a sixth.
 *
 * Now, on a phone, the step's cards are sections of the page's card
 * (CardSectionsOnPhones, held to it in Common's suite), and the criteria's
 * box is the one frame round its fields: Filters, Actions and Settings, a
 * filter's box and an action's box each reach out over the 12px the box
 * around them pads by, a band as wide as the criteria's box. From sm up
 * nothing changes: every band is the box it was, class for class.
 *
 * jsdom has no stylesheet: the classes are read the way the cascade does
 * (ResponsiveFrame, ResponsiveSpacing). The browser suite measures the
 * same page for real (E2E MonitorOverview/CriteriaEditorOnPhones.spec.ts).
 */

afterEach(() => {
  cleanup();
});

const PHONE_WIDTHS: Array<number> = [320, 375, 390, 639];
const FROM_SM_UP: Array<number> = [640, 768, 1024, 1280];

// What master drew, from sm up the look these keep.
const FORMER_ACTION_FORM_CLASS_NAME: string =
  "mt-4 rounded-md border border-gray-100 bg-gray-50 p-3 sm:ml-6";
const FORMER_FILTER_BOX_CLASS_NAME: string =
  "rounded-md p-2 bg-gray-50 my-5 border-gray-200 border-solid border-2";
const FORMER_SECTION_CLASS_NAME: string =
  "border border-gray-200 rounded-lg overflow-hidden mb-4";
const FORMER_CRITERIA_BOX_CLASS_NAME: string =
  "mb-4 border rounded-lg overflow-hidden border-l-4 bg-white";

const STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const STATUS_OPTIONS: Array<DropdownOption> = [
  { value: STATUS_ID.toString(), label: "Offline" },
];
const INCIDENT_SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: INCIDENT_SEVERITY_ID.toString(), label: "SEV-1" },
];
const ALERT_SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: ALERT_SEVERITY_ID.toString(), label: "Critical" },
];

function buildCriteria(
  options: { isEnabled?: boolean } = {},
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: STATUS_ID,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
      },
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 400,
      },
    ],
    incidents: [
      {
        id: ObjectID.generate().toString(),
        title: "Storefront is offline",
        description: "",
        incidentSeverityId: INCIDENT_SEVERITY_ID,
      },
    ],
    alerts: [
      {
        id: ObjectID.generate().toString(),
        title: "Storefront is offline",
        description: "",
        alertSeverityId: ALERT_SEVERITY_ID,
      },
    ],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    isEnabled: options.isEnabled ?? true,
    name: "Check if Storefront is offline",
    description: "",
  };
  return instance;
}

function renderEditor(
  criteria: Array<MonitorCriteriaInstance> = [buildCriteria()],
): void {
  const value: MonitorCriteria = new MonitorCriteria();
  value.data = { monitorCriteriaInstanceArray: criteria };

  render(
    <MemoryRouter>
      <MonitorCriteriaElement
        monitorType={MonitorType.Website}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={STATUS_OPTIONS}
        incidentSeverityDropdownOptions={INCIDENT_SEVERITY_OPTIONS}
        alertSeverityDropdownOptions={ALERT_SEVERITY_OPTIONS}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
      />
    </MemoryRouter>,
  );
}

function criteriaBox(): HTMLElement {
  return screen.getAllByTestId("monitor-criteria-box")[0]!;
}

// The criteria's body: the element that pads the sections in by 12px.
function criteriaBody(): HTMLElement {
  return within(criteriaBox()).getByTestId("monitor-criteria-body")
    .firstElementChild as HTMLElement;
}

const SECTION_TITLES: Array<string> = ["Filters", "Actions", "Settings"];

/*
 * Each section's frame: what holds its header - the role="button" that
 * controls a CollapsibleSection's body, named by its title (aria-labelledby).
 * Read from the markup: a role query over the whole editor takes seconds.
 */
function sectionFrames(): Map<string, HTMLElement> {
  const frames: Map<string, HTMLElement> = new Map<string, HTMLElement>();

  for (const header of Array.from(
    criteriaBox().querySelectorAll<HTMLElement>(
      "[role='button'][aria-controls^='collapsible-body-']",
    ),
  )) {
    const title: string =
      document.getElementById(header.getAttribute("aria-labelledby") || "")
        ?.textContent || "";

    if (SECTION_TITLES.includes(title)) {
      frames.set(title, header.parentElement as HTMLElement);
    }
  }

  expect(Array.from(frames.keys()).sort()).toEqual([...SECTION_TITLES].sort());

  return frames;
}

// The padded element of a section's body, which its bands reach out over.
function contentOf(frame: HTMLElement): HTMLElement {
  return frame.lastElementChild!.firstElementChild as HTMLElement;
}

function actionForms(): Array<HTMLElement> {
  return [
    screen.getByTestId("monitor-criteria-status-form"),
    screen.getByTestId("monitor-criteria-alert-form"),
    screen.getByTestId("monitor-criteria-incident-form"),
  ];
}

function filterBoxes(): Array<HTMLElement> {
  return within(criteriaBox()).getAllByTestId("criteria-filter-box");
}

interface Look {
  frame: ResolvedFrame;
  margin: BoxSpacing;
  padding: BoxSpacing;
}

function lookOf(className: string, width: number): Look {
  return {
    frame: resolveFrame(className, width),
    margin: resolveMargin(className, width),
    padding: resolvePadding(className, width),
  };
}

function tokens(className: string): Array<string> {
  return className.split(/\s+/).filter(Boolean);
}

describe("the criteria editor on a phone: the criteria's box is the one frame", () => {
  test("Filters, Actions and Settings are flush: rules above and below, nothing at the sides", () => {
    renderEditor();

    const frames: Map<string, HTMLElement> = sectionFrames();

    for (const title of SECTION_TITLES) {
      const frame: HTMLElement = frames.get(title)!;

      expect([title, frame.className]).toEqual([
        title,
        expect.stringContaining(
          COLLAPSIBLE_SECTION_BORDERED_FLUSH_ON_PHONES_FRAME_CLASS_NAME,
        ),
      ]);
      expect(frame).toHaveClass(...tokens(CRITERIA_SECTION_CLASS_NAME));

      for (const width of PHONE_WIDTHS) {
        const frameAtWidth: ResolvedFrame = resolveFrame(
          frame.className,
          width,
        );

        expect([title, width, frameAtWidth.border]).toEqual([
          title,
          width,
          { top: 1, right: 0, bottom: 1, left: 0 },
        ]);
        expect([title, width, frameAtWidth.radius.topLeft]).toEqual([
          title,
          width,
          0,
        ]);
      }
    }
  });

  test("each section reaches out over the criteria body's padding, to the box's sides", () => {
    renderEditor();

    expect(criteriaBody()).toHaveClass(...tokens(CRITERIA_BODY_CLASS_NAME));

    const frames: Map<string, HTMLElement> = sectionFrames();

    for (const title of SECTION_TITLES) {
      for (const width of PHONE_WIDTHS) {
        const body: BoxSpacing = resolvePadding(
          criteriaBody().className,
          width,
        );
        const margin: BoxSpacing = resolveMargin(
          frames.get(title)!.className,
          width,
        );

        expect([title, width, body.left, body.right]).toEqual([
          title,
          width,
          12,
          12,
        ]);
        expect([title, width, margin.left, margin.right]).toEqual([
          title,
          width,
          -body.left,
          -body.right,
        ]);
      }
    }
  });

  test("each action's box is a band across the Actions section, its fields where the switch starts", () => {
    renderEditor();

    const content: HTMLElement = contentOf(sectionFrames().get("Actions")!);

    for (const form of actionForms()) {
      expect(form).toHaveClass(...tokens(CRITERIA_ACTION_FORM_CLASS_NAME));
      expect(content.contains(form)).toBe(true);

      for (const width of PHONE_WIDTHS) {
        const look: Look = lookOf(form.className, width);
        const around: BoxSpacing = resolvePadding(content.className, width);

        // Out over the section's padding, to the criteria box's sides...
        expect([width, look.margin.left, look.margin.right]).toEqual([
          width,
          -around.left,
          -around.right,
        ]);
        // ...and its own padding puts its fields back where the switch is.
        expect([width, look.padding.left]).toEqual([width, around.left]);
        expect([width, look.frame.border]).toEqual([
          width,
          { top: 1, right: 0, bottom: 1, left: 0 },
        ]);
        expect([width, look.frame.radius.topLeft]).toEqual([width, 0]);
      }
    }
  });

  test("each filter's box is a band across the Filters section", () => {
    renderEditor();

    const content: HTMLElement = contentOf(sectionFrames().get("Filters")!);
    const boxes: Array<HTMLElement> = filterBoxes();

    expect(boxes).toHaveLength(2);

    for (const box of boxes) {
      expect(box).toHaveClass(...tokens(CRITERIA_FILTER_BOX_CLASS_NAME));
      expect(content.contains(box)).toBe(true);

      for (const width of PHONE_WIDTHS) {
        const look: Look = lookOf(box.className, width);
        const around: BoxSpacing = resolvePadding(content.className, width);

        expect([width, look.margin.left, look.margin.right]).toEqual([
          width,
          -around.left,
          -around.right,
        ]);
        expect([width, look.padding.left]).toEqual([width, around.left]);
        expect([width, look.frame.border]).toEqual([
          width,
          { top: 1, right: 0, bottom: 1, left: 0 },
        ]);
      }
    }
  });

  test("no box is left between the criteria's box and an action's fields", () => {
    renderEditor();

    const box: HTMLElement = criteriaBox();

    for (const form of actionForms()) {
      const framed: Array<string> = [];
      let element: HTMLElement | null = form.parentElement;

      while (element && element !== box) {
        const border: ResolvedFrame["border"] = resolveFrame(
          element.className,
          390,
        ).border;

        if (border.left > 0 || border.right > 0) {
          framed.push(element.className);
        }

        element = element.parentElement;
      }

      expect([form.getAttribute("data-testid"), framed]).toEqual([
        form.getAttribute("data-testid"),
        [],
      ]);
    }
  });
});

describe("the criteria editor from sm up: what it always was", () => {
  test("an action's box: set in under the switch's words, framed and rounded", () => {
    renderEditor();

    for (const form of actionForms()) {
      for (const width of FROM_SM_UP) {
        expect([width, lookOf(form.className, width)]).toEqual([
          width,
          lookOf(FORMER_ACTION_FORM_CLASS_NAME, width),
        ]);
      }
    }

    expect(lookOf(FORMER_ACTION_FORM_CLASS_NAME, 1280).margin.left).toBe(24);
  });

  test("a filter's box: its 2px border and 8px padding", () => {
    renderEditor();

    for (const box of filterBoxes()) {
      for (const width of FROM_SM_UP) {
        expect([width, lookOf(box.className, width)]).toEqual([
          width,
          lookOf(FORMER_FILTER_BOX_CLASS_NAME, width),
        ]);
      }
    }

    expect(lookOf(FORMER_FILTER_BOX_CLASS_NAME, 1280).frame.border).toEqual({
      top: 2,
      right: 2,
      bottom: 2,
      left: 2,
    });
  });

  test("Filters, Actions and Settings: framed sections", () => {
    renderEditor();

    const frames: Map<string, HTMLElement> = sectionFrames();

    for (const title of SECTION_TITLES) {
      for (const width of FROM_SM_UP) {
        expect([
          title,
          width,
          lookOf(frames.get(title)!.className, width),
        ]).toEqual([title, width, lookOf(FORMER_SECTION_CLASS_NAME, width)]);
      }
    }
  });

  test("the criteria's box: the same frame and the same 4px bar, at every width", () => {
    renderEditor();

    for (const width of [...PHONE_WIDTHS, ...FROM_SM_UP]) {
      expect([width, lookOf(criteriaBox().className, width)]).toEqual([
        width,
        lookOf(FORMER_CRITERIA_BOX_CLASS_NAME, width),
      ]);
    }

    expect(resolveFrame(criteriaBox().className, 390).border).toEqual({
      top: 1,
      right: 1,
      bottom: 1,
      left: 4,
    });
  });
});

describe("the criteria's box on the dark theme", () => {
  test("its sides are a grey the dark theme recolours, and its bar is blue on top of it", () => {
    renderEditor();

    const box: HTMLElement = criteriaBox();

    /*
     * Without a colour of their own the three sides kept Tailwind's default
     * light grey, which Theme.css cannot reach: a white frame on a dark page.
     */
    expect(box).toHaveClass(...tokens(CRITERIA_BOX_CLASS_NAME));
    expect(tokens(CRITERIA_BOX_CLASS_NAME)).toContain("border-gray-200");
    expect(classesWithoutDarkTheme(tokens(CRITERIA_BOX_CLASS_NAME))).toEqual(
      [],
    );

    // The bar is important, so the dark rule for border-gray-200 leaves it blue.
    expect(box).toHaveClass(CRITERIA_ACCENT_CLASS_NAME);
    expect(CRITERIA_ACCENT_CLASS_NAME).toBe("!border-l-blue-500");
  });

  test("a criteria turned off has a grey bar, which the dark theme recolours too", () => {
    renderEditor([buildCriteria({ isEnabled: false })]);

    expect(criteriaBox()).toHaveClass(CRITERIA_DISABLED_ACCENT_CLASS_NAME);
    expect(criteriaBox()).not.toHaveClass(CRITERIA_ACCENT_CLASS_NAME);
    expect(isRemappedForDarkTheme(CRITERIA_DISABLED_ACCENT_CLASS_NAME)).toBe(
      true,
    );
  });

  test("the bands keep the dark theme: their grounds and rules are recoloured", () => {
    for (const className of [
      CRITERIA_ACTION_FORM_CLASS_NAME,
      CRITERIA_FILTER_BOX_CLASS_NAME,
      CRITERIA_BODY_CLASS_NAME,
    ]) {
      expect([className, classesWithoutDarkTheme(tokens(className))]).toEqual([
        className,
        [],
      ]);
    }
  });
});
