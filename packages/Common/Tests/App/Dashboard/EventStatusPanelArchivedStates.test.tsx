import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

import EventStatusPanel, {
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import Color from "../../../Types/Color";
import { StateListType } from "../../../Utils/StateOrder";

/*
 * The header of an incident, an alert, an episode or a maintenance event
 * draws the project's states as a rail and offers the ones after the
 * current one in its ⋯ menu. An archived state (Common/Utils/ArchivableValues)
 * is shown only while the record is in it - the header still says where it
 * is - and is never offered as a state to move to: the server would refuse
 * it.
 */

const STATES: Array<EventStateItem> = [
  {
    id: "identified",
    name: "Identified",
    color: new Color("#ef4444"),
    order: 1,
  },
  {
    id: "monitoring",
    name: "Monitoring fix",
    color: new Color("#8b5cf6"),
    order: 2,
    isArchived: true,
  },
  {
    id: "mitigated",
    name: "Mitigated",
    color: new Color("#0ea5e9"),
    order: 3,
  },
  { id: "resolved", name: "Resolved", color: new Color("#10b981"), order: 4 },
];

const renderPanel: (currentStateId: string) => void = (
  currentStateId: string,
): void => {
  render(
    <EventStatusPanel
      stateList={StateListType.IncidentState}
      states={STATES}
      identifier="INC-42"
      currentStateId={currentStateId}
      actions={[]}
      onActionClick={(): void => {}}
      onStateSelect={(): void => {}}
    />,
  );
};

const menuChoices: () => Array<string> = (): Array<string> => {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));

  return Array.from(
    screen.getByRole("menu").querySelectorAll<HTMLElement>('[role="menuitem"]'),
  )
    .filter((element: HTMLElement): boolean => {
      return !element.querySelector('[role="menuitem"]');
    })
    .map((element: HTMLElement): string => {
      return element.textContent?.trim() || "";
    });
};

afterEach(() => {
  cleanup();
});

describe("an archived state in a record's header", () => {
  test("is not drawn while the record is in another state", () => {
    renderPanel("identified");

    expect(screen.queryByText("Monitoring fix")).toBeNull();
    expect(screen.getAllByText("Mitigated").length).toBeGreaterThan(0);
  });

  test("is never offered as a state to move to", () => {
    renderPanel("identified");

    const choices: Array<string> = menuChoices();

    expect(choices).toContain("Mitigated");
    expect(choices).toContain("Resolved");
    expect(choices).not.toContain("Monitoring fix");
  });

  test("is drawn while the record is in it, and the menu moves on from it", () => {
    renderPanel("monitoring");

    expect(screen.getAllByText("Monitoring fix").length).toBeGreaterThan(0);

    const choices: Array<string> = menuChoices();

    expect(choices).not.toContain("Monitoring fix");
    expect(choices).toContain("Mitigated");
    expect(choices).toContain("Resolved");
  });
});
