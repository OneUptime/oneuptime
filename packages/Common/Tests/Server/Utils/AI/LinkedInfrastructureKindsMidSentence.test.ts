import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  describeFollowUpCheck,
  describeLinkedInfrastructure,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import { LinkedAffectedResourceType } from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import IncidentFollowUpCheck, {
  FollowUpCheckContext,
} from "../../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import LinkedInfrastructureContext, {
  LINKED_INFRASTRUCTURE_KINDS,
  LinkedInfrastructure,
  LinkedInfrastructureResource,
} from "../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import {
  AIRunEventResultSummary,
  FollowUpCheckActivity,
  LinkedInfrastructureActivity,
} from "../../../../Types/AI/AIChatTypes";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";
import { createTranslator, Translator } from "../../../../Types/Translator";

/*
 * THE SERVER NAMES A RESOURCE'S KIND IN A SENTENCE AS THE AI INVESTIGATION
 * CARD DOES (#7952).
 *
 * The card draws an investigation's activity from its data, in the reader's
 * language, and since #7940 a kind in the middle of its lines reads as a
 * sentence says it: "on host web-1 and Docker host web-2". The server writes
 * the same facts in English for the people who do not see the card - the
 * run's activity for an API reader, the follow-up check's report lead for
 * the feed, the internal note, Slack and Teams - and wrote the label's
 * capital there: "on Host web-1".
 *
 * For every kind the server names, what it writes is held to what the card
 * draws for an English reader from the same data. The card's words are read
 * from the card's own module, never copied here.
 */

const DECLARED_AT: Date = new Date("2026-11-14T09:00:00.000Z");

// The card as an English reader sees it: the Dashboard's English locale.
function englishReader(): Translator {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
      ),
      "utf8",
    ),
  ) as Record<string, string>;

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, "en");
}

const ENGLISH: Translator = englishReader();

// One resource of every kind the server names, an App Platforms environment too.
const RESOURCES: Array<LinkedInfrastructureResource> = [
  ...LINKED_INFRASTRUCTURE_KINDS.map(
    (
      kind: { type: LinkedAffectedResourceType },
      index: number,
    ): LinkedInfrastructureResource => {
      return {
        type: kind.type,
        id: `0193c0de-eeee-4aaa-8bbb-0000000000${String(index).padStart(2, "0")}`,
        name: "web-1",
      };
    },
  ),
  {
    type: LinkedAffectedResourceType.CloudResource,
    id: "0193c0de-eeee-4aaa-8bbb-0000000000ee",
    name: "checkout · us-east-1",
    cloudResourceKind: CloudResourceKind.Environment,
  },
];

function nameOf(resource: LinkedInfrastructureResource): string {
  return resource.cloudResourceKind
    ? `${resource.type} (${resource.cloudResourceKind})`
    : resource.type;
}

function linkedTo(
  resources: Array<LinkedInfrastructureResource>,
  alertCount: number,
): LinkedInfrastructure {
  return {
    subjectKind: "incident",
    subjectCreatedAt: DECLARED_AT,
    resources,
    alerts: Array.from({ length: alertCount }, (_: unknown, index: number) => {
      return {
        id: `0193c0de-eeee-4aaa-8bbb-0000000001${String(index).padStart(2, "0")}`,
        alertNumber: 40 + index,
        title: "High CPU",
        isOpen: true,
        openedAt: DECLARED_AT,
        resources: [resources[0]!],
      };
    }),
    hasMoreAlerts: false,
    windowStart: new Date(DECLARED_AT.getTime() - 30 * 60 * 1000),
    readAt: DECLARED_AT,
  };
}

function followUpOn(
  resources: Array<LinkedInfrastructureResource>,
  alert: Partial<FollowUpCheckContext> = {},
): FollowUpCheckContext {
  return {
    incidentCreatedAt: DECLARED_AT,
    alertId: "0193c0de-eeee-4aaa-8bbb-0000000002ff",
    alertNumber: 12,
    alertTitle: "High CPU",
    alertOpenedAt: new Date(DECLARED_AT.getTime() + 2 * 60 * 1000),
    resources,
    ...alert,
  };
}

/*
 * The server's line beside the card's, drawn from the data the server
 * recorded with it.
 */
function activityLines(data: LinkedInfrastructure): {
  server: string;
  card: string;
} {
  const note: AIRunEventResultSummary | null =
    LinkedInfrastructureContext.buildActivityNote(data);
  const activity: LinkedInfrastructureActivity | undefined =
    note?.linkedInfrastructure;
  const message: string | undefined = note?.message;

  expect(activity).toBeDefined();
  expect(message).toBeDefined();

  return {
    server: message!,
    card: describeLinkedInfrastructure(activity!, ENGLISH),
  };
}

function followUpLines(context: FollowUpCheckContext): {
  server: string;
  card: string;
} {
  const note: AIRunEventResultSummary =
    IncidentFollowUpCheck.buildActivityNote(context);
  const activity: FollowUpCheckActivity | undefined = note.followUpCheck;

  expect(activity).toBeDefined();
  expect(note.message).toBeDefined();

  return {
    server: note.message!,
    card: describeFollowUpCheck(activity!, ENGLISH),
  };
}

// The card's follow-up line for alert #12, its resource's words captured.
const CARD_FOLLOW_UP_LINE: RegExp =
  /^Checking again: alert #12 opened on (.+) after the first analysis$/;

// "host web-1": the resource as the card's follow-up line names it.
function cardResourceWords(cardLine: string): string {
  const words: string | undefined = CARD_FOLLOW_UP_LINE.exec(cardLine)?.[1];

  expect(words).toBeDefined();

  return words!;
}

describe("every kind the server names reads in its lines as the card reads it", () => {
  test("the kinds are every one the server links, and an environment", () => {
    expect(RESOURCES.length).toBe(LINKED_INFRASTRUCTURE_KINDS.length + 1);
    expect(RESOURCES.length).toBeGreaterThanOrEqual(16);
  });

  /*
   * Not vacuous: the card does say a kind as the middle of a sentence says
   * it, and the server's line used to differ from it for a host.
   */
  test("the card says host web-1, where the server used to say Host web-1", () => {
    const lines: { server: string; card: string } = activityLines(
      linkedTo([RESOURCES[0]!], 1),
    );

    expect(RESOURCES[0]!.type).toBe(LinkedAffectedResourceType.Host);
    expect(lines.card).toBe("Read 1 open or recent alert on host web-1");
    expect(lines.server).not.toContain("Host");
  });

  test.each(RESOURCES.map(nameOf))(
    "%s: the run's activity line",
    (name: string) => {
      const resource: LinkedInfrastructureResource = RESOURCES.find(
        (candidate: LinkedInfrastructureResource): boolean => {
          return nameOf(candidate) === name;
        },
      )!;

      for (const alertCount of [0, 1, 2]) {
        const lines: { server: string; card: string } = activityLines(
          linkedTo([resource], alertCount),
        );

        expect(lines.server).toBe(lines.card);
      }

      // Without a name, the kind alone.
      const nameless: { server: string; card: string } = activityLines(
        linkedTo([{ ...resource, name: "" }], 0),
      );

      expect(nameless.server).toBe(nameless.card);
    },
  );

  test.each(RESOURCES.map(nameOf))(
    "%s: the follow-up check's activity line and its report's lead",
    (name: string) => {
      const resource: LinkedInfrastructureResource = RESOURCES.find(
        (candidate: LinkedInfrastructureResource): boolean => {
          return nameOf(candidate) === name;
        },
      )!;

      for (const named of [resource, { ...resource, name: "" }]) {
        const lines: { server: string; card: string } = followUpLines(
          followUpOn([named]),
        );

        expect(lines.server).toBe(lines.card);

        // The lead names the resource with the card's words.
        expect(
          IncidentFollowUpCheck.buildReportLead(followUpOn([named])).toString(),
        ).toContain(
          `opened on ${cardResourceWords(lines.card)}, 2 minutes after this incident was declared`,
        );
      }
    },
  );

  test("several resources, listed as the card lists them", () => {
    for (const alertCount of [0, 2]) {
      for (const count of [2, 3, RESOURCES.length]) {
        const lines: { server: string; card: string } = activityLines(
          linkedTo(RESOURCES.slice(0, count), alertCount),
        );

        expect(lines.server).toBe(lines.card);
      }
    }

    const more: LinkedInfrastructure = {
      ...linkedTo(RESOURCES.slice(-3), 10),
      hasMoreAlerts: true,
    };
    const lines: { server: string; card: string } = activityLines(more);

    expect(lines.server).toBe(lines.card);
  });

  /*
   * A kind a run recorded that this build does not know - an older or a
   * newer server's - is a resource on both.
   */
  test("a kind the server does not know is a resource on both", () => {
    const activity: LinkedInfrastructureActivity = {
      resources: [{ kind: "Spaceship", name: "enterprise" }],
      alertCount: 0,
      openAlertCount: 0,
      hasMoreAlerts: false,
      lookbackMinutes: 30,
    };

    expect(LinkedInfrastructureContext.describeActivity(activity)).toBe(
      describeLinkedInfrastructure(activity, ENGLISH),
    );
  });

  test("a follow-up without a resource, or by the alert's prefix or without its number, says what the card says", () => {
    for (const context of [
      followUpOn([]),
      followUpOn([RESOURCES[0]!], { alertNumberWithPrefix: "ALT-12" }),
      followUpOn([RESOURCES[0]!], { alertNumber: undefined }),
      followUpOn([], { alertNumber: undefined }),
    ]) {
      const lines: { server: string; card: string } = followUpLines(context);

      expect(lines.server).toBe(lines.card);
    }
  });
});
