import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AskAiPageButtons from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPageButtons";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "../../../Types/AI/AIChatTypes";

/*
 * "GO TO NOTIFICATION METHODS" (issue #6828): an answer to "how do I...?"
 * ends with a button that opens the page of the project where it is done.
 * Drawn for each Dashboard page the answer cites, once, and nothing else;
 * a click opens that citation's page.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav",
  () => {
    return {
      __esModule: true,
      navigateToCitationTarget: (target: unknown): void => {
        navigateMock(target);
      },
    };
  },
);

const pageCitation: (
  id: string,
  path: string,
  title: string,
) => AIChatCitation = (
  id: string,
  path: string,
  title: string,
): AIChatCitation => {
  return {
    id,
    toolName: "find_dashboard_page",
    label: `Page: ${title}`,
    queryArguments: { query: title },
    rowCount: 1,
    target: {
      type: AIChatCitationTargetType.DashboardPage,
      params: { path, title },
    },
  };
};

const METHODS: AIChatCitation = pageCitation(
  "C2",
  "/dashboard/:projectId/user-settings/notification-methods",
  "Notification Methods",
);

const DOCS: AIChatCitation = {
  id: "C1",
  toolName: "read_docs",
  label: "Docs: Notification Methods",
  queryArguments: { page: "notifications/notification-methods" },
  rowCount: 1,
  target: {
    type: AIChatCitationTargetType.DocsPage,
    params: { page: "notifications/notification-methods", language: "en" },
  },
};

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
});

describe("AskAiPageButtons", () => {
  test("draws a button for the page the answer cites, and opens it", () => {
    render(
      <AskAiPageButtons
        text={
          "1. Open **Notification Methods** [C1].\n2. Add your number [C1].\n\nOpen Notification Methods [C2]"
        }
        citations={[DOCS, METHODS]}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Go to Notification Methods",
    });
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(button);
    expect(navigateMock).toHaveBeenCalledWith(METHODS.target);
  });

  test("draws nothing for an answer that cites no Dashboard page", () => {
    const { container } = render(
      <AskAiPageButtons
        text="The docs do not cover this."
        citations={[DOCS]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("draws nothing for a page the model looked up but did not cite", () => {
    const { container } = render(
      <AskAiPageButtons
        text="Read the docs [C1]."
        citations={[DOCS, METHODS]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("draws nothing for a citation whose address is not one of the Dashboard's routes", () => {
    const { container } = render(
      <AskAiPageButtons
        text="Go [C3]."
        citations={[pageCitation("C3", "https://attacker.example", "Pay")]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
