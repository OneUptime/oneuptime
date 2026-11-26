import "@testing-library/jest-dom";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import ToolApprovalCard from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import { aiActionSentence } from "../../../Types/AI/AIActionWords";
import {
  AI_DATA_SECURITY_ACTION_ASKS_BECAUSE,
  AI_DATA_SECURITY_ACTION_CHANGES,
  AI_DATA_SECURITY_ACTION_COSTS,
  AI_DATA_SECURITY_ACTION_STOPS_WORKING,
  AI_DATA_SECURITY_ACTION_TITLES,
} from "../../../Types/AI/AIDataSecurityActionWords";

/*
 * AN APPROVAL CARD SAYS WHAT CHANGES, WHAT STOPS WORKING AND WHAT IT COSTS
 * (#10378).
 *
 * The card of an action that names its effects - a response on a store,
 * Fix with AI - draws each under a heading of its own, in plain words, and
 * says why it asks in every mode when it does. A card of an action that
 * names none draws no empty section.
 */

afterEach(() => {
  cleanup();
});

function card(overrides: Partial<AIChatToolAction> = {}): AIChatToolAction {
  return {
    id: "call-respond",
    toolName: "respond_on_data_store",
    title: 'Block public access to "website-assets"',
    arguments: { dataStoreId: "s-1", action: "Block public access" },
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Pending,
    words: {
      title: aiActionSentence(
        AI_DATA_SECURITY_ACTION_TITLES.blockPublicAccess,
        {
          store: '"website-assets"',
        },
      ),
      effects: {
        changes: [
          aiActionSentence(AI_DATA_SECURITY_ACTION_CHANGES.blockPublicAccessS3),
          aiActionSentence(
            AI_DATA_SECURITY_ACTION_CHANGES.checkedAgainRightAfter,
          ),
        ],
        stopsWorking: [
          aiActionSentence(
            AI_DATA_SECURITY_ACTION_STOPS_WORKING.blockPublicAccessS3,
          ),
        ],
        asksBecause: aiActionSentence(
          AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.respond,
        ),
      },
    },
    ...overrides,
  };
}

function draw(action: AIChatToolAction): void {
  render(
    <ToolApprovalCard
      toolActions={[action]}
      interactive={true}
      isSubmitting={false}
      onRespond={() => {}}
    />,
  );
}

describe("the approval card of a Data Security action", () => {
  test("says what changes and what stops working, each under its heading, and why it asks", () => {
    draw(card());

    const effects: HTMLElement = screen.getByTestId("tool-approval-effects");
    const changes: HTMLElement = within(effects).getByTestId(
      "tool-approval-effect-changes",
    );
    const stops: HTMLElement = within(effects).getByTestId(
      "tool-approval-effect-stops-working",
    );

    expect(
      within(changes).getByTestId("tool-approval-effect-heading"),
    ).toHaveTextContent("What changes");
    expect(changes).toHaveTextContent(
      "Turns on the bucket's four Block Public Access settings, so nobody on the internet can read it. No object is changed.",
    );
    expect(changes).toHaveTextContent(
      "OneUptime does this through the store's cloud connection and checks the store again right after",
    );
    expect(
      within(stops).getByTestId("tool-approval-effect-heading"),
    ).toHaveTextContent("What stops working");
    expect(stops).toHaveTextContent(
      "Anything that reads it publicly - a website, a download link - stops working.",
    );
    // No cost, no empty section for one.
    expect(
      within(effects).queryByTestId("tool-approval-effect-costs"),
    ).toBeNull();
    expect(screen.getByTestId("tool-approval-asks-because")).toHaveTextContent(
      "Asks first in every mode: it changes the store in its cloud, and what reads it may stop working.",
    );
  });

  test("says what it costs when it costs something: Fix with AI's OneUptime AI", () => {
    draw(
      card({
        toolName: "fix_data_security_issue_with_ai",
        words: {
          title: aiActionSentence(AI_DATA_SECURITY_ACTION_TITLES.fixWithAi, {
            issue: '"Anyone on the internet can read it"',
          }),
          effects: {
            changes: [
              aiActionSentence(
                AI_DATA_SECURITY_ACTION_CHANGES.fixNothingMerged,
              ),
            ],
            costs: [
              aiActionSentence(AI_DATA_SECURITY_ACTION_COSTS.oneUptimeAi),
            ],
          },
        },
      }),
    );

    const costs: HTMLElement = screen.getByTestId("tool-approval-effect-costs");

    expect(
      within(costs).getByTestId("tool-approval-effect-heading"),
    ).toHaveTextContent("What it costs");
    expect(costs).toHaveTextContent(
      "It uses OneUptime AI: it counts toward the project's AI credits and daily limits.",
    );
    // It follows the mode: no reason to ask in every mode.
    expect(screen.queryByTestId("tool-approval-asks-because")).toBeNull();
  });

  test("an action that names no effects draws no section", () => {
    draw(
      card({
        toolName: "create_incident",
        title: "Create incident: High memory usage",
        words: undefined,
      }),
    );

    expect(screen.queryByTestId("tool-approval-effects")).toBeNull();
  });
});
