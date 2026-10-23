import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import EventItem, {
  EVENT_ITEM_LABEL_CLASS_NAME,
  EVENT_ITEM_LABELS_CLASS_NAME,
} from "../../../UI/Components/EventItem/EventItem";
import LabelsElement, {
  DETAIL_LABELS_TEST_ID,
} from "../../../UI/Components/Label/Labels";
import {
  WRAPPING_PILL_CLASS_NAME,
  WRAPPING_PILL_TEXT_CLASS_NAME,
} from "../../../UI/Components/Pill/Pill";
import Page from "../../../UI/Components/Page/Page";
import { DetailValueContext } from "../../../UI/Components/Detail/DetailValueContext";
import Label from "../../../Models/DatabaseModels/Label";
import Color from "../../../Types/Color";

/*
 * LABELS READ IN NATURAL ORDER WHEREVER THE BROWSER SHOWS THEM (OneUptime
 * issue #5183): a record's labels in a detail card's field, under a page's
 * title, on a status page's incident, scheduled event and episode, and
 * beside a record in a picker - numbered labels first, by their numbers
 * ("1.", "2.", ... "10."), then the others alphabetically, case and
 * accents aside. They came in whatever order the database joined them.
 *
 * A table's cell is held in Table/TableLabels.test.tsx; the order itself in
 * Tests/Utils/NaturalOrder and LabelOrder.
 */

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

// As the database joined them.
const JOINED: Array<string> = [
  "4.Business System=Customer Mobile App",
  "Claude",
  "10.Owner=Loyalty Platform Team",
  "2.SubCategory=Website",
  "production",
  "1.Category=Application",
  "Église",
  "3.Item=Connectivity",
];

const IN_ORDER: Array<string> = [
  "1.Category=Application",
  "2.SubCategory=Website",
  "3.Item=Connectivity",
  "4.Business System=Customer Mobile App",
  "10.Owner=Loyalty Platform Team",
  "Claude",
  "Église",
  "production",
];

const makeLabels: (names: Array<string>) => Array<Label> = (
  names: Array<string>,
): Array<Label> => {
  return names.map((name: string, index: number): Label => {
    const label: Label = new Label();
    label._id = `21000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    label.name = name;
    label.color = new Color("#6366f1");
    return label;
  });
};

const pillTexts: (root: Element) => Array<string> = (
  root: Element,
): Array<string> => {
  return Array.from(root.querySelectorAll('[data-testid="pill"]')).map(
    (pill: Element): string => {
      return (pill.textContent || "").trim();
    },
  );
};

describe("labels read in natural order wherever they are shown", () => {
  test("a detail card's field: every label, side by side, in order", () => {
    render(
      <DetailValueContext.Provider value={true}>
        <LabelsElement labels={makeLabels(JOINED)} />
      </DetailValueContext.Provider>,
    );

    expect(pillTexts(screen.getByTestId(DETAIL_LABELS_TEST_ID))).toEqual(
      IN_ORDER,
    );
  });

  test("a box of a page's own (a rule's details, a monitor's criteria): in order, the first three", () => {
    const { container } = render(<LabelsElement labels={makeLabels(JOINED)} />);

    expect(pillTexts(container)).toEqual(IN_ORDER.slice(0, 3));
  });

  test("under a page's title", () => {
    render(
      <Page title="Checkout API" labels={makeLabels(JOINED)}>
        <p>The monitor</p>
      </Page>,
    );

    expect(
      screen.getByRole("heading", { name: "Checkout API" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Labels")).toBeInTheDocument();
    expect(pillTexts(document.body)).toEqual(IN_ORDER);
  });

  test("under a page's title, a label without a name or slug is left out and the rest keep their order", () => {
    const labels: Array<Label> = makeLabels(["10. Owner", "2. Team"]);
    const nameless: Label = new Label();
    nameless._id = "21000000-0000-4000-8000-000000000099";
    labels.push(nameless);

    render(
      <Page title="Checkout API" labels={labels}>
        <p>The monitor</p>
      </Page>,
    );

    expect(pillTexts(document.body)).toEqual(["2. Team", "10. Owner"]);
  });

  test("a status page's incident, scheduled event or episode", () => {
    const { container } = render(
      <EventItem
        eventTitle="Checkout is failing for some customers"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        isDetailItem={true}
        eventSecondDescription="Declared at 18:02 UTC"
        eventTimeline={[]}
        labels={JOINED.map((name: string) => {
          return { name: name, color: new Color("#6366f1") };
        })}
      />,
    );

    const row: Element = container.querySelector(
      ".active-event-box-body-labels",
    ) as Element;

    expect(row).not.toBeNull();
    expect(pillTexts(row)).toEqual(IN_ORDER);
  });

  /*
   * On a status page an event's labels sat on one line that never wrapped:
   * a project's long labels ran out of the incident's box and past a
   * phone's edge (1,300px past it with the issue's labels). They wrap now,
   * and a label longer than the box runs onto a second line in its pill.
   */
  test("a status page's event: its labels wrap in the box, a long one onto a second line in its pill", () => {
    const { container } = render(
      <EventItem
        eventTitle="Checkout is failing for some customers"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        isDetailItem={true}
        eventSecondDescription="Declared at 18:02 UTC"
        eventTimeline={[]}
        labels={JOINED.map((name: string) => {
          return { name: name, color: new Color("#6366f1") };
        })}
      />,
    );

    const row: HTMLElement = container.querySelector(
      ".active-event-box-body-labels",
    ) as HTMLElement;

    expect(row.className).toBe(EVENT_ITEM_LABELS_CLASS_NAME);
    expect(row).toHaveClass("flex-wrap");
    // Not the one line that never wrapped.
    expect(row).not.toHaveClass("space-x-1");

    for (const item of Array.from(row.children)) {
      expect((item as HTMLElement).className).toBe(EVENT_ITEM_LABEL_CLASS_NAME);
    }

    const pills: Array<HTMLElement> = within(row).getAllByTestId("pill");

    expect(pills).toHaveLength(JOINED.length);

    for (const pill of pills) {
      expect(pill.className.trim()).toBe(WRAPPING_PILL_CLASS_NAME);
    }

    for (const text of within(row).getAllByTestId("pill-text")) {
      expect(text.className).toBe(WRAPPING_PILL_TEXT_CLASS_NAME);
      expect(text).not.toHaveClass("truncate");
    }
  });

  test("a detail card's field: a label longer than the column runs onto a second line in its pill, never cut short", () => {
    render(
      <DetailValueContext.Provider value={true}>
        <LabelsElement labels={makeLabels(JOINED)} />
      </DetailValueContext.Provider>,
    );

    const field: HTMLElement = screen.getByTestId(DETAIL_LABELS_TEST_ID);

    for (const pill of within(field).getAllByTestId("pill")) {
      expect(pill.className.trim()).toBe(WRAPPING_PILL_CLASS_NAME);
    }

    for (const text of within(field).getAllByTestId("pill-text")) {
      expect(text.className).toBe(WRAPPING_PILL_TEXT_CLASS_NAME);
      expect(text).not.toHaveClass("truncate");
    }
  });

  test("beside a record in a picker: its labels in order, the first ones shown", () => {
    const monitor: DropdownOption = {
      value: "60000000-0000-4000-8000-000000000001",
      label: "Checkout API",
      labels: [
        { name: "Claude", color: Color.fromString("#0ea5e9") },
        { name: "10.Owner=Platform", color: Color.fromString("#6366f1") },
        { name: "2.SubCategory=Website", color: Color.fromString("#64748b") },
      ],
    };

    render(
      <Dropdown onChange={() => {}} options={[monitor]} value={monitor} />,
    );

    const value: HTMLElement = screen
      .getByTestId("dropdown-value-label")
      .closest("div.flex") as HTMLElement;
    const container: HTMLElement = value.parentElement as HTMLElement;
    const shown: Array<string> = Array.from(
      container.querySelectorAll("span[title]"),
    ).map((span: Element): string => {
      return span.getAttribute("title") || "";
    });

    expect(shown).toEqual(["2.SubCategory=Website", "10.Owner=Platform"]);
    expect(within(container).getByText("+1")).toBeInTheDocument();
  });
});
