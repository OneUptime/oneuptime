import AIService from "../../../Services/AIService";
import AIRunService from "../../../Services/AIRunService";
import ServiceService from "../../../Services/ServiceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../Telemetry/TelemetryReadScope";
import ProfileEvidence, {
  ProfileFunctionEvidence,
  ProfileKind,
  ProfileWindow,
} from "../../Profile/ProfileEvidence";
import SourceLocator, {
  LocatableRepository,
  LocatableRepositoryWithTree,
  SourceLink,
} from "../../CodeRepository/SourceLocator";
import CodeTaskAccess from "../CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeTaskRuns from "../CodeTask/CodeTaskRuns";
import SubjectCodeFixRun from "./SubjectCodeFixRun";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import ProfileSample from "../../../../Models/AnalyticsModels/ProfileSample";
import Service from "../../../../Models/DatabaseModels/Service";
import { AIRunStatusHelper } from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import { getCodeTaskRequest } from "../../../../Types/AI/CodeFixTaskContext";
import {
  CodeTaskBlocker,
  CodeTaskContextItem,
  CodeTaskContextType,
  CodeTaskRequest,
} from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { ProfileFrameOrigin } from "../../../../Utils/Profiles/ProfileFrames";
import {
  ProfileCategory,
  formatProfileShare,
} from "../../../../Utils/Profiles/ProfileTypes";
import SuggestionOffer from "../../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_PROFILE_FIX_SUGGESTION,
  PROFILE_NOT_WORTH_FIXING_MESSAGE,
  ProfileFixOffer,
  ProfileFixReason,
  ProfileFixRepository,
  ProfileFixSuggestion,
  ProfileHotspotEvidence,
  getProfileFixOffer,
  getProfileFixReason,
} from "../../../../Utils/Suggestions/ProfileFixSuggestion";

/*
 * AI SRE - "Fix with AI" from the Profiler: a hot function of a service's
 * own code becomes a Code task in the repository that holds it, with the
 * profile as its evidence.
 *
 * The Profiler's function panel asks first (getSuggestion, POST
 * /ai-investigation/profile-fix-suggestion) and draws only what the answer
 * says; the create route (createFixTask) checks the very same things, in the
 * same order, so the panel never offers a fix that is then refused:
 *
 *   1. the project's one AI switch;
 *   2. the profile, read under the person's own read scope: is the function
 *      worth a fix (ProfileFixSuggestion - the application's own code, a
 *      real share of the time, or a share that grew)?
 *   3. a task for this function already on its way;
 *   4. a repository: the one the function's file is found in
 *      (SourceLocator), or - when none holds it for certain - the ones the
 *      person can ask in, to pick from; none connected at all is a set-up
 *      step;
 *   5. what the Code gate says for that repository (the plan, the
 *      credits, the daily limit, a Runner, permission to ask).
 *
 * The task is an ordinary Code request (CodeTaskRuns.start), so it shows in
 * Code as a conversation the person can follow, reply in and stop, and any
 * Runner that takes Code requests can work it. Its context is a Profile
 * item read now (CodeTaskContextBuilder): telemetry expires, and the
 * conversation must show what the AI was given.
 */

export interface ProfileFixRequest {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  serviceId: ObjectID;
  functionName: string;
  // The function's file as the profile shows it ("" for a bare frame).
  fileName: string;
  // A kind ("cpu", "memory", ...) or one raw type; CPU time by default.
  profileType?: string | undefined;
  window: ProfileWindow;
  // The window the Profiler compared it with, when it did.
  beforeWindow?: ProfileWindow | undefined;
}

export interface ProfileFixRead {
  evidence: ProfileFunctionEvidence;
  hotspot: ProfileHotspotEvidence;
}

export const PROFILE_FIX_ALREADY_RUNNING_MESSAGE: string =
  "OneUptime AI is already working on this function. Follow it in Code.";

export const PROFILE_FIX_PICK_REPOSITORY_MESSAGE: string =
  "Pick the repository that holds this code.";

export const PROFILE_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE: string =
  "That repository is not connected, or you cannot ask AI to work in it.";

export default class ProfileFixTaskTrigger {
  /*
   * The function's profile, under the person's own read scope, and what the
   * fix rule reads of it. Null when the function took no time there.
   */
  @CaptureSpan()
  public static async readEvidence(
    request: ProfileFixRequest,
  ): Promise<ProfileFixRead | null> {
    const scope: TelemetryReadScope = await TelemetryReadAccess.getScope(
      ProfileSample,
      request.props,
    );
    const serviceFilter: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(scope, [request.serviceId]);

    const kind: ProfileKind | null = await ProfileEvidence.resolveKind({
      projectId: request.projectId,
      window: request.window,
      serviceFilter,
      selection: request.profileType,
    });

    if (!kind) {
      return null;
    }

    const evidence: ProfileFunctionEvidence | null =
      await ProfileEvidence.readFunction({
        projectId: request.projectId,
        serviceFilter,
        kind,
        functionName: request.functionName,
        fileName: request.fileName,
        window: request.window,
        beforeWindow: request.beforeWindow,
      });

    if (!evidence) {
      return null;
    }

    const hotspot: ProfileHotspotEvidence = {
      category: kind.category || ProfileCategory.Other,
      isOwnCode: evidence.origin === ProfileFrameOrigin.Own,
      ownShare: evidence.ownShare,
      functionSampleCount: evidence.sampleCount,
      windowSampleCount: evidence.windowSampleCount,
    };

    if (evidence.before) {
      hotspot.ownShareBefore = evidence.before.ownShare;
    }

    return { evidence, hotspot };
  }

  /*
   * The Code task already working on this function: a Code request whose
   * turn is queued or running and whose context names the same function of
   * the same service. Its task id (a reply's task is its first turn).
   */
  @CaptureSpan()
  public static async findActiveTaskId(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    functionName: string;
    fileName: string;
  }): Promise<string | null> {
    const activeRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeFixTaskType: CodeFixTaskType.CodeRequest,
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: { _id: true, taskContext: true, codeTaskId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    const serviceId: string = data.serviceId.toString().toLowerCase();

    for (const run of activeRuns) {
      const request: CodeTaskRequest | null = getCodeTaskRequest(
        run.taskContext,
      );

      const isThisFunction: boolean = Boolean(
        request?.context.some((item: CodeTaskContextItem): boolean => {
          return (
            item.type === CodeTaskContextType.Profile &&
            (item.serviceId || "").toLowerCase() === serviceId &&
            item.functionName === data.functionName &&
            (item.fileName || "") === data.fileName
          );
        }),
      );

      if (isThisFunction) {
        return (run.codeTaskId || run.id)?.toString() || null;
      }
    }

    return null;
  }

  // Where the function's file is, when one repository holds it for certain.
  private static async locateRepository(data: {
    request: ProfileFixRequest;
    evidence: ProfileFunctionEvidence;
    repositories: Array<LocatableRepositoryWithTree>;
  }): Promise<LocatableRepositoryWithTree | null> {
    if (!data.evidence.fileName) {
      return null;
    }

    const links: Array<SourceLink> = await SourceLocator.matchFrames({
      frames: [
        {
          fileName: data.evidence.fileName,
          lineNumber: data.evidence.lineNumber,
        },
      ],
      repositories: data.repositories,
      getTreePaths: (
        repository: LocatableRepository,
      ): Promise<Array<string>> => {
        return SourceLocator.getTreePaths(
          repository as LocatableRepositoryWithTree,
        );
      },
    });

    const link: SourceLink | undefined = links[0];

    if (!link) {
      return null;
    }

    return (
      data.repositories.find((repository: LocatableRepository): boolean => {
        return repository.id === link.repositoryId;
      }) || null
    );
  }

  // The repositories a person may ask AI to work in, of those given.
  private static async filterAskable(data: {
    request: ProfileFixRequest;
    repositories: Array<LocatableRepository>;
  }): Promise<Array<LocatableRepository>> {
    const askable: Array<LocatableRepository> = [];

    for (const repository of data.repositories) {
      if (
        await CodeTaskAccess.canAskInRepository({
          props: data.request.props,
          projectId: data.request.projectId,
          repositoryId: new ObjectID(repository.id),
        })
      ) {
        askable.push(repository);
      }
    }

    return askable;
  }

  /*
   * What the function panel offers for this function, decided by the gates
   * the create route enforces, in the same order. Never throws for a
   * function the person may not read or that took no time: there is simply
   * nothing to suggest.
   */
  @CaptureSpan()
  public static async getSuggestion(
    request: ProfileFixRequest,
  ): Promise<ProfileFixSuggestion> {
    if (!(await AIService.isProjectAIEnabled(request.projectId))) {
      return NO_PROFILE_FIX_SUGGESTION;
    }

    const read: ProfileFixRead | null =
      await ProfileFixTaskTrigger.readEvidence(request);

    if (!read || !getProfileFixReason(read.hotspot)) {
      return NO_PROFILE_FIX_SUGGESTION;
    }

    const activeTaskId: string | null =
      await ProfileFixTaskTrigger.findActiveTaskId({
        projectId: request.projectId,
        serviceId: request.serviceId,
        functionName: request.functionName,
        fileName: request.fileName,
      });

    if (activeTaskId) {
      const offer: ProfileFixOffer = getProfileFixOffer({
        evidence: read.hotspot,
        isAiEnabled: true,
        hasActiveFix: true,
        hasConnectedRepository: true,
      });

      return {
        ...NO_PROFILE_FIX_SUGGESTION,
        ...offer,
        evidence: read.hotspot,
        taskId: activeTaskId,
      };
    }

    const locatable: Array<LocatableRepositoryWithTree> =
      await SourceLocator.getLocatableRepositories({
        projectId: request.projectId,
        props: request.props,
      });

    if (locatable.length === 0) {
      /*
       * Repositories are connected, but none the person may read: nothing
       * they could do here would start the fix.
       */
      if (await SubjectCodeFixRun.hasConnectedRepository(request.projectId)) {
        return NO_PROFILE_FIX_SUGGESTION;
      }

      const offer: ProfileFixOffer = getProfileFixOffer({
        evidence: read.hotspot,
        isAiEnabled: true,
        hasActiveFix: false,
        hasConnectedRepository: false,
      });

      return {
        ...NO_PROFILE_FIX_SUGGESTION,
        ...offer,
        evidence: read.hotspot,
      };
    }

    const located: LocatableRepository | null =
      await ProfileFixTaskTrigger.locateRepository({
        request,
        evidence: read.evidence,
        repositories: locatable,
      });

    const candidates: Array<LocatableRepository> = located
      ? [located]
      : locatable;
    const askable: Array<LocatableRepository> =
      await ProfileFixTaskTrigger.filterAskable({
        request,
        repositories: candidates,
      });

    // The person may not ask AI in the repository that holds the code.
    if (askable.length === 0) {
      return NO_PROFILE_FIX_SUGGESTION;
    }

    const gateRepository: CodeRepository = new CodeRepository();
    gateRepository.id = new ObjectID(askable[0]!.id);

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props: request.props,
      projectId: request.projectId,
      repository: gateRepository,
      canAsk: true,
    });

    const offer: ProfileFixOffer = getProfileFixOffer({
      evidence: read.hotspot,
      isAiEnabled: true,
      hasActiveFix: false,
      hasConnectedRepository: true,
      blocker,
    });

    if (offer.offer === SuggestionOffer.None) {
      return NO_PROFILE_FIX_SUGGESTION;
    }

    const toRepository: (
      repository: LocatableRepository,
    ) => ProfileFixRepository = (
      repository: LocatableRepository,
    ): ProfileFixRepository => {
      return { id: repository.id, name: repository.name };
    };

    return {
      ...offer,
      evidence: read.hotspot,
      repository: located ? toRepository(askable[0]!) : null,
      repositories: located ? [] : askable.map(toRepository),
      taskId: null,
    };
  }

  /*
   * Start the fix: a Code task in the function's repository, asking AI to
   * make it lighter, with the profile as its context. Every gate of
   * getSuggestion is checked again; each refusal says which.
   */
  @CaptureSpan()
  public static async createFixTask(
    request: ProfileFixRequest & {
      // What the person sent, when they edited the request.
      message?: string | undefined;
      // The repository the person picked, when none was found for certain.
      repositoryId?: ObjectID | undefined;
    },
  ): Promise<{ taskId: string }> {
    // The project's one AI switch, before the profile is read.
    await AIService.assertProjectAIEnabled(request.projectId);

    const read: ProfileFixRead | null =
      await ProfileFixTaskTrigger.readEvidence(request);

    const reason: ProfileFixReason | null = read
      ? getProfileFixReason(read.hotspot)
      : null;

    if (!read || !reason) {
      throw new BadDataException(PROFILE_NOT_WORTH_FIXING_MESSAGE);
    }

    if (
      await ProfileFixTaskTrigger.findActiveTaskId({
        projectId: request.projectId,
        serviceId: request.serviceId,
        functionName: request.functionName,
        fileName: request.fileName,
      })
    ) {
      throw new BadDataException(PROFILE_FIX_ALREADY_RUNNING_MESSAGE);
    }

    const locatable: Array<LocatableRepositoryWithTree> =
      await SourceLocator.getLocatableRepositories({
        projectId: request.projectId,
        props: request.props,
      });

    let repositoryId: string | null = null;

    if (request.repositoryId) {
      const picked: string = request.repositoryId.toString();

      if (
        !locatable.some((repository: LocatableRepository): boolean => {
          return repository.id === picked;
        })
      ) {
        throw new BadDataException(
          PROFILE_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
        );
      }

      repositoryId = picked;
    } else {
      const located: LocatableRepository | null =
        await ProfileFixTaskTrigger.locateRepository({
          request,
          evidence: read.evidence,
          repositories: locatable,
        });

      if (!located) {
        throw new BadDataException(
          locatable.length > 0
            ? PROFILE_FIX_PICK_REPOSITORY_MESSAGE
            : "No connected repository whose code OneUptime reads holds this code. Connect it in Code: GitHub, GitLab, Forgejo and Gitea repositories are read.",
        );
      }

      repositoryId = located.id;
    }

    const repository: CodeRepository =
      await CodeTaskAccess.getReadableRepository({
        props: request.props,
        projectId: request.projectId,
        repositoryId: new ObjectID(repositoryId),
      });

    await CodeTaskGate.assertCanStart({
      props: request.props,
      projectId: request.projectId,
      repository,
      canAsk: await CodeTaskAccess.canAskInRepository({
        props: request.props,
        projectId: request.projectId,
        repositoryId: repository.id!,
      }),
    });

    const context: CodeTaskContextItem = await CodeTaskContextBuilder.buildItem(
      {
        type: CodeTaskContextType.Profile,
        serviceId: request.serviceId.toString(),
        functionName: request.functionName,
        fileName: request.fileName,
        profileType: read.evidence.kind.selection,
        startTime: request.window.startTime.toISOString(),
        endTime: request.window.endTime.toISOString(),
        ...(request.beforeWindow
          ? {
              beforeStartTime: request.beforeWindow.startTime.toISOString(),
              beforeEndTime: request.beforeWindow.endTime.toISOString(),
            }
          : {}),
      },
      { projectId: request.projectId, props: request.props },
    );

    const message: string =
      request.message && request.message.trim()
        ? CodeTaskRuns.readMessage(request.message)
        : ProfileFixTaskTrigger.buildRequestMessage({
            evidence: read.evidence,
            reason,
            serviceName: await ProfileFixTaskTrigger.getServiceName(request),
          });

    const run: AIRun = await CodeTaskRuns.start({
      projectId: request.projectId,
      userId: request.props.userId!,
      repository,
      message,
      context: [context],
    });

    return { taskId: run.id!.toString() };
  }

  // The service's name, when the person may read it.
  private static async getServiceName(
    request: ProfileFixRequest,
  ): Promise<string | undefined> {
    try {
      const service: Service | null = await ServiceService.findOneBy({
        query: {
          _id: request.serviceId.toString(),
          projectId: request.projectId,
        },
        select: { name: true },
        props: request.props,
      });

      return service?.name || undefined;
    } catch {
      return undefined;
    }
  }

  /*
   * A window as the person reads it in the task, in the one time zone the
   * server can be sure of: "between 08:55 and 09:55 UTC on 2026-10-20", or
   * with both dates when it spans midnight - never an ISO string with
   * milliseconds.
   */
  public static describeWindow(startTime: Date, endTime: Date): string {
    const start: string = startTime.toISOString();
    const end: string = endTime.toISOString();
    const startDay: string = start.substring(0, 10);
    const endDay: string = end.substring(0, 10);
    const startClock: string = start.substring(11, 16);
    const endClock: string = end.substring(11, 16);

    if (startDay === endDay) {
      return `between ${startClock} and ${endClock} UTC on ${startDay}`;
    }

    return `between ${startDay} ${startClock} and ${endDay} ${endClock} UTC`;
  }

  /*
   * What the AI is asked, in plain words - and what the person sees, and
   * may edit, before sending. Its first line is the task's title.
   */
  public static buildRequestMessage(data: {
    evidence: ProfileFunctionEvidence;
    reason: ProfileFixReason;
    serviceName?: string | undefined;
  }): string {
    const evidence: ProfileFunctionEvidence = data.evidence;
    const name: string = evidence.functionName || "this function";
    const where: string = evidence.fileName ? ` in ${evidence.fileName}` : "";
    const category: ProfileCategory | null = evidence.kind.category;

    const goal: string =
      category === ProfileCategory.Memory ||
      category === ProfileCategory.Allocations
        ? "use less memory"
        : category === ProfileCategory.Locks
          ? "wait less on locks"
          : "faster";

    const of: string = data.serviceName
      ? `${data.serviceName}'s ${ProfileEvidence.describeKind(evidence.kind)}`
      : ProfileEvidence.describeKind(evidence.kind);

    const finding: string =
      data.reason === ProfileFixReason.Grew && evidence.before
        ? `Its share of ${of} grew from ${formatProfileShare(evidence.before.ownShare)} to ${formatProfileShare(evidence.ownShare)} (counting the library and runtime code it calls) ${ProfileFixTaskTrigger.describeWindow(evidence.before.window.startTime, evidence.window.endTime)}.`
        : `It takes ${formatProfileShare(evidence.ownShare)} of ${of} (counting the library and runtime code it calls), in ${evidence.windowSampleCount.toLocaleString("en-US")} samples ${ProfileFixTaskTrigger.describeWindow(evidence.window.startTime, evidence.window.endTime)}.`;

    return [
      `Make ${name}${where} ${goal}`,
      "",
      finding,
      "",
      "The profile attached shows who calls it, what it spends its time calling, and its hottest line. Find why it is costly, change the code so it does less work, keep its behaviour the same, and add or update tests that show it still works.",
    ].join("\n");
  }
}
