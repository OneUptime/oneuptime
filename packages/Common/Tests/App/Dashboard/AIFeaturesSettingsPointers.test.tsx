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
 * The project's AI switches (Enable AI, Enable auto-remediation, Enable AI
 * command execution) live on "Project Settings → AI Features", which every
 * install shows. Copy that sends people to one of them has to name that
 * page: "Project Settings" alone leaves them hunting, and the old home (AI
 * Credits) is listed only when billing is on.
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
    test("the Let AI Compose Commands field says where the command execution switch is", () => {
      const { composeDescription } = renderRules(trigger);

      expect(composeDescription).toContain(
        `Requires Enable AI Command Execution (in ${AI_FEATURES})`,
      );
      expect(composeDescription).not.toContain(
        "the project's Enable AI Command Execution setting",
      );
    });

    test("every help sentence about the command execution switch names AI Features", () => {
      const { markdown } = renderRules(trigger);
      const sentences: Array<string> = sentencesMentioning(
        markdown,
        "Enable AI Command Execution",
      );

      expect(sentences.length).toBeGreaterThan(0);
      for (const sentence of sentences) {
        expect(sentence).toContain(AI_FEATURES);
      }
    });

    test("the guardrails say where auto-remediation is turned off for the project", () => {
      const { markdown } = renderRules(trigger);

      expect(markdown).toContain(
        `auto-remediation can be turned off for the whole project in ${AI_FEATURES}.`,
      );
      expect(markdown).not.toContain(
        "disabled project-wide from Project Settings",
      );
    });

    test("nothing points at AI Credits for a switch", () => {
      const { markdown, composeDescription } = renderRules(trigger);

      expect(markdown).not.toMatch(/AI Credits/);
      expect(composeDescription).not.toMatch(/AI Credits/);
    });
  },
);
