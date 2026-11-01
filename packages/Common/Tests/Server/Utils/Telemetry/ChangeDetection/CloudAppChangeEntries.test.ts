import { describe, expect, test } from "@jest/globals";
import {
  CloudAppChangeSubject,
  CloudAppRevisionChange,
  CloudAppRevisionChangeKind,
  buildCloudAppChangeEntry,
  buildCloudAppChangeFeedMarkdown,
  getCloudAppDisplayName,
} from "../../../../../Server/Utils/Telemetry/ChangeDetection/CloudAppChangeEntries";
import type { ParsedChangeEventEntry } from "../../../../../Server/Utils/Telemetry/ChangeEventRow";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventType,
  describeChangeEventSource,
  readChangeEventFields,
} from "../../../../../Utils/Telemetry/ChangeEventFields";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * What an App Platforms deploy or rollback says: a change event that names
 * the app and its environment (so OneUptime AI links it to an incident on
 * the environment, and the app's pages find their own), and a feed line
 * that links to the app.
 */

const APP_ID: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000001");
const ENVIRONMENT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000002",
);
const TIME: Date = new Date("2026-11-01T09:35:00.000Z");
const LINK: string =
  "https://oneuptime.example/dashboard/p/app-platforms/e/apps/a";

const SUBJECT: CloudAppChangeSubject = {
  appId: APP_ID,
  appName: "checkout-api",
  groupName: "production",
  environmentId: ENVIRONMENT_ID,
  cloudPlatform: "aws_ecs",
  cloudProvider: "aws",
  cloudAccountId: "123456789012",
  cloudRegion: "us-east-1",
  serviceVersion: "1.4.2",
};

const DEPLOY: CloudAppRevisionChange = {
  kind: CloudAppRevisionChangeKind.Deployed,
  revision: "43",
  previousRevision: "42",
  time: TIME,
};

const ROLLBACK: CloudAppRevisionChange = {
  kind: CloudAppRevisionChangeKind.RolledBack,
  revision: "42",
  previousRevision: "43",
  time: TIME,
};

describe("getCloudAppDisplayName", () => {
  test("names the app after its cluster or slot, when it has one", () => {
    expect(
      getCloudAppDisplayName({ appName: "checkout", groupName: "production" }),
    ).toBe("production/checkout");
    expect(getCloudAppDisplayName({ appName: "checkout" })).toBe("checkout");
    expect(
      getCloudAppDisplayName({ appName: "  checkout ", groupName: "  " }),
    ).toBe("checkout");
    expect(getCloudAppDisplayName({ appName: " " })).toBe("app");
  });
});

describe("a deploy's change event", () => {
  const entry: ParsedChangeEventEntry = buildCloudAppChangeEntry({
    subject: SUBJECT,
    change: DEPLOY,
  });

  test("is a Deployment at the time the new revision was first seen, saying what replaced what", () => {
    expect(entry.eventType).toBe(ChangeEventType.Deployment);
    expect(entry.time).toEqual(TIME);
    expect(entry.title).toBe("Deployed production/checkout-api revision 43");
    expect(entry.description).toBe(
      "production/checkout-api on AWS ECS / Fargate (us-east-1, account 123456789012) started running revision 43; it ran 42 before. OneUptime recorded this from the app's telemetry.",
    );
  });

  test("names the app and the environment it runs in", () => {
    expect(entry.attributes).toEqual({
      [ChangeEventAttribute.Source]: ChangeEventSource.AppPlatform,
      [ChangeEventAttribute.AppPlatformApp]: "production/checkout-api",
      [ChangeEventAttribute.AppPlatformAppId]: APP_ID.toString(),
      [ChangeEventAttribute.AppPlatformRevision]: "43",
      [ChangeEventAttribute.PreviousRevision]: "42",
      // How an incident linked to the environment finds it (AI linked changes).
      [ChangeEventAttribute.ResourceType]: "CloudResource",
      [ChangeEventAttribute.ResourceId]: ENVIRONMENT_ID.toString(),
      [ChangeEventAttribute.CloudPlatform]: "aws_ecs",
      [ChangeEventAttribute.CloudProvider]: "aws",
      [ChangeEventAttribute.CloudAccountId]: "123456789012",
      [ChangeEventAttribute.CloudRegion]: "us-east-1",
      [ChangeEventAttribute.ServiceVersion]: "1.4.2",
    });
  });

  test("reads back as fields, and says where it came from", () => {
    expect(readChangeEventFields(entry.attributes)).toEqual(
      expect.objectContaining({
        source: ChangeEventSource.AppPlatform,
        appPlatformApp: "production/checkout-api",
        appPlatformAppId: APP_ID.toString(),
        appPlatformRevision: "43",
        previousRevision: "42",
        cloudPlatform: "aws_ecs",
      }),
    );
    expect(describeChangeEventSource(ChangeEventSource.AppPlatform)).toBe(
      "a new revision on an app platform",
    );
  });

  test("leaves out what the environment does not know, and a version that names none", () => {
    const bare: ParsedChangeEventEntry = buildCloudAppChangeEntry({
      subject: {
        appId: APP_ID,
        appName: "api",
        environmentId: ENVIRONMENT_ID,
        cloudPlatform: "gcp_cloud_run",
        serviceVersion: "latest",
      },
      change: DEPLOY,
    });

    expect(bare.title).toBe("Deployed api revision 43");
    expect(bare.description).toBe(
      "api on Google Cloud Run started running revision 43; it ran 42 before. OneUptime recorded this from the app's telemetry.",
    );
    expect(bare.attributes[ChangeEventAttribute.CloudRegion]).toBeUndefined();
    expect(
      bare.attributes[ChangeEventAttribute.CloudAccountId],
    ).toBeUndefined();
    expect(
      bare.attributes[ChangeEventAttribute.ServiceVersion],
    ).toBeUndefined();
  });

  test("a platform it does not know is named by its provider, or as it was sent", () => {
    expect(
      buildCloudAppChangeEntry({
        subject: {
          appId: APP_ID,
          appName: "api",
          environmentId: ENVIRONMENT_ID,
          cloudPlatform: "acme_paas",
          cloudRegion: "eu-1",
        },
        change: DEPLOY,
      }).description,
    ).toMatch(/^api on acme_paas \(eu-1\) started running/);
    expect(
      buildCloudAppChangeEntry({
        subject: {
          appId: APP_ID,
          appName: "api",
          environmentId: ENVIRONMENT_ID,
        },
        change: DEPLOY,
      }).description,
    ).toMatch(/^api started running revision 43/);
  });
});

describe("a rollback's change event", () => {
  test("is a Rollback that says which revision stopped and which kept running", () => {
    const entry: ParsedChangeEventEntry = buildCloudAppChangeEntry({
      subject: SUBJECT,
      change: ROLLBACK,
    });

    expect(entry.eventType).toBe(ChangeEventType.Rollback);
    expect(entry.title).toBe(
      "Rolled back production/checkout-api to revision 42",
    );
    expect(entry.description).toBe(
      "production/checkout-api on AWS ECS / Fargate (us-east-1, account 123456789012) went back to revision 42: revision 43 stopped reporting while 42 kept running. OneUptime recorded this from the app's telemetry.",
    );
    expect(entry.attributes[ChangeEventAttribute.AppPlatformRevision]).toBe(
      "42",
    );
    expect(entry.attributes[ChangeEventAttribute.PreviousRevision]).toBe("43");
  });
});

describe("the feed line", () => {
  test("a deploy links the app and says what replaced what", () => {
    expect(
      buildCloudAppChangeFeedMarkdown({
        subject: SUBJECT,
        change: DEPLOY,
        appLink: LINK,
      }).toString(),
    ).toBe(
      `🚀 Deployed [production/checkout-api](${LINK}): revision **43** replaced **42**.`,
    );
  });

  test("a rollback links the app and says which revision stopped", () => {
    expect(
      buildCloudAppChangeFeedMarkdown({
        subject: SUBJECT,
        change: ROLLBACK,
        appLink: LINK,
      }).toString(),
    ).toBe(
      `↩️ Rolled back [production/checkout-api](${LINK}) to revision **42**: revision **43** stopped reporting.`,
    );
  });

  /*
   * Cloud Run and Container Apps name a revision after its service: the
   * line names the app already, so it says the revision as the app's page
   * does ("00042-xyz"), and the change event's attributes keep it whole.
   */
  test("a revision named after its service is said without the service's name, and kept whole in the attributes", () => {
    const cloudRun: CloudAppChangeSubject = {
      ...SUBJECT,
      appName: "api",
      groupName: null,
      cloudPlatform: "gcp_cloud_run",
      cloudProvider: "gcp",
      cloudAccountId: "acme-prod",
      cloudRegion: "europe-west1",
    };
    const deploy: CloudAppRevisionChange = {
      ...DEPLOY,
      revision: "api-00042-xyz",
      previousRevision: "api-00041-abc",
    };

    expect(
      buildCloudAppChangeFeedMarkdown({
        subject: cloudRun,
        change: deploy,
        appLink: LINK,
      }).toString(),
    ).toBe(
      `🚀 Deployed [api](${LINK}): revision **00042-xyz** replaced **00041-abc**.`,
    );

    const entry: ParsedChangeEventEntry = buildCloudAppChangeEntry({
      subject: cloudRun,
      change: deploy,
    });
    expect(entry.title).toBe("Deployed api revision 00042-xyz");
    expect(entry.description).toContain(
      "started running revision 00042-xyz; it ran 00041-abc before.",
    );
    expect(entry.attributes[ChangeEventAttribute.AppPlatformRevision]).toBe(
      "api-00042-xyz",
    );
    expect(entry.attributes[ChangeEventAttribute.PreviousRevision]).toBe(
      "api-00041-abc",
    );

    // A Container Apps rollback: "reports--v11def" said as "v11def".
    const containerApps: CloudAppChangeSubject = {
      ...cloudRun,
      appName: "reports",
      cloudPlatform: "azure_container_apps",
    };
    const rollback: CloudAppRevisionChange = {
      ...ROLLBACK,
      revision: "reports--v11def",
      previousRevision: "reports--v12abc",
    };
    expect(
      buildCloudAppChangeFeedMarkdown({
        subject: containerApps,
        change: rollback,
        appLink: LINK,
      }).toString(),
    ).toBe(
      `↩️ Rolled back [reports](${LINK}) to revision **v11def**: revision **v12abc** stopped reporting.`,
    );
    expect(
      buildCloudAppChangeEntry({ subject: containerApps, change: rollback })
        .title,
    ).toBe("Rolled back reports to revision v11def");

    // A revision that is not named after its app is said as it is.
    expect(
      buildCloudAppChangeEntry({
        subject: cloudRun,
        change: { ...deploy, revision: "apix-7", previousRevision: "api" },
      }).title,
    ).toBe("Deployed api revision apix-7");
  });

  test("a name or revision written like markdown stays text", () => {
    const line: string = buildCloudAppChangeFeedMarkdown({
      subject: { ...SUBJECT, groupName: null, appName: "a*b](x)" },
      change: { ...DEPLOY, revision: "**43**" },
      appLink: LINK,
    }).toString();

    expect(line).not.toContain("[a*b](x)]");
    expect(line).not.toContain("****43****");
  });
});
