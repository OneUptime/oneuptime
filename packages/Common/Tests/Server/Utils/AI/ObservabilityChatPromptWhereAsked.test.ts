import {
  buildObservabilityChatSystemPrompt,
  buildPageContextSection,
  INCIDENTS_ALERTS_AND_MONITORS_SECTION,
  ObservabilityChatApp,
  ObservabilityChatSurface,
} from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT OneUptime AI SAYS ABOUT ACTING, BY WHERE IT IS ASKED (#5315's
 * follow-ups).
 *
 * Asked to create an incident in Slack, the answer said "switch modes",
 * which means nothing in a chat app. Now:
 *
 *   - Slack and Microsoft Teams: it reads only, and says how to make the
 *     change from there - the chat's incident command, the buttons on
 *     OneUptime's messages, the page command, or Ask AI in the Dashboard
 *     by its link - never "switch modes";
 *   - the Dashboard's Read-only conversation: it names the mode that lets
 *     it act, Ask to act, and where it is picked;
 *   - an autonomous run: it reads only, with nobody to tell either;
 *   - asked in an incident's or alert's own channel, the question is about
 *     that record, said as a channel's, not a page's;
 *   - in every mode, how to write up a problem that already happened
 *     (initialState), and never to use it to keep people from being paged.
 */

const NOW: Date = new Date("2026-11-03T12:00:00Z");

const SLACK: ObservabilityChatApp = {
  name: "Slack",
  incidentCommand: "/oneuptime incident",
  pageCommand: "/oneuptime page",
  askAiUrl: "https://oneuptime.example.com/dashboard/p/ai/chat",
};

const TEAMS: ObservabilityChatApp = {
  name: "Microsoft Teams",
  incidentCommand: "incident",
  pageCommand: "page",
  commandNote:
    "typed to the OneUptime bot; in a channel or a group chat, mention @OneUptime first",
  askAiUrl: "https://oneuptime.example.com/dashboard/p/ai/chat",
};

const INCIDENT_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Incident,
  entityId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  entityTitle: "INC-42 Checkout is down",
};

const ALERT_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Alert,
  entityId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  entityTitle: "ALT-7 High memory on test01",
};

function promptFor(data: {
  permissionMode?: AIChatPermissionMode;
  surface?: ObservabilityChatSurface;
  chatApp?: ObservabilityChatApp;
  pageContext?: AIChatPageContext;
}): string {
  return buildObservabilityChatSystemPrompt({
    currentTime: NOW,
    permissionMode: data.permissionMode ?? AIChatPermissionMode.ReadOnly,
    ...(data.surface ? { surface: data.surface } : {}),
    ...(data.chatApp ? { chatApp: data.chatApp } : {}),
    ...(data.pageContext ? { pageContext: data.pageContext } : {}),
  });
}

describe("in a chat app it says how to act from there", () => {
  test("Slack: its commands, the buttons, and Ask AI in the Dashboard by its link", () => {
    const prompt: string = promptFor({ chatApp: SLACK });

    expect(prompt).toContain(
      "5. You are answering in Slack, where OneUptime AI only reads.",
    );
    expect(prompt).toContain(
      "say in one sentence that you cannot make changes from Slack",
    );
    expect(prompt).toContain(
      "declare an incident with `/oneuptime incident <title>`",
    );
    expect(prompt).toContain(
      "acknowledge, resolve or page someone about an incident with `/oneuptime incident <number>`, which shows its buttons, or with the buttons on OneUptime's message about the incident or alert",
    );
    expect(prompt).toContain("page a person or a team with `/oneuptime page`");
    expect(prompt).toContain(
      "Ask AI in the OneUptime Dashboard, which proposes the change for them to approve: https://oneuptime.example.com/dashboard/p/ai/chat",
    );
    expect(prompt).toContain("Name only the way that fits what they asked.");
    expect(prompt).toContain(
      "Slack has no modes: never tell them to switch modes.",
    );
    expect(prompt).not.toContain("switch modes to let you act");
    expect(prompt).not.toContain("read-only mode is on");
  });

  test("Microsoft Teams: the commands typed to the bot, and how to reach it in a channel", () => {
    const prompt: string = promptFor({ chatApp: TEAMS });

    expect(prompt).toContain(
      "5. You are answering in Microsoft Teams, where OneUptime AI only reads.",
    );
    expect(prompt).toContain(
      "then how they can from there (typed to the OneUptime bot; in a channel or a group chat, mention @OneUptime first):",
    );
    expect(prompt).toContain("declare an incident with `incident <title>`");
    expect(prompt).toContain("page a person or a team with `page`");
    expect(prompt).toContain(
      "Microsoft Teams has no modes: never tell them to switch modes.",
    );
  });

  test("whatever mode is passed, a chat app reads only: no action is offered there", () => {
    for (const permissionMode of [
      AIChatPermissionMode.ReadOnly,
      AIChatPermissionMode.AskForApproval,
      AIChatPermissionMode.AutoRun,
    ]) {
      const prompt: string = promptFor({ permissionMode, chatApp: SLACK });

      expect(prompt).toContain("where OneUptime AI only reads");
      expect(prompt).not.toContain("You can take actions:");
    }
  });

  test("it still names the tools a change would need, so it can say which way fits", () => {
    const prompt: string = promptFor({ chatApp: SLACK });

    for (const tool of [
      "create_incident_note",
      "create_alert_note",
      "start_investigation",
    ]) {
      expect(prompt).toContain(tool);
    }
  });
});

describe("in the Dashboard, a Read-only conversation names the mode that acts", () => {
  test("Ask to act, picked beside the box they type in - never 'switch modes'", () => {
    const prompt: string = promptFor({});

    expect(prompt).toContain("5. This conversation is READ-ONLY.");
    expect(prompt).toContain(
      "say that this conversation is Read-only, and that setting its permission mode to Ask to act, in the menu beside the box they type in, lets you propose the change for them to approve.",
    );
    expect(prompt).not.toContain("switch modes");
    // Read-only still names what it could not do, for the explanation.
    expect(prompt).toContain(
      "If the user asks you to create an incident or an alert, link one to the resources it is about,",
    );
  });

  test("the surface is the Dashboard unless said otherwise", () => {
    expect(promptFor({})).toBe(
      promptFor({ surface: ObservabilityChatSurface.Dashboard }),
    );
  });
});

describe("an autonomous run reads only, with nobody to tell", () => {
  test("no mode, no chat command, no 'switch modes'", () => {
    const prompt: string = promptFor({
      surface: ObservabilityChatSurface.AutonomousRun,
    });

    expect(prompt).toContain(
      "5. This run is READ-ONLY: you have only read tools — you cannot modify anything, and you must not claim to have taken any action",
    );
    expect(prompt).toContain(
      "Where a change would help, say which change, and why.",
    );
    expect(prompt).not.toContain("switch modes");
    expect(prompt).not.toContain("Ask to act");
    expect(prompt).not.toContain("/oneuptime");
  });
});

describe("asked in an incident's or an alert's own channel", () => {
  test("an incident's channel: the question is about that incident, said as a channel's", () => {
    const section: string = buildPageContextSection(INCIDENT_PAGE, SLACK);

    expect(section).toContain("## Current channel context");
    expect(section).toContain(
      'The user is asking in the Slack channel of an incident titled "INC-42 Checkout is down".',
    );
    expect(section).toContain(
      'Fetch its full details with query_incidents using incidentId="cccccccc-cccc-4ccc-8ccc-cccccccccccc"',
    );
    expect(section).toContain("assume they mean this channel's incident");
    expect(section).toContain("the channel is context, not a constraint");
    expect(section).not.toContain("dashboard page");
  });

  test("an alert's channel: the alert", () => {
    const section: string = buildPageContextSection(ALERT_PAGE, TEAMS);

    expect(section).toContain(
      'The user is asking in the Microsoft Teams channel of an alert titled "ALT-7 High memory on test01".',
    );
    expect(section).toContain("assume they mean this channel's alert");
  });

  test("the Dashboard's page context reads as it always did", () => {
    const section: string = buildPageContextSection(INCIDENT_PAGE);

    expect(section).toContain("## Current page context");
    expect(section).toContain(
      "The user has this chat open on the dashboard page of an incident",
    );
    expect(section).not.toContain("channel");
  });

  test("the whole prompt carries the channel's record", () => {
    expect(
      promptFor({ chatApp: SLACK, pageContext: INCIDENT_PAGE }),
    ).toContain("## Current channel context");
  });
});

describe("a problem that already happened is written up without paging anybody", () => {
  test("the section every mode reads says when to set initialState, and when never to", () => {
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      'create the incident or alert with initialState "resolved", or "acknowledged" when somebody is still on it: it then pages nobody, and the approval card says so.',
    );
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      "Never set initialState for a problem that is still live, or to keep anybody from being paged.",
    );

    for (const permissionMode of [
      AIChatPermissionMode.ReadOnly,
      AIChatPermissionMode.AskForApproval,
      AIChatPermissionMode.AutoRun,
    ]) {
      expect(promptFor({ permissionMode })).toContain(
        INCIDENTS_ALERTS_AND_MONITORS_SECTION,
      );
    }
  });
});
