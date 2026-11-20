import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AskAiPageButtons, {
  getOpenablePageLinks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPageButtons";
import {
  AskAiAnswerPageLink,
  getAnswerPageLinks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPageLinks";
import ProductKey from "../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
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

/*
 * A PAGE OF ONE RECORD (#7065): "Go to Custom Domains · Acme Status" opens
 * that status page's Custom Domains. The button says whose page it is, by
 * the name the server read the record by for the person, and opens it
 * only with an id that is one.
 */
const RECORD_ID: string = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const recordCitation: (
  id: string,
  params: { [key: string]: string },
) => AIChatCitation = (
  id: string,
  params: { [key: string]: string },
): AIChatCitation => {
  return {
    id,
    toolName: "find_dashboard_page",
    label: "Page: Status Page > Branding > Custom Domains",
    queryArguments: { query: "Custom Domains" },
    rowCount: 1,
    target: {
      type: AIChatCitationTargetType.DashboardPage,
      params: {
        path: "/dashboard/:projectId/status-pages/:id/domains",
        title: "Custom Domains",
        ...params,
      },
    },
  };
};

describe("AskAiPageButtons and a page of one record", () => {
  test("names the page and the record it belongs to, and opens it", () => {
    const domains: AIChatCitation = recordCitation("C2", {
      recordId: RECORD_ID,
      recordTitle: "Acme Status",
    });

    render(
      <AskAiPageButtons
        text={"Add your domain [C1].\n\nOpen Custom Domains [C2]"}
        citations={[DOCS, domains]}
      />,
    );

    const button: HTMLElement = screen.getByRole("button");
    expect(button).toHaveTextContent("Go to Custom Domains");
    expect(button).toHaveTextContent("Acme Status");
    expect(screen.getByTestId("ask-ai-page-button-record").tagName).toBe(
      "BDI",
    );

    fireEvent.click(button);
    expect(navigateMock).toHaveBeenCalledWith(domains.target);
  });

  test("a record's page with no name read draws the page's name alone", () => {
    render(
      <AskAiPageButtons
        text="Open Custom Domains [C2]"
        citations={[recordCitation("C2", { recordId: RECORD_ID })]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Go to Custom Domains" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ask-ai-page-button-record")).toBeNull();
  });

  test("draws nothing for a record's page without a record id that is one", () => {
    for (const params of [
      {},
      { recordId: "not-an-id", recordTitle: "Acme Status" },
      { recordId: "../../settings" },
    ]) {
      const { container } = render(
        <AskAiPageButtons
          text="Open Custom Domains [C2]"
          citations={[recordCitation("C2", params)]}
        />,
      );
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
  });

  test("the same page of two records is two buttons, each with its record", () => {
    render(
      <AskAiPageButtons
        text="Open Custom Domains [C2] or [C3]"
        citations={[
          recordCitation("C2", { recordId: RECORD_ID, recordTitle: "Acme" }),
          recordCitation("C3", {
            recordId: "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
            recordTitle: "Beta",
          }),
        ]}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

/*
 * NEVER A BUTTON TO A PRODUCT SWITCHED OFF ON THE SERVER (#6815, #7065):
 * an answer written before the product was switched off keeps its words,
 * not its button, as Search leaves the product's pages out.
 */
describe("getOpenablePageLinks", () => {
  const linksOf: (
    citations: Array<AIChatCitation>,
  ) => Array<AskAiAnswerPageLink> = (
    citations: Array<AIChatCitation>,
  ): Array<AskAiAnswerPageLink> => {
    return getAnswerPageLinks(
      citations
        .map((citation: AIChatCitation): string => {
          return `[${citation.id}]`;
        })
        .join(" "),
      citations,
    );
  };

  const CREATE_MONITOR: AIChatCitation = pageCitation(
    "C4",
    "/dashboard/:projectId/monitors/create",
    "Create Monitor",
  );
  const DOMAINS: AIChatCitation = recordCitation("C5", {
    recordId: RECORD_ID,
    recordTitle: "Acme Status",
  });

  const idsOf: (links: Array<AskAiAnswerPageLink>) => Array<string> = (
    links: Array<AskAiAnswerPageLink>,
  ): Array<string> => {
    return links.map((link: AskAiAnswerPageLink): string => {
      return link.citationId;
    });
  };

  test("keeps every page while every product is on", () => {
    expect(
      idsOf(
        getOpenablePageLinks({
          links: linksOf([METHODS, CREATE_MONITOR, DOMAINS]),
          offOnServer: {},
        }),
      ),
    ).toEqual(["C2", "C4", "C5"]);
  });

  test("leaves out the pages of a product switched off, and keeps the rest", () => {
    expect(
      idsOf(
        getOpenablePageLinks({
          links: linksOf([METHODS, CREATE_MONITOR, DOMAINS]),
          offOnServer: {
            [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
          },
        }),
      ),
    ).toEqual(["C2", "C4"]);

    expect(
      idsOf(
        getOpenablePageLinks({
          links: linksOf([METHODS, CREATE_MONITOR]),
          offOnServer: {
            [ProductKey.Monitors]:
              ServerProductOffReason.TelemetryIngestionStopped,
          },
        }),
      ),
    ).toEqual(["C2"]);
  });
});
