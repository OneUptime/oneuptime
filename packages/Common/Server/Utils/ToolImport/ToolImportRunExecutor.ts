import ToolImportRun from "../../../Models/DatabaseModels/ToolImportRun";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  getToolImportSourceDefinition,
  isToolImportAddressGiven,
  isToolImportFileUpload,
  resolveToolImportRegion,
  ToolImportCredentialField,
  ToolImportRegion,
  ToolImportSourceDefinition,
} from "../../../Types/ToolImport/ToolImportCatalog";
import {
  decodeToolImportCredentials,
  encodeToolImportCredentials,
  getToolImportSecrets,
  isToolImportApiKeyId,
  readToolImportApiUrl,
  ToolImportApiAddress,
  ToolImportCredentials,
} from "../../../Types/ToolImport/ToolImportCredentials";
import {
  TOOL_IMPORT_MAX_API_KEY_LENGTH,
  TOOL_IMPORT_MAX_FILE_NAME_LENGTH,
  TOOL_IMPORT_MAX_REQUESTS,
  TOOL_IMPORT_MAX_UPLOAD_BYTES,
  TOOL_IMPORT_READ_TIMEOUT_MS,
  TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS,
} from "../../../Types/ToolImport/ToolImportLimits";
import {
  assertToolImportSubscribersConsent,
  readToolImportSelection,
  ToolImportPlan,
  ToolImportProgress,
  ToolImportReport,
  ToolImportSelection,
} from "../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus, {
  ActiveToolImportRunStatuses,
} from "../../../Types/ToolImport/ToolImportRunStatus";
import { ToolImportSnapshot } from "../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource, {
  isToolImportSource,
} from "../../../Types/ToolImport/ToolImportSource";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../Infrastructure/Semaphore";
import ToolImportRunService from "../../Services/ToolImportRunService";
import CallerPlan from "../Billing/CallerPlan";
import DataSourceEgressGuard from "../DataSource/EgressGuard";
import logger from "../Logger";
import { redactLogString } from "../LogRedaction";
import WorkspaceActionAuthorization from "../Workspace/WorkspaceActionAuthorization";
import ToolImportAdapterRegistry from "./ToolImportAdapterRegistry";
import ToolImportApplier, { toErrorMessage } from "./ToolImportApplier";
import {
  createToolImportAddressTransport,
  createToolImportTransport,
  ToolImportSleep,
  ToolImportTransport,
} from "./ToolImportHttpClient";
import {
  buildToolImportPlan,
  ToolImportAccess,
  ToolImportProjectState,
} from "./ToolImportPlanner";
import ToolImportProjectStateReader from "./ToolImportProjectStateReader";
import { ToolImportReadContext } from "./Types";

/*
 * AN IMPORT'S LIFE: READ, REVIEW, IMPORT - EACH STEP A QUEUE JOB.
 *
 *   startRead    a person asks to read a tool: the run is created with the
 *                key encrypted on it, and a worker job queued.
 *   (worker)     reads the tool with the key and stores what it read; the
 *                key is cleared the moment the read ends, however it ends.
 *   getPlan      the preview: worked out from what was read, for the person
 *                looking, each time it is opened.
 *   startImport  the person starts it with what they ticked; a worker job
 *                is queued.
 *   (worker)     works the plan out again as the person - their props are
 *                rebuilt from the database, so someone who left the project
 *                or lost a permission since is held to that - creates what
 *                was ticked, and stores the report.
 *
 * Only one import of a project reads or imports at a time. A run left in
 * Reading or Importing by a worker that died is failed by the sweep (and
 * its key cleared); a preview nobody started within a day expires.
 */

export const TOOL_IMPORT_RUN_JOB: string = "ToolImport:RunToolImport";

// The worker's limit for one job: a read, or an import of the largest size.
export const TOOL_IMPORT_RUN_TIMEOUT_MS: number = 70 * 60 * 1000;

// A run still Reading or Importing this long after its last write is stuck.
export const TOOL_IMPORT_STALE_RUN_MS: number = 90 * 60 * 1000;

// How often progress is written while a run works.
const PROGRESS_WRITE_INTERVAL_MS: number = 1500;

const KEY_WHITESPACE: RegExp = /\s/;

export interface ToolImportStartReadData {
  projectId: ObjectID;
  userId: ObjectID;
  source: unknown;
  region: unknown;
  apiKey: unknown;
  // Splunk On-Call's API ID; ignored for a tool that has none.
  apiKeyId?: unknown;
  // The tool's API address; ignored for a tool whose hosts are fixed.
  apiUrl?: unknown;
}

export interface ToolImportReadRequest {
  source: ToolImportSource;
  region: ToolImportRegion;
  apiKey: string;
  apiKeyId?: string | undefined;
  apiUrl?: string | undefined;
}

export interface ToolImportTransportOptions {
  // The address is the one the person gave (not a fixed host of the tool).
  isAddressGiven: boolean;
  toolName: string;
  // Whether a given address may be plain http.
  allowHttp: boolean;
}

export default class ToolImportRunExecutor {
  /*
   * The transport reads go through: the tool's fixed hosts, or - for a tool
   * whose address the person gives - that host through the egress guard.
   * Tests replace it; it is never a real network call in a test.
   */
  public static transportFactory: (
    hosts: Array<string>,
    options?: ToolImportTransportOptions | undefined,
  ) => ToolImportTransport = (
    hosts: Array<string>,
    options?: ToolImportTransportOptions | undefined,
  ): ToolImportTransport => {
    return options?.isAddressGiven
      ? createToolImportAddressTransport({
          allowedHosts: hosts,
          toolName: options.toolName,
          allowHttp: options.allowHttp,
        })
      : createToolImportTransport(hosts);
  };

  /*
   * How a read waits - for a tool's pace, or when it says to slow down.
   * Undefined: really waits. Tests replace it so they never wait.
   */
  public static readSleep: ToolImportSleep | undefined = undefined;

  /*
   * Whether an address a person gives may be plain http: only where the
   * install may reach private networks at all (a self-hosted OneUptime on
   * the person's own network). OneUptime Cloud sends a key over https only.
   */
  public static allowsPlainHttpAddress(): boolean {
    return !DataSourceEgressGuard.shouldBlockPrivateAddresses();
  }

  public static validateReadRequest(data: {
    source: unknown;
    region: unknown;
    apiKey: unknown;
    apiKeyId?: unknown;
    apiUrl?: unknown;
  }): ToolImportReadRequest {
    if (!isToolImportSource(data.source)) {
      throw new BadDataException("Choose a tool to import from.");
    }

    const definition: ToolImportSourceDefinition =
      getToolImportSourceDefinition(data.source);

    // A tool read from a file has nothing to read over an API.
    if (isToolImportFileUpload(definition)) {
      throw new BadDataException(
        `${definition.title} is read from a file. Choose the file to read.`,
      );
    }

    const region: ToolImportRegion | null = resolveToolImportRegion(
      data.source,
      data.region,
    );

    if (!region) {
      throw new BadDataException(
        `Choose one of ${definition.title}'s regions.`,
      );
    }

    const request: ToolImportReadRequest = {
      source: data.source,
      region: region,
      apiKey: "",
    };

    if (
      definition.credentialFields.includes(ToolImportCredentialField.ApiUrl)
    ) {
      request.apiUrl = this.validateApiUrl(definition, data.apiUrl);
    }

    if (
      definition.credentialFields.includes(ToolImportCredentialField.ApiKeyId)
    ) {
      const apiKeyId: string =
        typeof data.apiKeyId === "string" ? data.apiKeyId.trim() : "";

      if (!apiKeyId) {
        throw new BadDataException(`Paste your ${definition.title} API ID.`);
      }

      if (!isToolImportApiKeyId(apiKeyId)) {
        throw new BadDataException(
          `That does not look like your ${definition.title} API ID. Paste the ID on its own.`,
        );
      }

      request.apiKeyId = apiKeyId;
    }

    const apiKey: string =
      typeof data.apiKey === "string" ? data.apiKey.trim() : "";

    if (!apiKey) {
      throw new BadDataException(`Paste your ${definition.title} API key.`);
    }

    if (
      apiKey.length > TOOL_IMPORT_MAX_API_KEY_LENGTH ||
      KEY_WHITESPACE.test(apiKey)
    ) {
      throw new BadDataException(
        `That does not look like your ${definition.title} API key. Paste the key on its own.`,
      );
    }

    request.apiKey = apiKey;

    return request;
  }

  /*
   * A tool's API address as the person pasted it, cleaned, or a refusal
   * that says what is wrong with it. Whether its host may be reached is the
   * egress guard's to say when the read calls it.
   */
  private static validateApiUrl(
    definition: ToolImportSourceDefinition,
    value: unknown,
  ): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadDataException(`Paste your ${definition.title} API URL.`);
    }

    const address: ToolImportApiAddress | null = readToolImportApiUrl(value);

    if (!address) {
      throw new BadDataException(
        `That does not look like your ${definition.title} API URL. Copy it from ${definition.title}'s settings.`,
      );
    }

    if (!address.isHttps && !this.allowsPlainHttpAddress()) {
      throw new BadDataException(
        `The ${definition.title} API URL must start with https://.`,
      );
    }

    return address.url;
  }

  public static async startRead(
    data: ToolImportStartReadData,
  ): Promise<ObjectID> {
    const request: ToolImportReadRequest = this.validateReadRequest(data);

    const lock: SemaphoreMutex = await Semaphore.lock({
      namespace: "ToolImportAdmission",
      key: data.projectId.toString(),
      lockTimeout: 30_000,
      acquireTimeout: 5_000,
    });

    let runId: ObjectID;

    try {
      await this.assertNoActiveRun(data.projectId);
      await this.discardPreviewsOf({
        projectId: data.projectId,
        userId: data.userId,
      });

      const run: ToolImportRun = new ToolImportRun();
      run.projectId = data.projectId;
      run.source = request.source;
      if (request.region.value) {
        run.region = request.region.value;
      }

      run.status = ToolImportRunStatus.Reading;
      run.apiKey = encodeToolImportCredentials(request.source, {
        apiKey: request.apiKey,
        apiKeyId: request.apiKeyId,
        apiUrl: request.apiUrl,
      });
      run.createdByUserId = data.userId;
      run.progress = { done: 0, total: 0 };

      const created: ToolImportRun = await ToolImportRunService.create({
        data: run,
        props: { isRoot: true },
      });

      runId = created.id!;
    } finally {
      await this.release(lock);
    }

    await this.enqueue(runId, "read");

    return runId;
  }

  public static async startImport(data: {
    runId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    selection: unknown;
  }): Promise<void> {
    let selection: ToolImportSelection;

    try {
      selection = readToolImportSelection(data.selection);
      assertToolImportSubscribersConsent(selection);
    } catch (error) {
      throw new BadDataException(toErrorMessage(error));
    }

    const lock: SemaphoreMutex = await Semaphore.lock({
      namespace: "ToolImportAdmission",
      key: data.projectId.toString(),
      lockTimeout: 30_000,
      acquireTimeout: 5_000,
    });

    try {
      const run: ToolImportRun = await this.getOwnRun(data);

      if (run.status !== ToolImportRunStatus.ReadyToReview) {
        throw new BadDataException(
          "This import has already started, or is no longer waiting to be started.",
        );
      }

      if (this.isReviewExpired(run)) {
        await this.expire(run.id!);
        throw new BadDataException(
          "This preview is more than a day old. Read the tool again to import what it has now.",
        );
      }

      await this.assertNoActiveRun(data.projectId);

      if (selection.selectedKeys.length === 0) {
        throw new BadDataException("Tick at least one thing to bring over.");
      }

      await ToolImportRunService.updateOneById({
        id: run.id!,
        data: {
          status: ToolImportRunStatus.Importing,
          selection: selection as never,
          startedAt: new Date(),
          progress: {
            done: 0,
            total: selection.selectedKeys.length,
          } as never,
          error: null,
        },
        props: { isRoot: true },
      });
    } finally {
      await this.release(lock);
    }

    await this.enqueue(data.runId, "import");
  }

  public static async cancel(data: {
    runId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const run: ToolImportRun = await this.getOwnRun(data);

    if (run.status !== ToolImportRunStatus.ReadyToReview) {
      throw new BadDataException(
        "Only a preview that was not started can be discarded.",
      );
    }

    await ToolImportRunService.updateOneById({
      id: run.id!,
      data: {
        status: ToolImportRunStatus.Cancelled,
        snapshot: null,
        apiKey: null,
        completedAt: new Date(),
      },
      props: { isRoot: true },
    });
  }

  /*
   * The preview of a run, for the person who started it: worked out now,
   * from what was read, with their permissions on the project's plan.
   */
  public static async getPlan(data: {
    run: ToolImportRun;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ToolImportPlan> {
    const snapshot: ToolImportSnapshot | null = this.readSnapshot(data.run);

    if (!snapshot || !data.run.source) {
      throw new BadDataException(
        "There is nothing to preview for this import.",
      );
    }

    const props: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
      data.props,
    );

    const state: ToolImportProjectState =
      await ToolImportProjectStateReader.readState({
        projectId: data.projectId,
        source: data.run.source,
      });

    const access: ToolImportAccess =
      await ToolImportProjectStateReader.readAccess({
        projectId: data.projectId,
        props: props,
        kinds: getToolImportSourceDefinition(data.run.source).kinds,
      });

    return buildToolImportPlan({
      snapshot: snapshot,
      state: state,
      access: access,
    });
  }

  /*
   * A tool read from a file the person uploads (Uptime Kuma, which has no
   * API to read): the file's text is read here, at once, into what was
   * found - and the run starts as a preview, ready to tick. The file
   * itself is never stored, queued or logged: it can hold passwords and
   * tokens, and only what the preview needs is kept.
   */
  public static async startUpload(data: {
    projectId: ObjectID;
    userId: ObjectID;
    source: unknown;
    fileName: unknown;
    content: unknown;
  }): Promise<ObjectID> {
    if (!isToolImportSource(data.source)) {
      throw new BadDataException("Choose a tool to import from.");
    }

    const definition: ToolImportSourceDefinition =
      getToolImportSourceDefinition(data.source);

    if (!isToolImportFileUpload(definition)) {
      throw new BadDataException(
        "This tool is read with its API key, not from a file.",
      );
    }

    if (typeof data.content !== "string" || !data.content.trim()) {
      throw new BadDataException("Choose the file to read.");
    }

    if (
      Buffer.byteLength(data.content, "utf8") > TOOL_IMPORT_MAX_UPLOAD_BYTES
    ) {
      throw new BadDataException(
        "This file is larger than 10 MB, which is more than an import reads.",
      );
    }

    const snapshot: ToolImportSnapshot =
      ToolImportAdapterRegistry.getFileAdapter(data.source).readFile({
        content: data.content,
        fileName: cleanUploadFileName(data.fileName),
        now: new Date(),
      });

    const lock: SemaphoreMutex = await Semaphore.lock({
      namespace: "ToolImportAdmission",
      key: data.projectId.toString(),
      lockTimeout: 30_000,
      acquireTimeout: 5_000,
    });

    try {
      await this.assertNoActiveRun(data.projectId);
      await this.discardPreviewsOf({
        projectId: data.projectId,
        userId: data.userId,
      });

      const run: ToolImportRun = new ToolImportRun();
      run.projectId = data.projectId;
      run.source = data.source;
      run.status = ToolImportRunStatus.ReadyToReview;
      run.snapshot = snapshot as never;
      run.createdByUserId = data.userId;

      if (snapshot.accountName) {
        run.accountName = snapshot.accountName;
      }

      const created: ToolImportRun = await ToolImportRunService.create({
        data: run,
        props: { isRoot: true },
      });

      return created.id!;
    } finally {
      await this.release(lock);
    }
  }

  // ---- The worker's side.

  public static async executeRun(runId: ObjectID): Promise<void> {
    let lock: SemaphoreMutex;

    try {
      lock = await Semaphore.lock({
        namespace: "ToolImportRun",
        key: runId.toString(),
        lockTimeout: TOOL_IMPORT_RUN_TIMEOUT_MS,
        acquireTimeout: 1000,
      });
    } catch (error) {
      if (error instanceof SemaphoreLockTimeoutError) {
        // Another worker is on this run already.
        return;
      }

      throw error;
    }

    try {
      const run: ToolImportRun | null = await ToolImportRunService.findOneById({
        id: runId,
        select: {
          _id: true,
          projectId: true,
          source: true,
          region: true,
          status: true,
          apiKey: true,
          snapshot: true,
          selection: true,
          createdByUserId: true,
        },
        props: { isRoot: true },
      });

      if (!run || !run.projectId || !run.source) {
        return;
      }

      if (run.status === ToolImportRunStatus.Reading) {
        await this.read(run);
        return;
      }

      if (run.status === ToolImportRunStatus.Importing) {
        await this.import(run);
      }
    } finally {
      await this.release(lock);
    }
  }

  private static async read(run: ToolImportRun): Promise<void> {
    const credentials: ToolImportCredentials | null =
      decodeToolImportCredentials(run.source!, run.apiKey);

    try {
      const definition: ToolImportSourceDefinition =
        getToolImportSourceDefinition(run.source!);

      if (!credentials) {
        throw new BadDataException(
          "The API key is no longer here. Paste it again to read the tool.",
        );
      }

      const isAddressGiven: boolean = isToolImportAddressGiven(definition);
      let hosts: Array<string> = definition.hosts;

      if (isAddressGiven) {
        const address: ToolImportApiAddress | null = readToolImportApiUrl(
          credentials.apiUrl,
        );

        if (!address) {
          throw new BadDataException(
            `The ${definition.title} API URL is no longer here. Read the tool again.`,
          );
        }

        hosts = [address.hostname];
      }

      const progress: ProgressWriter = new ProgressWriter(run.id!);

      const context: ToolImportReadContext = {
        transport: this.transportFactory(hosts, {
          isAddressGiven: isAddressGiven,
          toolName: definition.title,
          allowHttp: this.allowsPlainHttpAddress(),
        }),
        sleep: this.readSleep,
        maxRequests: TOOL_IMPORT_MAX_REQUESTS,
        deadlineAt: Date.now() + TOOL_IMPORT_READ_TIMEOUT_MS,
        onProgress: async (kind: ToolImportResourceKind): Promise<void> => {
          await progress.write({ done: 0, total: 0, kind: kind }, true);
        },
      };

      const snapshot: ToolImportSnapshot =
        await ToolImportAdapterRegistry.getAdapter(run.source!).read(
          {
            source: run.source!,
            apiKey: credentials.apiKey,
            apiKeyId: credentials.apiKeyId,
            apiUrl: credentials.apiUrl,
            region: run.region || "",
          },
          context,
        );

      await ToolImportRunService.updateOneById({
        id: run.id!,
        data: {
          status: ToolImportRunStatus.ReadyToReview,
          snapshot: snapshot as never,
          accountName: snapshot.accountName || null,
          apiKey: null,
          progress: null,
          error: null,
        },
        props: { isRoot: true },
      });
    } catch (error) {
      await this.fail(
        run.id!,
        this.describeFailure(error, getToolImportSecrets(credentials)),
        {
          clearSnapshot: true,
        },
      );
    }
  }

  private static async import(run: ToolImportRun): Promise<void> {
    let report: ToolImportReport | null = null;

    try {
      const snapshot: ToolImportSnapshot | null = this.readSnapshot(run);

      if (!snapshot || !run.createdByUserId) {
        throw new BadDataException(
          "What was read is no longer here. Read the tool again.",
        );
      }

      const selection: ToolImportSelection = readToolImportSelection(
        run.selection,
      );

      /*
       * The import acts as the person who started it, with what they may do
       * now - read from the database, not from the request that started it.
       */
      const props: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
        await WorkspaceActionAuthorization.getProjectMemberProps({
          userId: run.createdByUserId,
          projectId: run.projectId!,
        }),
      );

      const state: ToolImportProjectState =
        await ToolImportProjectStateReader.readState({
          projectId: run.projectId!,
          source: run.source!,
        });

      const access: ToolImportAccess =
        await ToolImportProjectStateReader.readAccess({
          projectId: run.projectId!,
          props: props,
          kinds: getToolImportSourceDefinition(run.source!).kinds,
        });

      const plan: ToolImportPlan = buildToolImportPlan({
        snapshot: snapshot,
        state: state,
        access: access,
      });

      /*
       * Only a team the person may still hand on: one they could pick in
       * the preview. Anything else invites nobody.
       */
      const inviteTeamId: string | null =
        selection.inviteTeamId &&
        plan.inviteTeams.some((team: { id: string }): boolean => {
          return team.id === selection.inviteTeamId;
        })
          ? selection.inviteTeamId
          : null;

      const progress: ProgressWriter = new ProgressWriter(run.id!);

      report = await ToolImportApplier.apply({
        runId: run.id!,
        projectId: run.projectId!,
        source: run.source!,
        snapshot: snapshot,
        plan: plan,
        selection: { ...selection, inviteTeamId: inviteTeamId },
        props: props,
        isLimitedToOneLevelPerPolicy: access.isLimitedToOneLevelPerPolicy,
        canLetSubscribersChooseResources: !access.subscriberChoiceRefusal,
        canCreateStatusPageGroups: !access.statusPageGroupRefusal,
        now: new Date(),
        onProgress: async (value: ToolImportProgress): Promise<void> => {
          await progress.write(value, false);
        },
      });

      await ToolImportRunService.updateOneById({
        id: run.id!,
        data: {
          status: ToolImportRunStatus.Completed,
          report: report as never,
          snapshot: null,
          progress: null,
          completedAt: new Date(),
        },
        props: { isRoot: true },
      });
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        await this.fail(
          run.id!,
          "You are no longer a member of this project, so the import was stopped.",
          { clearSnapshot: true },
        );
        return;
      }

      await this.fail(run.id!, this.describeFailure(error, ""), {
        clearSnapshot: true,
        report: report,
      });
    }
  }

  // ---- Sweeps.

  /*
   * Runs a dead worker left Reading or Importing are failed (and their key
   * cleared), and previews nobody started within a day expire. Called on a
   * schedule by the worker.
   */
  public static async sweepStaleRuns(now: Date = new Date()): Promise<void> {
    const stuck: Array<ToolImportRun> = await ToolImportRunService.findBy({
      query: {
        status: new Includes(ActiveToolImportRunStatuses),
        updatedAt: new LessThan(
          new Date(now.getTime() - TOOL_IMPORT_STALE_RUN_MS),
        ),
      },
      select: { _id: true, status: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    for (const run of stuck) {
      await this.fail(
        run.id!,
        run.status === ToolImportRunStatus.Reading
          ? "The read stopped before it finished. Read the tool again."
          : "The import stopped before it finished. What it created is kept: run the import again to bring over the rest.",
        { clearSnapshot: true },
      );
    }

    const waiting: Array<ToolImportRun> = await ToolImportRunService.findBy({
      query: {
        status: ToolImportRunStatus.ReadyToReview,
        updatedAt: new LessThan(
          new Date(now.getTime() - TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS),
        ),
      },
      select: { _id: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    for (const run of waiting) {
      await this.expire(run.id!);
    }
  }

  // ---- Helpers.

  private static async enqueue(
    runId: ObjectID,
    step: "read" | "import",
  ): Promise<void> {
    try {
      // The job carries the run's id only: never the key, never what was read.
      await Queue.addJob(
        QueueName.Worker,
        `${runId.toString()}-${step}`,
        TOOL_IMPORT_RUN_JOB,
        { runId: runId.toString() },
        { attempts: 1 },
      );
    } catch (error) {
      logger.error("ToolImport: the run could not be queued.");
      logger.error(redactLogString(toErrorMessage(error)));

      await this.fail(runId, "The import could not be queued. Try again.", {
        clearSnapshot: step === "read",
      });

      throw new BadDataException("The import could not be queued. Try again.");
    }
  }

  private static async assertNoActiveRun(projectId: ObjectID): Promise<void> {
    const active: Array<ToolImportRun> = await ToolImportRunService.findBy({
      query: {
        projectId: projectId,
        status: new Includes(ActiveToolImportRunStatuses),
      },
      select: { _id: true, updatedAt: true },
      limit: 5,
      skip: 0,
      props: { isRoot: true },
    });

    const live: Array<ToolImportRun> = active.filter(
      (run: ToolImportRun): boolean => {
        return Boolean(
          run.updatedAt &&
            run.updatedAt.getTime() > Date.now() - TOOL_IMPORT_STALE_RUN_MS,
        );
      },
    );

    if (live.length > 0) {
      throw new BadDataException(
        "Another import is running in this project. Wait for it to finish, then try again.",
      );
    }

    for (const run of active) {
      await this.fail(
        run.id!,
        "The import stopped before it finished. Run it again to bring over the rest.",
        { clearSnapshot: true },
      );
    }
  }

  /*
   * One preview per person: reading a tool again discards the previews
   * they never started, and what was read for them.
   */
  private static async discardPreviewsOf(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const previews: Array<ToolImportRun> = await ToolImportRunService.findBy({
      query: {
        projectId: data.projectId,
        createdByUserId: data.userId,
        status: ToolImportRunStatus.ReadyToReview,
      },
      select: { _id: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    for (const preview of previews) {
      await ToolImportRunService.updateOneById({
        id: preview.id!,
        data: {
          status: ToolImportRunStatus.Cancelled,
          snapshot: null,
          apiKey: null,
          completedAt: new Date(),
        },
        props: { isRoot: true },
      });
    }
  }

  /*
   * A run of the project that the person started. Anyone else's is not
   * found: only the person who read a tool sees its preview and starts it.
   */
  private static async getOwnRun(data: {
    runId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ToolImportRun> {
    const run: ToolImportRun | null = await ToolImportRunService.findOneBy({
      query: { _id: data.runId.toString(), projectId: data.projectId },
      select: {
        _id: true,
        status: true,
        createdByUserId: true,
        updatedAt: true,
        createdAt: true,
      },
      props: { isRoot: true },
    });

    if (
      !run ||
      !data.props.userId ||
      run.createdByUserId?.toString() !== data.props.userId.toString()
    ) {
      throw new BadDataException("This import was not found.");
    }

    return run;
  }

  public static isReviewExpired(
    run: ToolImportRun,
    now: Date = new Date(),
  ): boolean {
    const readyAt: Date | undefined = run.updatedAt || run.createdAt;

    return Boolean(
      readyAt &&
        now.getTime() - readyAt.getTime() > TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS,
    );
  }

  private static async expire(runId: ObjectID): Promise<void> {
    await ToolImportRunService.updateOneById({
      id: runId,
      data: {
        status: ToolImportRunStatus.Expired,
        snapshot: null,
        apiKey: null,
        completedAt: new Date(),
      },
      props: { isRoot: true },
    });
  }

  private static async fail(
    runId: ObjectID,
    message: string,
    options: { clearSnapshot: boolean; report?: ToolImportReport | null },
  ): Promise<void> {
    try {
      await ToolImportRunService.updateOneById({
        id: runId,
        data: {
          status: ToolImportRunStatus.Failed,
          error: message,
          apiKey: null,
          progress: null,
          completedAt: new Date(),
          ...(options.clearSnapshot ? { snapshot: null } : {}),
          ...(options.report ? { report: options.report as never } : {}),
        },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error("ToolImport: a failed run could not be recorded.");
      logger.error(redactLogString(toErrorMessage(error)));
    }
  }

  /*
   * What a person reads when a run fails: the failure's own message, with
   * the key - and its ID - cut out (the HTTP client already does; this is
   * the last line) and the log redaction applied.
   */
  public static describeFailure(
    error: unknown,
    secrets: string | Array<string>,
  ): string {
    let message: string = toErrorMessage(error);

    for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
      if (secret && secret.length >= 4) {
        message = message.split(secret).join("[REDACTED]");
      }
    }

    return redactLogString(message);
  }

  public static readSnapshot(run: ToolImportRun): ToolImportSnapshot | null {
    const value: unknown = run.snapshot;

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const snapshot: ToolImportSnapshot = value as unknown as ToolImportSnapshot;

    return Array.isArray(snapshot.people) && Array.isArray(snapshot.schedules)
      ? snapshot
      : null;
  }

  private static async release(lock: SemaphoreMutex): Promise<void> {
    try {
      await Semaphore.release(lock);
    } catch {
      logger.error(
        "ToolImport: a lock could not be released and will expire on its own.",
      );
    }
  }
}

const PATH_SEPARATORS: RegExp = /^.*[\\/]/;
const NOT_PRINTABLE: RegExp = /[^\p{L}\p{N}\p{P}\p{Zs}\p{S}]+/gu;

/*
 * The name of an uploaded file, as the page shows it back: without the
 * folders a browser may put before it, without anything that is not a
 * printable character, and cut to a sensible length.
 */
export function cleanUploadFileName(value: unknown): string {
  const name: string = (typeof value === "string" ? value : "")
    .replace(PATH_SEPARATORS, "")
    .replace(NOT_PRINTABLE, "")
    .trim();

  return name.slice(0, TOOL_IMPORT_MAX_FILE_NAME_LENGTH).trim();
}

/*
 * Writes a run's progress at most every PROGRESS_WRITE_INTERVAL_MS (and
 * always the last step), so a large import does not write a row per item.
 */
class ProgressWriter {
  private runId: ObjectID;
  private lastWriteAt: number = 0;

  public constructor(runId: ObjectID) {
    this.runId = runId;
  }

  public async write(
    progress: ToolImportProgress,
    force: boolean,
  ): Promise<void> {
    const now: number = Date.now();
    const isLast: boolean =
      progress.total > 0 && progress.done >= progress.total;

    if (
      !force &&
      !isLast &&
      now - this.lastWriteAt < PROGRESS_WRITE_INTERVAL_MS
    ) {
      return;
    }

    this.lastWriteAt = now;

    try {
      await ToolImportRunService.updateOneById({
        id: this.runId,
        data: {
          progress: {
            done: progress.done,
            total: progress.total,
            ...(progress.kind ? { kind: progress.kind } : {}),
          } as never,
        },
        props: { isRoot: true },
      });
    } catch (error) {
      // Progress is a nicety: the run goes on without it.
      logger.error("ToolImport: progress could not be written.");
      logger.error(redactLogString(toErrorMessage(error)));
    }
  }
}
