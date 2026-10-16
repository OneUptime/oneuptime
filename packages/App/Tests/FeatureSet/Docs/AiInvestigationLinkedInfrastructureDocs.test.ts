import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { AI_SRE } from "./AiDocsPages";
import { readPage } from "./DocsContentSupport";
import { toLatinDigits } from "./DocsTranslationChecks";
import { LinkedAffectedResourceType } from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import IncidentFollowUpCheck, {
  FOLLOW_UP_WINDOW_MINUTES,
} from "Common/Server/Utils/AI/SRE/IncidentFollowUpCheck";
import LinkedInfrastructureContext, {
  LINKED_INFRASTRUCTURE_KINDS,
  RELATED_ALERTS_LOOKBACK_MINUTES,
} from "Common/Server/Utils/AI/SRE/LinkedInfrastructureContext";
import {
  CONTAINER_SORT_BY_VALUES,
  ContainerStatus,
} from "Common/Server/Utils/AI/Toolbox/ContainerActivity";
import {
  AttributeSplitMetric,
  getAttributeSplitMetric,
} from "Common/Types/Metrics/AttributeSplitMetrics";
import { describe, expect, test } from "@jest/globals";

/*
 * Issues #4784-#4787: the AI SRE page says what an investigation reads -
 * the alerts on the infrastructure its incident or alert is linked to, the
 * host metrics OpenTelemetry splits by state, a container host's containers
 * - and that an incident is checked again, once, when an alert opens on that
 * infrastructure after the investigation read it. The numbers and words it
 * names are the code's, and every language has the section in the English
 * one's place (AiDocsTranslations holds the rest of each translation to it).
 */

const HEADING: string = "## What an investigation reads";
const FOLLOW_UP_HEADING: string = "### Checked again when a new alert opens";
const NEXT_HEADING: string = "## Talk to OneUptime AI about the incident";

const ENGLISH: string = readPage("en", AI_SRE);
const ENGLISH_LINES: Array<string> = ENGLISH.split("\n");
const START: number = ENGLISH_LINES.indexOf(HEADING);
const END: number = ENGLISH_LINES.indexOf(NEXT_HEADING);

// The lines of the section, in a language, where the English page has them.
function sectionIn(language: string): string {
  return readPage(language, AI_SRE).split("\n").slice(START, END).join("\n");
}

const SECTION: string = sectionIn("en");
const FOLLOW_UP: string = SECTION.slice(SECTION.indexOf(FOLLOW_UP_HEADING));

const SPLIT_METRICS: Array<string> = [
  "system.cpu.utilization",
  "system.memory.utilization",
];

describe("the AI SRE page says what an investigation reads", () => {
  test("the section follows what the investigation posts and comes before the conversation", () => {
    expect(START).toBeGreaterThan(
      ENGLISH_LINES.indexOf("## What the investigation posts"),
    );
    expect(END).toBeGreaterThan(START);
    expect(SECTION).toContain(FOLLOW_UP_HEADING);
  });

  test("the alerts it reads are the ones the context lists: the lookback, newest first, no private ones", () => {
    expect(RELATED_ALERTS_LOOKBACK_MINUTES).toBe(30);
    expect(SECTION).toContain(
      `The alerts on that infrastructure that opened in the ${RELATED_ALERTS_LOOKBACK_MINUTES} minutes before the incident, or are still open, newest first`,
    );
    expect(SECTION).toContain("Private alerts are left out.");
  });

  test("the infrastructure it names is what the context counts as linked infrastructure", () => {
    expect(SECTION).toContain(
      "the hosts, Docker and Podman hosts, Kubernetes clusters, databases and services its monitors watch",
    );

    const kinds: Array<LinkedAffectedResourceType> =
      LINKED_INFRASTRUCTURE_KINDS.map(
        (kind: { type: LinkedAffectedResourceType }) => {
          return kind.type;
        },
      );

    for (const type of [
      LinkedAffectedResourceType.Host,
      LinkedAffectedResourceType.DockerHost,
      LinkedAffectedResourceType.PodmanHost,
      LinkedAffectedResourceType.KubernetesCluster,
      LinkedAffectedResourceType.DatabaseServer,
      LinkedAffectedResourceType.Service,
    ]) {
      expect(kinds).toContain(type);
    }
  });

  test("the activity line it describes says how many alerts were read, and on which resources", () => {
    expect(SECTION).toContain(
      "says how many open or recent alerts it read, and on which resources",
    );
    expect(
      LinkedInfrastructureContext.describeActivity({
        resources: [{ kind: LinkedAffectedResourceType.Host, name: "web-1" }],
        alertCount: 2,
        openAlertCount: 1,
        hasMoreAlerts: false,
        lookbackMinutes: RELATED_ALERTS_LOOKBACK_MINUTES,
      }),
    ).toBe("Read 2 open or recent alerts on Host web-1");
  });

  test("the host metrics it names are read one state at a time, and busy CPU is user plus system", () => {
    for (const metricName of SPLIT_METRICS) {
      const split: AttributeSplitMetric | undefined =
        getAttributeSplitMetric(metricName);

      expect(split?.splitBy).toContain("state");
      expect(split?.meaning).toContain("add up to 1");
      expect(SECTION).toContain(`\`${metricName}\``);
    }

    expect(
      getAttributeSplitMetric("system.cpu.utilization")?.meaning,
    ).toContain("Busy CPU is user + system");
    expect(SECTION).toContain("the states add up to 100%");
    expect(SECTION).toContain("busy CPU is user plus system");
  });

  test("the containers it reads are ranked by CPU, memory or restarts, and the stopped ones are named", () => {
    expect([...CONTAINER_SORT_BY_VALUES]).toEqual([
      "cpu",
      "memory",
      "restarts",
    ]);
    expect(ContainerStatus.StoppedReporting).toBe("stopped reporting");
    expect(SECTION).toContain(
      "the busiest by CPU, memory or restarts, and the ones that stopped reporting",
    );
  });
});

describe("the AI SRE page says when an incident is checked again", () => {
  test("the window is the follow-up check's", () => {
    expect(FOLLOW_UP_WINDOW_MINUTES).toBe(30);
    expect(FOLLOW_UP).toContain(
      `within ${FOLLOW_UP_WINDOW_MINUTES} minutes of the incident, after the investigation read it, and the incident is still open`,
    );
    expect(FOLLOW_UP).toContain("This happens at most once per incident");
  });

  test("the lead it quotes is the one the server writes", () => {
    const incidentCreatedAt: Date = new Date("2026-10-16T10:00:00.000Z");
    const lead: string = IncidentFollowUpCheck.buildReportLead({
      incidentCreatedAt,
      alertId: "alert-id",
      alertNumber: 12,
      alertTitle: "High CPU on web-1",
      alertOpenedAt: new Date(incidentCreatedAt.getTime() + 2 * 60 * 1000),
      resources: [
        { type: LinkedAffectedResourceType.Host, id: "host-id", name: "web-1" },
      ],
    }).toString();

    expect(lead.startsWith("**Checked again** after alert #12")).toBe(true);
    expect(lead).toContain("2 minutes after this incident was declared");
    expect(FOLLOW_UP).toContain(
      "The new analysis begins with **Checked again** and the alert that made it check",
    );
  });

  test("what a follow-up check never does is what the page says", () => {
    expect(FOLLOW_UP).toContain(
      "A follow-up check never runs auto-remediation again and is never followed up itself, and an alert's investigation is not checked again.",
    );
    expect(FOLLOW_UP).toContain("There is nothing to turn on.");
  });
});

describe("every language has the section in the English one's place", () => {
  test.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s keeps the server's words, the metric names and the 30 minutes",
    (language: string) => {
      const section: string = sectionIn(language);
      const lines: Array<string> = section.split("\n");

      expect(lines[0]?.startsWith("## ")).toBe(true);
      expect(
        lines.filter((line: string): boolean => {
          return line.startsWith("### ");
        }),
      ).toHaveLength(1);
      expect(section).toContain("**Checked again**");

      for (const metricName of SPLIT_METRICS) {
        expect(section).toContain(`\`${metricName}\``);
      }

      // The lookback and the follow-up window, in the language's digits.
      const numbers: Array<string> = toLatinDigits(section).match(/\d+/g) || [];

      expect(
        numbers.filter((number: string): boolean => {
          return number === "30";
        }),
      ).toHaveLength(2);
      expect(
        readPage(language, AI_SRE).split("\n")[END]?.startsWith("## "),
      ).toBe(true);
    },
  );
});
