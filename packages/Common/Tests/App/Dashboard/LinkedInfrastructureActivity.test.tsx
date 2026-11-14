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
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

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

// The activity kind and the noun of an App Platforms environment, as written.
const SERVER_ENVIRONMENT_KIND: RegExp =
  /export const CLOUD_ENVIRONMENT_ACTIVITY_KIND: string = "([^"]*)";/;
const SERVER_ENVIRONMENT_NOUN: RegExp =
  /export const CLOUD_ENVIRONMENT_NOUN: string = "([^"]*)";/;

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

const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

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
      "Read 2 open or recent alerts on host web-1 and Docker host web-1",
    );
    expect(describeLinkedInfrastructure(activity({ alertCount: 1 }))).toBe(
      "Read 1 open or recent alert on host web-1 and Docker host web-1",
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
      "Read 2 open or recent alerts on host a, Docker host b and Kubernetes cluster c",
    );
    expect(
      describeLinkedInfrastructure(
        activity({ resources: [{ kind: "Host", name: "web-1" }] }),
      ),
    ).toBe("Read 2 open or recent alerts on host web-1");
  });

  test("none is said too: there was nothing on the infrastructure", () => {
    expect(describeLinkedInfrastructure(activity({ alertCount: 0 }))).toBe(
      "No open or recent alerts on host web-1 and Docker host web-1",
    );
  });

  test("more alerts than were read: the newest were", () => {
    expect(
      describeLinkedInfrastructure(
        activity({ alertCount: 10, hasMoreAlerts: true }),
      ),
    ).toBe(
      "Read the 10 newest open or recent alerts on host web-1 and Docker host web-1",
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
      "No open or recent alerts on Kubernetes cluster prod, Podman host build-1, database orders and 2 more",
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
    ).toBe("No open or recent alerts on cloud resource web-alb");
  });

  /*
   * An App Platforms environment is recorded as a kind of its own
   * (LinkedInfrastructureContext's CLOUD_ENVIRONMENT_ACTIVITY_KIND), and
   * named as the context names it: before #5519's follow-up the line said
   * "Cloud resource checkout · us-east-1" of a place apps run.
   */
  test("an App Platforms environment has the server's own noun", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../Server/Utils/AI/SRE/LinkedInfrastructureContext.ts",
      ),
      "utf8",
    );
    const kind: string | undefined = SERVER_ENVIRONMENT_KIND.exec(source)?.[1];
    const noun: string | undefined = SERVER_ENVIRONMENT_NOUN.exec(source)?.[1];

    expect(kind).toBe("CloudEnvironment");
    expect(noun).toBe("Cloud environment");
    expect(LINKED_RESOURCE_KIND_NOUNS[kind!]).toBe(noun);

    expect(
      describeLinkedInfrastructure(
        activity({
          alertCount: 0,
          resources: [
            { kind: "CloudEnvironment", name: "checkout · us-east-1" },
            { kind: "CloudResource", name: "orders-db" },
          ],
        }),
      ),
    ).toBe(
      "No open or recent alerts on cloud environment checkout · us-east-1 and cloud resource orders-db",
    );
    expect(
      describeFollowUpCheck(
        followUp({
          resourceKind: "CloudEnvironment",
          resourceName: "checkout · us-east-1",
        }),
      ),
    ).toBe(
      "Checking again: alert #12 opened on cloud environment checkout · us-east-1 after the first analysis",
    );
  });

  test.each(LANGUAGES)(
    "%s names an App Platforms environment its own way, apart from a cloud resource",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const environment: string = translator.translateText(
        "Cloud environment",
      ) as string;
      const resource: string = translator.translateText(
        "Cloud resource",
      ) as string;

      expect(environment).not.toBe("Cloud environment");
      expect(environment).not.toBe(resource);

      const line: string = describeLinkedInfrastructure(
        activity({
          alertCount: 0,
          resources: [{ kind: "CloudEnvironment", name: "checkout" }],
        }),
        translator,
      );

      expect(line).toContain(environment);
      expect(line).not.toContain(resource);
      expect(
        describeFollowUpCheck(
          followUp({
            resourceKind: "CloudEnvironment",
            resourceName: "checkout",
          }),
          translator,
        ),
      ).toContain(environment);
    },
  );

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
    ).toBe("No open or recent alerts on resource enterprise and host");
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

  /*
   * The name of what a monitor watches is a noun of these sentences, and
   * five languages word it for the middle of one. A row or a chip that
   * draws the same key starts it with a capital (toLabelTerm, #7607); the
   * key itself, and so the sentence, keeps it lower-case.
   */
  test.each([
    ["es", "en clúster de Kubernetes prod y host de Docker web-1"],
    ["fr", "cluster Kubernetes prod et hôte Docker web-1"],
    ["it", "cluster Kubernetes prod e host Docker web-1"],
    ["pt", "cluster Kubernetes prod e host Docker web-1"],
    ["ru", "кластер Kubernetes prod"],
  ])(
    "%s names a cluster and a host mid-sentence in lower case: %s",
    (language: string, named: string) => {
      expect(
        describeLinkedInfrastructure(
          activity({
            alertCount: 0,
            resources: [
              { kind: "KubernetesCluster", name: "prod" },
              { kind: "DockerHost", name: "web-1" },
            ],
          }),
          translatorFor(language),
        ),
      ).toContain(named);
    },
  );

  /*
   * A kind is a noun in the middle of these sentences, so every kind reads
   * as one, the reader's way (#7862): "sur hôte web-1 et hôte Docker web-2",
   * never a label's "sur Hôte web-1" beside "hôte Docker web-2". German
   * keeps its nouns' capital.
   */
  test.each([
    ["en", "on host web-1 and Docker host web-2"],
    ["de", "auf Host web-1 und Docker-Host web-2"],
    ["fr", "sur hôte web-1 et hôte Docker web-2"],
    ["es", "en host web-1 y host de Docker web-2"],
    ["it", "su host web-1 e host Docker web-2"],
    ["pt", "em host web-1 e host Docker web-2"],
    ["nl", "op host web-1 en Docker-host web-2"],
    ["da", "på vært web-1 og Docker-vært web-2"],
    ["no", "på vert web-1 og Docker-vert web-2"],
    ["sv", "på värd web-1 och Docker-värd web-2"],
    ["ru", "хост web-1 и Docker-хост web-2"],
  ])(
    "%s names a host mid-sentence as it names a Docker host: %s",
    (language: string, named: string) => {
      expect(
        describeLinkedInfrastructure(
          activity({
            resources: [
              { kind: "Host", name: "web-1" },
              { kind: "DockerHost", name: "web-2" },
            ],
          }),
          translatorFor(language),
        ),
      ).toContain(named);
    },
  );

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
      "Read 2 open or recent alerts on host web-1 and Docker host web-1",
    );
    expect(describeFollowUpCheck(followUp(), halfway)).toBe(
      "Checking again: alert #12 opened on host web-1 after the first analysis",
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
      "Checking again: alert #12 opened on host web-1 after the first analysis",
    );
    expect(
      describeFollowUpCheck(followUp({ alertNumberWithPrefix: "ALT-12" })),
    ).toBe(
      "Checking again: alert ALT-12 opened on host web-1 after the first analysis",
    );
  });

  test("without a number, or without a resource, it still reads", () => {
    expect(describeFollowUpCheck(followUp({ alertNumber: undefined }))).toBe(
      "Checking again: an alert opened on host web-1 after the first analysis",
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

  // The kind it opened on, as the middle of a sentence says it (#7862).
  test.each([
    ["en", "opened on host web-1 after"],
    ["de", "auf Host web-1"],
    ["fr", "sur hôte web-1"],
    ["da", "på vært web-1"],
    ["sv", "på värd web-1"],
  ])(
    "%s names the resource's kind mid-sentence: %s",
    (language: string, named: string) => {
      expect(
        describeFollowUpCheck(followUp(), translatorFor(language)),
      ).toContain(named);
    },
  );

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
      "Checking again: alert #12 opened on host web-1 after the first analysis",
    );
    const linkedLine: HTMLElement = screen.getByText(
      "Read 2 open or recent alerts on host web-1 and Docker host web-1",
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
