import {
  ClassifiedOpenStackError,
  OpenStackApiError,
  OpenStackBudgetExceededError,
  classifyOpenStackError,
} from "./OpenStackCollectionErrors";
import OpenStackServiceClient from "./OpenStackServiceClient";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import { OpenStackServiceOutcome } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";

/*
 * One service's reads in one region, each on its own.
 *
 * A failing read costs that read, and the others go on. Only when the service itself
 * looks to be in trouble - it said 429 or 503, or two reads in a row failed - does the
 * rest of its reads wait for the next collection, because asking a struggling service
 * for the rest of its lists is how monitoring makes it worse. Either way what was read
 * is kept.
 *
 * `isInventory` says whether a read is what vouches for rows. It is the difference
 * between a blemish and a hole. openstack_<service>_up reading 1 is what lets the
 * stale-row rule delete a row it has not seen lately, so a read that failed, or was
 * never made, must not let it say 1: the rows it would have vouched for are not gone,
 * they just were not read. A count nothing keeps a row of, such as aggregates, costs
 * only itself.
 */

export type OpenStackReadState =
  | "ok"
  // It answered, and said this credential may not.
  | "refused"
  // It answered, and has no such route.
  | "absent"
  | "failing"
  // Never asked: no time left, or the service was already in trouble.
  | "skipped";

export interface OpenStackReadOutcome {
  name: string;
  isInventory: boolean;
  /*
   * Asked without a token, as Nova's list of versions is. It shows the API is there, and
   * says nothing about what this credential can read.
   */
  isOpenToAnyone?: boolean | undefined;
  state: OpenStackReadState;
  status?: number | undefined;
  message?: string | undefined;
  durationInMs: number;
}

const FAILURES_IN_A_ROW_BEFORE_STOPPING: number = 2;

export default class OpenStackServiceRun {
  public readonly service: OpenStackServiceType;
  public readonly regionName: string;
  public readonly client: OpenStackServiceClient;
  public readonly reads: Array<OpenStackReadOutcome> = [];
  public readonly warnings: Array<string> = [];

  public isOverloaded: boolean = false;
  public isOutOfTime: boolean = false;
  public gotAnAnswer: boolean = false;
  public firstFailure: ClassifiedOpenStackError | null = null;
  public startedAt: number;
  public finishedAt: number | null = null;

  private failuresInARow: number = 0;

  public constructor(data: {
    service: OpenStackServiceType;
    regionName: string;
    client: OpenStackServiceClient;
  }) {
    this.service = data.service;
    this.regionName = data.regionName;
    this.client = data.client;
    this.startedAt = data.client.now();
  }

  // Whether the rest of this service's reads should wait for the next collection.
  public isStopped(): boolean {
    return (
      this.isOverloaded ||
      this.isOutOfTime ||
      this.failuresInARow >= FAILURES_IN_A_ROW_BEFORE_STOPPING
    );
  }

  /*
   * One read. What `run` throws is written down here and never goes further, which is
   * what keeps one read, and so one service, from touching another.
   */
  public async read<T>(data: {
    name: string;
    isInventory: boolean;
    isOpenToAnyone?: boolean | undefined;
    /*
     * Left out on purpose by every credential the docs recommend, so a refusal is no news,
     * and a warning would send someone looking for what is wrong with their cloud.
     */
    isQuietWhenRefused?: boolean | undefined;
    run: () => Promise<T>;
  }): Promise<T | undefined> {
    const startedAt: number = this.client.now();

    if (this.isStopped()) {
      this.reads.push({
        name: data.name,
        isInventory: data.isInventory,
        state: "skipped",
        durationInMs: 0,
      });
      return undefined;
    }

    try {
      const result: T = await data.run();

      this.gotAnAnswer = true;
      this.failuresInARow = 0;
      this.reads.push({
        name: data.name,
        isInventory: data.isInventory,
        isOpenToAnyone: data.isOpenToAnyone,
        state: "ok",
        durationInMs: this.client.now() - startedAt,
      });

      return result;
    } catch (error) {
      this.recordFailure(data, error, this.client.now() - startedAt);
      return undefined;
    }
  }

  // Marks the collection's end reached from outside, for a read that never returned.
  public markOutOfTime(message: string): void {
    this.isOutOfTime = true;

    if (!this.firstFailure) {
      this.firstFailure = {
        code: OpenStackCollectionErrorCode.TimedOut,
        message: message,
      };
    }
  }

  public finish(): void {
    if (this.finishedAt === null) {
      this.finishedAt = this.client.now();
    }
  }

  public getDurationInMs(): number {
    return Math.max(0, (this.finishedAt ?? this.client.now()) - this.startedAt);
  }

  private countOf(states: ReadonlyArray<OpenStackReadState>): number {
    return this.reads.filter((read: OpenStackReadOutcome): boolean => {
      return !read.isOpenToAnyone && states.includes(read.state);
    }).length;
  }

  /*
   * What this run's openstack_<service>_up reads. It answered, with data or with a
   * refusal, and nothing that vouches for rows failed. A refusal counts as answering:
   * the API is up, and it is the credential that may not.
   */
  public isApiUp(): boolean {
    if (this.isOutOfTime) {
      return false;
    }

    const hasInventoryHole: boolean = this.reads.some(
      (read: OpenStackReadOutcome): boolean => {
        return (
          read.isInventory &&
          (read.state === "failing" || read.state === "skipped")
        );
      },
    );

    return !hasInventoryHole && this.countOf(["ok", "refused"]) > 0;
  }

  /*
   * What this run's `up` reads. The receiver's `up` reads 0 when a scrape got no
   * answer or ran out of time, and an API that answered with an error reads 1, so
   * this does too: it is `_up` that says the API is not well.
   */
  public isAnswered(): boolean {
    return this.gotAnAnswer && !this.isOutOfTime;
  }

  public getOutcome(): OpenStackServiceOutcome {
    const answered: number = this.countOf(["ok"]);
    const refused: number = this.countOf(["refused"]);

    const hasInventoryHole: boolean = this.reads.some(
      (read: OpenStackReadOutcome): boolean => {
        return (
          read.isInventory &&
          (read.state === "failing" || read.state === "skipped")
        );
      },
    );

    if (answered === 0) {
      /*
       * Refusing everything is the credential's level, and the API is fine. Nothing
       * but 404s is an answer from something that is not this service.
       */
      return refused > 0 && !hasInventoryHole && !this.isOutOfTime
        ? "Refused"
        : "Failed";
    }

    return hasInventoryHole || this.isOutOfTime ? "Partial" : "Succeeded";
  }

  /*
   * Whether to ask this service less often for a while: it asked us to, it could not
   * finish in time, or nothing at all came back.
   */
  public mustBackOff(): boolean {
    return (
      this.isOverloaded || this.isOutOfTime || this.getOutcome() === "Failed"
    );
  }

  private recordFailure(
    read: {
      name: string;
      isInventory: boolean;
      isOpenToAnyone?: boolean | undefined;
      isQuietWhenRefused?: boolean | undefined;
    },
    error: unknown,
    durationInMs: number,
  ): void {
    const classified: ClassifiedOpenStackError = classifyOpenStackError(
      error,
      this.getErrorContext(),
    );

    let state: OpenStackReadState = "failing";
    let status: number | undefined;

    if (error instanceof OpenStackApiError) {
      status = error.status;
      this.gotAnAnswer = true;

      if (error.kind === "refused") {
        state = "refused";
      } else if (error.kind === "absent") {
        state = "absent";
      } else if (error.kind === "overloaded") {
        this.isOverloaded = true;
      }
    }

    if (error instanceof OpenStackBudgetExceededError) {
      this.isOutOfTime = true;
      state = "skipped";
    }

    this.reads.push({
      name: read.name,
      isInventory: read.isInventory,
      isOpenToAnyone: read.isOpenToAnyone,
      state: state,
      status: status,
      message: classified.message,
      durationInMs: durationInMs,
    });

    if (state === "refused") {
      if (!read.isQuietWhenRefused) {
        this.warnings.push(classified.message);
      }

      return;
    }

    if (state === "absent") {
      return;
    }

    if (state === "failing") {
      this.failuresInARow++;
    }

    if (!this.firstFailure) {
      this.firstFailure = classified;
    }
  }

  private getErrorContext(): { host: string; port: number } {
    try {
      const url: globalThis.URL = new globalThis.URL(this.client.baseUrl);

      return {
        host: url.hostname,
        port: url.port ? Number.parseInt(url.port, 10) : 443,
      };
    } catch {
      return { host: this.client.baseUrl, port: 443 };
    }
  }
}
