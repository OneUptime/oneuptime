import {
  INCIDENTS_ALERTS_AND_MONITORS_SECTION,
  ObservabilityChatSurface,
  SETUP_SECTION,
  buildObservabilityChatSystemPrompt,
} from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import {
  AI_SETUP_ACTION_TOOL_NAMES,
  WHO_IS_TOLD_TOOL_NAME,
} from "../../../../Types/AI/AISetupActions";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ASK AI IS TOLD ABOUT SETTING THINGS UP (issue #6829).
 *
 * Its own instructions said a request to be alerted "asks for a monitor, and
 * no tool here creates one". Now they say what the setup actions make, that
 * a plan is proposed whole in one answer and approved on one card in every
 * mode, what to read first, what to ask for and what never to add, and how
 * it ends: the test page and who is told. Only where actions are taken: a
 * read-only conversation, Slack, Microsoft Teams and an autonomous run say
 * how to set things up from Ask AI instead.
 */

const CHAT_APP: {
  name: string;
  incidentCommand: string;
  pageCommand: string;
  askAiUrl: string;
} = {
  name: "Slack",
  incidentCommand: "/oneuptime incident",
  pageCommand: "/oneuptime page",
  askAiUrl: "https://oneuptime.example/dashboard/ask-ai",
};

function promptFor(data: {
  permissionMode: AIChatPermissionMode;
  surface?: ObservabilityChatSurface;
  chatApp?: typeof CHAT_APP;
}): string {
  return buildObservabilityChatSystemPrompt({
    currentTime: new Date("2026-11-12T00:00:00Z"),
    permissionMode: data.permissionMode,
    surface: data.surface,
    chatApp: data.chatApp as never,
  });
}

describe("the setup section", () => {
  test.each([
    AIChatPermissionMode.AskForApproval,
    AIChatPermissionMode.AutoRun,
  ])(
    "is in the %s prompt, once, before the results are read",
    (permissionMode: AIChatPermissionMode) => {
      const prompt: string = promptFor({ permissionMode });

      expect(prompt.split("## Setting things up")).toHaveLength(2);
      expect(prompt).toContain(SETUP_SECTION);
      expect(prompt.indexOf(SETUP_SECTION)).toBeGreaterThan(
        prompt.indexOf(INCIDENTS_ALERTS_AND_MONITORS_SECTION),
      );
      expect(prompt.indexOf(SETUP_SECTION)).toBeLessThan(
        prompt.indexOf("## Reading tool results"),
      );
    },
  );

  test("is not where no action is taken: Read-only, Slack and Microsoft Teams, an autonomous run", () => {
    expect(
      promptFor({ permissionMode: AIChatPermissionMode.ReadOnly }),
    ).not.toContain("## Setting things up");
    expect(
      promptFor({
        permissionMode: AIChatPermissionMode.AskForApproval,
        chatApp: CHAT_APP,
      }),
    ).not.toContain("## Setting things up");
    expect(
      promptFor({
        permissionMode: AIChatPermissionMode.AskForApproval,
        surface: ObservabilityChatSurface.AutonomousRun,
      }),
    ).not.toContain("## Setting things up");
  });

  test("names every setup action the toolbox has, and the read that says who is told", () => {
    for (const name of AI_SETUP_ACTION_TOOL_NAMES) {
      expect(SETUP_SECTION).toContain(name);
      expect(AIToolbox.getToolByName(name)?.isMutation).toBe(true);
    }

    expect(SETUP_SECTION).toContain(WHO_IS_TOLD_TOOL_NAME);
    expect(AIToolbox.getToolByName(WHO_IS_TOLD_TOOL_NAME)).toBeDefined();
  });

  test("one plan, one card: every part in the same answer, with no plan described and waited on", () => {
    expect(SETUP_SECTION).toContain(
      "Propose every part of one request in the same answer, so the person approves the plan once, on one card where each part can be skipped.",
    );
    expect(SETUP_SECTION).toContain(
      "Do not describe the plan and wait to be told to go on",
    );
  });

  test("always asked, in every mode", () => {
    expect(SETUP_SECTION).toContain(
      "Setup actions always wait for the person's approval on the card, in every mode, Auto-run included.",
    );
    expect(
      promptFor({ permissionMode: AIChatPermissionMode.AutoRun }),
    ).toContain(
      "Actions you request run IMMEDIATELY without a separate confirmation, except the setup actions, which always wait for the person's approval on a card.",
    );
  });

  test("reads what decides the plan first, and never proposes a second policy beside a project's own", () => {
    expect(SETUP_SECTION).toContain(
      "query_on_call_policies says whether the project pages people already, and then set_up_paging is not proposed",
    );
    expect(SETUP_SECTION).toContain(
      'Being paged, texted or called when a website is down is two parts: set_up_website_monitoring, and set_up_paging with reachMeBy ("text me" is sms)',
    );
  });

  test("asks for what is missing once, and never for a phone number, which the person verifies", () => {
    expect(SETUP_SECTION).toContain(
      "Ask only for what you cannot work out, once",
    );
    expect(SETUP_SECTION).toContain(
      "Never ask for or add a phone number: the person adds and verifies it in Notification Methods.",
    );
    expect(SETUP_SECTION).toContain(
      'find_dashboard_page "Notification Methods"',
    );
    expect(SETUP_SECTION).toContain(
      "A setup action that cannot be made is not proposed: its result says what is needed",
    );
  });

  test("ends with what exists, what was not made and why, and a test page offered - never claimed", () => {
    expect(SETUP_SECTION).toContain(
      "exactly what was not created and why when a part failed",
    );
    expect(SETUP_SECTION).toContain(
      "Offer a test page in one sentence: the button under your answer sends it. Never say a test was sent.",
    );
  });
});

describe("the rest of the prompt agrees", () => {
  test.each([
    AIChatPermissionMode.AskForApproval,
    AIChatPermissionMode.AutoRun,
  ])(
    "the %s prompt lists setting things up among its actions",
    (permissionMode: AIChatPermissionMode) => {
      expect(promptFor({ permissionMode })).toContain(
        "and set things up - a website or API monitor, who is paged, a status page and the monitors on it (set_up_website_monitoring, set_up_paging, publish_status_page, add_monitors_to_status_page)",
      );
    },
  );

  test("a read-only conversation says it sets nothing up, and how to", () => {
    expect(
      promptFor({ permissionMode: AIChatPermissionMode.ReadOnly }),
    ).toContain(
      "set up a monitor, paging or a status page, or make any other change, say that this conversation is Read-only",
    );
  });

  test("Slack and Microsoft Teams send a setup to Ask AI in the Dashboard", () => {
    expect(
      promptFor({
        permissionMode: AIChatPermissionMode.AskForApproval,
        chatApp: CHAT_APP,
      }),
    ).toContain(
      "changing code, or setting up a monitor, paging or a status page, Ask AI in the OneUptime Dashboard",
    );
  });

  test("a monitor of any condition but a website or API is still one a person creates", () => {
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      "The only monitor a tool here sets up watches a website or API address (set_up_website_monitoring",
    );
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      "A person creates the monitor under Monitors → Create Monitor",
    );
  });
});
