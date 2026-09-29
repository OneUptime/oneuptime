import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

interface DetailItem {
  incidentSeverity?: IncidentSeverity | undefined;
  labels?: Array<Label> | undefined;
}

const renderDetail: (
  item: DetailItem,
  field: Field<DetailItem>,
) => HTMLElement = (
  item: DetailItem,
  field: Field<DetailItem>,
): HTMLElement => {
  const { container } = render(
    <Detail<DetailItem>
      item={item}
      fields={[field]}
      showDetailsInNumberOfColumns={1}
    />,
  );

  return container;
};

const buildSeverity: (name: string, color?: Color) => IncidentSeverity = (
  name: string,
  color?: Color,
): IncidentSeverity => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = new ObjectID("severity-id").toString();
  severity.name = name;

  if (color) {
    severity.color = color;
  }

  return severity;
};

const severityField: Field<DetailItem> = {
  key: "incidentSeverity",
  title: "Minimum Severity To Investigate",
  fieldType: FieldType.Entity,
  placeholder: "Every severity",
};

const badgeSelector: string = '[data-dropdown-value-badge="true"]';

const requireElement: (
  element: HTMLElement | null | undefined,
) => HTMLElement = (element: HTMLElement | null | undefined): HTMLElement => {
  if (!element) {
    throw new Error("Expected the element to be rendered");
  }

  return element;
};

afterEach(() => {
  cleanup();
});

describe("Detail entity fields", () => {
  test("renders a related model as a labelled badge instead of throwing", () => {
    const container: HTMLElement = renderDetail(
      { incidentSeverity: buildSeverity("Critical", new Color("#ef4444")) },
      severityField,
    );

    const badge: HTMLElement = requireElement(
      container.querySelector<HTMLElement>(badgeSelector),
    );

    expect(badge.textContent).toContain("Critical");
    expect(badge.style.backgroundColor).toEqual("rgb(239, 68, 68)");
  });

  test("renders an uncolored badge when the relation has no color selected", () => {
    const container: HTMLElement = renderDetail(
      { incidentSeverity: buildSeverity("Major") },
      severityField,
    );

    const badge: HTMLElement = requireElement(
      container.querySelector<HTMLElement>(badgeSelector),
    );

    expect(badge.textContent).toContain("Major");
    expect(badge.classList.contains("bg-indigo-50")).toBe(true);
  });

  test("shows the placeholder when the relation is not set", () => {
    const container: HTMLElement = renderDetail({}, severityField);

    expect(container.textContent).toContain("Every severity");
    expect(container.querySelector(badgeSelector)).toBeNull();
  });

  test("renders one badge per item for an entity array", () => {
    const first: Label = new Label();
    first.name = "Backend";
    first.color = new Color("#22c55e");

    const second: Label = new Label();
    second.name = "Database";

    const container: HTMLElement = renderDetail(
      { labels: [first, second] },
      {
        key: "labels",
        title: "Labels",
        fieldType: FieldType.EntityArray,
        placeholder: "No labels",
      },
    );

    const badges: Array<HTMLElement> = Array.from(
      container.querySelectorAll<HTMLElement>(badgeSelector),
    );

    expect(badges).toHaveLength(2);
    expect(requireElement(badges[0]).textContent).toContain("Backend");
    expect(requireElement(badges[0]).style.backgroundColor).toEqual(
      "rgb(34, 197, 94)",
    );
    expect(requireElement(badges[1]).textContent).toContain("Database");
  });

  test("shows the placeholder for an empty entity array", () => {
    const container: HTMLElement = renderDetail(
      { labels: [] },
      {
        key: "labels",
        title: "Labels",
        fieldType: FieldType.EntityArray,
        placeholder: "No labels",
      },
    );

    expect(container.textContent).toContain("No labels");
    expect(container.querySelector(badgeSelector)).toBeNull();
  });

  test("falls back to a label when a relation is declared without a field type", () => {
    const container: HTMLElement = renderDetail(
      { incidentSeverity: buildSeverity("Critical") },
      {
        key: "incidentSeverity",
        title: "Minimum Severity To Investigate",
        placeholder: "Every severity",
      },
    );

    expect(container.textContent).toContain("Critical");
  });
});
