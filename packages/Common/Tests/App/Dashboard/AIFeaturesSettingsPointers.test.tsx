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
 * Features", which every install shows. Copy that sends people to it has to
 * name that page: "Project Settings" alone leaves them hunting, and the old
 * home (AI Credits) is listed only when billing is on. It is the only
 * project switch auto-remediation answers to: "Enable auto-remediation" and
 * "Enable AI command execution" were folded into it, so the rules table
 * must not send anyone looking for either.
 *
 * The auto-remediation rules table is shared by the incident and alert
 * settings pages. Only the props it hands to ModelTable are under test, so
 * the table is captured instead of rendered.
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
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";

const AI_FEATURES: string = "Project Settings → AI Features";

/*
 * The retired switches, however the copy might spell them. Rule help that
 * names either sends people to a toggle that no longer exists.
 */
const RETIRED_SWITCH_PATTERNS: Array<RegExp> = [
  /AI command execution/i,
  /enable auto-remediation/i,
  /auto-remediation can be turned off/i,
];

interface CapturedField {
  field?: Record<string, unknown>;
  description?: string;
}

function renderRules(trigger: AutoRemediationTriggerEntity): {
  markdown: string;
  composeDescription: string;
} {
  render(
    <AutoRemediationRulesTable
      triggerEntityType={trigger}
      entityLabel={
        trigger === AutoRemediationTriggerEntity.Incident ? "incident" : "alert"
      }
    />,
  );

  const props: Record<string, unknown> =
    mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
  const helpContent: { markdown?: string } = (props["helpContent"] || {}) as {
    markdown?: string;
  };
  const fields: Array<CapturedField> = (props["formFields"] ||
    []) as Array<CapturedField>;
  const compose: CapturedField | undefined = fields.find(
    (candidate: CapturedField): boolean => {
      return Boolean(candidate.field?.["aiComposesCommands"]);
    },
  );

  if (!helpContent.markdown || !compose?.description) {
    throw new Error(
      "The rules table no longer has its help markdown or its Let AI Compose Commands field.",
    );
  }

  return {
    markdown: helpContent.markdown,
    composeDescription: compose.description,
  };
}

// The sentences of a block of copy that mention `phrase`.
function sentencesMentioning(text: string, phrase: string): Array<string> {
  return text.split(/(?<=[.;])\s+/).filter((sentence: string): boolean => {
    return sentence.includes(phrase);
  });
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe.each([
  [AutoRemediationTriggerEntity.Incident],
  [AutoRemediationTriggerEntity.Alert],
])(
  "the %s auto-remediation rules table",
  (trigger: AutoRemediationTriggerEntity) => {
    test("the Let AI Compose Commands field needs an opted-in Runner and no project switch", () => {
      const { composeDescription } = renderRules(trigger);

      expect(composeDescription).toContain(
        "Requires at least one Runner with Runs AI Remediation Commands.",
      );
      expect(composeDescription).not.toContain("Project Settings");
      for (const pattern of RETIRED_SWITCH_PATTERNS) {
        expect({
          pattern: String(pattern),
          named: pattern.test(composeDescription),
        }).toEqual({ pattern: String(pattern), named: false });
      }
    });

    test("the Let AI Compose Commands help names the Runner opt-in as its one requirement", () => {
      const { markdown } = renderRules(trigger);

      expect(markdown).toContain(
        "It requires at least one Runner with **Runs AI Remediation Commands** turned on;",
      );
    });

    test("the help never sends anyone to a retired switch", () => {
      const { markdown } = renderRules(trigger);

      for (const pattern of RETIRED_SWITCH_PATTERNS) {
        expect({
          pattern: String(pattern),
          named: pattern.test(markdown),
        }).toEqual({ pattern: String(pattern), named: false });
      }
    });

    test("the guardrails name Enable AI as the project-wide stop, on AI Features", () => {
      const { markdown } = renderRules(trigger);

      expect(markdown).toContain(
        `turning off **Enable AI** in ${AI_FEATURES} stops auto-remediation for the whole project.`,
      );
      expect(markdown).not.toContain(
        "disabled project-wide from Project Settings",
      );
    });

    test("every help sentence that names a project setting names Enable AI on AI Features", () => {
      const { markdown } = renderRules(trigger);
      const sentences: Array<string> = sentencesMentioning(
        markdown,
        "Project Settings",
      );

      expect(sentences.length).toBeGreaterThan(0);
      for (const sentence of sentences) {
        expect(sentence).toContain("**Enable AI**");
        expect(sentence).toContain(AI_FEATURES);
      }
    });

    test("nothing points at AI Credits for a switch", () => {
      const { markdown, composeDescription } = renderRules(trigger);

      expect(markdown).not.toMatch(/AI Credits/);
      expect(composeDescription).not.toMatch(/AI Credits/);
    });
  },
);
