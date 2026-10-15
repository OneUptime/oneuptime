import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import LinkedAffectedResources from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import AlertWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import IncidentWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A CREATED MESSAGE SHOWS NO HEADING WITH NOTHING UNDER IT.
 *
 * The "Incident Created" and "Alert Created" feed items - posted to Slack
 * and Microsoft Teams too - give the root cause and the remediation notes a
 * heading of their own, only when there are any. A value of nothing but
 * spaces and line breaks, which an API write can store, is none: it posted
 * "Root Cause:" with nothing after it. A blank description reads "No
 * description provided.", as a missing one does.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000b301",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000b302",
);

// What says nothing: empty, spaces, line breaks, tabs, a no-break space.
const BLANK_VALUES: Array<string> = [
  "",
  " ",
  "\n",
  "\r\n",
  " \n\t\n ",
  "\u00a0",
];

interface OptionalSections {
  description?: string | undefined;
  rootCause?: string | undefined;
  remediationNotes?: string | undefined;
}

type CreatedFeedFunction = (sections: OptionalSections) => Promise<string>;

type CreateIncidentFeedAsyncFunction = (incident: Incident) => Promise<void>;

type CreateAlertFeedAsyncFunction = (alertId: ObjectID) => Promise<void>;

// The "Incident Created" item's Markdown, for an incident with these sections.
const incidentCreatedFeed: CreatedFeedFunction = async (
  sections: OptionalSections,
): Promise<string> => {
  const feedItem: ReturnType<typeof jest.spyOn> = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockResolvedValue([] as never);
  jest
    .spyOn(IncidentWorkspaceMessages, "getIncidentCreateMessageBlocks")
    .mockResolvedValue([] as never);

  const incident: Incident = new Incident();
  incident._id = RECORD_ID.toString();
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = 7;
  incident.incidentNumberWithPrefix = "INC-7";
  incident.title = "Checkout is down";
  incident.description = sections.description;
  incident.rootCause = sections.rootCause;
  incident.remediationNotes = sections.remediationNotes;

  await (
    IncidentService as unknown as {
      createIncidentFeedAsync: CreateIncidentFeedAsyncFunction;
    }
  ).createIncidentFeedAsync(incident);

  expect(feedItem).toHaveBeenCalledTimes(1);

  return (feedItem.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
};

// The "Alert Created" item's Markdown, for an alert with these sections.
const alertCreatedFeed: CreatedFeedFunction = async (
  sections: OptionalSections,
): Promise<string> => {
  const alert: Alert = new Alert();
  alert._id = RECORD_ID.toString();
  alert.projectId = PROJECT_ID;
  alert.alertNumber = 42;
  alert.alertNumberWithPrefix = "ALT-42";
  alert.title = "Checkout is down";
  alert.description = sections.description;
  alert.rootCause = sections.rootCause;
  alert.remediationNotes = sections.remediationNotes;

  const feedItem: ReturnType<typeof jest.spyOn> = jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
  jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);
  jest
    .spyOn(LinkedAffectedResources, "readForAlert")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AlertWorkspaceMessages, "getAlertCreateMessageBlocks")
    .mockResolvedValue([] as never);

  await (
    AlertService as unknown as {
      createAlertFeedAsync: CreateAlertFeedAsyncFunction;
    }
  ).createAlertFeedAsync(RECORD_ID);

  expect(feedItem).toHaveBeenCalledTimes(1);

  return (feedItem.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
};

// The text of the message Slack gets for the Markdown.
function slackTextOf(markdown: string): string {
  return SlackUtil.getMarkdownBlocks({
    payloadMarkdownBlock: {
      _type: "WorkspacePayloadMarkdown",
      text: markdown,
    },
  })
    .map((block: { text?: { text?: string } }): string => {
      return block.text?.text || "";
    })
    .join("\n");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["the Incident Created item", incidentCreatedFeed],
  ["the Alert Created item", alertCreatedFeed],
])("%s", (_name: string, createdFeed: CreatedFeedFunction) => {
  test.each(BLANK_VALUES)(
    "a root cause of %j: no Root Cause heading, in the feed or in Slack",
    async (blank: string) => {
      const markdown: string = await createdFeed({
        description: "Every order fails.",
        rootCause: blank,
      });

      expect(markdown).not.toContain("Root Cause");
      expect(slackTextOf(markdown)).not.toContain("Root Cause");
    },
  );

  test.each(BLANK_VALUES)(
    "remediation notes of %j: no Remediation Notes heading, in the feed or in Slack",
    async (blank: string) => {
      const markdown: string = await createdFeed({
        description: "Every order fails.",
        remediationNotes: blank,
      });

      expect(markdown).not.toContain("Remediation Notes");
      expect(slackTextOf(markdown)).not.toContain("Remediation Notes");
    },
  );

  test.each(BLANK_VALUES)(
    "a description of %j reads as a missing one does",
    async (blank: string) => {
      const markdown: string = await createdFeed({ description: blank });

      expect(markdown).toContain("\nNo description provided.\n");
      expect(slackTextOf(markdown)).toContain("No description provided.");
    },
  );

  test("a root cause and remediation notes that say something are posted under their headings", async () => {
    const markdown: string = await createdFeed({
      description: "Every order fails.",
      rootCause: "Deploy 42 broke the payment client.",
      remediationNotes: "Roll back deploy 42.",
    });

    // Each under its own heading (the alert's item indents its blank lines).
    expect(markdown).toMatch(
      /📄 \*\*Root Cause\*\*:\n[ ]*\nDeploy 42 broke the payment client\.\n/,
    );
    expect(markdown).toMatch(
      /🎯 \*\*Remediation Notes\*\*:\n[ ]*\nRoll back deploy 42\.\n/,
    );
    expect(markdown).toContain("\nEvery order fails.\n");
    expect(markdown).not.toContain("No description provided.");

    const slackText: string = slackTextOf(markdown);

    expect(slackText).toContain("Root Cause");
    expect(slackText).toContain("Deploy 42 broke the payment client.");
    expect(slackText).toContain("Remediation Notes");
    expect(slackText).toContain("Roll back deploy 42.");
  });

  test("a root cause with spaces around it is posted as written", async () => {
    const markdown: string = await createdFeed({
      rootCause: "\n  Deploy 42 broke the payment client.  \n",
    });

    expect(markdown).toContain("📄 **Root Cause**:");
    expect(markdown).toContain("Deploy 42 broke the payment client.");
  });
});
