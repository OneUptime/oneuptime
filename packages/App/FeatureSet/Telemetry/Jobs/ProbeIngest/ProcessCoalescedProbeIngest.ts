import {
  processNetworkDeviceWalkFromQueue,
  processSnmpTrapFromQueue,
} from "./ProcessProbeIngest";
import TelemetryQueueService, {
  ProbeIngestJobData,
} from "../../Services/Queue/TelemetryQueueService";
import NetworkDevicePollLatestStore, {
  LatestNetworkDevicePoll,
} from "../../Utils/NetworkDevicePollLatestStore";
import SnmpTrapPendingStore, {
  MAX_ATTEMPTS_PER_TRAP,
  PendingSnmpTrap,
} from "../../Utils/SnmpTrapPendingStore";
import { isNonActionableIngestError } from "../../Utils/NonActionableIngestError";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";

/*
 * The jobs a backlog holds one of per device (a poll) or per sender (SNMP
 * traps), queued by TelemetryQueueService with BullMQ deduplication. Each
 * carries only who it is for; what to process is in Redis
 * (NetworkDevicePollLatestStore, SnmpTrapPendingStore), and is processed by
 * the same functions a job carrying it used to be (ProcessProbeIngest).
 */

/*
 * The most traps one job processes. A sender with more waiting gets the
 * job queued once more for the rest, behind the jobs already waiting, so
 * one noisy sender takes its turn with everyone else.
 */
export const MAX_TRAPS_PER_JOB: number = 500;

/*
 * A device's newest poll: whatever its slot holds when the job runs - which
 * may be a newer poll than the one that queued the job, when that one was
 * coalesced into it - and then the slot is cleared, unless an even newer one
 * was stored meanwhile; the job queued behind this one processes that. An
 * empty slot means a poll at least as new was processed already.
 */
export async function processNetworkDevicePollFromQueue(
  jobData: ProbeIngestJobData,
): Promise<void> {
  const probeId: string | undefined = jobData.networkDevicePoll?.probeId;
  const networkDeviceId: string | undefined =
    jobData.networkDevicePoll?.networkDeviceId;

  if (!probeId || !networkDeviceId) {
    throw new BadDataException(
      "The network device poll job does not say which probe and device it is for.",
    );
  }

  const latest: LatestNetworkDevicePoll | null =
    await NetworkDevicePollLatestStore.getLatest(probeId, networkDeviceId);

  if (!latest) {
    logger.debug(
      `Network device ${networkDeviceId}: no poll to process - one at least as new as poll ${jobData.networkDevicePoll?.pollId} was processed already.`,
    );
    return;
  }

  if (latest.pollId !== jobData.networkDevicePoll?.pollId) {
    logger.debug(
      `Network device ${networkDeviceId}: poll ${jobData.networkDevicePoll?.pollId} was superseded; processing the newest, ${latest.pollId}.`,
    );
  }

  try {
    await processNetworkDeviceWalkFromQueue(latest.payload);
  } catch (err) {
    /*
     * A failure the worker retries leaves the poll stored, so the retry
     * processes it - or anything newer - again. One it does not retry is
     * final, so clear it.
     */
    if (isNonActionableIngestError(err) || err instanceof BadDataException) {
      await NetworkDevicePollLatestStore.clearIfUnchanged({
        probeId: probeId,
        networkDeviceId: networkDeviceId,
        pollId: latest.pollId,
      });
    }

    throw err;
  }

  await NetworkDevicePollLatestStore.clearIfUnchanged({
    probeId: probeId,
    networkDeviceId: networkDeviceId,
    pollId: latest.pollId,
  });
}

/*
 * A sender's waiting traps, oldest first, up to MAX_TRAPS_PER_JOB. A trap
 * whose processing fails stays at the head, counted, and the job fails for
 * BullMQ to retry it later; one that has failed MAX_ATTEMPTS_PER_TRAP times
 * is given up on, so it cannot hold up its sender's later traps for good.
 */
export async function processSnmpTrapBatchFromQueue(
  jobData: ProbeIngestJobData,
): Promise<void> {
  const probeId: string | undefined = jobData.snmpTrapBatch?.probeId;
  const sourceIpAddress: string | undefined =
    jobData.snmpTrapBatch?.sourceIpAddress;

  if (!probeId || !sourceIpAddress) {
    throw new BadDataException(
      "The SNMP trap job does not say which probe and sender it is for.",
    );
  }

  let processed: number = 0;

  while (processed < MAX_TRAPS_PER_JOB) {
    const trap: PendingSnmpTrap | null = await SnmpTrapPendingStore.peekOldest(
      probeId,
      sourceIpAddress,
    );

    if (!trap) {
      return;
    }

    if (trap.attempts >= MAX_ATTEMPTS_PER_TRAP) {
      logger.error(
        `SNMP trap from ${sourceIpAddress} via probe ${probeId} failed ${trap.attempts} times; giving up on it.`,
      );
      await SnmpTrapPendingStore.removeOldest(
        probeId,
        sourceIpAddress,
        trap.raw,
      );
      continue;
    }

    try {
      await processSnmpTrapFromQueue(trap.payload);
    } catch (err) {
      if (!(err instanceof BadDataException)) {
        await SnmpTrapPendingStore.countFailure(probeId, sourceIpAddress, trap);
        throw err;
      }

      // A trap that can never be processed (bad data): logged and dropped.
      logger.warn(
        `SNMP trap from ${sourceIpAddress} via probe ${probeId} dropped: ${err.message}`,
      );
    }

    await SnmpTrapPendingStore.removeOldest(probeId, sourceIpAddress, trap.raw);
    processed++;
  }

  if (await SnmpTrapPendingStore.hasPending(probeId, sourceIpAddress)) {
    /*
     * This job is active, so BullMQ queues this one after it, however many
     * traps arrive meanwhile.
     */
    await TelemetryQueueService.addSnmpTrapBatchJob({
      probeId: probeId,
      sourceIpAddress: sourceIpAddress,
    });
  }
}
