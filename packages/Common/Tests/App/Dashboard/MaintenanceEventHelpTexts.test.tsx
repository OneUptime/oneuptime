import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { FunctionComponent } from "react";

/*
 * #7824: the help on a maintenance event's rule pages, and the Data
 * Observability docs, name the record as #6817 does. They said "scheduled
 * maintenance event" under a page and menus that say Maintenance Event.
 * "Scheduled Maintenance" stays where it names the product: "Scheduled
 * Maintenance Label Rules".
 *
 * These texts are Markdown in English, not in the locale files, so only a
 * test that reads them sees them go back to the old name. The tables and
 * the Markdown viewer are captured, not drawn: what each page hands them is
 * under test.
 */
const mockCapturedTableProps: Array<Record<string, unknown>> = [];
const mockCapturedMarkdown: Array<string> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): null => {
      mockCapturedMarkdown.push(props.text);
      return null;
    },
  };
});

import ScheduledMaintenanceRunbookRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceRunbookRules";
import ScheduledMaintenanceLabelRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceLabelRules";
import ScheduledMaintenanceOwnerRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceOwnerRules";
import DataObservabilityDocumentationPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Documentation";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";

const OLD_NAME: RegExp = /scheduled maintenance event/i;

type SettingsPage = FunctionComponent<PageComponentProps>;

interface TableWords {
  // The card's description, above the table.
  description: string;
  // The help: its title, description and Markdown, as one text.
  help: string;
  markdown: string;
}

function wordsOfThePage(Page: SettingsPage): TableWords {
  render(
    <Page
      pageRoute={new Route("/dashboard/rules")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  const props: Record<string, unknown> =
    mockCapturedTableProps[mockCapturedTableProps.length - 1] || {};
  const card: Record<string, unknown> = (props["cardProps"] || {}) as Record<
    string,
    unknown
  >;
  const help: Record<string, unknown> = (props["helpContent"] || {}) as Record<
    string,
    unknown
  >;

  return {
    description: String(card["description"]),
    help: [help["title"], help["description"], help["markdown"]].join("\n"),
    markdown: String(help["markdown"]),
  };
}

afterEach(() => {
  cleanup();
  mockCapturedTableProps.length = 0;
  mockCapturedMarkdown.length = 0;
});

describe("a maintenance event's rule pages name the record in their help", () => {
  test("Runbook Rules", () => {
    const words: TableWords = wordsOfThePage(
      ScheduledMaintenanceRunbookRulesPage,
    );

    expect(words.markdown).toContain(
      "Runbook rules attach runbooks to maintenance events automatically when they are created",
    );
    expect(words.markdown).toContain(
      "**Monitors** — the maintenance event affects one of the selected monitors.",
    );
    expect(words.markdown).toContain(
      "A rule with no conditions starts them for every maintenance event.",
    );
    expect(words.help).not.toMatch(OLD_NAME);
  });

  test("Label Rules", () => {
    const words: TableWords = wordsOfThePage(
      ScheduledMaintenanceLabelRulesPage,
    );

    expect(words.markdown).toContain(
      "Scheduled Maintenance Label Rules attach labels to a maintenance event automatically when it matches your criteria",
    );
    expect(words.description).toBe(
      "Auto-attach labels to new maintenance events that match, including labels from their monitors and infrastructure.",
    );
    expect(words.help).not.toMatch(OLD_NAME);
  });

  test("Owner Rules", () => {
    const words: TableWords = wordsOfThePage(
      ScheduledMaintenanceOwnerRulesPage,
    );

    expect(words.markdown).toContain(
      "Scheduled Maintenance Owner Rules add owner users and teams to a maintenance event automatically when it matches your criteria",
    );
    expect(words.description).toBe(
      "Auto-assign owner users and teams when matching maintenance events are created.",
    );
    expect(words.help).toContain(
      "Match maintenance events and add owner users/teams automatically.",
    );
    expect(words.help).not.toMatch(OLD_NAME);
  });
});

describe("the Data Observability docs", () => {
  test("tell how a maintenance event keeps a database's alerts quiet", () => {
    render(
      <DataObservabilityDocumentationPage
        pageRoute={new Route("/dashboard/data-observability/documentation")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    const docs: string = mockCapturedMarkdown.join("\n");

    expect(docs).toContain(
      "Name the database under **Data Observability Databases** on a maintenance event, or put its database server in one, and its data alerts stay quiet while the event is on.",
    );
    expect(docs).not.toMatch(OLD_NAME);
  });
});
