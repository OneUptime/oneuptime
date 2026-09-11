import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

const REPO_ROOT: string = nodePath.join(__dirname, "..", "..", "..");

function source(relativePath: string): string {
  return fs.readFileSync(nodePath.join(REPO_ROOT, relativePath), "utf8");
}

const componentSource: string = source(
  "App/FeatureSet/Dashboard/src/Components/SecurityEvents/ManagedSecurityEventConnections.tsx",
);
const pageSource: string = source(
  "App/FeatureSet/Dashboard/src/Pages/SecurityEvents/GoogleSecOpsConnections.tsx",
);
const workerIndexSource: string = source("App/FeatureSet/Workers/Index.ts");
const workerSource: string = source(
  "App/FeatureSet/Workers/Jobs/SecurityEvents/PollSecurityEventConnections.ts",
);
const baseApiSource: string = source("App/FeatureSet/BaseAPI/Index.ts");
const docsSource: string = source(
  "App/FeatureSet/Docs/Content/en/integrations/security-event-connectors.md",
);

const providers: Array<string> = [
  "AwsSecurityHub",
  "MicrosoftDefender",
  "Cloudflare",
  "CrowdStrikeFalcon",
  "GoogleSecurityCommandCenter",
  "Okta",
  "SplunkEnterpriseSecurity",
];

describe("managed security event connection wiring", () => {
  test("offers every supported provider in the creation form and documentation", () => {
    for (const provider of providers) {
      expect(componentSource).toContain(
        `SecurityEventConnectorType.${provider}`,
      );
    }

    for (const label of [
      "AWS Security Hub",
      "Microsoft Defender XDR and Sentinel",
      "Cloudflare",
      "CrowdStrike Falcon",
      "Google Security Command Center",
      "Okta",
      "Splunk Enterprise Security",
    ]) {
      expect(docsSource).toContain(label);
    }
  });

  test("keeps credentials write-only in edit flows and provides explicit rotation", () => {
    const credentialField: number = componentSource.indexOf(
      "field: { credentialJson: true }",
    );
    const enabledField: number = componentSource.indexOf(
      "field: { isEnabled: true }",
      credentialField,
    );

    expect(credentialField).toBeGreaterThan(-1);
    expect(enabledField).toBeGreaterThan(credentialField);
    expect(componentSource.slice(credentialField, enabledField)).toContain(
      "doNotShowWhenEditing: true",
    );
    expect(componentSource).toContain('title: "Update Credentials"');
    expect(componentSource).toContain(
      'data: { credentialJson: data["credentialJson"] }',
    );
    expect(docsSource).toContain("encrypted at rest and are write-only");
  });

  test("shows poll health and imports the managed table on the existing Connections page", () => {
    expect(componentSource).toContain('title: "Health"');
    expect(componentSource).toContain('title: "Last Polled"');
    expect(componentSource).toContain('title: "Last Successful Poll"');
    expect(componentSource).toContain('title: "Last Event Imported"');
    expect(componentSource).toContain('title: "Last Error"');
    expect(pageSource).toContain(
      'import ManagedSecurityEventConnections from "../../Components/SecurityEvents/ManagedSecurityEventConnections"',
    );
    expect(pageSource).toContain("<ManagedSecurityEventConnections />");
  });

  test("registers the API and minute worker", () => {
    expect(baseApiSource).toContain(
      "new BaseAPI<SecurityEventConnection, SecurityEventConnectionServiceType>",
    );
    expect(workerIndexSource).toContain(
      'import "./Jobs/SecurityEvents/PollSecurityEventConnections"',
    );
    expect(workerSource).toContain("EVERY_MINUTE");
    expect(workerSource).toContain(
      "SecurityEventConnectionPoller.pollAllDueConnections()",
    );
  });
});
