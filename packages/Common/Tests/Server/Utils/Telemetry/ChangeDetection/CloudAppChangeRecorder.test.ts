import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import CloudResourceFeedService from "../../../../../Server/Services/CloudResourceFeedService";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import logger from "../../../../../Server/Utils/Logger";
import CloudAppChangeRecorder from "../../../../../Server/Utils/Telemetry/ChangeDetection/CloudAppChangeRecorder";
import {
  CloudAppChangeSubject,
  CloudAppRevisionChange,
  CloudAppRevisionChangeKind,
} from "../../../../../Server/Utils/Telemetry/ChangeDetection/CloudAppChangeEntries";
import TelemetryFanInWriter from "../../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { CloudResourceFeedEventType } from "../../../../../Models/DatabaseModels/CloudResourceFeed";
import { Amber500, Indigo500 } from "../../../../../Types/BrandColors";
import URL from "../../../../../Types/API/URL";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { ChangeEventType } from "../../../../../Utils/Telemetry/ChangeEventFields";

/*
 * CloudAppChangeRecorder writes an App Platforms deploy or rollback twice:
 * as a change event (once, whichever worker found it - the dedup token is
 * the change itself) and as a line in the environment's feed that links to
 * the app. It never fails the ingest that found the change.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);
const ENVIRONMENT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);
const APP_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000003");
const TIME: Date = new Date("2026-11-01T09:35:00.000Z");
const APP_LINK: string = `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/app-platforms/${ENVIRONMENT_ID.toString()}/apps/${APP_ID.toString()}`;

const SUBJECT: CloudAppChangeSubject = {
  appId: APP_ID,
  appName: "checkout-api",
  groupName: "production",
  environmentId: ENVIRONMENT_ID,
  cloudPlatform: "aws_ecs",
  cloudProvider: "aws",
  cloudAccountId: "123456789012",
  cloudRegion: "us-east-1",
};

const DEPLOY: CloudAppRevisionChange = {
  kind: CloudAppRevisionChangeKind.Deployed,
  revision: "43",
  previousRevision: "42",
  time: TIME,
};

interface Submission {
  target: unknown;
  rows: Array<JSONObject>;
  dedupToken: string | undefined;
}

let submissions: Array<Submission>;
let feedItem: SpyInstance<
  typeof CloudResourceFeedService.createCloudResourceFeedItem
>;
let warn: SpyInstance<typeof logger.warn>;

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  submissions = [];

  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    target: unknown,
    rows: Array<JSONObject>,
    options?: { dedupToken?: string | undefined },
  ) => {
    submissions.push({ target, rows, dedupToken: options?.dedupToken });
    return { flushed: Promise.resolve() };
  }) as never);

  feedItem = jest
    .spyOn(CloudResourceFeedService, "createCloudResourceFeedItem")
    .mockResolvedValue(undefined);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));

  warn = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a deploy", () => {
  test("is one change event, written once whoever found it", async () => {
    await CloudAppChangeRecorder.record({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      change: DEPLOY,
    });

    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.target).toBe(ChangeEventService);
    expect(submissions[0]!.dedupToken).toBe(
      `app-platform-change:${APP_ID.toString()}:deployed:42:43:${TIME.getTime()}`,
    );

    const [row] = submissions[0]!.rows as [JSONObject];
    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["eventType"]).toBe(ChangeEventType.Deployment);
    expect(row["title"]).toBe("Deployed production/checkout-api revision 43");
    const attributes: Dictionary<string> = row[
      "attributes"
    ] as Dictionary<string>;
    expect(attributes["oneuptime.resource.type"]).toBe("CloudResource");
    expect(attributes["oneuptime.resource.id"]).toBe(ENVIRONMENT_ID.toString());
    expect(attributes["oneuptime.app_platform.app_id"]).toBe(APP_ID.toString());
  });

  test("is a line in the environment's feed, at when it happened, linking to the app", async () => {
    await CloudAppChangeRecorder.record({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      change: DEPLOY,
    });

    expect(feedItem).toHaveBeenCalledTimes(1);
    expect(feedItem).toHaveBeenCalledWith({
      cloudResourceId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
      cloudResourceFeedEventType: CloudResourceFeedEventType.AppDeployed,
      displayColor: Indigo500,
      feedInfoInMarkdown: `🚀 Deployed [production/checkout-api](${APP_LINK}): revision **43** replaced **42**.`,
      postedAt: TIME,
    });
  });
});

describe("a rollback", () => {
  test("is a Rollback change event and an amber feed line", async () => {
    await CloudAppChangeRecorder.record({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      change: {
        kind: CloudAppRevisionChangeKind.RolledBack,
        revision: "42",
        previousRevision: "43",
        time: TIME,
      },
    });

    expect(submissions[0]!.rows[0]!["eventType"]).toBe(
      ChangeEventType.Rollback,
    );
    expect(submissions[0]!.dedupToken).toBe(
      `app-platform-change:${APP_ID.toString()}:rolled-back:43:42:${TIME.getTime()}`,
    );
    expect(feedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudResourceFeedEventType: CloudResourceFeedEventType.AppRolledBack,
        displayColor: Amber500,
        feedInfoInMarkdown: `↩️ Rolled back [production/checkout-api](${APP_LINK}) to revision **42**: revision **43** stopped reporting.`,
      }),
    );
  });
});

describe("recordChange", () => {
  test("starts the writes and returns at once", async () => {
    CloudAppChangeRecorder.recordChange({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      change: DEPLOY,
    });

    await settle();

    expect(submissions).toHaveLength(1);
    expect(feedItem).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a write that fails is logged, never thrown into the ingest", async () => {
    feedItem.mockRejectedValue(new Error("Postgres said no"));

    expect(() => {
      CloudAppChangeRecorder.recordChange({
        projectId: PROJECT_ID,
        subject: SUBJECT,
        change: DEPLOY,
      });
    }).not.toThrow();

    await settle();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      `Could not record the deploy of app ${APP_ID.toString()} to revision 43: Postgres said no`,
    );
  });
});

describe("getAppLink", () => {
  test("is the app's page in App Platforms, under its environment", async () => {
    await expect(
      CloudAppChangeRecorder.getAppLink({
        projectId: PROJECT_ID,
        environmentId: ENVIRONMENT_ID,
        appId: APP_ID,
      }),
    ).resolves.toBe(APP_LINK);
  });
});
