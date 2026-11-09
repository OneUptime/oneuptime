import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import LlmAppsPath from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmAppsPath";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * AI / LLM > Connect > Your apps: the line under "What to send" that says
 * where personal data in prompts is masked before it is stored.
 *
 * Prompts recorded on the spans go through the traces' scrub rules. The
 * ones an instrumentation sends as log events (the JavaScript and Java
 * ones, Python's with true or event_only) are log records, which only the
 * logs' scrub rules read - so the line links both, each to its own page.
 */

// The key picker reads and creates keys over the network: a marker here.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        return ReactActual.createElement("div", {
          "data-testid": "ingestion-key-selector",
        });
      },
    };
  },
);

describe("Your apps' line on personal data in prompts", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/llm/connect`);
  });

  afterEach(() => {
    cleanup();
  });

  test("links the traces' scrub rules, and the logs' for prompts sent as log events", () => {
    render(<LlmAppsPath />);

    const traceRules: HTMLElement = screen.getByTestId(
      "llm-apps-trace-scrub-rules",
    );
    const logRules: HTMLElement = screen.getByTestId(
      "llm-apps-log-scrub-rules",
    );

    expect(traceRules.tagName).toBe("A");
    expect(traceRules).toHaveTextContent("trace scrub rules");
    expect(traceRules).toHaveAttribute(
      "href",
      routeFor(PageMap.TRACES_SETTINGS_SCRUB_RULES),
    );

    expect(logRules.tagName).toBe("A");
    expect(logRules).toHaveTextContent("log scrub rules");
    expect(logRules).toHaveAttribute(
      "href",
      routeFor(PageMap.LOGS_SETTINGS_SCRUB_RULES),
    );

    // This project's pages, not the route's placeholder.
    expect(logRules.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/logs/settings/scrub-rules`,
    );
    expect(traceRules.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/traces/settings/scrub-rules`,
    );

    // One sentence, with each link in its place.
    expect(screen.getByTestId("llm-apps-what-to-send")).toHaveTextContent(
      "Prompts can carry personal data. Mask it before it is stored with trace scrub rules, or log scrub rules for prompts sent as log events, and read the AI observability guide for everything else.",
    );
  });
});
