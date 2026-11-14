import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ObjectID from "../../../Types/ObjectID";
import { isRemappedForDarkMode } from "../../Helpers/DarkModeScan";
import {
  contrastOfClasses,
  groundClassOf,
  textClassOf,
} from "../../Helpers/TailwindContrast";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The "Affected Resource" card on an incident's and an alert's page, when
 * the event has series labels but none of them can be shown (every value
 * empty). The card then says so in one line.
 *
 * That line was gray-400 on the card's white: 2.5:1, under the 4.5:1 that
 * words need to be read, on a card that says nothing else. It is gray-500,
 * the colour the card's own description is written in, and the dark theme
 * re-colours it. It also sits straight in the card's body: the card pads
 * it, and the line adds no padding of its own (#6956).
 */

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
    },
  };
});

import IncidentAffectedResources from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/AffectedResources";
import AlertAffectedResources from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/AffectedResources";

// A label the card cannot show: its value is empty.
const LABELS_WITH_NOTHING_TO_SHOW: { "k8s.pod.name": string } = {
  "k8s.pod.name": "",
};

// WCAG AA for words at text-sm.
const READABLE_CONTRAST: number = 4.5;

const PADDING_CLASS: RegExp = /^-?(p|px|py|pt|pb|pl|pr|ps|pe)-/;

interface Case {
  name: string;
  line: string;
  renderCard: () => void;
}

const CASES: Array<Case> = [
  {
    name: "an incident",
    line: "No resource labels on this incident.",
    renderCard: (): void => {
      render(
        <IncidentAffectedResources
          incidentId={ObjectID.generate()}
          seriesLabels={LABELS_WITH_NOTHING_TO_SHOW}
        />,
      );
    },
  },
  {
    name: "an alert",
    line: "No resource labels on this alert.",
    renderCard: (): void => {
      render(
        <AlertAffectedResources
          alertId={ObjectID.generate()}
          seriesLabels={LABELS_WITH_NOTHING_TO_SHOW}
        />,
      );
    },
  },
];

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockResolvedValue({ monitors: [] } as never);
});

afterEach(() => {
  cleanup();
});

describe("the Affected Resource card with no labels to show", () => {
  for (const item of CASES) {
    describe(`on ${item.name}'s page`, () => {
      test("says so in words that can be read on the card", async () => {
        item.renderCard();

        const line: HTMLElement = await screen.findByText(item.line);
        const textClass: string = textClassOf(line);

        expect(textClass).toBe("text-gray-500");
        expect(
          contrastOfClasses(textClass, groundClassOf(line)),
        ).toBeGreaterThanOrEqual(READABLE_CONTRAST);
      });

      test("is re-coloured by the dark theme", async () => {
        item.renderCard();

        const line: HTMLElement = await screen.findByText(item.line);

        expect(isRemappedForDarkMode(textClassOf(line))).toBe(true);
      });

      test("is padded by the card alone", async () => {
        item.renderCard();

        const line: HTMLElement = await screen.findByText(item.line);
        const card: HTMLElement = screen.getByTestId("card");

        expect(card).toContainElement(line);
        expect(
          Array.from(line.classList).filter((token: string): boolean => {
            return PADDING_CLASS.test(token);
          }),
        ).toEqual([]);
      });
    });
  }

  test("reads gray-400 as too faint, so the check above can fail", () => {
    expect(contrastOfClasses("text-gray-400", "bg-white")).toBeLessThan(
      READABLE_CONTRAST,
    );
  });
});
