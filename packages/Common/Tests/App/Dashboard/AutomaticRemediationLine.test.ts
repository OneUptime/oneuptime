import {
  AUTOMATIC_REMEDIATION_SENTENCES,
  AUTOMATIC_REMEDIATION_SETTINGS_LINKS,
  getAutomaticRemediationLine,
  getAutomaticRemediationSentence,
  isAnyAutomaticRemediationOff,
  readAutomaticRemediation,
  shouldShowAutomaticRemediationLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AutomaticRemediationLine";
import * as ClusterStatus from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import { getResourceAutomaticRemediation } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The project's "Fix new incidents automatically" and "Fix new alerts
 * automatically" in one line, under the fixes of every AI agent page - a
 * Kubernetes cluster's and every resource's, a cloud account's included -
 * and in the cloud account's Let AI fix problems dialog when one is off. A
 * resource set to fix things fixes nothing new while both are off, which
 * they are by default: without the line, choosing "Fix safe problems on
 * its own" and seeing nothing happen read as AI not working.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

function resourceStatus(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceId: "30000000-0000-4000-8000-000000000001",
    resourceName: "Production",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: null,
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

describe("the automatic fixing line", () => {
  /*
   * One whole sentence for each pair of switches, in the words the
   * switches use ("Fix new incidents automatically"), so a locale words
   * each one its own way - never "Off · alerts: On" pieced together.
   */
  test("says in one sentence which of new incidents and alerts the project fixes automatically", () => {
    expect(AUTOMATIC_REMEDIATION_SENTENCES).toEqual({
      both: "This project fixes new incidents and alerts automatically.",
      incidentsOnly:
        "This project fixes new incidents automatically, but not new alerts.",
      alertsOnly:
        "This project fixes new alerts automatically, but not new incidents.",
      neither:
        "This project doesn't fix new incidents or alerts automatically.",
    });
    expect(
      getAutomaticRemediationLine({ incidents: false, alerts: false }),
    ).toBe("This project doesn't fix new incidents or alerts automatically.");
    expect(
      getAutomaticRemediationLine({ incidents: true, alerts: false }),
    ).toBe(
      "This project fixes new incidents automatically, but not new alerts.",
    );
    expect(
      getAutomaticRemediationLine({ incidents: false, alerts: true }),
    ).toBe(
      "This project fixes new alerts automatically, but not new incidents.",
    );
    expect(getAutomaticRemediationLine({ incidents: true, alerts: true })).toBe(
      "This project fixes new incidents and alerts automatically.",
    );
  });

  test("each pair of switches has its own sentence: four, none repeated", () => {
    const sentences: Array<string> = [
      getAutomaticRemediationSentence({ incidents: true, alerts: true }),
      getAutomaticRemediationSentence({ incidents: true, alerts: false }),
      getAutomaticRemediationSentence({ incidents: false, alerts: true }),
      getAutomaticRemediationSentence({ incidents: false, alerts: false }),
    ];

    expect(new Set(sentences).size).toBe(4);
    expect([...sentences].sort()).toEqual(
      Object.values(AUTOMATIC_REMEDIATION_SENTENCES).sort(),
    );
    // Whole sentences: nothing is filled in after translation.
    for (const sentence of sentences) {
      expect(sentence).not.toContain("{{");
      expect(sentence.endsWith(".")).toBe(true);
    }
  });

  test("links each switch that is off with a Turn on that says which", () => {
    expect(AUTOMATIC_REMEDIATION_SETTINGS_LINKS).toEqual({
      incidents: "Turn on for incidents",
      alerts: "Turn on for alerts",
    });
    expect(
      isAnyAutomaticRemediationOff({ incidents: true, alerts: true }),
    ).toBe(false);
    expect(
      isAnyAutomaticRemediationOff({ incidents: false, alerts: true }),
    ).toBe(true);
    expect(
      isAnyAutomaticRemediationOff({ incidents: true, alerts: false }),
    ).toBe(true);
  });

  test("reads only two booleans: anything else draws no line rather than a guess", () => {
    expect(
      readAutomaticRemediation({ incidents: false, alerts: true }),
    ).toEqual({ incidents: false, alerts: true });

    for (const value of [
      undefined,
      null,
      "on",
      [],
      {},
      { incidents: true },
      { alerts: false },
      { incidents: "true", alerts: false },
      { incidents: 1, alerts: 0 },
    ]) {
      expect(readAutomaticRemediation(value)).toBeNull();
    }

    // Only the two switches come through.
    expect(
      readAutomaticRemediation({ incidents: true, alerts: true, extra: "x" }),
    ).toEqual({ incidents: true, alerts: true });
  });

  test("an AI agent page draws it only while the cluster's or resource's own fixes are on", () => {
    const settings: { incidents: boolean; alerts: boolean } = {
      incidents: false,
      alerts: false,
    };

    expect(
      shouldShowAutomaticRemediationLine({ settings, areFixesOn: true }),
    ).toBe(true);
    // Fixes off: the project's switches change nothing there yet.
    expect(
      shouldShowAutomaticRemediationLine({ settings, areFixesOn: false }),
    ).toBe(false);
    // Nothing readable: no line rather than a guess.
    expect(
      shouldShowAutomaticRemediationLine({
        settings: null,
        areFixesOn: true,
      }),
    ).toBe(false);
  });

  test("a resource's status carries it, a cloud account's included", () => {
    expect(
      getResourceAutomaticRemediation(
        resourceStatus({
          automaticRemediation: { incidents: false, alerts: false },
        }),
      ),
    ).toEqual({ incidents: false, alerts: false });
    expect(getResourceAutomaticRemediation(resourceStatus())).toBeNull();
  });

  test("the cluster's page and every resource's draw the same line, from one module", () => {
    // The cluster module hands on the shared one, so the words cannot drift.
    expect(ClusterStatus.AUTOMATIC_REMEDIATION_SENTENCES).toBe(
      AUTOMATIC_REMEDIATION_SENTENCES,
    );
    expect(ClusterStatus.AUTOMATIC_REMEDIATION_SETTINGS_LINKS).toBe(
      AUTOMATIC_REMEDIATION_SETTINGS_LINKS,
    );
    expect(ClusterStatus.getAutomaticRemediationLine).toBe(
      getAutomaticRemediationLine,
    );

    const resourcePage: string = read(
      "Components/ResourceAiAgent/ResourceAiAgentPage.tsx",
    );
    const clusterPage: string = read("Pages/Kubernetes/View/AI/Agent.tsx");

    const note: string = read(
      "Components/AiAccess/AutomaticRemediationNote.tsx",
    );

    // One component draws the sentence and its links for every page.
    for (const page of [resourcePage, clusterPage]) {
      expect(page).toContain("<AutomaticRemediationNote");
      expect(page).toContain('dataTestId="ai-access-automatic-remediation"');
      expect(page).toContain("shouldShowAutomaticRemediationLine({");
      expect(page).not.toContain("AUTOMATIC_REMEDIATION_SETTINGS_LINKS.");
    }
    expect(note).toContain("incidents: PageMap.INCIDENTS_SETTINGS_AI");
    expect(note).toContain("alerts: PageMap.ALERTS_SETTINGS_AI");
    expect(note).toContain("AUTOMATIC_REMEDIATION_SETTINGS_LINKS[kind]");
    expect(note).toContain("getAutomaticRemediationSentence(props.settings)");
  });

  test("the cloud account's setup dialog says it under its question when a switch is off", () => {
    const dialog: string = read("Components/Cloud/CloudAiAgentSetupModal.tsx");

    expect(dialog).toContain("getResourceAutomaticRemediation(status)");
    expect(dialog).toContain(
      "isAnyAutomaticRemediationOff(automaticRemediation)",
    );
    expect(dialog).toContain("<AutomaticRemediationNote");
    expect(dialog).toContain(
      "dataTestId={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-automatic-remediation`}",
    );
  });
});
