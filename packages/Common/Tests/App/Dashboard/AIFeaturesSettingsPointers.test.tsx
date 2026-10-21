import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

/*
 * The project's AI switch, Enable AI, lives on "Project Settings → AI
 * Features", which every install shows. "Enable auto-remediation" and
 * "Enable AI command execution" were folded into it, so the rules tables
 * must not send anyone looking for either - nor for a project setting at
 * all: what turns fixing on is the "Fix new incidents automatically" (or
 * alerts) switch on the same page as the tables.
 *
 * The auto remediation rules and investigation rules tables are shared by
 * the incident and alert AI settings pages. Only the props they hand to
 * ModelTable are under test, so the tables are captured instead of rendered.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

import AutoRemediationRulesTable from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRulesTable";
import AIInvestigationRulesTable from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AIInvestigationRulesTable";
import { AiLane } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";

/*
 * The retired switches, however the copy might spell them. Rule copy that
 * names either sends people to a toggle that no longer exists.
 */
const RETIRED_SWITCH_PATTERNS: Array<RegExp> = [
  /AI command execution/i,
  /enable auto-remediation/i,
  /auto-remediation can be turned off/i,
];

// Pages the rules tables have no reason to send anyone to.
const PROJECT_SETTINGS: RegExp = /Project Settings/;
const AI_CREDITS: RegExp = /AI Credits/;

// Every string a captured table shows: its card, its fields and options.
function copyOf(props: Record<string, unknown>): Array<string> {
  const texts: Array<string> = [];

  const visit: (value: unknown) => void = (value: unknown): void => {
    if (typeof value === "string") {
      texts.push(value);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };

  visit(props["cardProps"]);
  visit(props["noItemsMessage"]);
  visit(props["helpContent"]);
  visit(props["formSteps"]);

  for (const field of (props["formFields"] || []) as Array<
    Record<string, unknown>
  >) {
    visit(field["title"]);
    visit(field["description"]);
    visit(field["placeholder"]);
    visit(field["cardSelectOptions"]);
  }

  return texts;
}

function captured(element: React.ReactElement): Record<string, unknown> {
  render(element);

  return mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe.each([[AiLane.Incident], [AiLane.Alert]])(
  "the %s rules tables",
  (lane: AiLane) => {
    test.each([
      [
        "auto remediation rules",
        (): React.ReactElement => {
          return <AutoRemediationRulesTable lane={lane} />;
        },
      ],
      [
        "investigation rules",
        (): React.ReactElement => {
          return <AIInvestigationRulesTable lane={lane} />;
        },
      ],
    ])(
      "the %s never send anyone to a retired switch, or to a project setting",
      (_name: string, draw: () => React.ReactElement) => {
        const texts: Array<string> = copyOf(captured(draw()));

        // A walk that found nothing would pass vacuously.
        expect(texts.length).toBeGreaterThan(10);

        for (const text of texts) {
          for (const pattern of RETIRED_SWITCH_PATTERNS) {
            expect({ text, named: pattern.test(text) }).toEqual({
              text,
              named: false,
            });
          }

          expect({ text, named: PROJECT_SETTINGS.test(text) }).toEqual({
            text,
            named: false,
          });
          expect({ text, named: AI_CREDITS.test(text) }).toEqual({
            text,
            named: false,
          });
        }
      },
    );

    test("the auto remediation rules say they act while fixing is on", () => {
      const props: Record<string, unknown> = captured(
        <AutoRemediationRulesTable lane={lane} />,
      );
      const cardProps: { description?: string } = (props["cardProps"] ||
        {}) as { description?: string };

      expect(cardProps.description).toContain("while fixing is on");
      expect(props["noItemsMessage"]).toContain("while fixing is on");
    });
  },
);
