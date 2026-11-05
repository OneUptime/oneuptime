/*
 * Issue #5945, in the Dashboard: "this workflow" is the one on the page, a
 * citation opens its Builder, and the Create a workflow dialog has a way to
 * describe one to Ask AI.
 */

const mockOpenAskAi: Mock = jest.fn();
const mockUseAiOffered: Mock = jest.fn();

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/UseAiOffered", () => {
  return {
    __esModule: true,
    default: () => {
      return mockUseAiOffered();
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents",
  () => {
    return { __esModule: true, openAskAi: mockOpenAskAi };
  },
);

import { AIChatCitationTargetType } from "../../../Types/AI/AIChatTypes";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { targetTypeToPageMap } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav";
import PageContextUtil from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import CreateWorkflowModal, {
  CreateWorkflowCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/CreateWorkflowModal";
import fs from "fs";
import path from "path";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const WORKFLOW_ID: string = "e8000000-0000-4000-8000-0000000000c1";

afterEach(() => {
  cleanup();
  mockOpenAskAi.mockClear();
});

describe("the workflow page context", () => {
  test("points at one record, which needs its id", () => {
    expect(
      AIChatPageContextHelper.isEntityType(AIChatPageContextType.Workflow),
    ).toBe(true);
  });

  test("a workflow's id passes, and anything else is dropped", () => {
    expect(
      AIChatPageContextHelper.sanitize({
        type: AIChatPageContextType.Workflow,
        entityId: WORKFLOW_ID,
      })?.entityId,
    ).toBe(WORKFLOW_ID);

    expect(
      AIChatPageContextHelper.sanitize({
        type: AIChatPageContextType.Workflow,
        entityId: "logs",
      }),
    ).toBeUndefined();
  });

  test("suggests what to ask of one", () => {
    const questions: Array<{ question: string }> =
      PageContextUtil.getSuggestions({
        type: AIChatPageContextType.Workflow,
        entityId: WORKFLOW_ID,
        noun: "workflow",
        chipLabel: "This workflow",
        icon: "Workflow",
        isEntity: true,
      } as never);

    expect(
      questions
        .map((q: { question: string }) => {
          return q.question;
        })
        .join(" "),
    ).toContain("this workflow");
  });
});

describe("a citation of what was built", () => {
  test("opens the workflow's Builder", () => {
    expect(targetTypeToPageMap[AIChatCitationTargetType.WorkflowBuilder]).toBe(
      PageMap.WORKFLOW_BUILDER,
    );
  });
});

describe("the Create a workflow dialog", () => {
  test("offers nothing of the kind while the project's AI is off", () => {
    mockUseAiOffered.mockReturnValue(false);

    render(
      <MemoryRouter>
        <CreateWorkflowModal
          onClose={jest.fn() as never}
          onCreated={jest.fn() as never}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("create-workflow-with-ai")).toBeNull();
  });

  test("offers to describe it to Ask AI, which opens with the sentence begun", () => {
    mockUseAiOffered.mockReturnValue(true);

    const onClose: Mock = jest.fn();

    render(
      <MemoryRouter>
        <CreateWorkflowModal
          onClose={onClose as never}
          onCreated={jest.fn() as never}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("create-workflow-with-ai")).toHaveTextContent(
      CreateWorkflowCopy.withAi,
    );

    fireEvent.click(screen.getByTestId("create-workflow-with-ai-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockOpenAskAi).toHaveBeenCalledWith({
      prompt: CreateWorkflowCopy.withAiPrompt,
    });
  });
});

describe("the words", () => {
  const KEYS: Array<string> = [
    CreateWorkflowCopy.withAi,
    CreateWorkflowCopy.withAiPrompt,
    "This workflow",
    "Explain what this workflow does, step by step, and what starts it.",
    "Did this workflow's recent runs fail? If so, why, and how do I fix it?",
    "What would make this workflow simpler or more reliable?",
    "Create workflow: {{name}}",
    "Update workflow {{workflow}}",
    "Steps: {{steps}}.",
    "It starts turned off, so nothing runs until someone turns it on.",
    "This workflow is on, so its next run uses the change.",
    "Turned off until someone turns it on",
    "Workflow steps",
    "Still to fill in",
  ];

  const LOCALES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("there is a file for each of the 17 languages", () => {
    expect(LOCALES.length).toBe(17);
  });

  test.each(LOCALES)("%s has them, translated", (file: string) => {
    const words: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    );

    for (const key of KEYS) {
      expect([key, typeof words[key]]).toEqual([key, "string"]);

      if (file !== "en.json") {
        expect([file, key, words[key] === key]).toEqual([file, key, false]);
      }
    }
  });
});
