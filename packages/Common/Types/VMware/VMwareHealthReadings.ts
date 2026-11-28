import {
  VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  isPastVMwareHealthThreshold,
} from "./VMwareHealthRules";

/*
 * WHAT A VMWARE PART READ LATELY, FOR "FOR AT LEAST N MINUTES" (#11469).
 *
 * The health rules judged a part by its latest report, so a host busy for
 * one two-minute report was flagged as one busy all day. A group of rules
 * can now wait (VMwareHealthRules' periods): a part is marked once every
 * report for that long was past the threshold. So ingest keeps each part's
 * last readings of what the rules judge, on its row
 * (VMwareResource.healthReadings, VMwareResourceService), and every page
 * that judges the part reads them here.
 *
 * One reading per report, the newest last, each the part's values as its
 * row held them once the report was written - the same numbers its page
 * shows:
 *
 *   t     when, in Unix seconds (the report's time)
 *   cpu   an ESXi host's CPU, percent
 *   mem   an ESXi host's memory, percent
 *   disk  a datastore's fullness, percent
 *   so    a VM's or a resource pool's swap-out rate, bytes per second
 *   si    a VM's swap-in rate, bytes per second
 *   sw    a VM's swapped memory, bytes
 *   bl    a VM's ballooned memory, bytes
 *   rd    a VM's CPU ready, percent
 *
 * What a part's kind does not have, or its report did not say, is left
 * out. Kept for the longest period plus the longest gap between two
 * reports a run may span, and never more than VMWARE_HEALTH_READINGS_MAX
 * readings.
 */

export interface VMwareHealthReading {
  t: number;
  cpu?: number | undefined;
  mem?: number | undefined;
  disk?: number | undefined;
  so?: number | undefined;
  si?: number | undefined;
  sw?: number | undefined;
  bl?: number | undefined;
  rd?: number | undefined;
}

export type VMwareHealthReadingField =
  | "cpu"
  | "mem"
  | "disk"
  | "so"
  | "si"
  | "sw"
  | "bl"
  | "rd";

export const VMWARE_HEALTH_READING_FIELDS: ReadonlyArray<VMwareHealthReadingField> =
  ["cpu", "mem", "disk", "so", "si", "sw", "bl", "rd"];

/*
 * Two readings further apart than this say nothing about the time between
 * them (a vCenter that stopped reporting), so a run of readings past a
 * threshold breaks there - the gap the swap rates are worked out across
 * too (VMWARE_SWAP_RATE_MAX_GAP_SECONDS).
 */
export const VMWARE_HEALTH_READINGS_MAX_GAP_SECONDS: number = 15 * 60;

// How far back ingest keeps readings: the longest period, and one gap more.
export const VMWARE_HEALTH_READINGS_KEEP_SECONDS: number =
  VMWARE_HEALTH_MAX_EVALUATION_MINUTES * 60 +
  VMWARE_HEALTH_READINGS_MAX_GAP_SECONDS;

// And never more readings than this (a vCenter collected every minute keeps 45).
export const VMWARE_HEALTH_READINGS_MAX: number = 64;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/*
 * The readings a row holds, oldest first, each with a time; anything that
 * is not one (a row from before #11469 holds none) is left out.
 */
export function readVMwareHealthReadings(
  value: unknown,
): Array<VMwareHealthReading> {
  let list: unknown = value;

  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(list)) {
    return [];
  }

  const readings: Array<VMwareHealthReading> = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const raw: Record<string, unknown> = entry as Record<string, unknown>;
    const time: number =
      typeof raw["t"] === "string" ? Number(raw["t"]) : (raw["t"] as number);
    if (!isFiniteNumber(time) || time <= 0) {
      continue;
    }
    const reading: VMwareHealthReading = { t: Math.trunc(time) };
    for (const field of VMWARE_HEALTH_READING_FIELDS) {
      const fieldValue: unknown =
        typeof raw[field] === "string" ? Number(raw[field]) : raw[field];
      if (isFiniteNumber(fieldValue)) {
        reading[field] = fieldValue;
      }
    }
    readings.push(reading);
  }

  return readings.sort((a: VMwareHealthReading, b: VMwareHealthReading) => {
    return a.t - b.t;
  });
}

/*
 * Since when a part's reading has been past a threshold: the time of the
 * first reading of the newest run of readings past it, no two of them
 * further apart than VMWARE_HEALTH_READINGS_MAX_GAP_SECONDS. Null when the
 * newest reading is not past it, says nothing of the field, or the rule is
 * off. The threshold is in the field's own unit (bytes, not MiB).
 */
export function getVMwarePastThresholdSince(data: {
  readings: Array<VMwareHealthReading>;
  field: VMwareHealthReadingField;
  threshold: number | null;
}): Date | null {
  if (data.threshold === null || data.readings.length === 0) {
    return null;
  }

  let since: VMwareHealthReading | null = null;

  for (let index: number = data.readings.length - 1; index >= 0; index--) {
    const reading: VMwareHealthReading = data.readings[index]!;

    if (!isPastVMwareHealthThreshold(reading[data.field], data.threshold)) {
      break;
    }
    if (
      since !== null &&
      since.t - reading.t > VMWARE_HEALTH_READINGS_MAX_GAP_SECONDS
    ) {
      break;
    }
    since = reading;
  }

  return since ? new Date(since.t * 1000) : null;
}

export interface VMwareHeldReading {
  // Past the threshold for at least the minutes asked.
  isHeld: boolean;
  // When the run past it began, by the readings; null when it is not past it.
  since: Date | null;
}

/*
 * Whether a reading past a threshold has held for at least `minutes`: its
 * newest run past it began that long before the newest reading. A part
 * with fewer readings than that - a part new to the vCenter, a row from
 * before #11469 - has not held it yet.
 */
export function hasVMwareReadingHeldFor(data: {
  readings: Array<VMwareHealthReading>;
  field: VMwareHealthReadingField;
  threshold: number | null;
  minutes: number;
}): VMwareHeldReading {
  const since: Date | null = getVMwarePastThresholdSince(data);

  if (since === null) {
    return { isHeld: false, since: null };
  }

  const newest: VMwareHealthReading =
    data.readings[data.readings.length - 1]!;
  const heldSeconds: number = newest.t - since.getTime() / 1000;

  return {
    isHeld: heldSeconds >= Math.max(0, data.minutes) * 60,
    since,
  };
}
