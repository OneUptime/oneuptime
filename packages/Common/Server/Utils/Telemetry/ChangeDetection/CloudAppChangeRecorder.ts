import { Amber500, Indigo500 } from "../../../../Types/BrandColors";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { CloudResourceFeedEventType } from "../../../../Models/DatabaseModels/CloudResourceFeed";
import DatabaseConfig from "../../../DatabaseConfig";
import ChangeEventService from "../../../Services/ChangeEventService";
import CloudResourceFeedService from "../../../Services/CloudResourceFeedService";
import logger from "../../Logger";
import {
  DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
  ParsedChangeEventEntry,
  buildChangeEventDbRow,
} from "../ChangeEventRow";
import TelemetryFanInWriter from "../TelemetryFanInWriter";
import {
  CloudAppChangeSubject,
  CloudAppRevisionChange,
  CloudAppRevisionChangeKind,
  buildCloudAppChangeEntry,
  buildCloudAppChangeFeedMarkdown,
} from "./CloudAppChangeEntries";

/*
 * Writes what CloudAppRevisionService decided - an App Platforms app was
 * deployed, or went back to an older revision - where people and OneUptime
 * AI look for what changed:
 *
 *   - a change event (Deployment or Rollback), which OneUptime AI reads as a
 *     linked change when it investigates an incident on the app's
 *     environment, and which charts draw as a marker;
 *   - a line in the environment's feed, linking to the app's page.
 *
 * Best effort: a change that cannot be written is logged, never thrown, so
 * the ingest that found it goes on (OtelIngestBaseService starts it and
 * moves on).
 */
export default class CloudAppChangeRecorder {
  public static recordChange(data: {
    projectId: ObjectID;
    subject: CloudAppChangeSubject;
    change: CloudAppRevisionChange;
  }): void {
    CloudAppChangeRecorder.record(data).catch((error: unknown) => {
      const what: string =
        data.change.kind === CloudAppRevisionChangeKind.RolledBack
          ? "rollback"
          : "deploy";

      logger.warn(
        `Could not record the ${what} of app ${data.subject.appId.toString()} to revision ${data.change.revision}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  // The change event and the feed line, both written. Awaitable for tests.
  public static async record(data: {
    projectId: ObjectID;
    subject: CloudAppChangeSubject;
    change: CloudAppRevisionChange;
  }): Promise<void> {
    await Promise.all([
      CloudAppChangeRecorder.writeChangeEvent(data),
      CloudAppChangeRecorder.writeFeedItem(data),
    ]);
  }

  // The app's page in App Platforms, as a feed line links it.
  public static async getAppLink(data: {
    projectId: ObjectID;
    environmentId: ObjectID;
    appId: ObjectID;
  }): Promise<string> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString())
      .addRoute(
        `/${data.projectId.toString()}/app-platforms/${data.environmentId.toString()}/apps/${data.appId.toString()}`,
      )
      .toString();
  }

  private static async writeChangeEvent(data: {
    projectId: ObjectID;
    subject: CloudAppChangeSubject;
    change: CloudAppRevisionChange;
  }): Promise<void> {
    const entry: ParsedChangeEventEntry = buildCloudAppChangeEntry({
      subject: data.subject,
      change: data.change,
    });

    /*
     * Project-wide, like a cloud account's changes: it names the app and its
     * environment in its attributes, and is read by them.
     */
    const row: JSONObject = buildChangeEventDbRow({
      parsed: entry,
      projectId: data.projectId,
      serviceMetadata: null,
      retentionDays: DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
    });

    const submission: { flushed: Promise<void> } =
      await TelemetryFanInWriter.submit(ChangeEventService, [row], {
        dedupToken: `app-platform-change:${data.subject.appId.toString()}:${data.change.kind}:${data.change.previousRevision}:${data.change.revision}:${data.change.time.getTime()}`,
      });

    await submission.flushed;
  }

  private static async writeFeedItem(data: {
    projectId: ObjectID;
    subject: CloudAppChangeSubject;
    change: CloudAppRevisionChange;
  }): Promise<void> {
    const appLink: string = await CloudAppChangeRecorder.getAppLink({
      projectId: data.projectId,
      environmentId: data.subject.environmentId,
      appId: data.subject.appId,
    });

    const isRollback: boolean =
      data.change.kind === CloudAppRevisionChangeKind.RolledBack;

    await CloudResourceFeedService.createCloudResourceFeedItem({
      cloudResourceId: data.subject.environmentId,
      projectId: data.projectId,
      cloudResourceFeedEventType: isRollback
        ? CloudResourceFeedEventType.AppRolledBack
        : CloudResourceFeedEventType.AppDeployed,
      displayColor: isRollback ? Amber500 : Indigo500,
      feedInfoInMarkdown: buildCloudAppChangeFeedMarkdown({
        subject: data.subject,
        change: data.change,
        appLink,
      }).toString(),
      postedAt: data.change.time,
    });
  }
}
