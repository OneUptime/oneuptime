import {
  MAX_REFUSED_CREDENTIAL_BACKOFF_IN_MS,
  OpenStackBackoffEntry,
  REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS,
} from "../OpenStackBackoff";
import {
  OpenStackCatalogService,
  findOpenStackEndpoint,
  getOpenStackCatalogRegions,
  toOpenStackServiceBaseUrl,
} from "../OpenStackCatalog";
import {
  ClassifiedOpenStackError,
  classifyOpenStackError,
} from "../OpenStackCollectionErrors";
import { getOpenStackCredentialKey } from "../OpenStackCollectorMemory";
import { OpenStackTransportHandle } from "../OpenStackHttp";
import {
  OpenStackKeystoneSession,
  OpenStackToken,
  keystoneLogin,
} from "../OpenStackKeystone";
import { mapWithLimit } from "../OpenStackServiceClient";
import {
  DEFAULT_OPENSTACK_CHECK_DEPENDENCIES,
  OpenStackCheckDependencies,
} from "./OpenStackCheckDependencies";
import {
  OPENSTACK_CHECK_ADMIN_ONLY_READS,
  OpenStackCheckAdminRead,
  getOpenStackCheckReachRefusal,
  getOpenStackCheckTokenRefusal,
} from "./OpenStackCheckGuard";
import {
  OpenStackOwnedListing,
  listOwnedResources,
  removeOwnedResources,
} from "./OpenStackCheckJanitor";
import OpenStackLifecycleCloud, {
  OpenStackCheckFaultError,
  OpenStackCheckRefusedError,
  OpenStackLifecycleEndpoints,
  OpenStackOwnedResource,
  boundFaultMessage,
  toCheckFaultError,
} from "./OpenStackLifecycleCloud";
import VMwareVCenterAddress from "Common/Utils/VMware/VMwareVCenterAddress";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  DEFAULT_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB,
  OPENSTACK_LIFECYCLE_STEP_PHASE,
  OpenStackCheckFault,
  OpenStackCheckFaultSource,
  OpenStackLifecycleCheckJob,
  OpenStackLifecycleCheckOptions,
  OpenStackLifecycleJanitorResult,
  OpenStackLifecyclePhase,
  OpenStackLifecyclePhaseVerdict,
  OpenStackLifecycleRun,
  OpenStackLifecycleRunStatus,
  OpenStackLifecycleStep,
  OpenStackLifecycleStepResult,
  getOpenStackJanitorAgeInMs,
  getOpenStackLifecycleRunBudgetInMs,
} from "Common/Types/OpenStack/OpenStackCheck";
import { OpenStackCredential } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import OpenStackAuthUrl, {
  OpenStackAddress,
  OpenStackAddressResult,
} from "Common/Utils/OpenStack/OpenStackAuthUrl";
import {
  buildOpenStackCheckName,
  buildOpenStackCheckRunId,
} from "Common/Utils/OpenStack/OpenStackCheckName";
import net from "net";

/*
 * ONE LIFECYCLE RUN: DOING WHAT A USER DOES, AND SAYING WHICH STEP WOULD HAVE STOPPED THEM.
 *
 * In each region, and only in the project this check was given:
 *
 *   log in, and refuse to go on with a credential that could reach further than that project
 *   list what is named for this check: a run's own that is too young to be left behind means one
 *     may still be going, so this run is skipped, and what is older than two intervals is deleted
 *   find the flavor, image and network
 *   create a server, and wait for ACTIVE                   (a failure here ends the run)
 *   optionally attach a floating IP, and ping it
 *   optionally create a volume, and attach it
 *   delete everything, and check that nothing is left
 *
 * A failure in the floating IP's part costs that part, and the volume's still runs: each is an
 * alert of its own, and one verdict is worth more than none. A boot that fails ends the run, since
 * nothing else can be asked of a server that is not there.
 *
 * Whatever happens, this ends with a report and with everything it made deleted or known to be
 * left. A probe killed part way can do neither, and that is what the janitor is for.
 *
 * The secret and the OSProfiler key go to Keystone and into a signature respectively, and never
 * into a report or a log line.
 */

// How long each wait may take. A run's whole budget can cut these shorter.
export const SERVER_ACTIVE_TIMEOUT_IN_MS: number = 10 * 60_000;
export const PING_TIMEOUT_IN_MS: number = 5 * 60_000;
export const VOLUME_AVAILABLE_TIMEOUT_IN_MS: number = 5 * 60_000;
export const VOLUME_ATTACH_TIMEOUT_IN_MS: number = 5 * 60_000;
export const VOLUME_DETACH_TIMEOUT_IN_MS: number = 3 * 60_000;
export const VOLUME_DELETE_TIMEOUT_IN_MS: number = 3 * 60_000;
export const SERVER_DELETE_TIMEOUT_IN_MS: number = 5 * 60_000;
export const SECURITY_GROUP_DELETE_TIMEOUT_IN_MS: number = 2 * 60_000;

// What is held back from the steps going forward, so there is always time to delete them.
export const CLEANUP_RESERVE_IN_MS: number = 5 * 60_000;

// However late it is, each step of the clean-up gets this long to try.
const MINIMUM_CLEANUP_WAIT_IN_MS: number = 60_000;

const PING_ATTEMPT_TIMEOUT_IN_MS: number = 3000;
const PING_RETRY_DELAY_IN_MS: number = 5000;

const KEYSTONE_TIMEOUT_IN_MS: number = 30_000;
const REGIONS_AT_A_TIME: number = 4;

// Quickly at first, since most things happen quickly, and then with room.
const POLL_DELAYS_IN_MS: ReadonlyArray<number> = [
  1000, 2000, 2000, 3000, 3000, 5000,
];
const POLL_DELAY_AFTERWARDS_IN_MS: number = 10_000;

export function getOpenStackCheckPollDelayInMs(attempt: number): number {
  return POLL_DELAYS_IN_MS[attempt] ?? POLL_DELAY_AFTERWARDS_IN_MS;
}

const GIB: number = 1024 * 1024 * 1024;

function text(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function count(value: JSONValue | undefined): number {
  const number: number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function describeWait(milliseconds: number): string {
  const minutes: number = Math.round(milliseconds / 60_000);

  return minutes >= 2
    ? `${minutes} minutes`
    : `${Math.round(milliseconds / 1000)} seconds`;
}

/*
 * What Nova said of a server in ERROR. Its fault's message is what a person acts on, and its
 * details hold a traceback only an admin is shown, so they are not kept.
 */
export function readOpenStackServerFault(
  server: JSONObject,
): OpenStackCheckFault {
  const fault: JSONObject = (server["fault"] as JSONObject) || {};
  const message: string = text(fault["message"]).trim();
  const code: number = count(fault["code"]);

  return {
    source: "nova",
    ...(code ? { code: code } : {}),
    message: boundFaultMessage(
      message || "Nova says the server is in ERROR, and gave no fault.",
    ),
  };
}

function fault(
  source: OpenStackCheckFaultSource,
  message: string,
  code?: number | undefined,
): OpenStackCheckFaultError {
  return new OpenStackCheckFaultError({
    source: source,
    ...(code ? { code: code } : {}),
    message: boundFaultMessage(message),
  });
}

/*
 * The smallest flavor that fits an image, so a boot's time is not spent on a big one. A flavor
 * without a disk asks for a boot from a volume, which needs a volume and is not what this is
 * measuring.
 */
export function chooseOpenStackCheckFlavor(data: {
  flavors: ReadonlyArray<JSONObject>;
  image: JSONObject;
}): JSONObject | null {
  const minimumRam: number = count(data.image["min_ram"]);
  const minimumDisk: number = Math.max(
    count(data.image["min_disk"]),
    Math.ceil(count(data.image["size"]) / GIB),
    1,
  );

  const fits: Array<JSONObject> = data.flavors.filter(
    (flavor: JSONObject): boolean => {
      return (
        flavor["OS-FLV-DISABLED:disabled"] !== true &&
        count(flavor["ram"]) >= minimumRam &&
        count(flavor["disk"]) >= minimumDisk
      );
    },
  );

  return (
    [...fits].sort((a: JSONObject, b: JSONObject): number => {
      return (
        count(a["ram"]) - count(b["ram"]) ||
        count(a["vcpus"]) - count(b["vcpus"]) ||
        count(a["disk"]) - count(b["disk"]) ||
        text(a["name"]).localeCompare(text(b["name"]))
      );
    })[0] || null
  );
}

// The small test image most clouds keep if there is one, or else the smallest there is.
export function chooseOpenStackCheckImage(
  images: ReadonlyArray<JSONObject>,
): JSONObject | null {
  const bySize: Array<JSONObject> = [...images].sort(
    (a: JSONObject, b: JSONObject): number => {
      return (
        count(a["size"]) - count(b["size"]) ||
        text(a["name"]).localeCompare(text(b["name"]))
      );
    },
  );

  return (
    bySize.find((image: JSONObject): boolean => {
      return text(image["name"]).toLowerCase().includes("cirros");
    }) ||
    bySize[0] ||
    null
  );
}

function isExternal(network: JSONObject): boolean {
  return network["router:external"] === true;
}

function namesOf(rows: ReadonlyArray<JSONObject>): string {
  return rows
    .map((row: JSONObject): string => {
      return text(row["name"]) || text(row["id"]);
    })
    .join(", ");
}

/*
 * The network to plug the server into: the only one this project has of its own that can take one,
 * or the only shared one if it has none. Asked to guess between several, it says so instead, because
 * plugged into the wrong one a boot still passes and a ping can never answer.
 */
export function chooseOpenStackCheckNetwork(data: {
  networks: ReadonlyArray<JSONObject>;
  projectId: string;
}): { network: JSONObject } | { error: string } {
  const usable: Array<JSONObject> = data.networks.filter(
    (network: JSONObject): boolean => {
      return (
        !isExternal(network) &&
        Array.isArray(network["subnets"]) &&
        (network["subnets"] as Array<unknown>).length > 0
      );
    },
  );
  const own: Array<JSONObject> = usable.filter(
    (network: JSONObject): boolean => {
      return (
        text(network["project_id"]) === data.projectId ||
        text(network["tenant_id"]) === data.projectId
      );
    },
  );
  const candidates: Array<JSONObject> = own.length > 0 ? own : usable;

  if (candidates.length === 1) {
    return { network: candidates[0] as JSONObject };
  }

  if (candidates.length === 0) {
    return {
      error:
        "This project can see no network with a subnet to plug a server into. Create one in the project, or share one with it.",
    };
  }

  return {
    error: `This project can see several networks a server could go on: ${namesOf(
      candidates,
    )}. Name one in the check's settings.`,
  };
}

// By its id or its exact name. A name two things share is not a name: it says so.
export function findOpenStackCheckByIdOrName(data: {
  rows: ReadonlyArray<JSONObject>;
  wanted: string;
  what: string;
}): { row: JSONObject } | { error: string } {
  const byId: JSONObject | undefined = data.rows.find(
    (row: JSONObject): boolean => {
      return row["id"] === data.wanted;
    },
  );

  if (byId) {
    return { row: byId };
  }

  const named: Array<JSONObject> = data.rows.filter(
    (row: JSONObject): boolean => {
      return row["name"] === data.wanted;
    },
  );

  if (named.length === 1) {
    return { row: named[0] as JSONObject };
  }

  if (named.length > 1) {
    return {
      error: `${named.length} ${data.what}s are called ${data.wanted}. Give this check the one you mean by its ID.`,
    };
  }

  return {
    error: `This project can see no ${data.what} called ${data.wanted}.`,
  };
}

interface WaitResult<T> {
  done: boolean;
  value?: T | undefined;
  // What the timeout's sentence will say, as of this poll.
  sofar?: string | undefined;
}

interface PreparedRun {
  flavorId: string;
  imageId: string;
  networkId: string;
  floatingNetworkId: string | null;
  floatingNetworkError: OpenStackCheckFaultError | null;
}

/*
 * One region's run. Never throws: everything that can go wrong goes wrong in a step, and every
 * step's failure is written down and acted on here.
 */
class OpenStackLifecycleRegionRun {
  private readonly job: OpenStackLifecycleCheckJob;
  private readonly deps: OpenStackCheckDependencies;
  private readonly cloud: OpenStackLifecycleCloud;
  private readonly regionName: string;
  private readonly runId: string;
  private readonly startedAt: number;
  private readonly projectId: string;
  private readonly projectName: string | null;
  private readonly options: OpenStackLifecycleCheckOptions;
  private readonly budgetInMs: number;
  private readonly tokenStep: OpenStackLifecycleStepResult;

  private readonly steps: Array<OpenStackLifecycleStepResult> = [];
  private readonly warnings: Array<string> = [];

  private status: OpenStackLifecycleRunStatus = "Succeeded";
  private message: string | undefined;
  private janitor: OpenStackLifecycleJanitorResult | undefined;
  private leftoverCount: number = 0;
  private traceId: string | undefined;

  private securityGroup: OpenStackOwnedResource | null = null;
  private server: OpenStackOwnedResource | null = null;
  private floatingIp: OpenStackOwnedResource | null = null;
  private volume: OpenStackOwnedResource | null = null;
  private isVolumeAttached: boolean = false;

  public constructor(data: {
    job: OpenStackLifecycleCheckJob;
    deps: OpenStackCheckDependencies;
    cloud: OpenStackLifecycleCloud;
    regionName: string;
    startedAt: number;
    projectId: string;
    projectName: string | null;
    tokenStep: OpenStackLifecycleStepResult;
  }) {
    this.job = data.job;
    this.deps = data.deps;
    this.cloud = data.cloud;
    this.regionName = data.regionName;
    this.startedAt = data.startedAt;
    this.projectId = data.projectId;
    this.projectName = data.projectName;
    this.tokenStep = data.tokenStep;
    this.options = data.job.options || {};
    this.budgetInMs = getOpenStackLifecycleRunBudgetInMs(
      data.job.intervalInMinutes,
    );
    this.runId = buildOpenStackCheckRunId({
      startedAt: data.startedAt,
      random: data.deps.randomHex(3),
    });
  }

  private now(): number {
    return this.deps.clock.now();
  }

  private nameOf(part: "server" | "volume" | "sg" | "fip"): string {
    return buildOpenStackCheckName({
      checkKey: this.job.checkKey,
      runId: this.runId,
      part: part,
    });
  }

  private sourceOfStep(
    step: OpenStackLifecycleStep,
  ): OpenStackCheckFaultSource {
    switch (step) {
      case OpenStackLifecycleStep.ServerCreate:
      case OpenStackLifecycleStep.ServerActive:
      case OpenStackLifecycleStep.ServerDelete:
      case OpenStackLifecycleStep.VolumeAttach:
      case OpenStackLifecycleStep.VolumeDetach:
      case OpenStackLifecycleStep.CredentialCheck:
      case OpenStackLifecycleStep.Prepare:
      case OpenStackLifecycleStep.Janitor:
        return "nova";
      case OpenStackLifecycleStep.VolumeCreate:
      case OpenStackLifecycleStep.VolumeDelete:
        return "cinder";
      case OpenStackLifecycleStep.Token:
        return "keystone";
      case OpenStackLifecycleStep.Ping:
        return "probe";
      default:
        return "neutron";
    }
  }

  /*
   * One step, timed. Its failure is written down here and never goes further, so the steps that
   * delete what was made always get to run. Except a refusal: nothing more is written after one.
   */
  private async step<T>(
    step: OpenStackLifecycleStep,
    run: () => Promise<T>,
    options?: { isSigned?: boolean | undefined } | undefined,
  ): Promise<{ isPassed: boolean; value?: T | undefined }> {
    const stepStartedAt: number = this.now();
    const traceId: string | null = options?.isSigned
      ? this.cloud.beginTrace()
      : null;

    try {
      const value: T = await run();

      this.steps.push({
        step: step,
        status: "Passed",
        durationInMs: Math.max(0, this.now() - stepStartedAt),
        ...(traceId ? { traceId: traceId } : {}),
      });

      return { isPassed: true, value: value };
    } catch (error) {
      if (error instanceof OpenStackCheckRefusedError) {
        throw error;
      }

      const met: OpenStackCheckFaultError = toCheckFaultError(error, {
        url: this.job.authUrl,
        source: this.sourceOfStep(step),
      });

      this.steps.push({
        step: step,
        status: "Failed",
        durationInMs: Math.max(0, this.now() - stepStartedAt),
        fault: met.fault,
        ...(traceId ? { traceId: traceId } : {}),
      });

      return { isPassed: false };
    } finally {
      this.cloud.endTrace();
    }
  }

  /*
   * Asks until it is done or the time is up. A poll that fails is not the step failing: an API
   * restarting in the middle of a boot is what these exist to sit through, and only the last one's
   * failure is reported, when nothing better came along. What a poll throws as a fault is final.
   */
  private async waitFor<T>(data: {
    timeoutInMs: number;
    source: OpenStackCheckFaultSource;
    what: string;
    poll: () => Promise<WaitResult<T>>;
  }): Promise<T> {
    const stopAt: number = this.now() + data.timeoutInMs;
    let attempt: number = 0;
    let sofar: string | undefined;
    let lastError: OpenStackCheckFaultError | null = null;

    for (;;) {
      try {
        const result: WaitResult<T> = await data.poll();

        lastError = null;

        if (result.done) {
          return result.value as T;
        }

        sofar = result.sofar ?? sofar;
      } catch (error) {
        if (
          error instanceof OpenStackCheckFaultError ||
          error instanceof OpenStackCheckRefusedError
        ) {
          throw error;
        }

        lastError = toCheckFaultError(error, {
          url: this.job.authUrl,
          source: data.source,
        });
      }

      const delay: number = getOpenStackCheckPollDelayInMs(attempt);
      attempt++;

      if (this.now() + delay >= stopAt) {
        if (lastError) {
          throw lastError;
        }

        throw fault(
          data.source,
          `${data.what} after ${describeWait(data.timeoutInMs)}.${sofar ? ` ${sofar}` : ""}`,
        );
      }

      await this.deps.clock.sleep(delay);
    }
  }

  // The time to give a step going forward, once clean-up has what it needs.
  private forwardTime(wanted: number): number {
    const remaining: number =
      this.startedAt + this.budgetInMs - CLEANUP_RESERVE_IN_MS - this.now();

    return Math.max(1000, Math.min(wanted, remaining));
  }

  private cleanupTime(wanted: number): number {
    const remaining: number = this.startedAt + this.budgetInMs - this.now();

    return Math.max(MINIMUM_CLEANUP_WAIT_IN_MS, Math.min(wanted, remaining));
  }

  public async run(): Promise<OpenStackLifecycleRun> {
    this.steps.push(this.tokenStep);

    try {
      await this.runSteps();
    } catch (error) {
      if (error instanceof OpenStackCheckRefusedError) {
        this.status = "Refused";
        this.message = error.message;
      } else {
        // A bug here, and the run still says so, and still deletes what it made.
        const met: OpenStackCheckFaultError = toCheckFaultError(error, {
          url: this.job.authUrl,
          source: "probe",
        });

        this.steps.push({
          step: OpenStackLifecycleStep.Prepare,
          status: "Failed",
          durationInMs: 0,
          fault: met.fault,
        });
      }
    }

    return this.finish();
  }

  private async runSteps(): Promise<void> {
    const isClean: boolean = await this.checkCredential();

    if (!isClean) {
      return;
    }

    /*
     * Listed first and on its own, because it decides whether this run starts at all, and what
     * earlier runs left still gets deleted when the flavor this run wants has gone.
     */
    const listed: {
      isPassed: boolean;
      value?: OpenStackOwnedListing | undefined;
    } = await this.step(OpenStackLifecycleStep.Prepare, () => {
      return listOwnedResources({
        cloud: this.cloud,
        checkKey: this.job.checkKey,
        projectId: this.projectId,
        clock: this.deps.clock,
      });
    });

    if (!listed.isPassed || !listed.value) {
      return;
    }

    const found: OpenStackOwnedListing = listed.value;

    if (found.otherServerCount > 0 || found.otherVolumeCount > 0) {
      this.warnings.push(
        `Project ${this.projectName || this.projectId} also holds ${found.otherServerCount} servers and ${found.otherVolumeCount} volumes this check did not make, so it is not a project of its own. They are not touched, but they share its quota.`,
      );
    }

    if (!this.job.isSweepOnly && this.isAnotherRunGoing(found)) {
      return;
    }

    await this.sweep(found);

    if (this.job.isSweepOnly) {
      this.status = "Swept";
      return;
    }

    const prepared: { isPassed: boolean; value?: PreparedRun | undefined } =
      await this.step(OpenStackLifecycleStep.Prepare, () => {
        return this.prepare();
      });

    // Two steps of one name, one row: what it took in all, and the failure if it failed.
    this.mergePrepareSteps();

    if (!prepared.isPassed || !prepared.value) {
      return;
    }

    try {
      await this.goForward(prepared.value);
    } finally {
      await this.cleanUp();
    }
  }

  private mergePrepareSteps(): void {
    const prepares: Array<OpenStackLifecycleStepResult> = this.steps.filter(
      (step: OpenStackLifecycleStepResult): boolean => {
        return step.step === OpenStackLifecycleStep.Prepare;
      },
    );

    if (prepares.length !== 2) {
      return;
    }

    const first: OpenStackLifecycleStepResult =
      prepares[0] as OpenStackLifecycleStepResult;
    const second: OpenStackLifecycleStepResult =
      prepares[1] as OpenStackLifecycleStepResult;

    first.durationInMs += second.durationInMs;
    first.status = second.status;

    if (second.fault) {
      first.fault = second.fault;
    }

    this.steps.splice(this.steps.indexOf(second), 1);
  }

  /*
   * Before anything is written, in this region. What the token says about itself was read before
   * this was called, for every region at once: these are what it can do here.
   */
  private async checkCredential(): Promise<boolean> {
    const reachable: Array<string> = [];

    const checked: { isPassed: boolean } = await this.step(
      OpenStackLifecycleStep.CredentialCheck,
      async (): Promise<void> => {
        for (const read of OPENSTACK_CHECK_ADMIN_ONLY_READS) {
          if (await this.canReadAsAdmin(read)) {
            reachable.push(read.read);
          }
        }

        if (reachable.length > 0) {
          throw new OpenStackCheckRefusedError(
            getOpenStackCheckReachRefusal(reachable),
          );
        }
      },
    );

    return checked.isPassed;
  }

  private canReadAsAdmin(read: OpenStackCheckAdminRead): Promise<boolean> {
    const services: Record<
      OpenStackCheckAdminRead["service"],
      OpenStackServiceType
    > = {
      identity: OpenStackServiceType.Identity,
      compute: OpenStackServiceType.Compute,
      network: OpenStackServiceType.Network,
    };

    return this.cloud.readsRows({
      service: services[read.service],
      read: read.read,
      path: read.path,
      key: read.key,
      query: read.query,
    });
  }

  /*
   * A run never starts while one is going. The server hands out no check a probe says it is running,
   * and that is enough until a probe restarts or the check moves to another probe, which is when this
   * is what holds: a thing named for this check and younger than a run can take may be a run's.
   */
  private isAnotherRunGoing(listing: OpenStackOwnedListing): boolean {
    const young: OpenStackOwnedResource | undefined = listing.owned.find(
      (resource: OpenStackOwnedResource): boolean => {
        return resource.ageInMs < this.budgetInMs;
      },
    );

    if (!young) {
      return false;
    }

    this.status = "Skipped";
    this.message = `Skipped: ${young.name} is ${describeWait(
      Math.max(0, young.ageInMs),
    )} old, and a run can take ${describeWait(
      this.budgetInMs,
    )}, so another run may be going.`;

    return true;
  }

  private async sweep(listing: OpenStackOwnedListing): Promise<void> {
    const limit: number = getOpenStackJanitorAgeInMs(
      this.job.intervalInMinutes,
    );
    const old: Array<OpenStackOwnedResource> = listing.owned.filter(
      (resource: OpenStackOwnedResource): boolean => {
        return resource.ageInMs > limit;
      },
    );

    await this.step(OpenStackLifecycleStep.Janitor, async (): Promise<void> => {
      const result: OpenStackLifecycleJanitorResult =
        await removeOwnedResources({
          cloud: this.cloud,
          clock: this.deps.clock,
          resources: old,
          allOwned: listing.owned,
        });

      this.janitor = {
        removed: result.removed,
        remainingCount:
          result.remainingCount + (listing.owned.length - old.length),
        errors: result.errors,
      };

      for (const error of result.errors) {
        this.warnings.push(error);
      }

      if (result.errors.length > 0) {
        throw fault("probe", result.errors[0] as string);
      }
    });
  }

  private async prepare(): Promise<PreparedRun> {
    const images: Array<JSONObject> = await this.cloud.listImages();
    const flavors: Array<JSONObject> = await this.cloud.listFlavors();
    const networks: Array<JSONObject> = await this.cloud.listNetworks();

    let image: JSONObject | null;

    if (this.options.image) {
      const found: { row: JSONObject } | { error: string } =
        findOpenStackCheckByIdOrName({
          rows: images,
          wanted: this.options.image,
          what: "image",
        });

      if ("error" in found) {
        throw fault("glance", found.error);
      }

      image = found.row;
    } else {
      image = chooseOpenStackCheckImage(images);
    }

    if (!image) {
      throw fault("glance", "This project can see no active image to boot.");
    }

    let flavor: JSONObject | null;

    if (this.options.flavor) {
      const found: { row: JSONObject } | { error: string } =
        findOpenStackCheckByIdOrName({
          rows: flavors,
          wanted: this.options.flavor,
          what: "flavor",
        });

      if ("error" in found) {
        throw fault("nova", found.error);
      }

      flavor = found.row;
    } else {
      flavor = chooseOpenStackCheckFlavor({ flavors: flavors, image: image });
    }

    if (!flavor) {
      throw fault(
        "nova",
        `This project can use no flavor that fits image ${text(image["name"])}. Give the project access to a small one, or name one in the check's settings.`,
      );
    }

    let network: JSONObject;

    if (this.options.network) {
      const found: { row: JSONObject } | { error: string } =
        findOpenStackCheckByIdOrName({
          rows: networks,
          wanted: this.options.network,
          what: "network",
        });

      if ("error" in found) {
        throw fault("neutron", found.error);
      }

      network = found.row;
    } else {
      const chosen: { network: JSONObject } | { error: string } =
        chooseOpenStackCheckNetwork({
          networks: networks,
          projectId: this.projectId,
        });

      if ("error" in chosen) {
        throw fault("neutron", chosen.error);
      }

      network = chosen.network;
    }

    let floatingNetworkId: string | null = null;
    let floatingNetworkError: OpenStackCheckFaultError | null = null;

    if (this.options.isFloatingIpEnabled) {
      if (this.options.floatingIpNetwork) {
        const found: { row: JSONObject } | { error: string } =
          findOpenStackCheckByIdOrName({
            rows: networks,
            wanted: this.options.floatingIpNetwork,
            what: "network",
          });

        if ("error" in found) {
          floatingNetworkError = fault("neutron", found.error);
        } else {
          floatingNetworkId = text(found.row["id"]);
        }
      } else {
        const external: Array<JSONObject> = networks.filter(isExternal);

        if (external.length === 1) {
          floatingNetworkId = text((external[0] as JSONObject)["id"]);
        } else {
          floatingNetworkError = fault(
            "neutron",
            external.length === 0
              ? "This project can see no external network to take a floating IP from."
              : `This project can see several external networks: ${namesOf(external)}. Name one in the check's settings.`,
          );
        }
      }
    }

    return {
      flavorId: text(flavor["id"]),
      imageId: text(image["id"]),
      networkId: text(network["id"]),
      floatingNetworkId: floatingNetworkId,
      floatingNetworkError: floatingNetworkError,
    };
  }

  private async goForward(prepared: PreparedRun): Promise<void> {
    if (this.options.isFloatingIpEnabled && prepared.floatingNetworkId) {
      /*
       * Only for a run that means to ping, and made before the server, which takes it as it boots. A
       * failure here costs the ping and leaves the boot to be judged on its own.
       */
      await this.step(
        OpenStackLifecycleStep.SecurityGroupCreate,
        async (): Promise<void> => {
          this.securityGroup = await this.cloud.createSecurityGroup({
            name: this.nameOf("sg"),
            runId: this.runId,
          });
          await this.cloud.allowPing(this.securityGroup);
        },
      );
    }

    const created: { isPassed: boolean } = await this.step(
      OpenStackLifecycleStep.ServerCreate,
      async (): Promise<void> => {
        this.server = await this.cloud.createServer({
          name: this.nameOf("server"),
          runId: this.runId,
          flavorId: prepared.flavorId,
          imageId: prepared.imageId,
          networkId: prepared.networkId,
          securityGroup: this.securityGroup,
        });
      },
      { isSigned: true },
    );

    this.traceId =
      this.steps.find((step: OpenStackLifecycleStepResult): boolean => {
        return step.step === OpenStackLifecycleStep.ServerCreate;
      })?.traceId || undefined;

    if (!created.isPassed || !this.server) {
      return;
    }

    const server: OpenStackOwnedResource = this.server;

    const active: { isPassed: boolean } = await this.step(
      OpenStackLifecycleStep.ServerActive,
      () => {
        return this.waitForActive(server);
      },
    );

    if (!active.isPassed) {
      return;
    }

    if (this.options.isFloatingIpEnabled) {
      await this.floatingIpPart(server, prepared);
    }

    if (this.options.isVolumeEnabled && this.cloud.hasVolumeService()) {
      await this.volumePart(server);
    }
  }

  private waitForActive(server: OpenStackOwnedResource): Promise<void> {
    return this.waitFor<void>({
      timeoutInMs: this.forwardTime(SERVER_ACTIVE_TIMEOUT_IN_MS),
      source: "nova",
      what: "The server never reached ACTIVE",
      poll: async (): Promise<WaitResult<void>> => {
        const row: JSONObject | null = await this.cloud.getServer(server.id);

        if (!row) {
          throw fault(
            "nova",
            "The server is gone: Nova no longer has it.",
            404,
          );
        }

        const status: string = text(row["status"]);

        if (status === "ACTIVE") {
          return { done: true };
        }

        if (status === "ERROR") {
          throw new OpenStackCheckFaultError(readOpenStackServerFault(row));
        }

        const task: string = text(row["OS-EXT-STS:task_state"]);

        return {
          done: false,
          sofar: `Nova still says ${status}${task ? ` (${task})` : ""}, and gave no fault.`,
        };
      },
    });
  }

  private async floatingIpPart(
    server: OpenStackOwnedResource,
    prepared: PreparedRun,
  ): Promise<void> {
    if (prepared.floatingNetworkError) {
      // Says so in the step that would have needed it: this part failed, and the boot did not.
      const error: OpenStackCheckFaultError = prepared.floatingNetworkError;

      await this.step(
        OpenStackLifecycleStep.FloatingIpCreate,
        async (): Promise<void> => {
          throw error;
        },
      );

      return;
    }

    const securityGroupFailed: boolean = this.steps.some(
      (step: OpenStackLifecycleStepResult): boolean => {
        return (
          step.step === OpenStackLifecycleStep.SecurityGroupCreate &&
          step.status === "Failed"
        );
      },
    );

    // The group's own failure is the fault. A ping that could not get in would say nothing more.
    if (securityGroupFailed) {
      return;
    }

    let address: string = "";
    let portId: string = "";

    const created: { isPassed: boolean } = await this.step(
      OpenStackLifecycleStep.FloatingIpCreate,
      async (): Promise<void> => {
        const port: JSONObject | null = await this.cloud.getPortOfServer(
          server.id,
        );

        if (!port || !text(port["id"])) {
          throw fault(
            "neutron",
            "The server is ACTIVE, and Neutron says it has no port.",
          );
        }

        portId = text(port["id"]);

        const made: { resource: OpenStackOwnedResource; address: string } =
          await this.cloud.createFloatingIp({
            name: this.nameOf("fip"),
            runId: this.runId,
            networkId: prepared.floatingNetworkId as string,
            portId: portId,
          });

        this.floatingIp = made.resource;
        address = made.address;
      },
      { isSigned: true },
    );

    if (!created.isPassed) {
      return;
    }

    await this.step(OpenStackLifecycleStep.Ping, () => {
      return this.pingUntilAnswered(address);
    });
  }

  /*
   * A floating IP is an address Neutron handed back, and pinging runs a program on the probe's
   * machine with it. So it is only ever an IP address, never a name or something a shell or a ping
   * could take for an option, and never one a probe does not connect to.
   */
  private async pingUntilAnswered(address: string): Promise<void> {
    if (
      net.isIP(address) === 0 ||
      VMwareVCenterAddress.isForbiddenHost(address)
    ) {
      throw fault(
        "neutron",
        `Neutron gave this floating IP the address ${address}, which a probe does not ping.`,
      );
    }

    const waitInMs: number = this.forwardTime(PING_TIMEOUT_IN_MS);
    const stopAt: number = this.now() + waitInMs;

    for (;;) {
      if (await this.deps.ping(address, PING_ATTEMPT_TIMEOUT_IN_MS)) {
        return;
      }

      if (this.now() + PING_RETRY_DELAY_IN_MS >= stopAt) {
        break;
      }

      await this.deps.clock.sleep(PING_RETRY_DELAY_IN_MS);
    }

    throw fault(
      "probe",
      `No reply from ${address} in ${describeWait(waitInMs)}. ${await this.describeFloatingIp()}`,
    );
  }

  // What Neutron says of the address that does not answer, which is where to look first.
  private async describeFloatingIp(): Promise<string> {
    if (!this.floatingIp) {
      return "";
    }

    try {
      const row: JSONObject | null = await this.cloud.getFloatingIp(
        this.floatingIp.id,
      );

      return `Neutron says its status is ${text(row?.["status"]) || "unknown"}.`;
    } catch {
      return "";
    }
  }

  private async volumePart(server: OpenStackOwnedResource): Promise<void> {
    const created: { isPassed: boolean } = await this.step(
      OpenStackLifecycleStep.VolumeCreate,
      async (): Promise<void> => {
        this.volume = await this.cloud.createVolume({
          name: this.nameOf("volume"),
          runId: this.runId,
          sizeInGiB:
            this.options.volumeSizeInGiB ??
            DEFAULT_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB,
          volumeType: this.options.volumeType,
        });

        await this.waitForVolumeAvailable(this.volume);
      },
      { isSigned: true },
    );

    if (!created.isPassed || !this.volume) {
      return;
    }

    const volume: OpenStackOwnedResource = this.volume;

    await this.step(
      OpenStackLifecycleStep.VolumeAttach,
      async (): Promise<void> => {
        await this.cloud.attachVolume({ server: server, volume: volume });
        this.isVolumeAttached = true;
        await this.waitForVolumeAttached(server, volume);
      },
      { isSigned: true },
    );
  }

  private waitForVolumeAvailable(
    volume: OpenStackOwnedResource,
  ): Promise<void> {
    return this.waitFor<void>({
      timeoutInMs: this.forwardTime(VOLUME_AVAILABLE_TIMEOUT_IN_MS),
      source: "cinder",
      what: "The volume never became available",
      poll: async (): Promise<WaitResult<void>> => {
        const row: JSONObject | null = await this.cloud.getVolume(volume.id);

        if (!row) {
          throw fault(
            "cinder",
            "The volume is gone: Cinder no longer has it.",
            404,
          );
        }

        const status: string = text(row["status"]);

        if (status === "available") {
          return { done: true };
        }

        if (status.startsWith("error")) {
          throw fault(
            "cinder",
            (await this.readVolumeMessage(volume.id)) ||
              `Cinder says the volume is in ${status}, and gave no reason.`,
          );
        }

        return { done: false, sofar: `Cinder still says ${status}.` };
      },
    });
  }

  private waitForVolumeAttached(
    server: OpenStackOwnedResource,
    volume: OpenStackOwnedResource,
  ): Promise<void> {
    return this.waitFor<void>({
      timeoutInMs: this.forwardTime(VOLUME_ATTACH_TIMEOUT_IN_MS),
      source: "cinder",
      what: "The volume never attached",
      poll: async (): Promise<WaitResult<void>> => {
        const row: JSONObject | null = await this.cloud.getVolume(volume.id);

        if (!row) {
          throw fault(
            "cinder",
            "The volume is gone: Cinder no longer has it.",
            404,
          );
        }

        const status: string = text(row["status"]);

        if (status === "in-use") {
          return { done: true };
        }

        /*
         * The attach took it out of available, so finding it there again is Nova having given up:
         * Nova rolls an attach back rather than say so anywhere a request can see.
         */
        if (status === "available" || status.startsWith("error")) {
          this.isVolumeAttached = false;

          throw await this.readAttachFault(server, volume, status);
        }

        return { done: false, sofar: `Cinder still says ${status}.` };
      },
    });
  }

  private async readVolumeMessage(volumeId: string): Promise<string | null> {
    try {
      const messages: Array<string> =
        await this.cloud.getVolumeMessages(volumeId);

      return messages[0] || null;
    } catch {
      return null;
    }
  }

  private async readAttachFault(
    server: OpenStackOwnedResource,
    volume: OpenStackOwnedResource,
    status: string,
  ): Promise<OpenStackCheckFaultError> {
    const cinderSays: string | null = await this.readVolumeMessage(volume.id);

    if (cinderSays) {
      return fault("cinder", cinderSays);
    }

    let novaSays: string | null = null;

    try {
      novaSays = await this.cloud.getAttachActionMessage(server.id);
    } catch {
      novaSays = null;
    }

    return fault(
      "nova",
      novaSays
        ? `Nova's attach_volume action says: ${novaSays}. Cinder says the volume is ${status}.`
        : `The attach was accepted, and Cinder says the volume is ${status}. Neither service said why.`,
    );
  }

  /*
   * What this run made, deleted in the order a cloud takes them. Each step gets its own try and its
   * own time, so the failure of one does not leave the rest behind. Only what the run knows it made
   * is handled by these steps. The list at the end finds anything else named for this run, such as
   * a server whose create timed out and which Nova made anyway.
   */
  private async cleanUp(): Promise<void> {
    const server: OpenStackOwnedResource | null = this.server;
    const volume: OpenStackOwnedResource | null = this.volume;

    let isVolumeStillAttached: boolean = false;

    if (server && volume && this.isVolumeAttached) {
      const detached: { isPassed: boolean } = await this.step(
        OpenStackLifecycleStep.VolumeDetach,
        async (): Promise<void> => {
          await this.cloud.detachVolume({ server: server, volume: volume });
          await this.waitForVolumeDetached(volume);
        },
        { isSigned: true },
      );

      isVolumeStillAttached = !detached.isPassed;
    }

    if (volume && !isVolumeStillAttached) {
      await this.deleteVolume(volume);
    }

    if (this.floatingIp) {
      const floatingIp: OpenStackOwnedResource = this.floatingIp;

      await this.step(
        OpenStackLifecycleStep.FloatingIpDelete,
        (): Promise<void> => {
          return this.cloud.deleteFloatingIp(floatingIp);
        },
        { isSigned: true },
      );
    }

    if (server) {
      await this.step(
        OpenStackLifecycleStep.ServerDelete,
        async (): Promise<void> => {
          await this.cloud.deleteServer(server);
          await this.waitForServerGone(server);
        },
        { isSigned: true },
      );
    }

    // Deleting the server takes the attachment with it, so this one can go now.
    if (volume && isVolumeStillAttached) {
      await this.deleteVolume(volume);
    }

    if (this.securityGroup) {
      const securityGroup: OpenStackOwnedResource = this.securityGroup;

      await this.step(
        OpenStackLifecycleStep.SecurityGroupDelete,
        () => {
          return this.deleteSecurityGroup(securityGroup);
        },
        { isSigned: true },
      );
    }

    await this.checkNothingIsLeft();
  }

  private deleteVolume(volume: OpenStackOwnedResource): Promise<unknown> {
    return this.step(
      OpenStackLifecycleStep.VolumeDelete,
      async (): Promise<void> => {
        await this.cloud.deleteVolume(volume);

        await this.waitFor<void>({
          timeoutInMs: this.cleanupTime(VOLUME_DELETE_TIMEOUT_IN_MS),
          source: "cinder",
          what: "The volume was not gone",
          poll: async (): Promise<WaitResult<void>> => {
            const row: JSONObject | null = await this.cloud.getVolume(
              volume.id,
            );

            if (!row) {
              return { done: true };
            }

            const status: string = text(row["status"]);

            if (status === "error_deleting") {
              throw fault(
                "cinder",
                (await this.readVolumeMessage(volume.id)) ||
                  "Cinder says the volume is in error_deleting, and gave no reason.",
              );
            }

            return { done: false, sofar: `Cinder still says ${status}.` };
          },
        });
      },
      { isSigned: true },
    );
  }

  private waitForVolumeDetached(volume: OpenStackOwnedResource): Promise<void> {
    return this.waitFor<void>({
      timeoutInMs: this.cleanupTime(VOLUME_DETACH_TIMEOUT_IN_MS),
      source: "cinder",
      what: "The volume never detached",
      poll: async (): Promise<WaitResult<void>> => {
        const row: JSONObject | null = await this.cloud.getVolume(volume.id);

        if (!row || text(row["status"]) === "available") {
          return { done: true };
        }

        return {
          done: false,
          sofar: `Cinder still says ${text(row["status"])}.`,
        };
      },
    });
  }

  private waitForServerGone(server: OpenStackOwnedResource): Promise<void> {
    return this.waitFor<void>({
      timeoutInMs: this.cleanupTime(SERVER_DELETE_TIMEOUT_IN_MS),
      source: "nova",
      what: "The server was not gone",
      poll: async (): Promise<WaitResult<void>> => {
        const row: JSONObject | null = await this.cloud.getServer(server.id);

        if (!row || text(row["status"]) === "DELETED") {
          return { done: true };
        }

        const task: string = text(row["OS-EXT-STS:task_state"]);

        return {
          done: false,
          sofar: `Nova still says ${text(row["status"])}${task ? ` (${task})` : ""}.`,
        };
      },
    });
  }

  /*
   * Neutron keeps a security group for as long as a port holds it, and a server's port goes a moment
   * after the server does.
   */
  private async deleteSecurityGroup(
    securityGroup: OpenStackOwnedResource,
  ): Promise<void> {
    await this.waitFor<void>({
      timeoutInMs: this.cleanupTime(SECURITY_GROUP_DELETE_TIMEOUT_IN_MS),
      source: "neutron",
      what: "The security group was not gone",
      poll: async (): Promise<WaitResult<void>> => {
        try {
          await this.cloud.deleteSecurityGroup(securityGroup);

          return { done: true };
        } catch (error) {
          if (
            error instanceof OpenStackCheckFaultError &&
            error.fault.code === 409
          ) {
            return { done: false, sofar: error.fault.message };
          }

          throw error;
        }
      },
    });
  }

  private async checkNothingIsLeft(): Promise<void> {
    try {
      const listing: OpenStackOwnedListing = await listOwnedResources({
        cloud: this.cloud,
        checkKey: this.job.checkKey,
        projectId: this.projectId,
        clock: this.deps.clock,
      });

      const mine: Array<OpenStackOwnedResource> = listing.owned.filter(
        (resource: OpenStackOwnedResource): boolean => {
          return resource.runId === this.runId;
        },
      );

      if (mine.length === 0) {
        return;
      }

      const result: OpenStackLifecycleJanitorResult =
        await removeOwnedResources({
          cloud: this.cloud,
          clock: this.deps.clock,
          resources: mine,
          allOwned: listing.owned,
        });

      // What took a second try, or is still there, the janitor's next run looks at again.
      this.leftoverCount = mine.length - result.removed.length;

      if (result.removed.length > 0) {
        this.warnings.push(
          `Deleted ${result.removed.length} of this run's own that its steps had not: ${result.removed
            .map((removed: { name: string }): string => {
              return removed.name;
            })
            .join(", ")}.`,
        );
      }

      for (const error of result.errors) {
        this.warnings.push(error);
      }
    } catch (error) {
      if (error instanceof OpenStackCheckRefusedError) {
        throw error;
      }

      this.warnings.push(
        `Could not check that this run left nothing behind: ${
          toCheckFaultError(error, {
            url: this.job.authUrl,
            source: "probe",
          }).message
        }`,
      );
    }
  }

  private getPhases(): Partial<
    Record<OpenStackLifecyclePhase, OpenStackLifecyclePhaseVerdict>
  > {
    const ran: (
      phase: OpenStackLifecyclePhase,
    ) => Array<OpenStackLifecycleStepResult> = (
      phase: OpenStackLifecyclePhase,
    ): Array<OpenStackLifecycleStepResult> => {
      return this.steps.filter(
        (step: OpenStackLifecycleStepResult): boolean => {
          return OPENSTACK_LIFECYCLE_STEP_PHASE[step.step] === phase;
        },
      );
    };

    const failed: (phase: OpenStackLifecyclePhase) => boolean = (
      phase: OpenStackLifecyclePhase,
    ): boolean => {
      return ran(phase).some((step: OpenStackLifecycleStepResult): boolean => {
        return step.status === "Failed";
      });
    };

    const hasPassed: (step: OpenStackLifecycleStep) => boolean = (
      wanted: OpenStackLifecycleStep,
    ): boolean => {
      return this.steps.some((step: OpenStackLifecycleStepResult): boolean => {
        return step.step === wanted && step.status === "Passed";
      });
    };

    const verdict: (
      phase: OpenStackLifecyclePhase,
      lastStep: OpenStackLifecycleStep,
    ) => OpenStackLifecyclePhaseVerdict = (
      phase: OpenStackLifecyclePhase,
      lastStep: OpenStackLifecycleStep,
    ): OpenStackLifecyclePhaseVerdict => {
      if (failed(phase)) {
        return "Failed";
      }

      return hasPassed(lastStep) ? "Passed" : "NotReached";
    };

    return {
      [OpenStackLifecyclePhase.Credential]: verdict(
        OpenStackLifecyclePhase.Credential,
        OpenStackLifecycleStep.CredentialCheck,
      ),
      [OpenStackLifecyclePhase.Boot]: verdict(
        OpenStackLifecyclePhase.Boot,
        OpenStackLifecycleStep.ServerActive,
      ),
      [OpenStackLifecyclePhase.FloatingIp]: this.options.isFloatingIpEnabled
        ? verdict(
            OpenStackLifecyclePhase.FloatingIp,
            OpenStackLifecycleStep.Ping,
          )
        : "Off",
      [OpenStackLifecyclePhase.Volume]:
        this.options.isVolumeEnabled && this.cloud.hasVolumeService()
          ? verdict(
              OpenStackLifecyclePhase.Volume,
              OpenStackLifecycleStep.VolumeAttach,
            )
          : "Off",
      [OpenStackLifecyclePhase.Cleanup]: failed(OpenStackLifecyclePhase.Cleanup)
        ? "Failed"
        : ran(OpenStackLifecyclePhase.Cleanup).length > 0
          ? "Passed"
          : "NotReached",
    };
  }

  private finish(): OpenStackLifecycleRun {
    const firstFailure: OpenStackLifecycleStepResult | undefined =
      this.steps.find((step: OpenStackLifecycleStepResult): boolean => {
        return step.status === "Failed";
      });

    if (firstFailure && this.status === "Succeeded") {
      this.status = "Failed";
    }

    if (this.options.isVolumeEnabled && !this.cloud.hasVolumeService()) {
      this.warnings.push(
        `The check is set to attach a volume, and region ${this.regionName} has no Cinder in its catalog, so it left that out.`,
      );
    }

    return {
      runId: this.runId,
      regionName: this.regionName,
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date(this.now()).toISOString(),
      status: this.status,
      ...(firstFailure
        ? { failedStep: firstFailure.step, fault: firstFailure.fault }
        : {}),
      ...(this.message ? { message: this.message } : {}),
      steps: this.steps,
      phases: this.getPhases(),
      ...(this.janitor ? { janitor: this.janitor } : {}),
      leftoverCount: this.leftoverCount,
      verifiedProjectId: this.projectId,
      ...(this.projectName ? { verifiedProjectName: this.projectName } : {}),
      ...(this.traceId ? { traceId: this.traceId } : {}),
      requestCount: this.cloud.getRequestCount(),
      writeCount: this.cloud.writes.length,
      warnings: this.warnings,
    };
  }
}

// A run that could not begin: no login, or a credential the guard refused.
function unstartedRun(data: {
  regionName: string;
  runId: string;
  startedAt: number;
  finishedAt: number;
  status: OpenStackLifecycleRunStatus;
  tokenStep: OpenStackLifecycleStepResult;
  message?: string | undefined;
}): OpenStackLifecycleRun {
  const isFailed: boolean = data.tokenStep.status === "Failed";

  return {
    runId: data.runId,
    regionName: data.regionName,
    startedAt: new Date(data.startedAt).toISOString(),
    finishedAt: new Date(data.finishedAt).toISOString(),
    status: data.status,
    ...(isFailed
      ? {
          failedStep: OpenStackLifecycleStep.Token,
          fault: data.tokenStep.fault,
        }
      : {}),
    ...(data.message ? { message: data.message } : {}),
    steps: [data.tokenStep],
    phases: {
      [OpenStackLifecyclePhase.Credential]: isFailed ? "Failed" : "Passed",
    },
    leftoverCount: 0,
    requestCount: 1,
    writeCount: 0,
    warnings: [],
  };
}

export default class OpenStackLifecycleCheck {
  // One run in each region. Never throws: every way it can go wrong is a run that says so.
  public static async run(
    job: OpenStackLifecycleCheckJob,
    deps: OpenStackCheckDependencies = DEFAULT_OPENSTACK_CHECK_DEPENDENCIES,
  ): Promise<Array<OpenStackLifecycleRun>> {
    const { clock } = deps;
    const startedAt: number = clock.now();

    const unstarted: (data: {
      tokenStep: OpenStackLifecycleStepResult;
      status: OpenStackLifecycleRunStatus;
      message?: string | undefined;
      regions: ReadonlyArray<string>;
    }) => Array<OpenStackLifecycleRun> = (data: {
      tokenStep: OpenStackLifecycleStepResult;
      status: OpenStackLifecycleRunStatus;
      message?: string | undefined;
      regions: ReadonlyArray<string>;
    }): Array<OpenStackLifecycleRun> => {
      /*
       * A run that could not log in knows no catalog, so it speaks for the regions it was given,
       * and with none, for no region in particular.
       */
      const regions: ReadonlyArray<string> =
        data.regions.length > 0 ? data.regions : [""];

      return regions.map((regionName: string): OpenStackLifecycleRun => {
        return unstartedRun({
          regionName: regionName,
          runId: buildOpenStackCheckRunId({
            startedAt: startedAt,
            random: deps.randomHex(3),
          }),
          startedAt: startedAt,
          finishedAt: clock.now(),
          status: data.status,
          tokenStep: data.tokenStep,
          message: data.message,
        });
      });
    };

    const failedLogin: (
      source: OpenStackCheckFaultSource,
      message: string,
      code?: number | undefined,
    ) => Array<OpenStackLifecycleRun> = (
      source: OpenStackCheckFaultSource,
      message: string,
      code?: number | undefined,
    ): Array<OpenStackLifecycleRun> => {
      return unstarted({
        regions: job.regions,
        status: "Failed",
        tokenStep: {
          step: OpenStackLifecycleStep.Token,
          status: "Failed",
          durationInMs: Math.max(0, clock.now() - startedAt),
          fault: {
            source: source,
            ...(code ? { code: code } : {}),
            message: boundFaultMessage(message),
          },
        },
      });
    };

    const normalized: OpenStackAddressResult = OpenStackAuthUrl.normalize(
      job.authUrl,
    );

    if (!normalized.address) {
      return failedLogin("probe", normalized.error);
    }

    const address: OpenStackAddress = normalized.address;
    const credential: OpenStackCredential = job.credential;
    const backoffKey: string = getOpenStackCredentialKey({
      openStackCloudId: job.openStackCloudCheckId,
      authUrl: address.url,
      credential: credential,
      trustedFingerprints: job.trustedCertificateFingerprints,
    });

    const heldBack: OpenStackBackoffEntry | null = deps.backoff.check(
      backoffKey,
      startedAt,
    );

    if (heldBack) {
      return failedLogin(
        "keystone",
        `${heldBack.message} Repeating a refused credential is what locks an account, so the probe asks again at ${new Date(
          heldBack.nextTryAt,
        ).toISOString()}.`,
      );
    }

    const handle: OpenStackTransportHandle = deps.createTransport({
      trustedFingerprints: job.trustedCertificateFingerprints,
      resolve: deps.resolve,
    });

    try {
      let token: OpenStackToken;

      const login: () => Promise<OpenStackToken> = () => {
        return keystoneLogin({
          authUrl: address.url,
          credential: credential,
          transport: handle.transport,
          userAgent: deps.userAgent,
          timeoutInMs: KEYSTONE_TIMEOUT_IN_MS,
        });
      };

      try {
        token = await login();
      } catch (error) {
        const classified: ClassifiedOpenStackError = classifyOpenStackError(
          error,
          { host: address.host, port: address.port },
        );

        if (
          classified.code === OpenStackCollectionErrorCode.InvalidCredential ||
          classified.code === OpenStackCollectionErrorCode.WrongProjectScope
        ) {
          deps.backoff.recordFailure(backoffKey, {
            now: clock.now(),
            random: clock.random(),
            baseInMs: REFUSED_CREDENTIAL_BACKOFF_BASE_IN_MS,
            maxInMs: MAX_REFUSED_CREDENTIAL_BACKOFF_IN_MS,
            code: classified.code,
            message: classified.message,
          });
        }

        return failedLogin("keystone", classified.message);
      }

      deps.backoff.recordSuccess(backoffKey);

      const tokenStep: OpenStackLifecycleStepResult = {
        step: OpenStackLifecycleStep.Token,
        status: "Passed",
        durationInMs: Math.max(0, clock.now() - startedAt),
      };

      const getRefusal: (candidate: OpenStackToken) => string | null = (
        candidate: OpenStackToken,
      ): string | null => {
        return getOpenStackCheckTokenRefusal({
          token: candidate,
          expectedProjectName: job.expectedProjectName,
          /*
           * Pinned for this run to what its first token verified, whatever the job said, so a token
           * renewed part way cannot be for another project.
           */
          pinnedProjectId: job.pinnedProjectId || token.projectId || undefined,
        });
      };

      const refusal: string | null = getRefusal(token);

      if (refusal) {
        return unstarted({
          regions: job.regions,
          status: "Refused",
          tokenStep: tokenStep,
          message: refusal,
        });
      }

      const catalog: Array<OpenStackCatalogService> = token.catalog;
      const inCatalog: Array<string> = getOpenStackCatalogRegions(catalog);
      const regions: Array<string> =
        job.regions.length > 0 ? job.regions : inCatalog;

      if (regions.length === 0) {
        return failedLogin(
          "keystone",
          "Keystone gave this credential a token with no endpoints in it, so the probe cannot tell where any service answers.",
        );
      }

      const session: OpenStackKeystoneSession = new OpenStackKeystoneSession({
        token: token,
        isFresh: false,
        login: async (): Promise<OpenStackToken> => {
          const fresh: OpenStackToken = await login();
          const renewedRefusal: string | null = getRefusal(fresh);

          if (renewedRefusal) {
            throw new OpenStackCheckRefusedError(renewedRefusal);
          }

          return fresh;
        },
      });

      const budgetInMs: number = getOpenStackLifecycleRunBudgetInMs(
        job.intervalInMinutes,
      );
      const runs: Array<OpenStackLifecycleRun> = [];

      await mapWithLimit(
        regions,
        REGIONS_AT_A_TIME,
        async (regionName: string): Promise<void> => {
          const endpoints: OpenStackLifecycleEndpoints | null =
            OpenStackLifecycleCheck.getEndpoints({
              catalog: catalog,
              regionName: regionName,
              identityUrl: `${address.url}/v3`,
              job: job,
            });

          if (!endpoints) {
            runs.push({
              ...unstartedRun({
                regionName: regionName,
                runId: buildOpenStackCheckRunId({
                  startedAt: startedAt,
                  random: deps.randomHex(3),
                }),
                startedAt: startedAt,
                finishedAt: clock.now(),
                status: "Failed",
                tokenStep: tokenStep,
              }),
              failedStep: OpenStackLifecycleStep.Prepare,
              fault: {
                source: "keystone",
                message: boundFaultMessage(
                  `The catalog has no compute or network endpoint in region ${regionName}, on the ${job.endpointInterface} interface. It names ${inCatalog.join(", ")}.`,
                ),
              },
              phases: {
                [OpenStackLifecyclePhase.Credential]: "Passed",
                [OpenStackLifecyclePhase.Boot]: "Failed",
              },
            });
            return;
          }

          const cloud: OpenStackLifecycleCloud = new OpenStackLifecycleCloud({
            regionName: regionName,
            transport: handle.transport,
            clock: clock,
            session: session,
            endpoints: endpoints,
            userAgent: deps.userAgent,
            getRefusal: getRefusal,
            osProfilerKey: job.osProfilerKey,
            randomUuid: deps.randomUuid,
            hardStopAt: startedAt + budgetInMs + CLEANUP_RESERVE_IN_MS,
          });

          runs.push(
            await new OpenStackLifecycleRegionRun({
              job: job,
              deps: deps,
              cloud: cloud,
              regionName: regionName,
              startedAt: startedAt,
              projectId: token.projectId as string,
              projectName: token.projectName,
              tokenStep: { ...tokenStep },
            }).run(),
          );
        },
      );

      return runs;
    } finally {
      handle.close();
    }
  }

  // Where each service answers in this region, or null without what a boot cannot do without.
  private static getEndpoints(data: {
    catalog: Array<OpenStackCatalogService>;
    regionName: string;
    identityUrl: string;
    job: OpenStackLifecycleCheckJob;
  }): OpenStackLifecycleEndpoints | null {
    const urlOf: (service: OpenStackServiceType) => string | null = (
      service: OpenStackServiceType,
    ): string | null => {
      const url: string | null = findOpenStackEndpoint({
        catalog: data.catalog,
        service: service,
        regionName: data.regionName,
        endpointInterface: data.job.endpointInterface,
      });

      return url ? toOpenStackServiceBaseUrl(service, url) : null;
    };

    const compute: string | null = urlOf(OpenStackServiceType.Compute);
    const network: string | null = urlOf(OpenStackServiceType.Network);

    if (!compute || !network) {
      return null;
    }

    return {
      identity: data.identityUrl,
      compute: compute,
      network: network,
      volume: urlOf(OpenStackServiceType.Volume),
      image: urlOf(OpenStackServiceType.Image),
    };
  }
}
