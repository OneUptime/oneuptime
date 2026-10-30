import DataConfidence, {
  higherConfidence,
} from "../../Types/DataSecurity/DataConfidence";
import { maskValue } from "./Masking";

/*
 * WHAT A SCAN FOUND OF ONE DATA TYPE IN ONE PLACE, WITHOUT THE VALUES.
 *
 * A tally is all a scan keeps: how many matches, how many of them were test
 * values, the highest confidence, at most MAX_MASKED_SAMPLES masked
 * samples, and an estimate of how many different values there were. The
 * estimate counts 32-bit hashes of the values in a bounded set; the hashes
 * live only in the scanner's memory and are dropped with the tally's owner.
 */

export const MAX_MASKED_SAMPLES: number = 3;

// The most distinct hashes counted; past it the estimate says "at least".
export const MAX_COUNTED_DISTINCT_VALUES: number = 10_000;

// FNV-1a: a fast 32-bit hash, enough to tell values apart for a count.
export function fnv1a(value: string): number {
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

export interface DataTypeTallyJSON {
  dataTypeId: string;
  matchCount: number;
  testValueCount: number;
  confidence: DataConfidence;
  maskedSamples: Array<string>;
  distinctValues: number;
  // Whether distinctValues stopped counting at MAX_COUNTED_DISTINCT_VALUES.
  distinctValuesCapped: boolean;
}

export class DataTypeTally {
  public readonly dataTypeId: string;
  public matchCount: number = 0;
  public testValueCount: number = 0;
  public confidence: DataConfidence = DataConfidence.Low;
  public readonly maskedSamples: Array<string> = [];

  private readonly distinct: Set<number> = new Set();
  private distinctCapped: boolean = false;

  public constructor(dataTypeId: string) {
    this.dataTypeId = dataTypeId;
  }

  public add(data: {
    normalized: string;
    confidence: DataConfidence;
    isTestValue: boolean;
    raw?: string | undefined;
  }): void {
    if (data.isTestValue) {
      this.testValueCount++;
      return;
    }

    this.matchCount++;

    // The first real match sets it; later ones can only raise it.
    this.confidence =
      this.matchCount === 1
        ? data.confidence
        : higherConfidence(this.confidence, data.confidence);

    const hash: number = fnv1a(data.normalized);

    // A value already counted changes nothing, even once the set is full.
    if (!this.distinct.has(hash)) {
      if (this.distinct.size < MAX_COUNTED_DISTINCT_VALUES) {
        this.distinct.add(hash);
      } else {
        this.distinctCapped = true;
      }
    }

    if (this.maskedSamples.length < MAX_MASKED_SAMPLES) {
      const masked: string = maskValue(
        this.dataTypeId,
        data.raw || data.normalized,
      );

      if (!this.maskedSamples.includes(masked)) {
        this.maskedSamples.push(masked);
      }
    }
  }

  public get distinctValues(): number {
    return this.distinct.size;
  }

  public toJSON(): DataTypeTallyJSON {
    return {
      dataTypeId: this.dataTypeId,
      matchCount: this.matchCount,
      testValueCount: this.testValueCount,
      confidence: this.confidence,
      maskedSamples: [...this.maskedSamples],
      distinctValues: this.distinct.size,
      distinctValuesCapped: this.distinctCapped,
    };
  }
}

// Tallies by data type, for one place a scan looked.
export class FindingTally {
  private readonly tallies: Map<string, DataTypeTally> = new Map();

  public add(data: {
    dataTypeId: string;
    normalized: string;
    confidence: DataConfidence;
    isTestValue: boolean;
    raw?: string | undefined;
  }): void {
    let tally: DataTypeTally | undefined = this.tallies.get(data.dataTypeId);

    if (!tally) {
      tally = new DataTypeTally(data.dataTypeId);
      this.tallies.set(data.dataTypeId, tally);
    }

    tally.add(data);
  }

  public get(dataTypeId: string): DataTypeTally | undefined {
    return this.tallies.get(dataTypeId);
  }

  public all(): Array<DataTypeTally> {
    return [...this.tallies.values()];
  }

  public get size(): number {
    return this.tallies.size;
  }
}
