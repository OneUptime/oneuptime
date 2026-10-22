import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../Services/CodeRepositoryService";
import ServiceService from "../../../Services/ServiceService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import {
  createRepositoryResolver,
  RepoResolution,
  RepositoryResolver,
  ResolvableRepository,
} from "../../CodeRepository/StackTraceRepoResolver";
import LlmConversationPrivacy from "../../LlmObservability/LlmConversationPrivacy";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { untrustedLine } from "../SRE/UntrustedText";
import CodeFixAgentAuth, { CodeFixAgentIdentity } from "./CodeFixAgentAuth";
import { getPerformanceStackTrace } from "./CodeFixRunRepository";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Service from "../../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT A CODE-FIX RUN MAY READ OF PRODUCTION.
 *
 * The code agent's production telemetry tools (CodeAgentTelemetryTools) run
 * here on the server, never on the Runner: the Runner holds no credential
 * that reads telemetry, and the worker never names a project, a repository
 * or a service. Everything a tool may read follows from the RUN:
 *
 *   - its project, and no other;
 *   - its recipe: a review of a pull request (GitHubPullRequestReview) or a
 *     fix of an exception, a slow trace or an investigated incident
 *     (FixException, FixPerformance, FixFromIncident) - any other recipe is
 *     offered none;
 *   - its repository (AIRun.codeRepositoryId: pinned by the GitHub command,
 *     or decided when the fix was queued, CodeFixRunRepository);
 *   - and THE SERVICES THAT REPOSITORY SERVES.
 *
 * There is no service-to-repository table: a fix finds its repository at
 * run time, from the facts of what it fixes (StackTraceRepoResolver - the
 * files of a stack trace matched against every connected repository's
 * tree, then a repository named like the service, then the project's only
 * repository). The services a repository serves are worked out with that
 * same resolver, the other way round: a service is served by the
 * repository when the resolver maps one of the service's own facts to it -
 * the stack trace of one of its recent exception groups, or its name - or,
 * for the run's own subject, the facts the run itself was resolved from
 * (an exception's stack trace, a slow trace's code locations). A project
 * with one repository therefore has every service in its scope, exactly as
 * every fix of that project lands in that repository.
 *
 * A service the resolver maps elsewhere is out of scope, and every tool
 * holds every read to the services in scope (CodeAgentTelemetryTools): its
 * telemetry is unreachable from this run. So is a company AI tool's service
 * (its people's chats with Claude Enterprise or Microsoft 365 Copilot,
 * LlmConversationPrivacy) unless its connection lets everyone read it: what
 * the agent writes lands on a pull request, where far more people read it
 * than the project's owners and admins.
 */

// The recipes production telemetry is offered to.
export const CODE_AGENT_TELEMETRY_TASK_TYPES: ReadonlyArray<CodeFixTaskType> = [
  CodeFixTaskType.GitHubPullRequestReview,
  CodeFixTaskType.FixException,
  CodeFixTaskType.FixPerformance,
  CodeFixTaskType.FixFromIncident,
];

// How far back a service's exception groups count among its facts.
export const SCOPE_EXCEPTION_LOOKBACK_DAYS: number = 30;

// The most recently seen exception groups read for the facts.
export const MAX_SCOPE_EXCEPTION_GROUPS: number = 300;

// The stack traces of one service the resolver is asked about.
export const MAX_STACK_TRACES_PER_SERVICE: number = 3;

// The most services of a project a scope is worked out over.
export const MAX_SCOPE_SERVICES: number = 500;

// The longest a service's name runs where a prompt shows it.
export const MAX_SCOPED_SERVICE_NAME_LENGTH: number = 100;

// How long a run's scope is kept before it is worked out again.
export const SCOPE_CACHE_TTL_MS: number = 10 * 60 * 1000;

// The most runs whose scope is kept at once.
const MAX_CACHED_SCOPES: number = 500;

// One service in a run's scope, and why.
export interface CodeAgentScopedService {
  // The service's id, lower case.
  id: string;
  /*
   * Its name as a prompt may show it: one line, redacted, held to a length
   * (UntrustedText) - whoever created the service chose it.
   */
  name: string;
  // Which of the service's facts maps it to the repository.
  method: RepoResolution["method"];
  evidence: string;
  /*
   * Where the service's code is in the repository, when the stack-trace
   * match can tell (a monorepo's subdirectory) - null otherwise.
   */
  pathInRepository: string | null;
}

export interface CodeAgentScope {
  projectId: ObjectID;
  aiRunId: ObjectID;
  taskType: CodeFixTaskType;
  codeRepositoryId: ObjectID;
  // "acme/checkout", as the repository's page names it.
  repositoryFullName: string;
  services: Array<CodeAgentScopedService>;
}

// The facts of one service the resolver is asked about.
export interface ServiceFacts {
  id: string;
  name: string;
  // Its stack traces, the run's own subject's first.
  stackTraces: Array<string>;
}

/*
 * The services a repository serves, worked out for a run's scope or for a
 * production review of one of its pull requests (ProductionReviewScope) -
 * or why there are none: the repository is no longer one the project's
 * GitHub App reaches, or no service of the project maps to it.
 */
export enum RepositoryServicesGap {
  RepositoryNotConnected = "RepositoryNotConnected",
  NoServiceMapped = "NoServiceMapped",
}

export type RepositoryServices =
  | {
      repository: ResolvableRepository;
      services: Array<CodeAgentScopedService>;
      gap: null;
    }
  | {
      repository: ResolvableRepository | null;
      services: [];
      gap: RepositoryServicesGap;
    };

// The run whose own subject's facts come first in its scope.
export interface ScopeSubject {
  run: AIRun;
  taskType: CodeFixTaskType;
}

/*
 * What a run is offered: its scope, or - for a run that may ask but has
 * nothing to read - why not.
 */
export type CodeAgentTelemetryOffer =
  | { scope: CodeAgentScope; reason: null }
  | { scope: null; reason: string };

// The run, as every telemetry request reads it.
export interface CodeAgentTelemetryRun {
  run: AIRun;
  projectId: ObjectID;
  taskType: CodeFixTaskType;
}

interface CachedOffer {
  offer: CodeAgentTelemetryOffer;
  expiresAt: number;
}

const cachedOffers: Map<string, CachedOffer> = new Map<string, CachedOffer>();

function normalizeId(id: ObjectID | string): string {
  return id.toString().trim().toLowerCase();
}

/*
 * The services a repository serves, of the services given: those for which
 * the resolver maps one of their facts to the repository - a stack trace
 * (with the service's name, as a fix asks), then the name alone. Pure apart
 * from the resolver's tree reads, which it does once per repository.
 */
export async function findServicesServedByRepository(data: {
  codeRepositoryId: string;
  resolver: RepositoryResolver;
  services: Array<ServiceFacts>;
}): Promise<Array<CodeAgentScopedService>> {
  const repositoryId: string = normalizeId(data.codeRepositoryId);
  const served: Array<CodeAgentScopedService> = [];
  const seen: Set<string> = new Set<string>();

  for (const service of data.services) {
    const serviceId: string = normalizeId(service.id);

    if (seen.has(serviceId)) {
      continue;
    }

    const asked: Array<string | null> = [
      ...service.stackTraces.slice(0, MAX_STACK_TRACES_PER_SERVICE),
      // The name alone, as a fix with no stack trace asks.
      null,
    ];

    for (const stackTrace of asked) {
      const resolution: RepoResolution | null = await data.resolver.resolve({
        stackTrace: stackTrace,
        serviceName: service.name || null,
      });

      if (
        resolution &&
        normalizeId(resolution.codeRepositoryId) === repositoryId
      ) {
        seen.add(serviceId);
        served.push({
          id: serviceId,
          name: untrustedLine(
            service.name || "Unnamed service",
            MAX_SCOPED_SERVICE_NAME_LENGTH,
          ),
          method: resolution.method,
          evidence: resolution.evidence,
          pathInRepository: resolution.servicePathInRepository,
        });
        break;
      }
    }
  }

  return served;
}

export default class CodeAgentTelemetryScope {
  /*
   * The run a telemetry request names, when the agent may read for it: a
   * Running code-fix run of a project the agent may act in, claimed by this
   * agent. Anything else is refused - a run of another project exactly as a
   * missing one, so a probing key cannot tell them apart.
   */
  @CaptureSpan()
  public static async readRun(data: {
    aiAgent: CodeFixAgentIdentity;
    aiRunId: ObjectID;
  }): Promise<CodeAgentTelemetryRun> {
    const run: AIRun | null = await AIRunService.findOneById({
      id: data.aiRunId,
      select: {
        _id: true,
        projectId: true,
        runType: true,
        status: true,
        aiAgentId: true,
        codeFixTaskType: true,
        codeRepositoryId: true,
        triggeredByTelemetryExceptionId: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        taskContext: true,
        toolCallCount: true,
      },
      props: { isRoot: true },
    });

    if (
      !run ||
      !run.projectId ||
      CodeFixAgentAuth.deniesAccessToProject(data.aiAgent, run.projectId)
    ) {
      throw new BadDataException("Task not found");
    }

    if (run.runType !== AIRunType.CodeFix) {
      throw new BadDataException(
        "Production telemetry is only served for code-fix runs",
      );
    }

    if (run.status !== AIRunStatus.Running) {
      throw new BadDataException(
        `This task is not running (status: ${run.status}) — production telemetry is only served for claimed, running tasks`,
      );
    }

    if (
      !run.aiAgentId ||
      run.aiAgentId.toString() !== data.aiAgent.id.toString()
    ) {
      throw new BadDataException(
        "This task is claimed by a different agent — production telemetry is only served to the agent that claimed the run",
      );
    }

    return {
      run: run,
      projectId: run.projectId,
      taskType: CodeFixTaskTypeHelper.fromDatabaseValue(run.codeFixTaskType),
    };
  }

  /*
   * What the run is offered: its scope, worked out once and kept for
   * SCOPE_CACHE_TTL_MS (the run itself is read again on every request, by
   * readRun), or why it is offered nothing.
   */
  @CaptureSpan()
  public static async getOffer(
    data: CodeAgentTelemetryRun,
  ): Promise<CodeAgentTelemetryOffer> {
    /*
     * By the run and its repository: a run queued without one is linked to
     * the repository its token is minted for (AIAgentDataAPI), and is then
     * offered that repository's scope at once.
     */
    const key: string = `${normalizeId(data.run.id!)}:${
      data.run.codeRepositoryId ? normalizeId(data.run.codeRepositoryId) : ""
    }`;
    const cached: CachedOffer | undefined = cachedOffers.get(key);
    const now: number = OneUptimeDate.getCurrentDate().getTime();

    if (cached && cached.expiresAt > now) {
      return cached.offer;
    }

    const offer: CodeAgentTelemetryOffer =
      await CodeAgentTelemetryScope.workOutOffer(data);

    CodeAgentTelemetryScope.makeRoomInCache(now);
    cachedOffers.set(key, { offer, expiresAt: now + SCOPE_CACHE_TTL_MS });

    return offer;
  }

  // Forgets every run's scope (tests).
  public static clearCache(): void {
    cachedOffers.clear();
  }

  // The expired scopes out, then the oldest, until one more fits.
  private static makeRoomInCache(now: number): void {
    for (const [cachedKey, entry] of cachedOffers) {
      if (entry.expiresAt <= now) {
        cachedOffers.delete(cachedKey);
      }
    }

    // A Map keeps its keys in the order they were set: oldest first.
    for (const cachedKey of cachedOffers.keys()) {
      if (cachedOffers.size < MAX_CACHED_SCOPES) {
        break;
      }

      cachedOffers.delete(cachedKey);
    }
  }

  private static async workOutOffer(
    data: CodeAgentTelemetryRun,
  ): Promise<CodeAgentTelemetryOffer> {
    const { run, projectId, taskType } = data;

    if (!CODE_AGENT_TELEMETRY_TASK_TYPES.includes(taskType)) {
      return {
        scope: null,
        reason:
          "Production telemetry is offered to reviews and to fixes of an exception, a slow trace or an incident, and this task is none of them.",
      };
    }

    if (!run.codeRepositoryId) {
      return {
        scope: null,
        reason:
          "This task works in no repository OneUptime knows, so there are no services whose telemetry it may read.",
      };
    }

    const found: RepositoryServices =
      await CodeAgentTelemetryScope.findRepositoryServices({
        projectId,
        codeRepositoryId: run.codeRepositoryId,
        subject: { run, taskType },
      });

    if (
      !found.repository ||
      found.gap === RepositoryServicesGap.RepositoryNotConnected
    ) {
      return {
        scope: null,
        reason:
          "This task's repository is no longer connected to the project through the GitHub App, so OneUptime cannot tell which services it serves.",
      };
    }

    const repository: ResolvableRepository = found.repository;

    if (found.gap === RepositoryServicesGap.NoServiceMapped) {
      return {
        scope: null,
        reason: `No service of this project maps to ${repository.organizationName}/${repository.repositoryName}: none of their recent stack traces runs through its files, none is named like it, and the project has other repositories. There is no production telemetry to read for it.`,
      };
    }

    logger.debug(
      `Production telemetry scope of run ${run.id?.toString()}: ${found.services.length} service(s) of ${repository.organizationName}/${repository.repositoryName}.`,
    );

    return {
      scope: {
        projectId: projectId,
        aiRunId: run.id!,
        taskType: taskType,
        codeRepositoryId: new ObjectID(repository.id),
        repositoryFullName: `${repository.organizationName}/${repository.repositoryName}`,
        services: found.services,
      },
      reason: null,
    };
  }

  /*
   * The services a repository serves, of its project's: those the
   * repository resolver maps to it from their own facts (above), with a
   * company AI tool's private chats left out - or why there are none. A
   * run's own subject's facts come first, when a run asks.
   */
  @CaptureSpan()
  public static async findRepositoryServices(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    subject?: ScopeSubject | undefined;
  }): Promise<RepositoryServices> {
    const repositories: Array<ResolvableRepository> =
      await CodeRepositoryService.getResolvableRepositories(data.projectId);

    const repository: ResolvableRepository | undefined = repositories.find(
      (candidate: ResolvableRepository): boolean => {
        return (
          normalizeId(candidate.id) === normalizeId(data.codeRepositoryId)
        );
      },
    );

    if (!repository) {
      return {
        repository: null,
        services: [],
        gap: RepositoryServicesGap.RepositoryNotConnected,
      };
    }

    // A company AI tool's private chats never enter the scope (see above).
    const restricted: Set<string> = new Set<string>(
      await LlmConversationPrivacy.getRestrictedServiceIds(data.projectId),
    );

    const facts: Array<ServiceFacts> = (
      await CodeAgentTelemetryScope.readServiceFacts({
        projectId: data.projectId,
        subject: data.subject,
      })
    ).filter((service: ServiceFacts): boolean => {
      return !restricted.has(service.id);
    });

    const resolver: RepositoryResolver = createRepositoryResolver({
      repositories: repositories,
      getTreePaths: CodeRepositoryServiceClass.getRepositoryTreePaths,
    });

    const services: Array<CodeAgentScopedService> =
      await findServicesServedByRepository({
        codeRepositoryId: repository.id,
        resolver: resolver,
        services: facts,
      });

    if (services.length === 0) {
      return {
        repository,
        services: [],
        gap: RepositoryServicesGap.NoServiceMapped,
      };
    }

    return { repository, services, gap: null };
  }

  /*
   * Every service of the project with the facts the resolver is asked
   * about: its name, the stack traces of its most recently seen exception
   * groups, and - first - the run's own subject's facts, when a run asks.
   */
  private static async readServiceFacts(data: {
    projectId: ObjectID;
    subject?: ScopeSubject | undefined;
  }): Promise<Array<ServiceFacts>> {
    const services: Array<Service> = await ServiceService.findBy({
      query: { projectId: data.projectId },
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      limit: MAX_SCOPE_SERVICES,
      skip: 0,
      props: { isRoot: true },
    });

    const factsById: Map<string, ServiceFacts> = new Map<
      string,
      ServiceFacts
    >();
    const idsByName: Map<string, string> = new Map<string, string>();

    for (const service of services) {
      if (!service._id) {
        continue;
      }

      const id: string = normalizeId(service._id);
      factsById.set(id, {
        id: id,
        name: service.name || "",
        stackTraces: [],
      });

      if (service.name) {
        idsByName.set(service.name.trim().toLowerCase(), id);
      }
    }

    // The run's own subject's facts come first.
    if (data.subject) {
      await CodeAgentTelemetryScope.addSubjectFacts({
        projectId: data.projectId,
        run: data.subject.run,
        taskType: data.subject.taskType,
        factsById,
        idsByName,
      });
    }

    const exceptions: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: {
          projectId: data.projectId,
          lastSeenAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveDays(
              OneUptimeDate.getCurrentDate(),
              -SCOPE_EXCEPTION_LOOKBACK_DAYS,
            ),
          ),
        },
        select: { primaryEntityId: true, stackTrace: true },
        sort: { lastSeenAt: SortOrder.Descending },
        limit: MAX_SCOPE_EXCEPTION_GROUPS,
        skip: 0,
        props: { isRoot: true },
      });

    for (const exception of exceptions) {
      const facts: ServiceFacts | undefined = exception.primaryEntityId
        ? factsById.get(normalizeId(exception.primaryEntityId))
        : undefined;

      if (
        facts &&
        exception.stackTrace &&
        facts.stackTraces.length < MAX_STACK_TRACES_PER_SERVICE &&
        !facts.stackTraces.includes(exception.stackTrace)
      ) {
        facts.stackTraces.push(exception.stackTrace);
      }
    }

    return Array.from(factsById.values());
  }

  /*
   * The facts the run itself was resolved from: an exception fix's stack
   * trace, on its service; a performance fix's code locations, on the
   * service its trace was attributed to.
   */
  private static async addSubjectFacts(data: {
    projectId: ObjectID;
    run: AIRun;
    taskType: CodeFixTaskType;
    factsById: Map<string, ServiceFacts>;
    idsByName: Map<string, string>;
  }): Promise<void> {
    try {
      if (
        data.taskType === CodeFixTaskType.FixException &&
        data.run.triggeredByTelemetryExceptionId
      ) {
        const exception: TelemetryException | null =
          await TelemetryExceptionService.findOneBy({
            query: {
              _id: data.run.triggeredByTelemetryExceptionId.toString(),
              projectId: data.projectId,
            },
            select: { primaryEntityId: true, stackTrace: true },
            props: { isRoot: true },
          });

        const facts: ServiceFacts | undefined = exception?.primaryEntityId
          ? data.factsById.get(normalizeId(exception.primaryEntityId))
          : undefined;

        if (facts && exception?.stackTrace) {
          facts.stackTraces.unshift(exception.stackTrace);
        }
      }

      if (data.taskType === CodeFixTaskType.FixPerformance) {
        const stackTrace: string | null = getPerformanceStackTrace(
          data.run.taskContext?.codeLocations,
        );
        const serviceName: string = (data.run.taskContext?.serviceName || "")
          .trim()
          .toLowerCase();
        const serviceId: string | undefined = serviceName
          ? data.idsByName.get(serviceName)
          : undefined;
        const facts: ServiceFacts | undefined = serviceId
          ? data.factsById.get(serviceId)
          : undefined;

        if (facts && stackTrace) {
          facts.stackTraces.unshift(stackTrace);
        }
      }
    } catch (error) {
      // The subject's facts only add to the scope: never fail it over them.
      logger.debug(
        `Could not read the subject facts of run ${data.run.id?.toString()}: ${error}`,
      );
    }
  }
}
