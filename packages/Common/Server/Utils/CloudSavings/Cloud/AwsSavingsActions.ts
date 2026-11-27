import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import {
  CloudSavingsActionKind,
  CloudSavingsTarget,
} from "../../../../Types/Cloud/CloudSavingsAction";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { CLOUD_SAVINGS_ACTION_TAG_KEY } from "../../../../Types/CloudConnection/CloudSavingsActionsAccess";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  AwsCredentials,
  awsErrorCodeOf,
  awsErrorMessageOf,
  readXmlChildren,
  readXmlTag,
  readXmlTags,
  sendAwsRequest,
} from "../../CloudConnection/Aws/AwsApi";
import AwsCloudConnector from "../../CloudConnection/Aws/AwsCloudConnector";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
} from "../../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  CloudSavingsProgress,
  CloudSavingsRun,
  CloudSavingsStepContext,
  CloudSavingsStepOutcome,
  CloudSavingsUndoRun,
  done,
  getFinalSnapshotName,
  waiting,
} from "../CloudSavingsCloudTypes";

/*
 * ACTING ON A SAVING IN AWS (#11010), through the connection's opt-in
 * OneUptimeSavingsActions policy (CloudSavingsActionsAccess).
 *
 *   StopInstance      DescribeInstances, StopInstances; undone with
 *                     StartInstances.
 *   StopDatabase      DescribeDBInstances, StopDBInstance; undone with
 *                     StartDBInstance. AWS starts it again after 7 days.
 *   ChangeVolumeType  DescribeVolumes, ModifyVolume to gp3 - with the IOPS
 *                     and throughput gp2 gave the volume, so it is no
 *                     slower - undone by ModifyVolume back to gp2 (EBS
 *                     allows it six hours after the first).
 *   DeleteVolume      DescribeVolumes (unattached only), CreateSnapshot and
 *                     DescribeSnapshots until it completes, DeleteVolume;
 *                     undone by CreateVolume from that snapshot, in the
 *                     same zone, of the same type, with the same tags.
 *   DeleteSnapshot    DescribeSnapshots, DeleteSnapshot. Never undone.
 *   ReleaseAddress    DescribeAddresses (unassociated only), ReleaseAddress.
 *                     Never undone: the address goes back to AWS's pool.
 *   ResizeInstance    DescribeInstances, StopInstances and wait for it to
 *                     stop, ModifyInstanceAttribute, StartInstances when it
 *                     was running; undone the same way back.
 *   ResizeDatabase    DescribeDBInstances, ModifyDBInstance with
 *                     ApplyImmediately; undone the same way back.
 *
 * Every step reads before it writes, so run twice it does no more than
 * once. A refusal says which setting grants the call; anything else AWS
 * says is passed on in its own words after OneUptime's. A role in a member
 * account of an organization is signed in to for that account.
 */

const PROVIDER_TITLE: string = "AWS";
const EC2_VERSION: string = "2016-11-15";
const RDS_VERSION: string = "2014-10-31";
const DEFAULT_MAX_REQUESTS: number = 20;
const DEFAULT_MAX_DURATION_MS: number = 2 * 60 * 1000;

// gp2 gives 3 IOPS a GiB, 100 at least and 16,000 at most; gp3 gives 3,000 at least.
const GP3_BASE_IOPS: number = 3000;
const GP2_MAX_IOPS: number = 16000;
// gp2 gives 250 MiB/s above 170 GiB, 128 below; gp3 gives 125 at least.
const GP2_HIGH_THROUGHPUT_FROM_GIB: number = 170;

interface AwsCall {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  budget: CloudReadBudget;
  region: string;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  subject: string;
}

async function signIn(
  context: CloudSavingsStepContext,
  target: CloudSavingsTarget,
): Promise<AwsCall> {
  const connector: AwsCloudConnector = new AwsCloudConnector();
  const settings: CloudConnectionSettings = context.settings;

  connector.validateSettings(settings);

  const accountSettings: CloudConnectionSettings =
    connector.isOrganization(settings) && target.account
      ? connector.settingsForAccount(settings, target.account)
      : settings;
  const transport: CloudConnectorTransport =
    context.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
  const budget: CloudReadBudget =
    context.budget ||
    new CloudReadBudget({
      maxRequests: DEFAULT_MAX_REQUESTS,
      maxDurationMs: DEFAULT_MAX_DURATION_MS,
    });

  return {
    transport,
    budget,
    region: target.location,
    now: context.now,
    sleep: context.sleep,
    credentials: await connector.getCredentials(accountSettings, {
      transport,
      now: context.now,
      sleep: context.sleep,
      connectionId: context.connectionId.toString(),
      budget,
    }),
    subject:
      connector.getAuthMethod(settings) === CloudConnectionAuthMethod.AwsRole
        ? "The role"
        : "The access key",
  };
}

// What AWS said went wrong, by its code: "" when it said nothing of its own.
function codeOf(error: unknown): string {
  return error instanceof LlmProviderError
    ? awsErrorCodeOf(error.responseBody || "")
    : "";
}

/*
 * A refusal, said with what grants the call; anything else AWS said, after
 * what OneUptime was doing, in AWS's own words.
 */
function explain(
  error: unknown,
  data: { subject: string; iamAction: string; what: string },
): unknown {
  if (!(error instanceof LlmProviderError)) {
    return error;
  }

  if (error.kind === CloudConnectionFailureKind.Permission) {
    const resize: boolean =
      data.iamAction === "ec2:ModifyInstanceAttribute" ||
      data.iamAction === "rds:ModifyDBInstance";

    return new LlmProviderError({
      message: `AWS refused ${data.iamAction} on ${data.what}: ${data.subject.toLowerCase()} may not call it. Set the connection's Savings actions to ${
        resize ? '"Stop, start, clean up and resize"' : "on"
      }, and run its setup command again.`,
      kind: CloudConnectionFailureKind.Permission,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  return error;
}

async function query(
  call: AwsCall,
  data: {
    service: "ec2" | "rds";
    body: Dictionary<string>;
    step: string;
    isSafeToRepeat?: boolean | undefined;
  },
): Promise<string> {
  return (
    await sendAwsRequest({
      transport: call.transport,
      credentials: call.credentials,
      service: data.service,
      region: call.region,
      body: {
        Version: data.service === "ec2" ? EC2_VERSION : RDS_VERSION,
        ...data.body,
      },
      step: data.step,
      providerTitle: PROVIDER_TITLE,
      now: call.now,
      sleep: call.sleep,
      budget: call.budget,
      isSafeToRepeat: data.isSafeToRepeat,
    })
  ).text;
}

// A tag spec on a create: the action that made it, and its name.
function tagsOn(
  resourceType: "snapshot" | "volume",
  tags: Array<[string, string]>,
): Dictionary<string> {
  const fields: Dictionary<string> = {
    "TagSpecification.1.ResourceType": resourceType,
  };

  tags.slice(0, 50).forEach(([key, value]: [string, string], index: number) => {
    fields[`TagSpecification.1.Tag.${index + 1}.Key`] = key;
    fields[`TagSpecification.1.Tag.${index + 1}.Value`] = value;
  });

  return fields;
}

/*
 * ---------------------------------------------------------------------------
 * Instances
 * ---------------------------------------------------------------------------
 */

interface Ec2Instance {
  state: string;
  instanceType: string;
}

async function describeInstance(
  call: AwsCall,
  id: string,
): Promise<Ec2Instance | null> {
  let text: string;

  try {
    text = await query(call, {
      service: "ec2",
      body: { Action: "DescribeInstances", "InstanceId.1": id },
      step: "instance request",
    });
  } catch (error) {
    if (codeOf(error) === "InvalidInstanceID.NotFound") {
      return null;
    }

    throw explain(error, {
      subject: call.subject,
      iamAction: "ec2:DescribeInstances",
      what: `instance ${id}`,
    });
  }

  const item: string | undefined = readXmlTags(
    readXmlTags(text, "instancesSet")[0] || "",
    "item",
  )[0];

  if (!item) {
    return null;
  }

  return {
    state: readXmlTag(readXmlTags(item, "instanceState")[0] || "", "name"),
    instanceType: readXmlChildren(item, "instanceType")[0] || "",
  };
}

async function changeInstanceState(
  call: AwsCall,
  id: string,
  verb: "StopInstances" | "StartInstances",
): Promise<void> {
  try {
    await query(call, {
      service: "ec2",
      body: { Action: verb, "InstanceId.1": id },
      step: verb === "StopInstances" ? "instance stop" : "instance start",
      // Stopping a stopping instance, or starting a starting one, does nothing more.
      isSafeToRepeat: true,
    });
  } catch (error) {
    if (codeOf(error) === "UnsupportedOperation") {
      throw new BadDataException(
        `AWS cannot ${verb === "StopInstances" ? "stop" : "start"} instance ${id} now. ${awsErrorMessageOf(
          (error as LlmProviderError).responseBody || "",
        )}`,
      );
    }

    throw explain(error, {
      subject: call.subject,
      iamAction:
        verb === "StopInstances" ? "ec2:StopInstances" : "ec2:StartInstances",
      what: `instance ${id}`,
    });
  }
}

function instanceGone(id: string): BadDataException {
  return new BadDataException(
    `Instance ${id} was not found: it may have been terminated.`,
  );
}

async function stopInstance(
  call: AwsCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  const instance: Ec2Instance | null = await describeInstance(call, id);

  if (!instance || ["terminated", "shutting-down"].includes(instance.state)) {
    throw instanceGone(id);
  }

  if (instance.state === "stopped" || instance.state === "stopping") {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Instance ${id} was already stopped; nothing changed.`,
    });
  }

  await changeInstanceState(call, id, "StopInstances");

  return done({
    progress: run.progress,
    changed: true,
    summary: `Stopped instance ${id}. Its disks are kept, and it can be started again.`,
  });
}

async function startInstance(
  call: AwsCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  const instance: Ec2Instance | null = await describeInstance(call, id);

  if (!instance || ["terminated", "shutting-down"].includes(instance.state)) {
    throw instanceGone(id);
  }

  if (instance.state === "running" || instance.state === "pending") {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Instance ${id} was already running; nothing changed.`,
    });
  }

  // A stop still under way: AWS refuses a start until it has stopped.
  if (instance.state === "stopping") {
    return waiting(run.progress, `Waiting for instance ${id} to stop.`);
  }

  await changeInstanceState(call, id, "StartInstances");

  return done({
    progress: run.progress,
    changed: true,
    summary: `Started instance ${id} again.`,
  });
}

/*
 * A resize, in its steps: stop (when running), wait until stopped, change
 * the type, start again (when it was running). A type AWS will not set -
 * one the instance's image or zone does not take - starts the instance
 * again before the failure is said.
 */
async function resizeInstance(
  call: AwsCall,
  run: CloudSavingsRun,
  to: string,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  let progress: CloudSavingsProgress = { ...run.progress };

  for (;;) {
    const step: string = progress.step || "start";

    if (step === "start") {
      const instance: Ec2Instance | null = await describeInstance(call, id);

      if (
        !instance ||
        ["terminated", "shutting-down"].includes(instance.state)
      ) {
        throw instanceGone(id);
      }

      if (instance.instanceType === to) {
        return done({
          progress,
          changed: false,
          summary: `Instance ${id} was already ${to}; nothing changed.`,
        });
      }

      progress = {
        ...progress,
        previous: progress.previous || instance.instanceType,
        wasRunning:
          instance.state === "running" || instance.state === "pending",
      };

      if (instance.state === "running" || instance.state === "pending") {
        await changeInstanceState(call, id, "StopInstances");
        progress.step = "wait-stopped";
        return waiting(
          progress,
          `Stopping instance ${id} to resize it to ${to}.`,
        );
      }

      progress.step = instance.state === "stopping" ? "wait-stopped" : "modify";
      continue;
    }

    if (step === "wait-stopped") {
      const instance: Ec2Instance | null = await describeInstance(call, id);

      if (!instance) {
        throw instanceGone(id);
      }

      if (instance.state !== "stopped") {
        return waiting(progress, `Waiting for instance ${id} to stop.`);
      }

      progress.step = "modify";
      continue;
    }

    if (step === "modify") {
      try {
        await query(call, {
          service: "ec2",
          body: {
            Action: "ModifyInstanceAttribute",
            InstanceId: id,
            "InstanceType.Value": to,
          },
          step: "instance type update",
          // Sets the type to one value: sent again, it sets the same.
          isSafeToRepeat: true,
        });
      } catch (error) {
        // Never leave a running instance stopped because its resize failed.
        if (progress.wasRunning) {
          await changeInstanceState(call, id, "StartInstances");
        }

        if (codeOf(error) === "InvalidParameterValue") {
          throw new BadDataException(
            `AWS would not make instance ${id} a ${to}, so it was left ${progress.previous ? `a ${progress.previous}` : "the size it was"}${progress.wasRunning ? " and started again" : ""}. ${awsErrorMessageOf(
              (error as LlmProviderError).responseBody || "",
            )}`,
          );
        }

        throw explain(error, {
          subject: call.subject,
          iamAction: "ec2:ModifyInstanceAttribute",
          what: `instance ${id}`,
        });
      }

      progress.step = progress.wasRunning ? "start-again" : "done";

      if (!progress.wasRunning) {
        return done({
          progress,
          changed: true,
          summary: `Resized instance ${id} from ${progress.previous} to ${to}. It was stopped, and is left stopped.`,
        });
      }

      continue;
    }

    if (step === "start-again") {
      await changeInstanceState(call, id, "StartInstances");

      return done({
        progress,
        changed: true,
        summary: `Resized instance ${id} from ${progress.previous} to ${to}, and started it again.`,
      });
    }

    return done({
      progress,
      changed: true,
      summary: `Resized instance ${id} to ${to}.`,
    });
  }
}

/*
 * ---------------------------------------------------------------------------
 * Databases
 * ---------------------------------------------------------------------------
 */

interface RdsInstance {
  status: string;
  instanceClass: string;
}

async function describeDatabase(
  call: AwsCall,
  id: string,
): Promise<RdsInstance | null> {
  let text: string;

  try {
    text = await query(call, {
      service: "rds",
      body: { Action: "DescribeDBInstances", DBInstanceIdentifier: id },
      step: "database request",
    });
  } catch (error) {
    if (codeOf(error) === "DBInstanceNotFound") {
      return null;
    }

    throw explain(error, {
      subject: call.subject,
      iamAction: "rds:DescribeDBInstances",
      what: `database ${id}`,
    });
  }

  const instance: string | undefined = readXmlTags(text, "DBInstance")[0];

  if (!instance) {
    return null;
  }

  return {
    status: readXmlChildren(instance, "DBInstanceStatus")[0] || "",
    instanceClass: readXmlChildren(instance, "DBInstanceClass")[0] || "",
  };
}

function databaseGone(id: string): BadDataException {
  return new BadDataException(
    `Database ${id} was not found: it may have been deleted.`,
  );
}

async function changeDatabaseState(
  call: AwsCall,
  id: string,
  verb: "StopDBInstance" | "StartDBInstance",
): Promise<void> {
  try {
    await query(call, {
      service: "rds",
      body: { Action: verb, DBInstanceIdentifier: id },
      step: verb === "StopDBInstance" ? "database stop" : "database start",
    });
  } catch (error) {
    const code: string = codeOf(error);

    if (
      code === "InvalidDBInstanceState" ||
      code === "InvalidDBInstanceStateFault" ||
      code === "InvalidParameterCombination" ||
      code === "InvalidDBClusterStateFault"
    ) {
      throw new BadDataException(
        `AWS cannot ${verb === "StopDBInstance" ? "stop" : "start"} database ${id} now. ${awsErrorMessageOf(
          (error as LlmProviderError).responseBody || "",
        )}`,
      );
    }

    throw explain(error, {
      subject: call.subject,
      iamAction:
        verb === "StopDBInstance"
          ? "rds:StopDBInstance"
          : "rds:StartDBInstance",
      what: `database ${id}`,
    });
  }
}

async function stopDatabase(
  call: AwsCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  const database: RdsInstance | null = await describeDatabase(call, id);

  if (!database) {
    throw databaseGone(id);
  }

  if (database.status === "stopped" || database.status === "stopping") {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Database ${id} was already stopped; nothing changed.`,
    });
  }

  if (database.status !== "available") {
    throw new BadDataException(
      `Database ${id} is ${database.status}, so it cannot be stopped now. Try again once it is available.`,
    );
  }

  await changeDatabaseState(call, id, "StopDBInstance");

  return done({
    progress: run.progress,
    changed: true,
    summary: `Stopped database ${id}. Its data is kept; AWS starts it again after seven days.`,
  });
}

async function startDatabase(
  call: AwsCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  const database: RdsInstance | null = await describeDatabase(call, id);

  if (!database) {
    throw databaseGone(id);
  }

  if (database.status === "available" || database.status === "starting") {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Database ${id} was already running; nothing changed.`,
    });
  }

  if (database.status === "stopping") {
    return waiting(run.progress, `Waiting for database ${id} to stop.`);
  }

  await changeDatabaseState(call, id, "StartDBInstance");

  return done({
    progress: run.progress,
    changed: true,
    summary: `Started database ${id} again.`,
  });
}

async function resizeDatabase(
  call: AwsCall,
  run: CloudSavingsRun,
  to: string,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  const database: RdsInstance | null = await describeDatabase(call, id);

  if (!database) {
    throw databaseGone(id);
  }

  if (database.instanceClass === to) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Database ${id} was already ${to}; nothing changed.`,
    });
  }

  if (database.status !== "available") {
    throw new BadDataException(
      `Database ${id} is ${database.status}, so it cannot be resized now. Try again once it is available.`,
    );
  }

  try {
    await query(call, {
      service: "rds",
      body: {
        Action: "ModifyDBInstance",
        DBInstanceIdentifier: id,
        DBInstanceClass: to,
        ApplyImmediately: "true",
      },
      step: "database class update",
      isSafeToRepeat: true,
    });
  } catch (error) {
    if (
      codeOf(error) === "InvalidParameterCombination" ||
      codeOf(error) === "InvalidParameterValue"
    ) {
      throw new BadDataException(
        `AWS would not make database ${id} a ${to}. ${awsErrorMessageOf(
          (error as LlmProviderError).responseBody || "",
        )}`,
      );
    }

    throw explain(error, {
      subject: call.subject,
      iamAction: "rds:ModifyDBInstance",
      what: `database ${id}`,
    });
  }

  return done({
    progress: { ...run.progress, previous: database.instanceClass },
    changed: true,
    summary: `Resizing database ${id} from ${database.instanceClass} to ${to}: it restarts in the next few minutes.`,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Volumes, snapshots and addresses
 * ---------------------------------------------------------------------------
 */

interface EbsVolume {
  state: string;
  volumeType: string;
  size: number;
  iops: number;
  throughput: number;
  zone: string;
  encrypted: boolean;
  kmsKeyId: string;
  tags: Array<[string, string]>;
}

async function describeVolume(
  call: AwsCall,
  id: string,
): Promise<EbsVolume | null> {
  let text: string;

  try {
    text = await query(call, {
      service: "ec2",
      body: { Action: "DescribeVolumes", "VolumeId.1": id },
      step: "volume request",
    });
  } catch (error) {
    if (codeOf(error) === "InvalidVolume.NotFound") {
      return null;
    }

    throw explain(error, {
      subject: call.subject,
      iamAction: "ec2:DescribeVolumes",
      what: `volume ${id}`,
    });
  }

  const item: string | undefined = readXmlTags(
    readXmlTags(text, "volumeSet")[0] || "",
    "item",
  )[0];

  if (!item) {
    return null;
  }

  const tags: Array<[string, string]> = readXmlTags(
    readXmlTags(item, "tagSet")[0] || "",
    "item",
  )
    .map((tag: string): [string, string] => {
      return [
        readXmlChildren(tag, "key")[0] || "",
        readXmlChildren(tag, "value")[0] || "",
      ];
    })
    .filter((tag: [string, string]): boolean => {
      // AWS's own tags ("aws:...") cannot be set by anyone.
      return Boolean(tag[0]) && !tag[0].startsWith("aws:");
    });

  return {
    state: readXmlChildren(item, "status")[0] || "",
    volumeType: readXmlChildren(item, "volumeType")[0] || "",
    size: Number(readXmlChildren(item, "size")[0] || 0),
    iops: Number(readXmlChildren(item, "iops")[0] || 0),
    throughput: Number(readXmlChildren(item, "throughput")[0] || 0),
    zone: readXmlChildren(item, "availabilityZone")[0] || "",
    encrypted: (readXmlChildren(item, "encrypted")[0] || "") === "true",
    kmsKeyId: readXmlChildren(item, "kmsKeyId")[0] || "",
    tags,
  };
}

/*
 * The IOPS and throughput gp2 gave a volume, at gp3's floor at least: a
 * volume moved to gp3 is never slower than it was.
 */
export function getGp3Performance(sizeGiB: number): {
  iops: number;
  throughput: number;
} {
  const gp2Iops: number = Math.min(GP2_MAX_IOPS, Math.max(100, sizeGiB * 3));

  return {
    iops: Math.max(GP3_BASE_IOPS, gp2Iops),
    throughput: sizeGiB > GP2_HIGH_THROUGHPUT_FROM_GIB ? 250 : 125,
  };
}

async function modifyVolumeType(
  call: AwsCall,
  id: string,
  body: Dictionary<string>,
): Promise<void> {
  try {
    await query(call, {
      service: "ec2",
      body: { Action: "ModifyVolume", VolumeId: id, ...body },
      step: "volume type update",
    });
  } catch (error) {
    const code: string = codeOf(error);
    const message: string = awsErrorMessageOf(
      (error as LlmProviderError)?.responseBody || "",
    );

    if (
      code.includes("ModificationRate") ||
      message.toLowerCase().includes("6 hours")
    ) {
      throw new BadDataException(
        `EBS changes a volume once every six hours, and volume ${id} was changed less than six hours ago. Try again later.`,
      );
    }

    if (code === "IncorrectModificationState") {
      throw new BadDataException(
        `Volume ${id} is still being changed by its last modification. Try again once it has finished.`,
      );
    }

    throw explain(error, {
      subject: call.subject,
      iamAction: "ec2:ModifyVolume",
      what: `volume ${id}`,
    });
  }
}

async function changeVolumeType(
  call: AwsCall,
  run: CloudSavingsRun,
  to: string,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  const volume: EbsVolume | null = await describeVolume(call, id);

  if (!volume) {
    throw new BadDataException(
      `Volume ${id} was not found: it may have been deleted.`,
    );
  }

  if (volume.volumeType === to) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Volume ${id} was already ${to}; nothing changed.`,
    });
  }

  const body: Dictionary<string> = { VolumeType: to };
  let detail: string = "";

  if (to === "gp3") {
    const performance: { iops: number; throughput: number } = getGp3Performance(
      volume.size,
    );
    body["Iops"] = String(performance.iops);
    body["Throughput"] = String(performance.throughput);
    detail = ` with ${performance.iops}${NO_BREAK_SPACE}IOPS and ${performance.throughput}${NO_BREAK_SPACE}MiB/s, as fast as it was`;
  }

  await modifyVolumeType(call, id, body);

  return done({
    progress: { ...run.progress, previous: volume.volumeType },
    changed: true,
    summary: `Changed volume ${id} from ${volume.volumeType} to ${to}${detail}. It stays in use while EBS changes it.`,
  });
}

async function describeSnapshotState(
  call: AwsCall,
  id: string,
): Promise<string | null> {
  let text: string;

  try {
    text = await query(call, {
      service: "ec2",
      body: { Action: "DescribeSnapshots", "SnapshotId.1": id },
      step: "snapshot request",
    });
  } catch (error) {
    if (codeOf(error) === "InvalidSnapshot.NotFound") {
      return null;
    }

    throw explain(error, {
      subject: call.subject,
      iamAction: "ec2:DescribeSnapshots",
      what: `snapshot ${id}`,
    });
  }

  const item: string | undefined = readXmlTags(
    readXmlTags(text, "snapshotSet")[0] || "",
    "item",
  )[0];

  return item ? readXmlChildren(item, "status")[0] || "" : null;
}

/*
 * An unattached volume deleted, in its steps: read it (still unattached),
 * its final snapshot made and waited for, then the delete. What it was is
 * kept, to make it again from the snapshot.
 */
async function deleteVolume(
  call: AwsCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  let progress: CloudSavingsProgress = { ...run.progress };

  for (;;) {
    const step: string = progress.step || "start";

    if (step === "start") {
      const volume: EbsVolume | null = await describeVolume(call, id);

      if (!volume) {
        return done({
          progress,
          changed: false,
          summary: `Volume ${id} was already deleted; nothing changed.`,
        });
      }

      if (volume.state !== "available") {
        throw new BadDataException(
          `Volume ${id} is ${volume.state === "in-use" ? "attached to an instance" : volume.state} now, so it was not deleted.`,
        );
      }

      progress = {
        ...progress,
        disk: {
          zone: volume.zone,
          volumeType: volume.volumeType,
          size: volume.size,
          iops: volume.iops,
          throughput: volume.throughput,
          encrypted: volume.encrypted,
          kmsKeyId: volume.kmsKeyId,
          tags: volume.tags.map((tag: [string, string]): string => {
            return JSON.stringify(tag);
          }),
        },
        step: run.finalSnapshot ? "snapshot" : "delete",
      };
      continue;
    }

    if (step === "snapshot") {
      let text: string;

      try {
        text = await query(call, {
          service: "ec2",
          body: {
            Action: "CreateSnapshot",
            VolumeId: id,
            Description: `Final snapshot OneUptime took before deleting ${id} (savings action ${run.actionId}).`,
            ...tagsOn("snapshot", [
              ["Name", getFinalSnapshotName(id, run.actionId)],
              [CLOUD_SAVINGS_ACTION_TAG_KEY, run.actionId],
            ]),
          },
          step: "final snapshot",
        });
      } catch (error) {
        throw explain(error, {
          subject: call.subject,
          iamAction: "ec2:CreateSnapshot",
          what: `volume ${id}`,
        });
      }

      const snapshotId: string = readXmlTag(text, "snapshotId");

      if (!snapshotId) {
        throw new BadDataException(
          `AWS did not say which snapshot it made of volume ${id}, so the volume was not deleted.`,
        );
      }

      progress = { ...progress, snapshotId, step: "wait-snapshot" };
      return waiting(
        progress,
        `Taking a final snapshot of volume ${id} (${snapshotId}) before deleting it.`,
      );
    }

    if (step === "wait-snapshot") {
      const state: string | null = await describeSnapshotState(
        call,
        progress.snapshotId || "",
      );

      if (state === "error" || state === null) {
        throw new BadDataException(
          `The final snapshot of volume ${id} failed, so the volume was not deleted.`,
        );
      }

      if (state !== "completed") {
        return waiting(
          progress,
          `Waiting for the final snapshot of volume ${id} (${progress.snapshotId}) to complete.`,
        );
      }

      progress.step = "delete";
      continue;
    }

    try {
      await query(call, {
        service: "ec2",
        body: { Action: "DeleteVolume", VolumeId: id },
        step: "volume delete",
      });
    } catch (error) {
      if (codeOf(error) === "InvalidVolume.NotFound") {
        return done({
          progress,
          changed: false,
          summary: `Volume ${id} was already deleted; nothing changed.`,
        });
      }

      if (codeOf(error) === "VolumeInUse") {
        throw new BadDataException(
          `Volume ${id} was attached to an instance before it could be deleted, so it was kept.`,
        );
      }

      throw explain(error, {
        subject: call.subject,
        iamAction: "ec2:DeleteVolume",
        what: `volume ${id}`,
      });
    }

    return done({
      progress,
      changed: true,
      summary: progress.snapshotId
        ? `Deleted volume ${id}, after a final snapshot (${progress.snapshotId}) it can be made again from.`
        : `Deleted volume ${id}. No final snapshot was taken.`,
    });
  }
}

// A deleted volume made again from its final snapshot, as it was.
async function restoreVolume(
  call: AwsCall,
  run: CloudSavingsUndoRun,
): Promise<CloudSavingsStepOutcome> {
  const snapshotId: string = run.applied.snapshotId || "";
  const disk: Record<string, unknown> = (run.applied.disk || {}) as Record<
    string,
    unknown
  >;

  if (!snapshotId) {
    throw new BadDataException(
      "No final snapshot was taken before this disk was deleted, so it cannot be made again.",
    );
  }

  if (run.progress.restoredId) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Volume ${run.target.id} was already made again, as ${run.progress.restoredId}.`,
    });
  }

  const volumeType: string = String(disk["volumeType"] || "gp3");
  const body: Dictionary<string> = {
    Action: "CreateVolume",
    AvailabilityZone: String(disk["zone"] || ""),
    SnapshotId: snapshotId,
    VolumeType: volumeType,
    // The same restore asked twice makes one volume.
    ClientToken: `oneuptime-restore-${run.actionId}`.slice(0, 64),
  };

  if (["io1", "io2", "gp3"].includes(volumeType) && Number(disk["iops"]) > 0) {
    body["Iops"] = String(disk["iops"]);
  }

  if (volumeType === "gp3" && Number(disk["throughput"]) > 0) {
    body["Throughput"] = String(disk["throughput"]);
  }

  const tags: Array<[string, string]> = (
    Array.isArray(disk["tags"]) ? (disk["tags"] as Array<string>) : []
  )
    .map((tag: string): [string, string] | null => {
      try {
        const pair: unknown = JSON.parse(tag);
        return Array.isArray(pair) && pair.length === 2
          ? [String(pair[0]), String(pair[1])]
          : null;
      } catch {
        return null;
      }
    })
    .filter((tag: [string, string] | null): boolean => {
      return tag !== null && tag[0] !== CLOUD_SAVINGS_ACTION_TAG_KEY;
    }) as Array<[string, string]>;

  let text: string;

  try {
    text = await query(call, {
      service: "ec2",
      body: {
        ...body,
        ...tagsOn("volume", [
          ...tags.slice(0, 49),
          [CLOUD_SAVINGS_ACTION_TAG_KEY, run.actionId],
        ]),
      },
      step: "volume restore",
      isSafeToRepeat: true,
    });
  } catch (error) {
    throw explain(error, {
      subject: call.subject,
      iamAction: "ec2:CreateVolume",
      what: `snapshot ${snapshotId}`,
    });
  }

  const restoredId: string = readXmlTag(text, "volumeId");

  return done({
    progress: { ...run.progress, restoredId },
    changed: true,
    summary: `Made volume ${run.target.id} again from its final snapshot ${snapshotId}, as ${restoredId} in ${String(
      disk["zone"] || "its zone",
    )}. Attach it where it was used.`,
  });
}

async function deleteSnapshot(
  call: AwsCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  const state: string | null = await describeSnapshotState(call, id);

  if (state === null) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Snapshot ${id} was already deleted; nothing changed.`,
    });
  }

  try {
    await query(call, {
      service: "ec2",
      body: { Action: "DeleteSnapshot", SnapshotId: id },
      step: "snapshot delete",
    });
  } catch (error) {
    if (codeOf(error) === "InvalidSnapshot.InUse") {
      throw new BadDataException(
        `Snapshot ${id} is used by an image (AMI), so it was kept. ${awsErrorMessageOf(
          (error as LlmProviderError).responseBody || "",
        )}`,
      );
    }

    throw explain(error, {
      subject: call.subject,
      iamAction: "ec2:DeleteSnapshot",
      what: `snapshot ${id}`,
    });
  }

  return done({
    progress: run.progress,
    changed: true,
    summary: `Deleted snapshot ${id}.`,
  });
}

async function releaseAddress(
  call: AwsCall,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const id: string = run.target.id;
  let text: string;

  try {
    text = await query(call, {
      service: "ec2",
      body: { Action: "DescribeAddresses", "AllocationId.1": id },
      step: "address request",
    });
  } catch (error) {
    if (codeOf(error) === "InvalidAllocationID.NotFound") {
      return done({
        progress: run.progress,
        changed: false,
        summary: `Address ${id} was already released; nothing changed.`,
      });
    }

    throw explain(error, {
      subject: call.subject,
      iamAction: "ec2:DescribeAddresses",
      what: `address ${id}`,
    });
  }

  const item: string =
    readXmlTags(readXmlTags(text, "addressesSet")[0] || "", "item")[0] || "";
  const publicIp: string = readXmlChildren(item, "publicIp")[0] || id;

  if (!item) {
    return done({
      progress: run.progress,
      changed: false,
      summary: `Address ${id} was already released; nothing changed.`,
    });
  }

  if (readXmlChildren(item, "associationId")[0]) {
    throw new BadDataException(
      `Address ${publicIp} is associated with ${readXmlChildren(item, "instanceId")[0] || readXmlChildren(item, "networkInterfaceId")[0] || "a network interface"} now, so it was not released.`,
    );
  }

  try {
    await query(call, {
      service: "ec2",
      body: { Action: "ReleaseAddress", AllocationId: id },
      step: "address release",
    });
  } catch (error) {
    throw explain(error, {
      subject: call.subject,
      iamAction: "ec2:ReleaseAddress",
      what: `address ${publicIp}`,
    });
  }

  return done({
    progress: run.progress,
    changed: true,
    summary: `Released address ${publicIp} (${id}). It goes back to AWS and cannot be had again.`,
  });
}

/*
 * ---------------------------------------------------------------------------
 * The change, and its undo
 * ---------------------------------------------------------------------------
 */

function needs(value: string | undefined, what: string): string {
  if (!value) {
    throw new BadDataException(`The change does not say ${what}.`);
  }

  return value;
}

export async function applyAwsSavingsAction(
  context: CloudSavingsStepContext,
  run: CloudSavingsRun,
): Promise<CloudSavingsStepOutcome> {
  const call: AwsCall = await signIn(context, run.target);

  switch (run.kind) {
    case CloudSavingsActionKind.StopInstance:
      return await stopInstance(call, run);
    case CloudSavingsActionKind.StopDatabase:
      return await stopDatabase(call, run);
    case CloudSavingsActionKind.ChangeVolumeType:
      return await changeVolumeType(
        call,
        run,
        needs(run.to, "which volume type to change to"),
      );
    case CloudSavingsActionKind.DeleteVolume:
      return await deleteVolume(call, run);
    case CloudSavingsActionKind.DeleteSnapshot:
      return await deleteSnapshot(call, run);
    case CloudSavingsActionKind.ReleaseAddress:
      return await releaseAddress(call, run);
    case CloudSavingsActionKind.ResizeInstance:
      return await resizeInstance(
        call,
        run,
        needs(run.to, "which size to resize to"),
      );
    case CloudSavingsActionKind.ResizeDatabase:
      return await resizeDatabase(
        call,
        run,
        needs(run.to, "which class to resize to"),
      );
    default:
      throw new BadDataException(
        `OneUptime does not make a change of this kind in AWS: ${run.kind}.`,
      );
  }
}

/*
 * Takes a change back: starts what was stopped, sizes or types back what
 * was resized or retyped, makes a deleted volume again from its final
 * snapshot. What cannot be undone says why. Its steps are its own
 * (run.progress); what the change did is run.applied.
 */
export async function undoAwsSavingsAction(
  context: CloudSavingsStepContext,
  run: CloudSavingsUndoRun,
): Promise<CloudSavingsStepOutcome> {
  const call: AwsCall = await signIn(context, run.target);
  const previous: string = run.applied.previous || "";

  switch (run.kind) {
    case CloudSavingsActionKind.StopInstance:
      return await startInstance(call, run);
    case CloudSavingsActionKind.StopDatabase:
      return await startDatabase(call, run);
    case CloudSavingsActionKind.ChangeVolumeType:
      return await changeVolumeType(
        call,
        run,
        needs(previous, "what the volume's type was"),
      );
    case CloudSavingsActionKind.DeleteVolume:
      return await restoreVolume(call, run);
    case CloudSavingsActionKind.ResizeInstance:
      return await resizeInstance(
        call,
        run,
        needs(previous, "what the instance's size was"),
      );
    case CloudSavingsActionKind.ResizeDatabase:
      return await resizeDatabase(
        call,
        run,
        needs(previous, "what the database's class was"),
      );
    default:
      throw new BadDataException(
        "This change cannot be undone: what it deleted or released is gone.",
      );
  }
}
