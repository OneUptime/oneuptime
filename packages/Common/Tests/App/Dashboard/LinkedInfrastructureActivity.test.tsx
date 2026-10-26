import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import ChatActivityFeed, {
  LINKED_RESOURCE_KIND_NOUNS,
  describeFollowUpCheck,
  describeLinkedInfrastructure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";

import { isFollowUpCheckRun } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import {
  AIRunEventResultSummary,
  FollowUpCheckActivity,
  LinkedInfrastructureActivity,
} from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import ObjectID from "../../../Types/ObjectID";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * WHAT AN INVESTIGATION READ ABOUT ITS INFRASTRUCTURE, IN ITS ACTIVITY
 * (issues #4786, #4787).
 *
 * The run records, before the model starts, which hosts, container hosts
 * and clusters its incident is linked to and how many open or recent alerts
 * were on them - and, for a follow-up check, the alert that made it check
 * again. The activity feed draws each as a line in the reader's language,
 * from the data, not from the English sentence the server stored.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

/*
 * The kinds the server records and the noun it gives each
 * (LinkedInfrastructureContext's LINKED_INFRASTRUCTURE_KINDS), read from
 * its source: the module itself loads the database services.
 */
const SERVER_KIND_ENTRY: RegExp =
  /type: LinkedAffectedResourceType\.(\w+),[^{}]*?noun: "([^"]*)"/g;

function serverKindNouns(): Array<{ kind: string; noun: string }> {
  const source: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../Server/Utils/AI/SRE/LinkedInfrastructureContext.ts",
    ),
    "utf8",
  );
  const start: number = source.indexOf(
    "export const LINKED_INFRASTRUCTURE_KINDS",
  );
  const block: string = source.slice(start, source.indexOf("];", start));

  return Array.from(block.matchAll(SERVER_KIND_ENTRY)).map(
    (match: RegExpMatchArray): { kind: string; noun: string } => {
      return { kind: match[1] || "", noun: match[2] || "" };
    },
  );
}

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

function activity(
  partial: Partial<LinkedInfrastructureActivity> = {},
): LinkedInfrastructureActivity {
  return {
    resources: [
      { kind: "Host", name: "web-1" },
      { kind: "DockerHost", name: "web-1" },
    ],
    alertCount: 2,
    openAlertCount: 1,
    hasMoreAlerts: false,
    lookbackMinutes: 30,
    ...partial,
  };
}

function followUp(
  partial: Partial<FollowUpCheckActivity> = {},
): FollowUpCheckActivity {
  return {
    alertNumber: 12,
    resourceKind: "Host",
    resourceName: "web-1",
    minutesAfterIncident: 2,
    ...partial,
  };
}

function progressLog(summary: AIRunEventResultSummary): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ProgressLog;
  event.resultSummary = summary;
  return event;
}

function toolCall(toolName: string): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ToolCallStarted;
  event.toolName = toolName;
  return event;
}

afterEach(() => {
  cleanup();
});

describe("describeLinkedInfrastructure", () => {
  test("how many open or recent alerts were on which resources, listed as a sentence lists them", () => {
    expect(describeLinkedInfrastructure(activity())).toBe(
      "Read 2 open or recent alerts on Host web-1 and Docker host web-1",
    );
    expect(describeLinkedInfrastructure(activity({ alertCount: 1 }))).toBe(
      "Read 1 open or recent alert on Host web-1 and Docker host web-1",
    );
    expect(
      describeLinkedInfrastructure(
        activity({
          resources: [
            { kind: "Host", name: "a" },
            { kind: "DockerHost", name: "b" },
            { kind: "KubernetesCluster", name: "c" },
          ],
        }),
      ),
    ).toBe(
      "Read 2 open or recent alerts on Host a, Docker host b and Kubernetes cluster c",
    );
    expect(
      describeLinkedInfrastructure(
        activity({ resources: [{ kind: "Host", name: "web-1" }] }),
      ),
    ).toBe("Read 2 open or recent alerts on Host web-1");
  });

  test("none is said too: there was nothing on the infrastructure", () => {
    expect(describeLinkedInfrastructure(activity({ alertCount: 0 }))).toBe(
      "No open or recent alerts on Host web-1 and Docker host web-1",
    );
  });

  test("more alerts than were read: the newest were", () => {
    expect(
      describeLinkedInfrastructure(
        activity({ alertCount: 10, hasMoreAlerts: true }),
      ),
    ).toBe(
      "Read the 10 newest open or recent alerts on Host web-1 and Docker host web-1",
    );
  });

  test("three resources by name, then how many more", () => {
    expect(
      describeLinkedInfrastructure(
        activity({
          alertCount: 0,
          resources: [
            { kind: "KubernetesCluster", name: "prod" },
            { kind: "PodmanHost", name: "build-1" },
            { kind: "DatabaseServer", name: "orders" },
            { kind: "Service", name: "checkout-api" },
            { kind: "StorageArray", name: "san-1" },
          ],
        }),
      ),
    ).toBe(
      "No open or recent alerts on Kubernetes cluster prod, Podman host build-1, Database orders and 2 more",
    );
  });

  /*
   * Every kind the server writes into an investigation's activity has its
   * own noun here, the server's own: a cloud resource linked to an
   * incident read "Resource web-alb" before the card knew the kind.
   */
  test("every kind the server names has its own noun, the server's", () => {
    const kinds: Array<{ kind: string; noun: string }> = serverKindNouns();

    expect(kinds.length).toBeGreaterThanOrEqual(13);
    expect(kinds).toContainEqual({
      kind: "CloudResource",
      noun: "Cloud resource",
    });
    for (const entry of kinds) {
      expect({
        kind: entry.kind,
        noun: LINKED_RESOURCE_KIND_NOUNS[entry.kind],
      }).toEqual(entry);
    }

    expect(
      describeLinkedInfrastructure(
        activity({
          alertCount: 0,
          resources: [{ kind: "CloudResource", name: "web-alb" }],
        }),
      ),
    ).toBe("No open or recent alerts on Cloud resource web-alb");
  });

  test("a cloud resource is named in the reader's language", () => {
    for (const language of LANGUAGES) {
      const translator: Translator = translatorFor(language);
      const noun: string = translator.translateText("Cloud resource") as string;

      expect({ language, translated: noun !== "Cloud resource" }).toEqual({
        language,
        translated: true,
      });
      expect(
        describeLinkedInfrastructure(
          activity({
            alertCount: 0,
            resources: [{ kind: "CloudResource", name: "web-alb" }],
          }),
          translator,
        ),
      ).toContain(noun);
    }
  });

  test("a kind it does not know is a resource, and a resource without a name is its kind", () => {
    expect(
      describeLinkedInfrastructure(
        activity({
          alertCount: 0,
          resources: [
            { kind: "Spaceship", name: "enterprise" },
            { kind: "Host", name: "" },
          ],
        }),
      ),
    ).toBe("No open or recent alerts on Resource enterprise and Host");
  });

  test("a language lists the names its own way: its 'and', and its own comma", () => {
    expect(describeLinkedInfrastructure(activity(), translatorFor("de"))).toBe(
      "2 offene oder neue Warnungen auf Host web-1 und Docker-Host web-1 gelesen",
    );

    const many: LinkedInfrastructureActivity = activity({
      alertCount: 0,
      resources: [
        { kind: "Host", name: "a" },
        { kind: "DockerHost", name: "b" },
        { kind: "KubernetesCluster", name: "c" },
        { kind: "Service", name: "d" },
      ],
    });

    // Japanese lists with 、, Persian with ، - never an English comma.
    expect(describeLinkedInfrastructure(many, translatorFor("ja"))).toContain(
      "ホスト a、Docker ホスト b、Kubernetes クラスター c",
    );
    expect(
      describeLinkedInfrastructure(many, translatorFor("fa")),
    ).not.toContain(", ");
  });

  test("a sentence a language has not worded yet is English through and through, names included", () => {
    const halfway: Translator = createTranslator(
      (text: string): string | undefined => {
        return (
          {
            "Docker host": "Docker-Host",
            "{{first}} and {{second}}": "{{first}} und {{second}}",
          } as Record<string, string>
        )[text];
      },
      "de",
    );

    expect(describeLinkedInfrastructure(activity(), halfway)).toBe(
      "Read 2 open or recent alerts on Host web-1 and Docker host web-1",
    );
    expect(describeFollowUpCheck(followUp(), halfway)).toBe(
      "Checking again: alert #12 opened on Host web-1 after the first analysis",
    );
  });

  test.each(LANGUAGES)(
    "%s words every line its own way, with every value in it",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      for (const item of [
        activity(),
        activity({ alertCount: 1 }),
        activity({ alertCount: 0 }),
        activity({ alertCount: 10, hasMoreAlerts: true }),
      ]) {
        const line: string = describeLinkedInfrastructure(item, translator);

        expect(line).not.toBe(describeLinkedInfrastructure(item));
        expect(line).not.toContain("{{");
        expect(line).toContain("web-1");

        if (item.alertCount > 0) {
          // In the reader's digits (Persian has its own).
          expect(line).toContain(translator.formatNumber(item.alertCount));
        }
      }
    },
  );
});

describe("describeFollowUpCheck", () => {
  test("the alert's number and the resource it opened on", () => {
    expect(describeFollowUpCheck(followUp())).toBe(
      "Checking again: alert #12 opened on Host web-1 after the first analysis",
    );
    expect(
      describeFollowUpCheck(followUp({ alertNumberWithPrefix: "ALT-12" })),
    ).toBe(
      "Checking again: alert ALT-12 opened on Host web-1 after the first analysis",
    );
  });

  test("without a number, or without a resource, it still reads", () => {
    expect(describeFollowUpCheck(followUp({ alertNumber: undefined }))).toBe(
      "Checking again: an alert opened on Host web-1 after the first analysis",
    );
    expect(describeFollowUpCheck(followUp({ resourceKind: "" }))).toBe(
      "Checking again: alert #12 opened on this incident's infrastructure after the first analysis",
    );
    expect(
      describeFollowUpCheck(
        followUp({ resourceKind: "", alertNumber: undefined }),
      ),
    ).toBe(
      "Checking again: an alert opened on this incident's infrastructure after the first analysis",
    );
  });

  test.each(LANGUAGES)("%s words it its own way", (language: string) => {
    const translator: Translator = translatorFor(language);

    for (const item of [
      followUp(),
      followUp({ alertNumber: undefined }),
      followUp({ resourceKind: "" }),
      followUp({ resourceKind: "", alertNumber: undefined }),
    ]) {
      const line: string = describeFollowUpCheck(item, translator);

      expect(line).not.toBe(describeFollowUpCheck(item));
      expect(line).not.toContain("{{");
    }

    expect(describeFollowUpCheck(followUp(), translator)).toContain("#12");
    expect(describeFollowUpCheck(followUp(), translator)).toContain("web-1");
  });
});

describe("the activity feed draws them", () => {
  test("from the data, as quiet log lines, the follow-up first", () => {
    render(
      <ChatActivityFeed
        events={[
          progressLog({
            message: "the English the server stored",
            severity: "Info",
            followUpCheck: followUp(),
          }),
          progressLog({
            message: "the English the server stored, too",
            severity: "Info",
            linkedInfrastructure: activity(),
          }),
        ]}
        hideChrome={true}
      />,
    );

    const followUpLine: HTMLElement = screen.getByText(
      "Checking again: alert #12 opened on Host web-1 after the first analysis",
    );
    const linkedLine: HTMLElement = screen.getByText(
      "Read 2 open or recent alerts on Host web-1 and Docker host web-1",
    );

    expect(followUpLine).toBeVisible();
    expect(linkedLine).toBeVisible();
    expect(followUpLine).toHaveClass("text-gray-500");
    expect(
      followUpLine.compareDocumentPosition(linkedLine) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("the English the server stored")).toBeNull();
  });

  test("the container and resource tools read as what they do", () => {
    const { container } = render(
      <ChatActivityFeed
        events={[
          toolCall("query_containers"),
          toolCall("query_resource_telemetry"),
        ]}
        hideChrome={true}
      />,
    );

    // A running step is its words and an ellipsis.
    expect(container.textContent).toContain("Checking the host's containers…");
    expect(container.textContent).toContain("Reading a resource's telemetry…");
    expect(container.textContent).not.toContain("Running query_containers");
  });

  /*
   * What every investigation reads besides telemetry used to show as
   * "Running search_incidents", "Running recent_changes": the tool's id.
   */
  test.each([
    ["search_incidents", "Searching past incidents"],
    ["recent_changes", "Checking recent changes"],
    ["get_incident_timeline", "Reading the incident timeline"],
    ["get_alert_timeline", "Reading the alert timeline"],
    ["baseline_anomaly", "Comparing a metric with its baseline"],
    ["query_telemetry_resources", "Listing infrastructure resources"],
  ])("%s reads as %s", (toolName: string, words: string) => {
    const { container } = render(
      <ChatActivityFeed events={[toolCall(toolName)]} hideChrome={true} />,
    );

    expect(container.textContent).toBe(`${words}…`);
  });

  test.each(LANGUAGES)(
    "%s words the new step names too",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      for (const words of [
        "Searching past incidents",
        "Checking recent changes",
        "Reading the incident timeline",
        "Reading the alert timeline",
        "Comparing a metric with its baseline",
        "Listing infrastructure resources",
        "OneUptime AI is checking again",
      ]) {
        expect(translator.translateText(words)).not.toBe(words);
      }
    },
  );
});

describe("a step that wraps", () => {
  test("its mark sits beside its first line, and its detail follows its words", () => {
    const completed: AIRunEvent = new AIRunEvent(ObjectID.generate());
    completed.eventType = AIRunEventType.ToolCallCompleted;
    completed.toolName = "query_containers";
    completed.resultSummary = { rowCount: 4, durationInMs: 600 };

    const { container } = render(
      <ChatActivityFeed
        events={[
          progressLog({ severity: "Info", linkedInfrastructure: activity() }),
          toolCall("query_containers"),
          completed,
        ]}
        hideChrome={true}
      />,
    );

    const marks: Array<Element> = Array.from(
      container.querySelectorAll("[data-testid='activity-step-mark']"),
    );
    const texts: Array<Element> = Array.from(
      container.querySelectorAll("[data-testid='activity-step-text']"),
    );

    expect(marks).toHaveLength(2);
    expect(texts).toHaveLength(2);

    for (const mark of marks) {
      // A first line's height, the mark centred in it, on a top-aligned row.
      expect(mark).toHaveClass("flex", "h-4", "flex-shrink-0", "items-center");
      expect(mark.parentElement).toHaveClass("items-start", "leading-4");
      expect(mark.parentElement).not.toHaveClass("items-center");
    }

    // The detail flows after the words, inside the same block of text.
    expect(texts[1]!.textContent).toBe(
      "Checking the host's containers · 4 rows · 0.6s",
    );
    expect(screen.getByText("· 4 rows · 0.6s").parentElement).toBe(texts[1]);
  });
});

describe("isFollowUpCheckRun", () => {
  test("a run whose activity says it checks again is a follow-up check; any other run is not", () => {
    expect(
      isFollowUpCheckRun([
        progressLog({ severity: "Info", followUpCheck: followUp() }),
        progressLog({ severity: "Info", linkedInfrastructure: activity() }),
      ]),
    ).toBe(true);
    expect(
      isFollowUpCheckRun([
        progressLog({ severity: "Info", linkedInfrastructure: activity() }),
        toolCall("query_alerts"),
      ]),
    ).toBe(false);
    expect(isFollowUpCheckRun([])).toBe(false);
  });
});
