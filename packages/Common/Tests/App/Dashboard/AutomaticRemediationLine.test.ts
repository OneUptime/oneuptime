import {
  AUTOMATIC_REMEDIATION_LINE,
  AUTOMATIC_REMEDIATION_SETTINGS_LINKS,
  getAutomaticRemediationLine,
  isAnyAutomaticRemediationOff,
  readAutomaticRemediation,
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
  test("names both switches, in the reader's words", () => {
    expect(AUTOMATIC_REMEDIATION_LINE).toBe(
      "Automatic fixes for new incidents in this project: {{incidents}} · alerts: {{alerts}}",
    );
    expect(
      getAutomaticRemediationLine({ incidents: false, alerts: false }),
    ).toBe(
      "Automatic fixes for new incidents in this project: Off · alerts: Off",
    );
    expect(
      getAutomaticRemediationLine({ incidents: true, alerts: false }),
    ).toBe(
      "Automatic fixes for new incidents in this project: On · alerts: Off",
    );
    expect(
      getAutomaticRemediationLine({ incidents: false, alerts: true }),
    ).toBe(
      "Automatic fixes for new incidents in this project: Off · alerts: On",
    );
    expect(getAutomaticRemediationLine({ incidents: true, alerts: true })).toBe(
      "Automatic fixes for new incidents in this project: On · alerts: On",
    );
  });

  test("links each switch's own AI settings page while it is off", () => {
    expect(AUTOMATIC_REMEDIATION_SETTINGS_LINKS).toEqual({
      incidents: "Incident AI settings",
      alerts: "Alert AI settings",
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
    expect(ClusterStatus.AUTOMATIC_REMEDIATION_LINE).toBe(
      AUTOMATIC_REMEDIATION_LINE,
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

    for (const page of [resourcePage, clusterPage]) {
      expect(page).toContain('data-testid="ai-access-automatic-remediation"');
      expect(page).toContain(
        "getAutomaticRemediationLine(automaticRemediation)",
      );
      expect(page).toContain("PageMap.INCIDENTS_SETTINGS_AI");
      expect(page).toContain("PageMap.ALERTS_SETTINGS_AI");
    }
  });

  test("the cloud account's setup dialog says it under its question when a switch is off", () => {
    const dialog: string = read("Components/Cloud/CloudAiAgentSetupModal.tsx");

    expect(dialog).toContain("getResourceAutomaticRemediation(status)");
    expect(dialog).toContain(
      "isAnyAutomaticRemediationOff(automaticRemediation)",
    );
    expect(dialog).toContain(
      "getAutomaticRemediationLine(automaticRemediation)",
    );
    expect(dialog).toContain(
      "data-testid={`${CLOUD_AI_AGENT_SETUP_TEST_ID}-automatic-remediation`}",
    );
  });
});
