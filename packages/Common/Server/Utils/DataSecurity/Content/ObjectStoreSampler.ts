import { higherConfidence } from "../../../../Types/DataSecurity/DataConfidence";
import { JSONObject } from "../../../../Types/JSON";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";
import {
  MAX_COUNTED_DISTINCT_VALUES,
  MAX_MASKED_SAMPLES,
} from "../../../../Utils/DataSecurity/FindingTally";
import {
  getObjectExtension,
  toPathPattern,
} from "../../../../Utils/DataSecurity/PathPattern";
import {
  ObjectStoreListPage,
  ObjectStoreObject,
  ObjectStoreReader,
} from "../Cloud/DataSecurityCloudTypes";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  emptyContentScanResult,
  LocationFindings,
  MAX_READ_LOG_ENTRIES,
} from "../DataSecurityScanTypes";
import { FingerprintAccumulator } from "../Fingerprint";
import { classifyContent, ContentClassification } from "./ContentClassifier";

/*
 * A BUCKET, SAMPLED BY KIND.
 *
 * A bucket can hold ten million objects; a scan reads a few hundred. So
 * the sampler lists names first (page by page, at most LISTING_FACTOR
 * times the objects it may read), turns every name into its pattern
 * (PathPattern.ts: exports/*\/users-*.csv), and reads the most recent
 * objects of each pattern, one of each before a second of any - so a
 * bucket of one huge pattern and many small ones has every small one
 * covered, not a thousand copies of the big one. Each object is read from
 * its start (readObjectStart: at most maxBytesPerObject, at most
 * maxBytesTotal in all) and classified (ContentClassifier.ts).
 *
 * What it finds is reported by pattern, never by object: a field of a
 * pattern is "exports/*\/users-*.csv › email", free text is the pattern
 * itself. The findings of every object of a pattern are added together.
 *
 * An incremental scan skips an object whose etag has not changed since
 * the last scan read it - unless that was REREAD_AFTER_DAYS ago, so a
 * finding of an unchanged object is still seen before the evaluator stops
 * counting it - and reads the next one of its pattern instead. What could
 * not be done - a list or read that failed, the deadline, the byte budget -
 * is a warning, and the result says it is not complete.
 */

// How many names are listed for each object the scan may read.
export const LISTING_FACTOR: number = 10;

// The most names listed, whatever the limits.
export const MAX_LISTED_OBJECTS: number = 200_000;

const LIST_PAGE_SIZE: number = 1_000;

// The most objects of one pattern read in one scan.
export const SAMPLES_PER_PATTERN: number = 5;

// An unchanged object is read again after this long.
export const REREAD_AFTER_DAYS: number = 7;

// The most objects the next scan's state remembers.
export const MAX_STATE_ENTRIES: number = 2_000;

const MAX_STATE_KEY_LENGTH: number = 512;

const MAX_WARNINGS: number = 50;

const MAX_PLAINTEXT_PASSWORD_FIELDS: number = 50;

const MAX_ERROR_LENGTH: number = 200;

export const LOCATION_SEPARATOR: string = " › ";

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// Formats known by their extension that no reader reads: not even fetched.
const UNREAD_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["png", "PNG image"],
  ["jpg", "JPEG image"],
  ["jpeg", "JPEG image"],
  ["gif", "GIF image"],
  ["webp", "WebP image"],
  ["bmp", "BMP image"],
  ["ico", "icon"],
  ["tif", "TIFF image"],
  ["tiff", "TIFF image"],
  ["heic", "HEIC image"],
  ["mp4", "MP4 video"],
  ["mov", "QuickTime video"],
  ["avi", "AVI video"],
  ["mkv", "Matroska video"],
  ["webm", "WebM video"],
  ["mp3", "MP3 audio"],
  ["wav", "WAV audio"],
  ["flac", "FLAC audio"],
  ["ogg", "Ogg media"],
  ["m4a", "M4A audio"],
  ["parquet", "Parquet"],
  ["avro", "Avro"],
  ["orc", "ORC"],
  ["arrow", "Arrow"],
  ["feather", "Feather"],
  ["pdf", "PDF"],
  ["tar", "tar archive"],
  ["tgz", "tar archive"],
  ["7z", "7z archive"],
  ["rar", "RAR archive"],
  ["bz2", "bzip2"],
  ["xz", "xz"],
  ["zst", "Zstandard"],
  ["exe", "executable"],
  ["dll", "library"],
  ["so", "library"],
  ["dylib", "library"],
  ["class", "Java class file"],
  ["jar", "Java archive"],
  ["war", "Java archive"],
  ["pyc", "Python bytecode"],
  ["wasm", "WebAssembly"],
  ["iso", "disk image"],
  ["dmg", "disk image"],
  ["woff", "font"],
  ["woff2", "font"],
  ["ttf", "font"],
  ["otf", "font"],
]);

export class ScanDeadlineError extends Error {
  public constructor() {
    super("The scan reached its deadline.");
  }
}

/*
 * The work, or a ScanDeadlineError once the deadline passes: a read that
 * hangs cannot hold the scan past its end.
 */
export async function beforeDeadline<T>(
  work: Promise<T>,
  deadline: Date,
): Promise<T> {
  const left: number = deadline.getTime() - Date.now();

  if (left <= 0) {
    throw new ScanDeadlineError();
  }

  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>(
        (_resolve: (value: never) => void, reject: (error: Error) => void) => {
          timer = setTimeout(() => {
            reject(new ScanDeadlineError());
          }, left);
        },
      ),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function describeError(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message : String(error || "unknown error");

  return message.split("\n")[0]!.slice(0, MAX_ERROR_LENGTH);
}

interface StateEntry {
  etag: string;
  readAt: number;
}

// What the last scan left: the etag of each object it read, and when.
export function readPreviousEtags(
  state: JSONObject | undefined,
): Map<string, StateEntry> {
  const entries: Map<string, StateEntry> = new Map();
  const etags: unknown = state?.["etags"];

  if (!etags || typeof etags !== "object" || Array.isArray(etags)) {
    return entries;
  }

  for (const [key, value] of Object.entries(etags as Record<string, unknown>)) {
    if (typeof value === "string") {
      entries.set(key, { etag: value, readAt: 0 });
      continue;
    }

    if (value && typeof value === "object") {
      const entry: { etag?: unknown; readAt?: unknown } = value as {
        etag?: unknown;
        readAt?: unknown;
      };
      const readAt: number =
        typeof entry.readAt === "string" ? Date.parse(entry.readAt) : NaN;

      if (typeof entry.etag === "string") {
        entries.set(key, {
          etag: entry.etag,
          readAt: Number.isFinite(readAt) ? readAt : 0,
        });
      }
    }
  }

  return entries;
}

function normalizeExclusions(exclusions: Array<string>): Array<string> {
  return exclusions
    .map((exclusion: string) => {
      let prefix: string = exclusion.trim();

      while (prefix.startsWith("/")) {
        prefix = prefix.slice(1);
      }

      return prefix;
    })
    .filter((prefix: string) => {
      return prefix.length > 0;
    });
}

interface PatternGroup {
  pattern: string;
  // Objects that can be read, the most recently modified first.
  objects: Array<ObjectStoreObject>;
  cursor: number;
  picked: number;
  // Objects of formats no reader reads, by format.
  unreadFormats: Map<string, number>;
}

interface Pick {
  object: ObjectStoreObject;
  group: PatternGroup;
}

interface PatternStats {
  read: number;
  sensitiveRecords: number;
}

// Two findings of one data type in one place, added together.
export function mergeClassifications(
  a: FieldClassification,
  b: FieldClassification,
): FieldClassification {
  const samples: Array<string> = [...a.maskedSamples];

  for (const sample of b.maskedSamples) {
    if (samples.length >= MAX_MASKED_SAMPLES) {
      break;
    }

    if (!samples.includes(sample)) {
      samples.push(sample);
    }
  }

  const valueCount: number = a.valueCount + b.valueCount;
  const valuesWithMatch: number = a.valuesWithMatch + b.valuesWithMatch;
  const distinctValues: number = Math.max(a.distinctValues, b.distinctValues);

  return {
    dataTypeId: a.dataTypeId,
    matchCount: a.matchCount + b.matchCount,
    testValueCount: a.testValueCount + b.testValueCount,
    confidence:
      a.matchCount === 0
        ? b.confidence
        : b.matchCount === 0
          ? a.confidence
          : higherConfidence(a.confidence, b.confidence),
    maskedSamples: samples,
    distinctValues: Math.min(distinctValues, MAX_COUNTED_DISTINCT_VALUES),
    distinctValuesCapped:
      a.distinctValuesCapped ||
      b.distinctValuesCapped ||
      distinctValues > MAX_COUNTED_DISTINCT_VALUES,
    matchRatio: valueCount > 0 ? valuesWithMatch / valueCount : 0,
    valueCount,
    valuesWithMatch,
    isFreeText: a.isFreeText || b.isFreeText,
    nameHinted: a.nameHinted || b.nameHinted,
    foundByName: a.foundByName && b.foundByName,
  };
}

// Where a finding of an object is reported: its pattern, and the field.
export function getPatternLocation(
  pattern: string,
  location: LocationFindings,
): { location: string; locationKind: DataStoreLocationKind } {
  if (!location.location) {
    return { location: pattern, locationKind: DataStoreLocationKind.Object };
  }

  return {
    location: `${pattern}${LOCATION_SEPARATOR}${location.location}`,
    locationKind:
      location.locationKind === DataStoreLocationKind.Text
        ? DataStoreLocationKind.Object
        : location.locationKind,
  };
}

class Findings {
  private readonly locations: Map<
    string,
    {
      locationKind: DataStoreLocationKind;
      byType: Map<string, FieldClassification>;
    }
  > = new Map();

  public add(pattern: string, found: LocationFindings): void {
    const place: { location: string; locationKind: DataStoreLocationKind } =
      getPatternLocation(pattern, found);
    let entry:
      | {
          locationKind: DataStoreLocationKind;
          byType: Map<string, FieldClassification>;
        }
      | undefined = this.locations.get(place.location);

    if (!entry) {
      entry = { locationKind: place.locationKind, byType: new Map() };
      this.locations.set(place.location, entry);
    }

    for (const classification of found.classifications) {
      const existing: FieldClassification | undefined = entry.byType.get(
        classification.dataTypeId,
      );

      entry.byType.set(
        classification.dataTypeId,
        existing
          ? mergeClassifications(existing, classification)
          : {
              ...classification,
              maskedSamples: [...classification.maskedSamples],
            },
      );
    }
  }

  public toLocations(): Array<LocationFindings> {
    return [...this.locations.entries()].map(
      ([location, entry]: [
        string,
        {
          locationKind: DataStoreLocationKind;
          byType: Map<string, FieldClassification>;
        },
      ]) => {
        return {
          location,
          locationKind: entry.locationKind,
          classifications: [...entry.byType.values()],
        };
      },
    );
  }
}

function byRecency(a: ObjectStoreObject, b: ObjectStoreObject): number {
  const first: number = a.lastModified?.getTime() ?? -1;
  const second: number = b.lastModified?.getTime() ?? -1;

  if (first !== second) {
    return second - first;
  }

  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

export async function sampleObjectStore(
  reader: ObjectStoreReader,
  options: ContentScanOptions,
): Promise<ContentScanResult> {
  const result: ContentScanResult = emptyContentScanResult();
  const limits: ContentScanOptions["limits"] = options.limits;
  const deadline: Date = limits.deadline;
  const warnings: Array<string> = [];
  const warned: Set<string> = new Set();
  const exclusions: Array<string> = normalizeExclusions(options.exclusions);
  const previous: Map<string, StateEntry> = readPreviousEtags(
    options.previousState,
  );
  const now: number = Date.now();
  let isComplete: boolean = true;

  const warn: (message: string) => void = (message: string): void => {
    if (!warned.has(message) && warnings.length < MAX_WARNINGS) {
      warned.add(message);
      warnings.push(message);
    }
  };

  // 1. The names, page by page, grouped by pattern.
  const maxListed: number = Math.min(
    MAX_LISTED_OBJECTS,
    Math.max(1, limits.maxObjects) * LISTING_FACTOR,
  );
  const groups: Map<string, PatternGroup> = new Map();
  const listedKeys: Set<string> = new Set();
  let listed: number = 0;
  let nextToken: string | undefined = undefined;
  let listingFinished: boolean = false;
  let pages: number = 0;
  const maxPages: number = Math.ceil(maxListed / LIST_PAGE_SIZE) + 10;

  while (pages < maxPages) {
    let page: ObjectStoreListPage;

    try {
      // No request is started that the deadline would throw away.
      if (Date.now() >= deadline.getTime()) {
        throw new ScanDeadlineError();
      }

      page = await beforeDeadline(
        reader.listObjects({
          nextToken,
          maxKeys: Math.min(LIST_PAGE_SIZE, maxListed - listed),
        }),
        deadline,
      );
    } catch (error) {
      isComplete = false;
      warn(
        error instanceof ScanDeadlineError
          ? `The scan reached its time limit while listing ${reader.description}, after ${listed} objects.`
          : `Could not list the objects of ${reader.description}: ${describeError(error)}`,
      );
      break;
    }

    pages++;

    for (const object of page.objects) {
      if (listed >= maxListed) {
        break;
      }

      listed++;

      if (
        !object ||
        typeof object.key !== "string" ||
        object.key.endsWith("/") ||
        !(object.sizeInBytes > 0)
      ) {
        continue;
      }

      listedKeys.add(object.key);

      if (
        exclusions.some((prefix: string) => {
          return object.key.startsWith(prefix);
        })
      ) {
        continue;
      }

      const pattern: string = toPathPattern(object.key);
      let group: PatternGroup | undefined = groups.get(pattern);

      if (!group) {
        group = {
          pattern,
          objects: [],
          cursor: 0,
          picked: 0,
          unreadFormats: new Map(),
        };
        groups.set(pattern, group);
      }

      const unreadFormat: string | undefined = UNREAD_EXTENSIONS.get(
        getObjectExtension(object.key),
      );

      if (unreadFormat) {
        group.unreadFormats.set(
          unreadFormat,
          (group.unreadFormats.get(unreadFormat) || 0) + 1,
        );
        continue;
      }

      group.objects.push(object);
    }

    nextToken = page.nextToken;

    if (!nextToken) {
      listingFinished = true;
      break;
    }

    if (listed >= maxListed) {
      warn(
        `Listed the first ${listed} objects of ${reader.description}; the patterns of the objects after them were not sampled.`,
      );
      break;
    }
  }

  for (const group of groups.values()) {
    group.objects.sort(byRecency);

    for (const [format] of group.unreadFormats) {
      warn(`${group.pattern}: not scanned: ${format} is not supported yet`);
    }
  }

  // 2. The objects to read: the most recent of each pattern, in turns.
  const ordered: Array<PatternGroup> = [...groups.values()]
    .filter((group: PatternGroup) => {
      return group.objects.length > 0;
    })
    .sort((a: PatternGroup, b: PatternGroup) => {
      const newest: number =
        byRecency(a.objects[0]!, b.objects[0]!) ||
        (a.pattern < b.pattern ? -1 : 1);

      return newest;
    });
  const picks: Array<Pick> = [];
  const unchangedKeys: Set<string> = new Set();
  const maxObjects: number = Math.max(0, limits.maxObjects);

  for (let round: number = 0; round < SAMPLES_PER_PATTERN; round++) {
    let pickedThisRound: boolean = false;

    for (const group of ordered) {
      if (picks.length >= maxObjects) {
        break;
      }

      while (group.cursor < group.objects.length) {
        const object: ObjectStoreObject = group.objects[group.cursor]!;
        const last: StateEntry | undefined = previous.get(object.key);

        group.cursor++;

        const isUnchanged: boolean =
          Boolean(object.etag) &&
          last !== undefined &&
          last.etag === object.etag &&
          now - last.readAt < REREAD_AFTER_DAYS * DAY_IN_MS;

        if (isUnchanged) {
          unchangedKeys.add(object.key);
          continue;
        }

        picks.push({ object, group });
        group.picked++;
        pickedThisRound = true;
        break;
      }
    }

    if (!pickedThisRound || picks.length >= maxObjects) {
      break;
    }
  }

  const unsampled: number = ordered.filter((group: PatternGroup) => {
    return group.picked === 0 && group.cursor < group.objects.length;
  }).length;

  if (unsampled > 0) {
    isComplete = false;
    warn(
      `${unsampled} patterns were not sampled: the scan reads at most ${maxObjects} objects.`,
    );
  }

  // 3. Read and classify, within the byte budget and the deadline.
  const fingerprints: FingerprintAccumulator = new FingerprintAccumulator(
    options.fingerprintKey,
  );
  const findings: Findings = new Findings();
  const stats: Map<string, PatternStats> = new Map();
  const plaintextPasswordFields: Array<string> = [];
  const readNow: Map<string, StateEntry> = new Map();

  for (let index: number = 0; index < picks.length; index++) {
    const pick: Pick = picks[index]!;
    const key: string = pick.object.key;

    if (Date.now() >= deadline.getTime()) {
      isComplete = false;
      warn(
        `The scan reached its time limit after reading ${result.objectsRead} of ${picks.length} objects.`,
      );
      break;
    }

    const budgetLeft: number = limits.maxBytesTotal - result.bytesRead;

    if (budgetLeft <= 0) {
      isComplete = false;
      warn(
        `The scan read its ${limits.maxBytesTotal} bytes after ${result.objectsRead} of ${picks.length} objects.`,
      );
      break;
    }

    const maxBytes: number = Math.max(
      1,
      Math.min(limits.maxBytesPerObject, budgetLeft, pick.object.sizeInBytes),
    );
    let bytes: Uint8Array;

    try {
      bytes = await beforeDeadline(
        reader.readObjectStart(key, maxBytes),
        deadline,
      );
    } catch (error) {
      isComplete = false;

      if (error instanceof ScanDeadlineError) {
        warn(
          `The scan reached its time limit after reading ${result.objectsRead} of ${picks.length} objects.`,
        );
        break;
      }

      warn(`Could not read ${key}: ${describeError(error)}`);
      continue;
    }

    // Never more than was asked for, whatever the reader returned.
    if (bytes.length > maxBytes) {
      bytes = bytes.subarray(0, maxBytes);
    }

    result.objectsRead++;
    result.bytesRead += bytes.length;

    if (result.readLog.length < MAX_READ_LOG_ENTRIES) {
      result.readLog.push(key);
    }

    if (pick.object.etag && key.length <= MAX_STATE_KEY_LENGTH) {
      readNow.set(key, { etag: pick.object.etag, readAt: Date.now() });
    }

    const isTruncated: boolean = pick.object.sizeInBytes > bytes.length;
    let classification: ContentClassification;

    try {
      classification = classifyContent({
        name: key,
        bytes,
        options,
        fingerprints,
        isTruncated,
      });
    } catch (error) {
      isComplete = false;
      warn(`Could not classify ${key}: ${describeError(error)}`);
      continue;
    }

    for (const warning of classification.warnings) {
      warn(`${pick.group.pattern}: ${warning}`);
    }

    for (const location of classification.locations) {
      findings.add(pick.group.pattern, location);
    }

    for (const field of classification.plaintextPasswordFields) {
      const path: string = `${pick.group.pattern}${LOCATION_SEPARATOR}${field}`;

      if (
        plaintextPasswordFields.length < MAX_PLAINTEXT_PASSWORD_FIELDS &&
        !plaintextPasswordFields.includes(path)
      ) {
        plaintextPasswordFields.push(path);
      }
    }

    result.rowsRead += classification.recordCount;

    /*
     * The records of the whole object, from those in the bytes read: a
     * CSV's first 64 KB of a 10 MB file is about a 150th of its rows. A
     * document is one record however much of it was read.
     */
    const scale: number =
      isTruncated && classification.recordCount > 1 && bytes.length > 0
        ? pick.object.sizeInBytes / bytes.length
        : 1;
    const patternStats: PatternStats = stats.get(pick.group.pattern) || {
      read: 0,
      sensitiveRecords: 0,
    };

    patternStats.read++;
    patternStats.sensitiveRecords +=
      classification.recordsWithSensitive * scale;
    stats.set(pick.group.pattern, patternStats);
  }

  // 4. The result: findings by pattern, and what the next scan can skip.
  let estimatedRecords: number = 0;

  for (const [pattern, patternStats] of stats) {
    const group: PatternGroup | undefined = groups.get(pattern);
    const objectsOfPattern: number = group ? group.objects.length : 1;

    if (patternStats.read > 0) {
      estimatedRecords +=
        patternStats.sensitiveRecords * (objectsOfPattern / patternStats.read);
    }
  }

  result.locations = findings.toLocations();
  result.fingerprints = fingerprints.getFingerprints();
  result.plaintextPasswordFields = plaintextPasswordFields;
  result.warnings = warnings;
  result.isComplete = isComplete;
  result.estimatedRecords =
    result.objectsRead > 0 ? Math.round(estimatedRecords) : undefined;
  result.nextState = buildNextState({
    previous,
    readNow,
    unchangedKeys,
    listedKeys,
    listingFinished,
  });

  return result;
}

/*
 * What the next scan needs: the etag of every object read now, and of
 * those skipped as unchanged (with when they were last read), then the
 * rest of what the last scan knew while it may still be there - all
 * capped, the most recently read first.
 */
function buildNextState(data: {
  previous: Map<string, StateEntry>;
  readNow: Map<string, StateEntry>;
  unchangedKeys: Set<string>;
  listedKeys: Set<string>;
  listingFinished: boolean;
}): JSONObject {
  const entries: Map<string, StateEntry> = new Map(data.readNow);

  for (const [key, entry] of data.previous) {
    if (entries.has(key)) {
      continue;
    }

    // A finished listing that did not name an object: it is gone.
    if (data.listingFinished && !data.listedKeys.has(key)) {
      continue;
    }

    entries.set(key, entry);
  }

  const kept: Array<[string, StateEntry]> = [...entries.entries()]
    .sort((a: [string, StateEntry], b: [string, StateEntry]) => {
      const firstUnchanged: number = Number(data.unchangedKeys.has(a[0]));
      const secondUnchanged: number = Number(data.unchangedKeys.has(b[0]));

      return b[1].readAt - a[1].readAt || secondUnchanged - firstUnchanged;
    })
    .slice(0, MAX_STATE_ENTRIES);

  const etags: JSONObject = {};

  for (const [key, entry] of kept) {
    etags[key] = {
      etag: entry.etag,
      readAt: new Date(entry.readAt).toISOString(),
    };
  }

  return { etags };
}
