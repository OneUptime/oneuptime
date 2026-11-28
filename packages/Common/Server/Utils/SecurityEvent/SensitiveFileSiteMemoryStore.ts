import GlobalCache from "../../Infrastructure/GlobalCache";
import Redis from "../../Infrastructure/Redis";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SENSITIVE_FILE_MEMORY_IN_HOURS,
  SensitiveFileMemory,
  createSensitiveFileMemory,
  isSensitiveFileMemoryNeeded,
  judgeSensitiveFileAnswers,
  mergeSensitiveFileMemory,
  readSensitiveFileMemory,
  writeSensitiveFileMemory,
} from "../../../Utils/SecurityEvent/SensitiveFileAnswers";
import logger from "../Logger";

/*
 * WHAT EACH SITE ANSWERED IN THE LAST DAY, KEPT FROM SCAN TO SCAN (#11036).
 *
 * A request for /.env that a site answered with a size and no type is
 * judged by what the same site answered the batch's other requests
 * (SensitiveFileAnswers) - and a scanner that asks for it alone leaves the
 * batch nothing to judge it by. So each scan keeps what its batches said of
 * every site - when it last answered a sensitive path "not found", the
 * sizes of its own page, the answers nothing decided, the files it served -
 * and the next scan judges by that too, for a day.
 *
 * What it costs is bounded whatever the project sends:
 *
 *   - one read a scan, of one small value per project and kind of scan
 *     (the log scan's, the trace scan's), and only once a page holds an
 *     answer nothing recorded the type of - every later page of the scan,
 *     and every site, judged from what that read and the pages before
 *     taught it;
 *   - at most one write a scan, at its end, and only when a batch taught it
 *     something worth keeping: a fact it did not hold, or one it last kept
 *     more than an hour ago;
 *   - a value of at most MAX_REMEMBERED_SITES sites, each with a handful of
 *     facts (writeSensitiveFileMemory).
 *
 * Re-reading the last day's security events instead would read every event
 * the project stored that day, once a minute while a single-page app is
 * being scanned: the attributes a request's answer is in are no column an
 * index narrows. Measured for #11036 on ClickHouse 26.7, a day of 1,000,000
 * security events, 2% of them requests for sensitive files spread through
 * it, made that read scan 911,624 rows and 307 MB, with about 150 MB of
 * memory, each time.
 *
 * Never a reason to fail a scan, and never a reason to call an answer the
 * file: a memory that cannot be read or kept - no cache, a value of another
 * shape - is a memory that says nothing, and a request it cannot decide is
 * left out, as before.
 */

// Where each project's memory is kept, by the scan that keeps it.
export const SENSITIVE_FILE_MEMORY_CACHE_NAMESPACE: string =
  "security-sensitive-file-sites";

// A memory nobody wrote for a day says nothing more: it goes.
export const SENSITIVE_FILE_MEMORY_EXPIRES_IN_SECONDS: number =
  SENSITIVE_FILE_MEMORY_IN_HOURS * 60 * 60;

// The scans that judge a served file, each with a memory of its own.
export enum SensitiveFileMemoryScan {
  Logs = "logs",
  Traces = "traces",
}

export function getSensitiveFileMemoryKey(data: {
  projectId: ObjectID;
  scan: SensitiveFileMemoryScan;
}): string {
  return `${data.projectId.toString()}-${data.scan}`;
}

export default class SensitiveFileSiteMemoryStore {
  private readonly projectId: ObjectID;
  private readonly scan: SensitiveFileMemoryScan;
  private readonly memory: SensitiveFileMemory;
  private isRead: boolean = false;

  // What the scan cost the cache: its reads and its writes.
  public reads: number = 0;
  public writes: number = 0;

  private constructor(data: {
    projectId: ObjectID;
    scan: SensitiveFileMemoryScan;
    now: Date;
  }) {
    this.projectId = data.projectId;
    this.scan = data.scan;
    this.memory = createSensitiveFileMemory(data.now);
  }

  // A scan's memory: empty until a page needs what it keeps.
  public static forScan(data: {
    projectId: ObjectID;
    scan: SensitiveFileMemoryScan;
    now: Date;
  }): SensitiveFileSiteMemoryStore {
    return new SensitiveFileSiteMemoryStore(data);
  }

  /*
   * A page's events to store (judgeSensitiveFileAnswers), each request its
   * page cannot decide judged by what its site answered the scan's pages
   * before it and the scans of the last day - read the first time a page
   * needs them. What the page says of its sites is then kept for the rest.
   */
  public async judge(
    events: Array<NormalizedSecurityEvent>,
  ): Promise<Array<NormalizedSecurityEvent>> {
    if (!this.isRead && isSensitiveFileMemoryNeeded(events)) {
      await this.read();
    }

    return judgeSensitiveFileAnswers(events, this.memory);
  }

  // What the memory holds now, for the tests that pin it.
  public getMemory(): SensitiveFileMemory {
    return this.memory;
  }

  /*
   * What the scan learned, kept for the next: written once, at the scan's
   * end, over what was kept before - read first when no page needed it, so
   * nothing of it is lost. Nothing learned, nothing written.
   */
  public async save(): Promise<void> {
    if (!this.memory.isChanged) {
      return;
    }

    if (!this.isRead) {
      await this.read();
    }

    if (!Redis.isConnected()) {
      return;
    }

    try {
      this.writes++;
      await GlobalCache.setJSON(
        SENSITIVE_FILE_MEMORY_CACHE_NAMESPACE,
        this.key(),
        writeSensitiveFileMemory(this.memory),
        { expiresInSeconds: SENSITIVE_FILE_MEMORY_EXPIRES_IN_SECONDS },
      );
      this.memory.isChanged = false;
    } catch (error) {
      logger.warn(
        `SensitiveFileSiteMemoryStore: could not keep what project ${this.projectId.toString()}'s ${this.scan} scan learned of its sites; the next scan judges each request by its page and what it keeps itself. ${String(error)}`,
      );
    }
  }

  private key(): string {
    return getSensitiveFileMemoryKey({
      projectId: this.projectId,
      scan: this.scan,
    });
  }

  // What the scans before kept, added to what this one learned so far.
  private async read(): Promise<void> {
    this.isRead = true;

    if (!Redis.isConnected()) {
      return;
    }

    try {
      this.reads++;

      const kept: JSONObject | null = await GlobalCache.getJSONObject(
        SENSITIVE_FILE_MEMORY_CACHE_NAMESPACE,
        this.key(),
      );

      mergeSensitiveFileMemory(
        this.memory,
        readSensitiveFileMemory(kept, new Date(this.memory.now)),
      );
    } catch (error) {
      logger.warn(
        `SensitiveFileSiteMemoryStore: could not read what project ${this.projectId.toString()}'s ${this.scan} scans kept of its sites; each request is judged by its page and what this scan learns. ${String(error)}`,
      );
    }
  }
}
