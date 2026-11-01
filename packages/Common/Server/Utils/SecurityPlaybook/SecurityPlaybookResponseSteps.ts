import AIRun from "../../../Models/DatabaseModels/AIRun";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import RumSessionPin from "../../../Models/DatabaseModels/RumSessionPin";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseNote from "../../../Models/DatabaseModels/SecurityCaseNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../../Types/AI/AIFixReadiness";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RunbookTriggerType from "../../../Types/Runbook/RunbookTriggerType";
import {
  SecurityEntity,
  SecurityEntityType,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  PostStatusPageAnnouncementConfig,
  RunRunbookConfig,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import {
  ProtectedEntityRule,
  findProtectingRule,
  isProtectedEntityType,
} from "../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { SecurityCaseTemplateValues } from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import AIService from "../../Services/AIService";
import RumSessionPinService from "../../Services/RumSessionPinService";
import RunbookService from "../../Services/RunbookService";
import SecurityCaseNoteService from "../../Services/SecurityCaseNoteService";
import SecurityProtectedEntityService from "../../Services/SecurityProtectedEntityService";
import StatusPageAnnouncementService from "../../Services/StatusPageAnnouncementService";
import StatusPageService from "../../Services/StatusPageService";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import logger from "../Logger";
import RuleRecordScope from "../Rules/RuleRecordScope";
import RunbookStarter, {
  RUNBOOK_RUN_NOT_QUEUED_REASON,
  RUNBOOK_START_SELECT,
  RunbookStartRefusal,
  RunbookStartResult,
} from "../Runbook/RunbookStarter";
import SecurityCaseEvidence, {
  MAX_FIXED_EXCEPTIONS,
  MAX_PINNED_SESSIONS,
  SecurityCaseEvidenceLinks,
  SecurityCaseEvidenceWindow,
  SecurityCaseRequestEvidence,
  SecurityCaseSessionReplay,
  distinctValues,
  getEvidenceWindow,
} from "./SecurityCaseEvidence";
import SecurityPlaybookTargets from "./SecurityPlaybookTargets";
import type {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "./SecurityPlaybookActions";

/*
 * THE STEPS THAT RESPOND THROUGH THE REST OF ONEUPTIME.
 *
 * A security case lives beside the project's runbooks, its session replays,
 * its status pages and its code, and these steps use them:
 *
 *   - Run a runbook: one of the project's runbooks, started with the case as
 *     its inputs (buildRunbookInputs) - to block the address an attack came
 *     from, stop a process, cordon a node: whatever its steps do.
 *   - Preserve the evidence: the session replays of the requests behind the
 *     case are pinned, so they outlive their retention, and a note on the
 *     case lists the traces, replays and exceptions those requests link to.
 *   - Post a status page announcement: what the playbook's author wrote, on
 *     the pages they chose. Nothing of the case goes on a public page.
 *   - Fix the code with AI: a fix run for each exception the case's requests
 *     threw, when OneUptime AI can take one. When it cannot, the step says
 *     what is missing and is skipped rather than failed: a project without a
 *     repository connected is not a broken playbook.
 *
 * Each acts as OneUptime on the case's own project, as every step does
 * (SecurityPlaybookActions).
 */

const ROOT: { isRoot: true } = { isRoot: true };

// The most values of one kind of entity a runbook is handed.
export const MAX_RUNBOOK_INPUT_VALUES: number = 50;

// The longest text a runbook input carries.
export const MAX_RUNBOOK_INPUT_TEXT_LENGTH: number = 2000;

// The longest label a request has in the evidence note.
export const EVIDENCE_LABEL_LENGTH: number = 120;

const NUL: string = String.fromCharCode(0);

function succeeded(
  summary: MarkdownText,
  extra?: Partial<PlaybookStepOutcome>,
): PlaybookStepOutcome {
  return { status: SecurityPlaybookStepStatus.Succeeded, summary, ...extra };
}

function failed(error: string, summary?: MarkdownText): PlaybookStepOutcome {
  return {
    status: SecurityPlaybookStepStatus.Failed,
    summary: summary || FeedMarkdown.empty(),
    error,
  };
}

function skipped(
  summary: MarkdownText,
  extra?: Partial<PlaybookStepOutcome>,
): PlaybookStepOutcome {
  return { status: SecurityPlaybookStepStatus.Skipped, summary, ...extra };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

function cut(text: string, limit: number): string {
  const value: string = (text || "").split(NUL).join("").trim();

  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function plural(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

// ---------- Run a runbook ----------

/*
 * The name each kind of entity has among a runbook's inputs: the list of
 * every one the case names, and - for the kinds a response acts on - the
 * one the case is about.
 */
export const RUNBOOK_INPUT_KEYS: ReadonlyArray<{
  type: SecurityEntityType;
  list: string;
  target?: string | undefined;
}> = [
  { type: SecurityEntityType.IpAddress, list: "ips", target: "ip" },
  { type: SecurityEntityType.User, list: "users", target: "user" },
  { type: SecurityEntityType.Host, list: "hosts", target: "host" },
  { type: SecurityEntityType.Domain, list: "domains" },
  { type: SecurityEntityType.Url, list: "urls" },
  { type: SecurityEntityType.FileHash, list: "file_hashes" },
  { type: SecurityEntityType.Process, list: "processes" },
  /*
   * The store a Data Security case is about - its detections are grouped on
   * it - so a runbook can lock it down again: "data-store:" and its key.
   */
  {
    type: SecurityEntityType.DataStore,
    list: "data_stores",
    target: "data_store",
  },
];

// The kinds of entity a runbook is told the case is about.
export const RUNBOOK_TARGET_TYPES: ReadonlyArray<SecurityEntityType> =
  RUNBOOK_INPUT_KEYS.filter(
    (entry: { target?: string | undefined }): boolean => {
      return Boolean(entry.target);
    },
  ).map((entry: { type: SecurityEntityType }): SecurityEntityType => {
    return entry.type;
  });

export interface RunbookCaseInputs {
  inputs: JSONObject;
  // The protected users and hosts left out of them.
  withheld: Array<SecurityEntity>;
}

/*
 * The case as a runbook's inputs - a Bash step reads each as
 * $ONEUPTIME_INPUT_<NAME>, a JavaScript step as args.inputs
 * (Types/Runbook/RunbookInputs):
 *
 *   case_id, case_number, case_title, case_priority, case_status, case_url,
 *   playbook     what the run is for;
 *   ip, user, host, data_store
 *                the address, user, host and data store the case is about -
 *                what its detections are grouped on, or what threat intel
 *                knows - by the same rule containment acts by
 *                (SecurityPlaybookTargets); "" when it is about none, so a
 *                runbook never blocks the victim by mistake;
 *   ips, users, hosts, domains, urls, file_hashes, processes, data_stores
 *                every one the case names.
 *
 * A protected user or host (Protected Entities) is never handed to a
 * runbook, in any of them.
 */
export function buildRunbookInputs(data: {
  securityCaseId: string;
  values: SecurityCaseTemplateValues;
  playbookName: string;
  entities: ReadonlyArray<SecurityEntity>;
  targets: ReadonlyArray<SecurityPlaybookTarget>;
  protectedRules: ReadonlyArray<ProtectedEntityRule>;
}): RunbookCaseInputs {
  const withheld: Array<SecurityEntity> = [];

  const isProtected: (entity: SecurityEntity) => boolean = (
    entity: SecurityEntity,
  ): boolean => {
    return (
      isProtectedEntityType(entity.type) &&
      Boolean(
        findProtectingRule({
          type: entity.type,
          value: entity.value,
          rules: data.protectedRules,
        }),
      )
    );
  };

  const inputs: JSONObject = {
    case_id: data.securityCaseId,
    case_number: cut(data.values.number, MAX_RUNBOOK_INPUT_TEXT_LENGTH),
    case_title: cut(data.values.title, MAX_RUNBOOK_INPUT_TEXT_LENGTH),
    case_priority: cut(data.values.priority, MAX_RUNBOOK_INPUT_TEXT_LENGTH),
    case_status: cut(data.values.status, MAX_RUNBOOK_INPUT_TEXT_LENGTH),
    case_url: data.values.url,
    playbook: cut(data.playbookName, MAX_RUNBOOK_INPUT_TEXT_LENGTH),
  };

  for (const entry of RUNBOOK_INPUT_KEYS) {
    const list: Array<string> = [];

    for (const entity of data.entities) {
      if (entity.type !== entry.type) {
        continue;
      }

      if (isProtected(entity)) {
        withheld.push(entity);
        continue;
      }

      const value: string = cut(entity.value, MAX_RUNBOOK_INPUT_TEXT_LENGTH);

      if (
        value &&
        !list.includes(value) &&
        list.length < MAX_RUNBOOK_INPUT_VALUES
      ) {
        list.push(value);
      }
    }

    inputs[entry.list] = list;

    if (entry.target) {
      const target: SecurityPlaybookTarget | undefined = data.targets.find(
        (candidate: SecurityPlaybookTarget): boolean => {
          return (
            candidate.type === entry.type &&
            candidate.state !== SecurityPlaybookTargetState.Protected &&
            !isProtected({ type: candidate.type, value: candidate.value })
          );
        },
      );

      inputs[entry.target] = target
        ? cut(target.value, MAX_RUNBOOK_INPUT_TEXT_LENGTH)
        : "";
    }
  }

  return { inputs, withheld };
}

// Why a runbook did not start, as the step says it.
export function describeRunbookRefusal(
  refusal: RunbookStartRefusal,
  runbookName: string,
): string {
  switch (refusal) {
    case RunbookStartRefusal.NotFound:
      return "The runbook this step runs no longer exists.";
    case RunbookStartRefusal.TurnedOff:
      return `The runbook "${runbookName}" is turned off. Turn it on, or pick another runbook on the playbook.`;
    case RunbookStartRefusal.NoSteps:
      return `The runbook "${runbookName}" has no steps to run.`;
    case RunbookStartRefusal.ProjectBlocked:
      return "Runbooks cannot run on their own in this project.";
    case RunbookStartRefusal.NotQueued:
      return RUNBOOK_RUN_NOT_QUEUED_REASON;
  }
}

// ---------- Preserve the evidence ----------

export interface EvidenceException {
  id: string;
  label: string;
}

export interface EvidenceReplay {
  sessionId: string;
  rumApplicationId: string;
  isPinned: boolean;
}

// A request's line in the note: what its event said, and how far it got.
function requestLabel(request: SecurityCaseRequestEvidence): string {
  const label: string = cut(
    (request.message || "").split("\n")[0] || "",
    EVIDENCE_LABEL_LENGTH,
  );

  return label || `Trace ${request.traceId.slice(0, 16)}`;
}

/*
 * The note Preserve the evidence leaves on the case: each request's trace,
 * each session replay (and whether it is now kept), each exception - with
 * a link to each - and, said plainly, what OneUptime cannot hold longer.
 */
export function buildEvidenceNoteMarkdown(data: {
  caseNumber: string;
  requests: ReadonlyArray<SecurityCaseRequestEvidence>;
  replays: ReadonlyArray<EvidenceReplay>;
  exceptions: ReadonlyArray<EvidenceException>;
  links: SecurityCaseEvidenceLinks;
}): MarkdownText {
  const sections: Array<MarkdownText> = [
    mdText`**Evidence for ${data.caseNumber || "this case"}**, as the playbook found it.`,
  ];

  const traced: Array<SecurityCaseRequestEvidence> = data.requests.filter(
    (request: SecurityCaseRequestEvidence): boolean => {
      return Boolean(request.traceId);
    },
  );

  if (traced.length > 0) {
    sections.push(
      mdText`**Requests** (${plural(traced.length, "trace", "traces")})\n${FeedMarkdown.bulletList(
        traced.map((request: SecurityCaseRequestEvidence): MarkdownText => {
          const link: MarkdownText = FeedMarkdown.link(
            requestLabel(request),
            data.links.trace(request.traceId, request.spanId).toString(),
          );

          return request.requestOutcome
            ? mdText`${link} · ${request.requestOutcome}`
            : link;
        }),
      )}`,
    );
  }

  if (data.replays.length > 0) {
    sections.push(
      mdText`**Session replays** (${plural(data.replays.length, "replay", "replays")})\n${FeedMarkdown.bulletList(
        data.replays.map((replay: EvidenceReplay): MarkdownText => {
          const link: MarkdownText = FeedMarkdown.link(
            `Session ${replay.sessionId.slice(0, 16)}`,
            data.links
              .sessionReplay(replay.rumApplicationId, replay.sessionId)
              .toString(),
          );

          return replay.isPinned
            ? mdText`${link} · kept past its retention`
            : mdText`${link} · could not be kept`;
        }),
      )}`,
    );
  }

  if (data.exceptions.length > 0) {
    sections.push(
      mdText`**Exceptions** (${plural(data.exceptions.length, "exception", "exceptions")})\n${FeedMarkdown.bulletList(
        data.exceptions.map((exception: EvidenceException): MarkdownText => {
          return FeedMarkdown.link(
            exception.label,
            data.links.exception(exception.id).toString(),
          );
        }),
      )}`,
    );
  }

  sections.push(
    mdText`Logs and traces are kept only as long as the project keeps telemetry: OneUptime cannot hold them longer, so export what the investigation needs before then.`,
  );

  return FeedMarkdown.join(sections, "\n\n");
}

// An exception group as the note and the step name it.
function exceptionLabel(exception: TelemetryException): string {
  const type: string = (exception.exceptionType || "").trim();
  const message: string = cut(
    (exception.message || "").split("\n")[0] || "",
    EVIDENCE_LABEL_LENGTH,
  );

  if (type && message) {
    return cut(`${type}: ${message}`, EVIDENCE_LABEL_LENGTH);
  }

  return type || message || "Exception";
}

// ---------- Fix the code with AI ----------

export interface ExceptionNotFixed {
  label: string;
  reason: string;
}

// What a readiness check that failed says is missing, as one sentence.
export function describeMissingReadiness(readiness: AIFixReadiness): string {
  const missing: Array<string> = readiness.checks
    .filter((check: AIFixReadinessCheck): boolean => {
      return !check.ok;
    })
    .map((check: AIFixReadinessCheck): string => {
      return check.title;
    });

  return missing.length > 0
    ? `missing ${missing.join(", ")}`
    : "OneUptime AI is not ready to fix it";
}

export default class SecurityPlaybookResponseSteps {
  // ---------- Run a runbook ----------

  public static async runRunbook(
    context: PlaybookStepContext,
    values: SecurityCaseTemplateValues,
  ): Promise<PlaybookStepOutcome> {
    const config: RunRunbookConfig = context.step
      .config as unknown as RunRunbookConfig;

    const runbook: Runbook | null = await RunbookService.findOneBy({
      query: {
        _id: config.runbookId,
        projectId: context.projectId,
      },
      select: RUNBOOK_START_SELECT,
      props: ROOT,
    });

    if (!runbook || !runbook._id) {
      return failed(describeRunbookRefusal(RunbookStartRefusal.NotFound, ""));
    }

    const runbookName: string = runbook.name || "Runbook";
    const securityCase: SecurityCase = context.securityCase;

    // The case's attacker side, kind by kind, as containment picks it.
    const targets: Array<SecurityPlaybookTarget> = [];

    for (const type of RUNBOOK_TARGET_TYPES) {
      targets.push(
        ...(await SecurityPlaybookTargets.selectTargets({
          projectId: context.projectId,
          securityCase,
          entityType: type,
        })),
      );
    }

    const protectedRules: Array<ProtectedEntityRule> = [];

    for (const type of [SecurityEntityType.User, SecurityEntityType.Host]) {
      protectedRules.push(
        ...(await SecurityProtectedEntityService.getRules({
          projectId: context.projectId,
          entityType: type,
        })),
      );
    }

    const { inputs, withheld }: RunbookCaseInputs = buildRunbookInputs({
      securityCaseId: securityCase.id?.toString() || "",
      values,
      playbookName: context.playbookName,
      entities: mergeSecurityEntities(
        (securityCase.entities || []) as unknown as Array<SecurityEntity>,
      ),
      targets,
      protectedRules,
    });

    const result: RunbookStartResult = await RunbookStarter.start({
      projectId: context.projectId,
      runbookId: new ObjectID(runbook._id.toString()),
      trigger: RunbookTriggerType.SecurityPlaybook,
      triggeredByUserId: context.triggeredByUserId,
      inputs,
      triggerDetails: {
        securityCaseId: securityCase.id?.toString() || "",
        caseNumber: securityCase.caseNumberWithPrefix || "",
        playbookName: context.playbookName,
        playbookRunId: context.runId.toString(),
      },
      runbook,
    });

    if (!result.isStarted) {
      return failed(describeRunbookRefusal(result.refusal, runbookName));
    }

    const links: SecurityCaseEvidenceLinks =
      await SecurityCaseEvidence.getLinks(context.projectId);
    const runLink: MarkdownText = FeedMarkdown.link(
      runbookName,
      links
        .runbookRun(runbook._id.toString(), result.execution._id!.toString())
        .toString(),
    );

    return succeeded(mdText`Started the runbook ${runLink}.`, {
      feedEventType: SecurityCaseFeedEventType.ResponseAction,
      ...(withheld.length > 0
        ? {
            detailsInMarkdown: mdText`Left out of its inputs, as protected: ${FeedMarkdown.join(
              withheld.map((entity: SecurityEntity): MarkdownText => {
                return FeedMarkdown.code(entity.value);
              }),
            )}.`,
          }
        : {}),
    });
  }

  // ---------- Preserve the evidence ----------

  public static async preserveEvidence(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const securityCase: SecurityCase = context.securityCase;
    const requests: Array<SecurityCaseRequestEvidence> =
      await SecurityCaseEvidence.findRequests({
        projectId: context.projectId,
        securityCase,
      });

    if (requests.length === 0) {
      return skipped(
        mdText`None of the case's events happened in a request OneUptime traced, so there is no trace, session replay or exception to keep.`,
      );
    }

    const window: SecurityCaseEvidenceWindow = getEvidenceWindow(securityCase);
    const sessionIds: Array<string> = distinctValues(
      requests.map((request: SecurityCaseRequestEvidence): string => {
        return request.sessionId;
      }),
      MAX_PINNED_SESSIONS,
    );
    const fingerprints: Array<string> = distinctValues(
      requests.map((request: SecurityCaseRequestEvidence): string => {
        return request.exceptionFingerprint;
      }),
      20,
    );

    const [sessionReplays, exceptionGroups]: [
      Array<SecurityCaseSessionReplay>,
      Array<TelemetryException>,
    ] = await Promise.all([
      SecurityCaseEvidence.findSessionReplays({
        projectId: context.projectId,
        sessionIds,
        window,
      }),
      SecurityCaseEvidence.findExceptions({
        projectId: context.projectId,
        fingerprints,
      }),
    ]);

    const caseNumber: string = securityCase.caseNumberWithPrefix || "";
    const replays: Array<EvidenceReplay> = [];

    for (const replay of sessionReplays) {
      try {
        const pin: RumSessionPin = new RumSessionPin();
        pin.projectId = context.projectId;
        pin.rumApplicationId = new ObjectID(replay.rumApplicationId);
        pin.sessionId = replay.sessionId;
        pin.reason = cut(
          `Evidence for security case ${caseNumber || ""}: ${securityCase.title || ""}`,
          500,
        );

        // Idempotent: a replay already kept stays kept, by the pin it has.
        await RumSessionPinService.create({ data: pin, props: ROOT });
        replays.push({ ...replay, isPinned: true });
      } catch (error) {
        logger.error(
          `Security playbook: session replay ${replay.sessionId} of case ${caseNumber} could not be kept: ${errorMessage(error)}`,
        );
        replays.push({ ...replay, isPinned: false });
      }
    }

    const exceptions: Array<EvidenceException> = exceptionGroups
      .filter((exception: TelemetryException): boolean => {
        return Boolean(exception.id);
      })
      .map((exception: TelemetryException): EvidenceException => {
        return {
          id: exception.id!.toString(),
          label: exceptionLabel(exception),
        };
      });

    const links: SecurityCaseEvidenceLinks =
      await SecurityCaseEvidence.getLinks(context.projectId);

    const note: SecurityCaseNote = new SecurityCaseNote();
    note.projectId = context.projectId;
    note.securityCaseId = securityCase.id!;
    note.note = buildEvidenceNoteMarkdown({
      caseNumber,
      requests,
      replays,
      exceptions,
      links,
    }).toString();

    // The note service puts the note on the timeline itself.
    await SecurityCaseNoteService.create({ data: note, props: ROOT });

    const traceCount: number = requests.filter(
      (request: SecurityCaseRequestEvidence): boolean => {
        return Boolean(request.traceId);
      },
    ).length;
    const pinnedCount: number = replays.filter(
      (replay: EvidenceReplay): boolean => {
        return replay.isPinned;
      },
    ).length;

    return succeeded(
      mdText`Kept ${plural(pinnedCount, "session replay", "session replays")}, and noted ${plural(traceCount, "trace", "traces")} and ${plural(exceptions.length, "exception", "exceptions")} on the case.`,
      {
        detailsInMarkdown: mdText`Logs and traces cannot be held longer than the project keeps telemetry; the note links to them while they last.`,
      },
    );
  }

  // ---------- Post a status page announcement ----------

  public static async postStatusPageAnnouncement(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: PostStatusPageAnnouncementConfig = context.step
      .config as unknown as PostStatusPageAnnouncementConfig;

    const pageIds: Array<string> = await RuleRecordScope.keepIdsInProject({
      projectId: context.projectId,
      ids: (config.statusPageIds || []).filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      }),
      modelType: StatusPage,
      description: "status pages of a security playbook step",
      logAttributes: { projectId: context.projectId.toString() },
    });

    const pages: Array<StatusPage> =
      pageIds.length > 0
        ? await StatusPageService.findBy({
            query: { _id: new Includes(pageIds) },
            select: { _id: true, name: true },
            skip: 0,
            limit: pageIds.length,
            props: ROOT,
          })
        : [];

    if (pages.length === 0) {
      return failed(
        "None of the status pages this step posts on exists any more. Pick the pages again on the playbook.",
      );
    }

    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
    announcement.projectId = context.projectId;
    announcement.title = config.announcementTitle;
    announcement.description = config.announcementDescription;
    announcement.showAnnouncementAt = OneUptimeDate.getCurrentDate();
    announcement.statusPages = pages.map((page: StatusPage): StatusPage => {
      const reference: StatusPage = new StatusPage();
      reference._id = page._id!.toString();
      return reference;
    });
    announcement.shouldStatusPageSubscribersBeNotified =
      config.notifySubscribers === true;

    const created: StatusPageAnnouncement =
      await StatusPageAnnouncementService.create({
        data: announcement,
        props: ROOT,
      });

    const links: SecurityCaseEvidenceLinks =
      await SecurityCaseEvidence.getLinks(context.projectId);
    const announcementLink: MarkdownText = FeedMarkdown.link(
      config.announcementTitle,
      links.announcement(created._id!.toString()).toString(),
    );
    const pageNames: MarkdownText = FeedMarkdown.join(
      pages.map((page: StatusPage): MarkdownText => {
        return mdText`**${page.name || ""}**`;
      }),
    );

    return succeeded(
      mdText`Posted the announcement ${announcementLink} on ${pageNames}.`,
      {
        feedEventType: SecurityCaseFeedEventType.Notification,
        detailsInMarkdown:
          config.notifySubscribers === true
            ? mdText`The pages' subscribers are being notified.`
            : mdText`The pages' subscribers were not notified.`,
      },
    );
  }

  // ---------- Fix the code with AI ----------

  public static async fixWithAi(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const requests: Array<SecurityCaseRequestEvidence> =
      await SecurityCaseEvidence.findRequests({
        projectId: context.projectId,
        securityCase: context.securityCase,
      });
    const fingerprints: Array<string> = distinctValues(
      requests.map((request: SecurityCaseRequestEvidence): string => {
        return request.exceptionFingerprint;
      }),
      20,
    );

    if (fingerprints.length === 0) {
      return skipped(
        mdText`None of the requests behind the case threw an exception OneUptime recorded, so there is no code to fix.`,
      );
    }

    const exceptions: Array<TelemetryException> = (
      await SecurityCaseEvidence.findExceptions({
        projectId: context.projectId,
        fingerprints,
      })
    )
      .filter((exception: TelemetryException): boolean => {
        return (
          Boolean(exception.id) &&
          !exception.isResolved &&
          !exception.isArchived
        );
      })
      .slice(0, MAX_FIXED_EXCEPTIONS);

    if (exceptions.length === 0) {
      return skipped(
        mdText`The exceptions the case's requests threw are resolved or archived, so there is nothing to fix.`,
      );
    }

    if (!(await AIService.isProjectAIEnabled(context.projectId))) {
      return skipped(
        mdText`OneUptime AI is turned off for this project, so no fix was asked for. Turn it on in Project Settings > AI.`,
      );
    }

    const links: SecurityCaseEvidenceLinks =
      await SecurityCaseEvidence.getLinks(context.projectId);
    const started: Array<MarkdownText> = [];
    const notFixed: Array<ExceptionNotFixed> = [];

    for (const exception of exceptions) {
      const label: string = exceptionLabel(exception);

      try {
        const readiness: AIFixReadiness =
          await TelemetryExceptionService.getAIFixReadiness({
            telemetryExceptionId: exception.id!,
            props: { ...ROOT, tenantId: context.projectId },
          });

        if (!readiness.ready) {
          notFixed.push({ label, reason: describeMissingReadiness(readiness) });
          continue;
        }

        const run: AIRun =
          await TelemetryExceptionService.createCodeFixRunForException({
            telemetryExceptionId: exception.id!,
            props: { ...ROOT, tenantId: context.projectId },
          });

        if (!run) {
          notFixed.push({ label, reason: "no fix run was queued" });
          continue;
        }

        started.push(
          FeedMarkdown.link(
            label,
            links.exceptionAiAssistance(exception.id!.toString()).toString(),
          ),
        );
      } catch (error) {
        notFixed.push({ label, reason: errorMessage(error) });
      }
    }

    const notFixedMarkdown: MarkdownText | undefined =
      notFixed.length > 0
        ? mdText`Not asked for:\n${FeedMarkdown.bulletList(
            notFixed.map((item: ExceptionNotFixed): MarkdownText => {
              return mdText`${item.label}: ${item.reason}`;
            }),
          )}`
        : undefined;

    if (started.length === 0) {
      return skipped(
        mdText`OneUptime AI could not take a fix for the exceptions behind the case.`,
        { detailsInMarkdown: notFixedMarkdown },
      );
    }

    return succeeded(
      mdText`Asked OneUptime AI to fix ${FeedMarkdown.join(started)}. Its pull request shows on each exception's AI page.`,
      {
        feedEventType: SecurityCaseFeedEventType.ResponseAction,
        ...(notFixedMarkdown ? { detailsInMarkdown: notFixedMarkdown } : {}),
      },
    );
  }
}
