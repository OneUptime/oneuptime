import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import ChatActivityFeed, {
  describeFollowUpCheck,
  describeLinkedInfrastructure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
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
  test("how many open or recent alerts were on which resources", () => {
    expect(describeLinkedInfrastructure(activity())).toBe(
      "Read 2 open or recent alerts on Host web-1, Docker host web-1",
    );
    expect(describeLinkedInfrastructure(activity({ alertCount: 1 }))).toBe(
      "Read 1 open or recent alert on Host web-1, Docker host web-1",
    );
  });

  test("none is said too: there was nothing on the infrastructure", () => {
    expect(describeLinkedInfrastructure(activity({ alertCount: 0 }))).toBe(
      "No open or recent alerts on Host web-1, Docker host web-1",
    );
  });

  test("more alerts than were read: the newest were", () => {
    expect(
      describeLinkedInfrastructure(
        activity({ alertCount: 10, hasMoreAlerts: true }),
      ),
    ).toBe(
      "Read the 10 newest open or recent alerts on Host web-1, Docker host web-1",
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
    ).toBe("No open or recent alerts on Resource enterprise, Host");
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
      "Read 2 open or recent alerts on Host web-1, Docker host web-1",
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
});
