import EncryptColumnInPlace, {
  ColumnToEncrypt,
  EncryptColumnPass,
} from "./EncryptColumnInPlace";
import EncryptGlobalConfigCredentials from "../DataMigrations/EncryptGlobalConfigCredentials";
import EncryptLetsEncryptKeys from "../DataMigrations/EncryptLetsEncryptKeys";
import EncryptProjectCallSMSConfigTwilioAuthToken from "../DataMigrations/EncryptProjectCallSMSConfigTwilioAuthToken";
import EncryptProjectCredentials from "../DataMigrations/EncryptProjectCredentials";
import EncryptSnmpCredentials from "../DataMigrations/EncryptSnmpCredentials";
import EncryptUploadedCertificateKeys from "../DataMigrations/EncryptUploadedCertificateKeys";
import EncryptWebhookAddresses from "../DataMigrations/EncryptWebhookAddresses";
import MaskWebhookAddressesInLogs from "../DataMigrations/MaskWebhookAddressesInLogs";
import DataMigration from "Common/Models/DatabaseModels/DataMigration";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import PresentedKeysAtRest, {
  SETTLE_PERIOD_MS,
  SqlRunner,
} from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";

// What the job is called, in its log lines and in each group's marker.
export const CREDENTIALS_AT_REST_JOB_NAME: string =
  "CredentialsAtRest:EncryptInPlace";

/*
 * Recorded in the DataMigrations table once a group's values are all
 * protected: "CredentialsAtRest:EncryptProjectCredentials".
 */
export function getProtectedMarkerName(migrationName: string): string {
  return `CredentialsAtRest:${migrationName}`;
}

// What one pass over a group came to.
export interface CredentialsGroupPass {
  // Nothing was left to do, every page was read and every row written.
  isDone: boolean;
  // Rows encrypted (or masked) by this pass.
  written: number;
}

/*
 * The values one data migration of the upgrade left as written, protected
 * in place a day after it ran.
 */
export interface CredentialsAtRestGroup {
  // The data migration recorded at the upgrade: when it ran starts the wait.
  migrationName: string;
  // What its values are, for the log: "a project's SMTP passwords, ...".
  description: string;
  /*
   * One pass over the group, once the wait is over: `startedAt` is when its
   * data migration ran.
   */
  pass: (data: {
    startedAt: Date;
    deadline?: JobDeadline | undefined;
  }) => Promise<CredentialsGroupPass>;
}

// Where a run stopped, for one group.
export enum CredentialsAtRestOutcome {
  // Protected already, and recorded so: nothing left to do, ever.
  AlreadyProtected = "already-protected",
  // Its data migration has not run yet: the upgrade has not happened.
  NotUpgradedYet = "not-upgraded-yet",
  // Within the day after the upgrade: a server of the release before may still be running.
  Waiting = "waiting",
  // Every value protected, and recorded so.
  Protected = "protected",
  // Some values protected; the rest wait for the next run.
  NotDoneYet = "not-done-yet",
}

export interface CredentialsAtRestRun {
  migrationName: string;
  outcome: CredentialsAtRestOutcome;
}

/*
 * THE CREDENTIALS THE UPGRADE LEFT AS WRITTEN, ENCRYPTED A DAY LATER (#9266).
 *
 * A project's mail, chat and webhook credentials, the webhook addresses,
 * the SNMP credentials, the certificate keys, the server's own credentials
 * and the Twilio tokens are each kept encrypted at rest now: DatabaseService
 * encrypts them on every write and decrypts them on every read, and hands
 * back a value stored before as it is. The values stored before are
 * encrypted in place - but not at the upgrade. A server of the release
 * before, still running while an upgrade rolls out (on Helm the migrate Job
 * runs the data migrations while the old pods serve; with migrate.hook, for
 * the whole of them), reads each column as it is stored: it would sign in
 * to the mail server, post to Slack or to a webhook, hand a probe its
 * community string, or write a certificate's key file, with a ciphertext.
 * A page sent so is lost - none is sent twice.
 *
 * So each of those data migrations runs at the upgrade and changes nothing,
 * and when it ran starts the wait. A day later - long past any rolling
 * upgrade, the day the keys presented to OneUptime wait too
 * (PresentedKeysAtRest.SETTLE_PERIOD_MS) - this encrypts each value still
 * stored as written, in place (EncryptColumnInPlace: paged, raw SQL, each
 * write held to the value read, idempotent, safe twice at once, no value in
 * a log line). That includes what a server of the release before saved
 * meanwhile, which the data migrations could not have reached. Once a pass
 * over a group finds nothing left, it records the group's marker
 * (getProtectedMarkerName), and does nothing for it again.
 *
 * An install that ran these data migrations when they still encrypted at
 * once - 15.0.0, builds of main, and from 14.1.0 and 14.0.56 the server's
 * credentials and the Twilio tokens - has its values encrypted already, and
 * the migrations recorded long ago: its pass comes at once, finds the
 * ciphertext and leaves it (a value, or a JSON field, that is our
 * ciphertext is never encrypted again), and encrypts only what an earlier
 * server saved as written.
 *
 * The webhook logs are masked at the upgrade (MaskWebhookAddressesInLogs),
 * which no server of the release before minds: it only shows them. What it
 * logs meanwhile is masked by a pass over the rows logged since.
 *
 * Bounded by the run's deadline: what is left waits for the next run.
 */
export default class CredentialsAtRest {
  // Each group, in the order its data migration runs.
  public static getGroups(): Array<CredentialsAtRestGroup> {
    return [
      CredentialsAtRest.columnsGroup({
        migrationName: new EncryptProjectCallSMSConfigTwilioAuthToken().name,
        description: "a project's Twilio auth tokens",
        getTargets: EncryptProjectCallSMSConfigTwilioAuthToken.getTargets,
      }),
      CredentialsAtRest.columnsGroup({
        migrationName: new EncryptGlobalConfigCredentials().name,
        description:
          "the server's own SMTP, Twilio, call and SMS gateway, WhatsApp, Telegram, SendGrid and license credentials",
        getTargets: EncryptGlobalConfigCredentials.getTargets,
      }),
      CredentialsAtRest.columnsGroup({
        migrationName: new EncryptUploadedCertificateKeys().name,
        description: "the private keys of uploaded certificates",
        getTargets: EncryptUploadedCertificateKeys.getTargets,
      }),
      CredentialsAtRest.columnsGroup({
        migrationName: new EncryptLetsEncryptKeys().name,
        description: "the private keys of Let's Encrypt certificates",
        getTargets: EncryptLetsEncryptKeys.getTargets,
      }),
      CredentialsAtRest.columnsGroup({
        migrationName: new EncryptProjectCredentials().name,
        description:
          "a project's SMTP passwords and client secrets, chat tokens, code repositories' webhook secrets and webhooks' signing secrets",
        getTargets: EncryptProjectCredentials.getTargets,
      }),
      CredentialsAtRest.columnsGroup({
        migrationName: new EncryptWebhookAddresses().name,
        description:
          "the webhook addresses of status page subscribers, notification methods, OpenStack notices and custom channels",
        getTargets: EncryptWebhookAddresses.getTargets,
      }),
      CredentialsAtRest.columnsGroup({
        migrationName: new EncryptSnmpCredentials().name,
        description:
          "the SNMP credentials of network devices and discovery scans",
        getTargets: EncryptSnmpCredentials.getTargets,
      }),
      {
        migrationName: new MaskWebhookAddressesInLogs().name,
        description: "the webhook addresses in the notification logs",
        pass: async (data: {
          startedAt: Date;
          deadline?: JobDeadline | undefined;
        }): Promise<CredentialsGroupPass> => {
          /*
           * What was logged since the day before the logs were masked: a
           * server of the release before went on logging addresses whole
           * while the upgrade rolled out, and the mask itself ran a while.
           */
          const isDone: boolean =
            await new MaskWebhookAddressesInLogs().maskLogs({
              since: new Date(data.startedAt.getTime() - SETTLE_PERIOD_MS),
              deadline: data.deadline,
            });

          return { isDone: isDone, written: 0 };
        },
      },
    ];
  }

  /*
   * A group of columns, each encrypted in place by a pass of
   * EncryptColumnInPlace. Done once a pass over every column finds nothing
   * left as written, and fails nowhere: the run that encrypts the values is
   * followed by one that finds none, as a row a write was held to may have
   * changed meanwhile.
   */
  public static columnsGroup(data: {
    migrationName: string;
    description: string;
    getTargets: () => Array<ColumnToEncrypt>;
  }): CredentialsAtRestGroup {
    return {
      migrationName: data.migrationName,
      description: data.description,
      pass: async (pass: {
        startedAt: Date;
        deadline?: JobDeadline | undefined;
      }): Promise<CredentialsGroupPass> => {
        let isDone: boolean = true;
        let written: number = 0;

        for (const target of data.getTargets()) {
          const column: EncryptColumnPass = await EncryptColumnInPlace.encrypt({
            // Its log lines name the job, and the migration whose values these are.
            migrationName: `${CREDENTIALS_AT_REST_JOB_NAME} (${data.migrationName})`,
            target: target,
            deadline: pass.deadline,
          });

          written += column.written;

          if (column.read > 0 || column.failed > 0 || column.isCutShort) {
            isDone = false;
          }
        }

        return { isDone: isDone, written: written };
      },
    };
  }

  public static async run(data: {
    runner: SqlRunner;
    now: Date;
    deadline?: JobDeadline | undefined;
    groups?: Array<CredentialsAtRestGroup> | undefined;
    settlePeriodInMs?: number | undefined;
  }): Promise<Array<CredentialsAtRestRun>> {
    const runs: Array<CredentialsAtRestRun> = [];

    for (const group of data.groups || CredentialsAtRest.getGroups()) {
      runs.push({
        migrationName: group.migrationName,
        outcome: await CredentialsAtRest.runGroup({
          runner: data.runner,
          now: data.now,
          deadline: data.deadline,
          group: group,
          settlePeriodInMs: data.settlePeriodInMs,
        }),
      });
    }

    return runs;
  }

  // One group's turn in a run: see the top of the class.
  public static async runGroup(data: {
    runner: SqlRunner;
    now: Date;
    deadline?: JobDeadline | undefined;
    group: CredentialsAtRestGroup;
    settlePeriodInMs?: number | undefined;
  }): Promise<CredentialsAtRestOutcome> {
    const marker: string = getProtectedMarkerName(data.group.migrationName);

    if (await PresentedKeysAtRest.getExecutedAt(data.runner, marker)) {
      return CredentialsAtRestOutcome.AlreadyProtected;
    }

    const startedAt: Date | null = await PresentedKeysAtRest.getExecutedAt(
      data.runner,
      data.group.migrationName,
    );

    if (!startedAt) {
      return CredentialsAtRestOutcome.NotUpgradedYet;
    }

    const settlePeriodInMs: number = data.settlePeriodInMs ?? SETTLE_PERIOD_MS;

    if (data.now.getTime() - startedAt.getTime() < settlePeriodInMs) {
      return CredentialsAtRestOutcome.Waiting;
    }

    if (data.deadline?.hasPassed()) {
      return CredentialsAtRestOutcome.NotDoneYet;
    }

    const pass: CredentialsGroupPass = await data.group.pass({
      startedAt: startedAt,
      deadline: data.deadline,
    });

    if (!pass.isDone) {
      logger.info(
        `${CREDENTIALS_AT_REST_JOB_NAME}: ${data.group.description}: ${pass.written} encrypted this run; the rest wait for the next run, and keep working meanwhile.`,
      );

      return CredentialsAtRestOutcome.NotDoneYet;
    }

    await CredentialsAtRest.recordProtected(data.runner, marker, data.now);

    logger.info(
      `${CREDENTIALS_AT_REST_JOB_NAME}: ${data.group.description} are now all kept encrypted at rest (#9266).`,
    );

    return CredentialsAtRestOutcome.Protected;
  }

  /*
   * Records a group's marker, once: two runs at once record it once - or
   * twice, which reads the same (the earliest is the one read).
   */
  public static async recordProtected(
    runner: SqlRunner,
    marker: string,
    now: Date,
  ): Promise<void> {
    if (await PresentedKeysAtRest.getExecutedAt(runner, marker)) {
      return;
    }

    const record: DataMigration = new DataMigration();
    record.name = marker;
    record.executed = true;
    record.executedAt = now;

    await DataMigrationService.create({
      data: record,
      props: {
        isRoot: true,
      },
    });
  }
}
