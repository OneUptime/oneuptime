import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Purple500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import {
  ExposureLogRead,
  ExposureLogReadStatus,
  getReadsFromOutside,
  withoutLogPrincipals,
} from "../../../../Types/DataSecurity/AccessLogReads";
import { BreachPlace } from "../../../../Types/DataSecurity/BreachLaws";
import { ComplianceFact } from "../../../../Types/DataSecurity/ComplianceFacts";
import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  DataSecurityExposureAssessmentResponse,
  DataSecurityExposureCaseStore,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  editExposureDraft,
  EXPOSURE_DRAFT_PART_TITLES,
  ExposureAssessmentStarter,
  ExposureAssessmentView,
  ExposureDraftAnswer,
  ExposureDraftPart,
  ExposureDraftSection,
  ExposureReadsLogged,
  getDraftableExposureParts,
  getStaleExposureDraftParts,
  HeldExposureDrafts,
  holdExposureDraftsToFacts,
  mergeExposureDrafts,
  readStoredExposureAssessment,
  setExposurePeoplePlaces,
  startExposureAssessment,
  StoredExposureAssessment,
  toStoredExposureAssessmentJson,
} from "../../../../Types/DataSecurity/ExposureAssessment";
import { ExposureChecklistAnswer } from "../../../../Types/DataSecurity/ExposureChecklist";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AIService, { AILogResponse } from "../../../Services/AIService";
import ProjectService from "../../../Services/ProjectService";
import SecurityCaseFeedService from "../../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import UserService from "../../../Services/UserService";
import ExposureAssessmentReader, {
  CHANGE_REFUSED_MESSAGE,
  ExposureCaseScope,
  NOT_ABOUT_A_STORE_MESSAGE,
  ReadExposure,
} from "../../DataSecurity/ExposureAssessmentReader";
import {
  JOB_LOG_READ_LIMITS,
  PERSON_LOG_READ_LIMITS,
  S3LogReadLimitsInTime,
} from "../../DataSecurity/Cloud/Aws/AwsS3AccessLogs";
import FeedPersonName from "../../Feed/FeedPersonName";
import logger from "../../Logger";
import ProjectLanguage from "../../Notification/ProjectLanguage";
import UserLanguage from "../../Notification/UserLanguage";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import DataSecurityAiCall from "./DataSecurityAiCall";
import DataSecurityAiInput, { AiComplianceFacts } from "./DataSecurityAiInput";
import {
  buildCaseExposurePrompt,
  EXPOSURE_ASSESSMENT_MAX_TOKENS,
  EXPOSURE_ASSESSMENT_TEMPERATURE,
  readExposureAssessmentAnswer,
} from "./ExposureAssessmentPrompt";

/*
 * A SECURITY CASE'S EXPOSURE ASSESSMENT (#10377): STARTED, READ, WRITTEN UP
 * BY ONEUPTIME AI, AND EDITED.
 *
 * Plain code works the assessment out every time it is read - the window,
 * who could read the data, whose data it was, the secrets to rotate and
 * which breach laws may apply (ExposureAssessmentReader, and the table of
 * BreachLaws.ts) - so it always says what is true now. The case keeps only
 * what is not worked out (SecurityCase.exposureAssessment): which store it
 * is about and who started it, where a person said the people live, and
 * OneUptime AI's write-up - what it means, a notice to the regulator, a
 * notice to the people affected and an internal summary - each held to the
 * facts it rests on, and each one a person edited theirs from then on.
 *
 *   - Data Security starts one on its own when it opens a case for a
 *     Critical exposure of a store with Restricted or Confidential data
 *     (ExposureAssessmentRun, startOnItsOwn), and OneUptime AI writes it
 *     up there as the project's Data Security AI rules allow
 *     (draftOnItsOwn);
 *   - a person starts one on any case about a store they may read (assess),
 *     and asks OneUptime AI for the write-up (draftForPerson).
 *
 * Its readers are the case's who may read the store and its findings too,
 * since it names what the store holds (ExposureAssessmentReader.mayRead); to
 * change it, they may edit the case as well. The case's timeline says when
 * it was started, written up or edited - never what it says. Nothing is
 * sent anywhere: a notice is text a person edits and copies.
 */

export const PICK_A_STORE_MESSAGE: string =
  "This case is about more than one data store. Say which store to assess.";

export const NOT_ASSESSED_MESSAGE: string =
  "This case has no exposure assessment yet. Assess the exposure first.";

export const NOTHING_TO_DRAFT_MESSAGE: string =
  "A person wrote every part of this assessment's write-up, so there is nothing for OneUptime AI to draft.";

export const ANSWER_UNREAD_MESSAGE: string =
  "OneUptime AI's write-up did not hold to the assessment's facts, so none of it was kept. Try again in a moment, or write the notices yourself.";

// Why OneUptime AI wrote nothing on its own.
export enum ExposureDraftSkip {
  NotAssessed = "not-assessed",
  NothingToDraft = "nothing-to-draft",
  NoLlmProvider = "no-llm-provider",
  NoAiCredits = "no-ai-credits",
  AiDailyLimitReached = "ai-daily-limit-reached",
  // Its answer could not be read, or none of it held to the facts.
  NothingHeld = "nothing-held",
  Failed = "failed",
}

export type ExposureDraftOutcome =
  | { drafted: true; parts: Array<ExposureDraftPart> }
  | { drafted: false; reason: ExposureDraftSkip };

const ROOT: { isRoot: true } = { isRoot: true };

interface AssessmentContext {
  scope: ExposureCaseScope;
  stored: StoredExposureAssessment;
  read: ReadExposure;
  built: AiComplianceFacts;
}

export default class ExposureAssessmentDrafter {
  // The assessment as the caller may read it, with what plain code works out now.
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityExposureAssessmentResponse> {
    const scope: ExposureCaseScope =
      await ExposureAssessmentReader.readScope(data);

    if (!scope.stored) {
      return await this.toResponse({
        projectId: data.projectId,
        props: data.props,
        scope,
        context: null,
      });
    }

    return await this.toResponse({
      projectId: data.projectId,
      props: data.props,
      scope,
      context: await this.readContext({
        projectId: data.projectId,
        scope,
        stored: scope.stored,
        now: data.now,
      }),
    });
  }

  /*
   * A person starts the case's assessment: of the one store it is about, or
   * the store they pick. Asking again for the same store changes nothing;
   * for another store, the assessment starts over for that one.
   */
  @CaptureSpan()
  public static async assess(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    dataStoreId?: ObjectID | undefined;
    now?: Date | undefined;
  }): Promise<DataSecurityExposureAssessmentResponse> {
    if (
      !(await ExposureAssessmentReader.mayChange({
        securityCaseId: data.securityCaseId,
        props: data.props,
      }))
    ) {
      throw new NotAuthorizedException(CHANGE_REFUSED_MESSAGE);
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const scope: ExposureCaseScope =
      await ExposureAssessmentReader.readScope(data);
    const dataStoreId: string = this.pickStore(scope, data.dataStoreId);

    if (scope.stored?.dataStoreId !== dataStoreId) {
      const started: StoredExposureAssessment = startExposureAssessment({
        dataStoreId,
        startedBy: ExposureAssessmentStarter.Person,
        startedByUserId: data.props.userId?.toString(),
        language: await this.languageOf(data),
        now,
      });

      await this.save(data.securityCaseId, started);
      await this.writeTimeline({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        userId: data.props.userId || undefined,
        line: async (byWhom: MarkdownText | null): Promise<MarkdownText> => {
          return byWhom
            ? mdText`**${byWhom}** assessed this exposure: how long the store was open, who could read it, whose data it was and which breach laws may apply. It is on the case's Overview, under Was It a Breach?`
            : mdText`This exposure was assessed: how long the store was open, who could read it, whose data it was and which breach laws may apply. It is on the case's Overview, under Was It a Breach?`;
        },
      });
    }

    return await this.read({ ...data, now });
  }

  /*
   * Data Security starts the assessment on its own, as it opens a case for
   * a Critical exposure: once per case, never over one already started.
   */
  @CaptureSpan()
  public static async startOnItsOwn(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    dataStoreId: ObjectID;
    now?: Date | undefined;
  }): Promise<boolean> {
    const kept: SecurityCase | null = await SecurityCaseService.findOneBy({
      query: { _id: data.securityCaseId, projectId: data.projectId },
      select: { _id: true, exposureAssessment: true },
      props: ROOT,
    });

    if (!kept || readStoredExposureAssessment(kept.exposureAssessment)) {
      return false;
    }

    await this.save(
      data.securityCaseId,
      startExposureAssessment({
        dataStoreId: data.dataStoreId.toString(),
        startedBy: ExposureAssessmentStarter.DataSecurity,
        language: await ProjectLanguage.getLanguage(data.projectId),
        now: data.now || OneUptimeDate.getCurrentDate(),
      }),
    );
    await this.writeTimeline({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      line: async (): Promise<MarkdownText> => {
        return mdText`Data Security assessed this exposure: how long the store was open, who could read it, whose data it was and which breach laws may apply. It is on the case's Overview, under Was It a Breach?`;
      },
    });

    return true;
  }

  /*
   * A person asks OneUptime AI to write the assessment up: every part no
   * person edited, in the language of the person who asked. A case not
   * assessed yet is assessed first.
   */
  @CaptureSpan()
  public static async draftForPerson(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityExposureAssessmentResponse> {
    if (
      !(await ExposureAssessmentReader.mayChange({
        securityCaseId: data.securityCaseId,
        props: data.props,
      }))
    ) {
      throw new NotAuthorizedException(CHANGE_REFUSED_MESSAGE);
    }

    await AIService.assertProjectAIEnabled(data.projectId);

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    let scope: ExposureCaseScope =
      await ExposureAssessmentReader.readScope(data);

    if (!scope.stored) {
      await this.assess({ ...data, now });
      scope = await ExposureAssessmentReader.readScope(data);
    }

    const context: AssessmentContext = await this.readContext({
      projectId: data.projectId,
      scope,
      stored: scope.stored!,
      now,
    });
    const parts: Array<ExposureDraftPart> = getDraftableExposureParts(
      context.stored,
    );

    if (parts.length === 0) {
      throw new BadDataException(NOTHING_TO_DRAFT_MESSAGE);
    }

    const language: string = await this.languageOf(data);
    const response: AILogResponse = await DataSecurityAiCall.ask({
      projectId: data.projectId,
      userId: data.props.userId || undefined,
      prompt: buildCaseExposurePrompt({
        feature: DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
        built: context.built,
        parts,
        dueFirst: context.read.view.mostUrgent?.ruleId,
        language,
      }),
      maxTokens: EXPOSURE_ASSESSMENT_MAX_TOKENS,
      temperature: EXPOSURE_ASSESSMENT_TEMPERATURE,
    });
    const drafted: Partial<Record<ExposureDraftPart, ExposureDraftSection>> =
      this.hold({ content: response.content, parts, context, now });

    if (Object.keys(drafted).length === 0) {
      throw new BadDataException(ANSWER_UNREAD_MESSAGE);
    }

    const merged: StoredExposureAssessment = await this.mergeAndSave({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      drafted,
      facts: context.built.facts,
      language,
      now,
    });

    await this.writeDraftedTimeline({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      parts: Object.keys(drafted) as Array<ExposureDraftPart>,
      userId: data.props.userId || undefined,
    });

    return await this.toResponse({
      projectId: data.projectId,
      props: data.props,
      scope,
      context: { ...context, stored: merged },
    });
  }

  /*
   * OneUptime AI writes the assessment up on its own (ExposureAssessmentRun):
   * every part no person edited, in the project's language, on the provider
   * the AI rule picked. A missing provider, AI credits used up or the
   * project's daily limit reached writes nothing; a person can still ask.
   * Never throws.
   */
  @CaptureSpan()
  public static async draftOnItsOwn(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    llmProviderId?: string | undefined;
    now?: Date | undefined;
  }): Promise<ExposureDraftOutcome> {
    try {
      const now: Date = data.now || OneUptimeDate.getCurrentDate();
      const scope: ExposureCaseScope = await ExposureAssessmentReader.readScope(
        {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          props: ROOT,
        },
      );

      if (!scope.stored) {
        return { drafted: false, reason: ExposureDraftSkip.NotAssessed };
      }

      const parts: Array<ExposureDraftPart> = getDraftableExposureParts(
        scope.stored,
      );

      if (parts.length === 0) {
        return { drafted: false, reason: ExposureDraftSkip.NothingToDraft };
      }

      const blocked: ExposureDraftSkip | null = await this.getBlocker({
        projectId: data.projectId,
        llmProviderId: data.llmProviderId,
      });

      if (blocked) {
        return { drafted: false, reason: blocked };
      }

      const context: AssessmentContext = await this.readContext({
        projectId: data.projectId,
        scope,
        stored: scope.stored,
        now,
      });
      const language: string = await ProjectLanguage.getLanguage(
        data.projectId,
      );
      const response: AILogResponse = await DataSecurityAiCall.ask({
        projectId: data.projectId,
        prompt: buildCaseExposurePrompt({
          feature: DataSecurityAiFeature.DraftExposureAssessment,
          built: context.built,
          parts,
          dueFirst: context.read.view.mostUrgent?.ruleId,
          language,
        }),
        maxTokens: EXPOSURE_ASSESSMENT_MAX_TOKENS,
        temperature: EXPOSURE_ASSESSMENT_TEMPERATURE,
        // No person started it: the call's own messages and bounds hold.
        protectRequestParameters: true,
        rulePickedProviderId: data.llmProviderId,
      });
      const drafted: Partial<Record<ExposureDraftPart, ExposureDraftSection>> =
        this.hold({ content: response.content, parts, context, now });

      if (Object.keys(drafted).length === 0) {
        return { drafted: false, reason: ExposureDraftSkip.NothingHeld };
      }

      await this.mergeAndSave({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        drafted,
        facts: context.built.facts,
        language,
        now,
      });
      await this.writeDraftedTimeline({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        parts: Object.keys(drafted) as Array<ExposureDraftPart>,
      });

      return {
        drafted: true,
        parts: Object.keys(drafted) as Array<ExposureDraftPart>,
      };
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not write up the exposure assessment of security case ${data.securityCaseId.toString()}: ${error}`,
      );

      return { drafted: false, reason: ExposureDraftSkip.Failed };
    }
  }

  // A person's words for one part: theirs from then on, never drafted again.
  @CaptureSpan()
  public static async editPart(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    part: ExposureDraftPart;
    markdown: string;
    now?: Date | undefined;
  }): Promise<DataSecurityExposureAssessmentResponse> {
    if (
      !(await ExposureAssessmentReader.mayChange({
        securityCaseId: data.securityCaseId,
        props: data.props,
      }))
    ) {
      throw new NotAuthorizedException(CHANGE_REFUSED_MESSAGE);
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const scope: ExposureCaseScope =
      await ExposureAssessmentReader.readScope(data);

    if (!scope.stored) {
      throw new BadDataException(NOT_ASSESSED_MESSAGE);
    }

    const context: AssessmentContext = await this.readContext({
      projectId: data.projectId,
      scope,
      stored: scope.stored,
      now,
    });
    const edited:
      | { isDone: true; assessment: StoredExposureAssessment }
      | { isDone: false; refusal: string } = editExposureDraft({
      assessment: context.stored,
      part: data.part,
      markdown: data.markdown,
      facts: context.built.facts,
      userId: data.props.userId?.toString(),
      now,
    });

    if (!edited.isDone) {
      throw new BadDataException(edited.refusal);
    }

    await this.save(data.securityCaseId, edited.assessment);

    const part: string = EXPOSURE_DRAFT_PART_TITLES[data.part];

    await this.writeTimeline({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      userId: data.props.userId || undefined,
      color: Gray500,
      line: async (byWhom: MarkdownText | null): Promise<MarkdownText> => {
        return byWhom
          ? mdText`The exposure assessment's **${part}** was edited by **${byWhom}**.`
          : mdText`The exposure assessment's **${part}** was edited.`;
      },
    });

    return await this.toResponse({
      projectId: data.projectId,
      props: data.props,
      scope,
      context: { ...context, stored: edited.assessment },
    });
  }

  /*
   * Where a person says the people the data is about live: the places the
   * breach laws are applied with from then on. None takes the answer back.
   */
  @CaptureSpan()
  public static async setPeoplePlaces(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    places: ReadonlyArray<unknown>;
    now?: Date | undefined;
  }): Promise<DataSecurityExposureAssessmentResponse> {
    if (
      !(await ExposureAssessmentReader.mayChange({
        securityCaseId: data.securityCaseId,
        props: data.props,
      }))
    ) {
      throw new NotAuthorizedException(CHANGE_REFUSED_MESSAGE);
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const scope: ExposureCaseScope =
      await ExposureAssessmentReader.readScope(data);

    if (!scope.stored) {
      throw new BadDataException(NOT_ASSESSED_MESSAGE);
    }

    const updated: StoredExposureAssessment = setExposurePeoplePlaces({
      assessment: scope.stored,
      places: data.places,
      userId: data.props.userId?.toString(),
      now,
    });

    await this.save(data.securityCaseId, updated);
    await this.writeTimeline({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      userId: data.props.userId || undefined,
      color: Gray500,
      line: async (byWhom: MarkdownText | null): Promise<MarkdownText> => {
        return byWhom
          ? mdText`**${byWhom}** said where the people the exposed data is about live. The exposure assessment's breach laws follow it.`
          : mdText`Where the people the exposed data is about live was said. The exposure assessment's breach laws follow it.`;
      },
    });

    return await this.read({ ...data, now });
  }

  /*
   * A person asks OneUptime to read the store's own access logs for the
   * exposure's window (#10951): as far as a request's time lets it, kept on
   * the case, the timeline saying what they show - counted, never who.
   */
  @CaptureSpan()
  public static async readLogsForPerson(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityExposureAssessmentResponse> {
    if (
      !(await ExposureAssessmentReader.mayChange({
        securityCaseId: data.securityCaseId,
        props: data.props,
      }))
    ) {
      throw new NotAuthorizedException(CHANGE_REFUSED_MESSAGE);
    }

    const scope: ExposureCaseScope =
      await ExposureAssessmentReader.readScope(data);

    if (!scope.stored) {
      throw new BadDataException(NOT_ASSESSED_MESSAGE);
    }

    await this.readAndKeepLogs({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      scope,
      stored: scope.stored,
      limits: PERSON_LOG_READ_LIMITS,
      userId: data.props.userId || undefined,
      now: data.now,
    });

    return await this.read({ ...data, now: data.now });
  }

  /*
   * ...and Data Security reads them on its own as it assesses a case
   * (ExposureAssessmentRun), longer and further, so the write-up rests on
   * what they say. Only for a store whose reads are logged. Never throws.
   */
  @CaptureSpan()
  public static async readLogsOnItsOwn(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    now?: Date | undefined;
  }): Promise<ExposureLogRead | null> {
    try {
      const scope: ExposureCaseScope = await ExposureAssessmentReader.readScope(
        {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          props: ROOT,
        },
      );

      if (!scope.stored) {
        return null;
      }

      return await this.readAndKeepLogs({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        scope,
        stored: scope.stored,
        limits: JOB_LOG_READ_LIMITS,
        onlyWhereLogged: true,
        now: data.now,
      });
    } catch (error) {
      logger.error(
        `DataSecurity: could not read the access logs for security case ${data.securityCaseId.toString()}'s exposure: ${error}`,
      );

      return null;
    }
  }

  // The logs read for the window as it is now, kept on the case over what it holds now.
  private static async readAndKeepLogs(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    scope: ExposureCaseScope;
    stored: StoredExposureAssessment;
    limits: S3LogReadLimitsInTime;
    // On its own: only a store whose reads are logged; a person learns why otherwise.
    onlyWhereLogged?: boolean | undefined;
    userId?: ObjectID | undefined;
    now?: Date | undefined;
  }): Promise<ExposureLogRead | null> {
    const context: AssessmentContext = await this.readContext({
      projectId: data.projectId,
      scope: data.scope,
      stored: data.stored,
      now: data.now,
    });

    if (
      data.onlyWhereLogged &&
      context.read.view.reads.logged !== ExposureReadsLogged.Logged
    ) {
      return null;
    }

    const logRead: ExposureLogRead =
      await ExposureAssessmentReader.readAccessLogs({
        projectId: data.projectId,
        dataStoreId: new ObjectID(data.stored.dataStoreId),
        window: context.read.view.window,
        limits: data.limits,
        now: data.now,
      });
    const fresh: SecurityCase | null = await SecurityCaseService.findOneBy({
      query: { _id: data.securityCaseId, projectId: data.projectId },
      select: { _id: true, exposureAssessment: true },
      props: ROOT,
    });
    const previous: StoredExposureAssessment | null =
      readStoredExposureAssessment(fresh?.exposureAssessment);

    if (!previous || previous.dataStoreId !== data.stored.dataStoreId) {
      return logRead;
    }

    await this.save(data.securityCaseId, { ...previous, logRead });

    const outside: number = getReadsFromOutside(logRead).reads;
    const isRead: boolean = logRead.status === ExposureLogReadStatus.Read;

    await this.writeTimeline({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      userId: data.userId,
      color: Gray500,
      line: async (byWhom: MarkdownText | null): Promise<MarkdownText> => {
        const said: MarkdownText = !isRead
          ? mdText`they could not be read.`
          : outside > 0
            ? mdText`they show ${String(outside)} reads from outside your accounts${logRead.isComplete ? "" : ", in the part read so far"}.`
            : logRead.isComplete
              ? mdText`they show no read from outside your accounts.`
              : mdText`the part read so far shows no read from outside your accounts.`;

        return byWhom
          ? mdText`**${byWhom}** read the store's access logs for the exposure's window: ${said}`
          : mdText`Data Security read the store's access logs for the exposure's window: ${said}`;
      },
    });

    return logRead;
  }

  // The store the assessment is about: the one it keeps, the one asked for, or the case's only one.
  private static pickStore(
    scope: ExposureCaseScope,
    requested: ObjectID | undefined,
  ): string {
    const ids: Array<string> = scope.stores.map(
      (store: DataSecurityExposureCaseStore): string => {
        return store.dataStoreId;
      },
    );

    if (requested) {
      if (!ids.includes(requested.toString())) {
        throw new NotFoundException(NOT_ABOUT_A_STORE_MESSAGE);
      }

      return requested.toString();
    }

    if (scope.stored && ids.includes(scope.stored.dataStoreId)) {
      return scope.stored.dataStoreId;
    }

    if (ids.length === 0) {
      throw new NotFoundException(NOT_ABOUT_A_STORE_MESSAGE);
    }

    if (ids.length > 1) {
      throw new BadDataException(PICK_A_STORE_MESSAGE);
    }

    return ids[0]!;
  }

  // What plain code works out now, and the facts OneUptime AI is told of it.
  private static async readContext(data: {
    projectId: ObjectID;
    scope: ExposureCaseScope;
    stored: StoredExposureAssessment;
    now?: Date | undefined;
  }): Promise<AssessmentContext> {
    const read: ReadExposure = await ExposureAssessmentReader.readView({
      projectId: data.projectId,
      securityCaseId: data.scope.securityCaseId,
      dataStoreId: new ObjectID(data.stored.dataStoreId),
      placesNamed: data.stored.peopleLiveIn?.places as
        | Array<BreachPlace>
        | undefined,
      logRead: data.stored.logRead,
      now: data.now,
    });

    return {
      scope: data.scope,
      stored: data.stored,
      read,
      built: DataSecurityAiInput.exposureAssessmentFacts({
        dossier: { store: read.store, view: read.view },
      }),
    };
  }

  // OneUptime AI's answer, read strictly and held to the facts: only the parts asked.
  private static hold(data: {
    content: string | null | undefined;
    parts: ReadonlyArray<ExposureDraftPart>;
    context: AssessmentContext;
    now: Date;
  }): Partial<Record<ExposureDraftPart, ExposureDraftSection>> {
    const answer: ExposureDraftAnswer | null = readExposureAssessmentAnswer(
      data.content,
    );

    if (!answer) {
      return {};
    }

    const asked: ExposureDraftAnswer = {};

    for (const part of data.parts) {
      if (answer[part]) {
        asked[part] = answer[part];
      }
    }

    const held: HeldExposureDrafts = holdExposureDraftsToFacts({
      answer: asked,
      facts: data.context.built.facts,
      now: data.now,
    });

    return held.sections;
  }

  // Over the assessment as it is now: a part a person saved meanwhile stands.
  private static async mergeAndSave(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    drafted: Partial<Record<ExposureDraftPart, ExposureDraftSection>>;
    facts: ReadonlyArray<ComplianceFact>;
    language: string;
    now: Date;
  }): Promise<StoredExposureAssessment> {
    const fresh: SecurityCase | null = await SecurityCaseService.findOneBy({
      query: { _id: data.securityCaseId, projectId: data.projectId },
      select: { _id: true, exposureAssessment: true },
      props: ROOT,
    });
    const previous: StoredExposureAssessment | null =
      readStoredExposureAssessment(fresh?.exposureAssessment);

    if (!previous) {
      throw new BadDataException(NOT_ASSESSED_MESSAGE);
    }

    const merged: StoredExposureAssessment = mergeExposureDrafts({
      previous,
      drafted: data.drafted,
      facts: data.facts,
      language: data.language,
      now: data.now,
    });

    await this.save(data.securityCaseId, merged);

    return merged;
  }

  // The case's own column, round its hooks: nobody reads it through the API (a hidden column).
  private static async save(
    securityCaseId: ObjectID,
    assessment: StoredExposureAssessment,
  ): Promise<void> {
    await SecurityCaseService.updateColumnsByIdWithoutHooks({
      id: securityCaseId,
      data: {
        exposureAssessment: toStoredExposureAssessmentJson(assessment),
      } as never,
    });
  }

  private static async languageOf(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<string> {
    return data.props.userId
      ? await UserLanguage.getLanguage(data.props.userId)
      : await ProjectLanguage.getLanguage(data.projectId);
  }

  // What stops OneUptime AI before it is asked: no provider, no credits, the day's limit.
  private static async getBlocker(data: {
    projectId: ObjectID;
    llmProviderId?: string | undefined;
  }): Promise<ExposureDraftSkip | null> {
    const pick: ObjectID | undefined =
      data.llmProviderId && ObjectID.isValidUUID(data.llmProviderId)
        ? new ObjectID(data.llmProviderId)
        : undefined;
    const blocker: "provider_missing" | "insufficient_ai_balance" | null =
      await AIInvestigationEngine.getProviderOrBalanceReason(
        data.projectId,
        pick,
      );

    if (blocker === "provider_missing") {
      return ExposureDraftSkip.NoLlmProvider;
    }

    if (blocker === "insufficient_ai_balance") {
      return ExposureDraftSkip.NoAiCredits;
    }

    return (await AIService.getReachedProjectDailyLimit({
      projectId: data.projectId,
    }))
      ? ExposureDraftSkip.AiDailyLimitReached
      : null;
  }

  // One line on the case's timeline: what happened to the assessment, never what it says.
  private static async writeTimeline(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    userId?: ObjectID | undefined;
    color?: typeof Purple500 | undefined;
    line: (byWhom: MarkdownText | null) => Promise<MarkdownText>;
  }): Promise<void> {
    try {
      const byWhom: MarkdownText | null = data.userId
        ? await UserService.getUserMarkdownString({
            userId: data.userId,
            projectId: data.projectId,
          })
        : null;

      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        feedInfoInMarkdown: (await data.line(byWhom)).toString(),
        eventType: SecurityCaseFeedEventType.ExposureAssessment,
        displayColor: data.color || Purple500,
        userId: data.userId,
      });
    } catch (error) {
      logger.error(
        `DataSecurity: could not write the timeline of security case ${data.securityCaseId.toString()}'s exposure assessment: ${error}`,
      );
    }
  }

  private static async writeDraftedTimeline(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    parts: ReadonlyArray<ExposureDraftPart>;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const titles: string = data.parts
      .map((part: ExposureDraftPart): string => {
        return EXPOSURE_DRAFT_PART_TITLES[part];
      })
      .join(", ");

    await this.writeTimeline({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      userId: data.userId,
      line: async (): Promise<MarkdownText> => {
        return mdText`OneUptime AI wrote up the exposure assessment, for a person to review and edit: **${titles}**. Nothing was sent.`;
      },
    });
  }

  private static async toResponse(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    scope: ExposureCaseScope;
    context: AssessmentContext | null;
  }): Promise<DataSecurityExposureAssessmentResponse> {
    const project: { enableAi?: boolean | undefined } | null =
      await ProjectService.findOneById({
        id: data.projectId,
        select: { _id: true, enableAi: true },
        props: ROOT,
      });
    const isAiEnabled: boolean = project?.enableAi !== false;
    const canChange: boolean = await ExposureAssessmentReader.mayChange({
      securityCaseId: data.scope.securityCaseId,
      props: data.props,
    });
    const stored: StoredExposureAssessment | null =
      data.context?.stored || null;
    const facts: Array<ComplianceFact> = data.context?.built.facts || [];
    const editors: Record<string, string> = {};
    const editorIds: Array<string> = [
      ...new Set(
        [
          ...Object.values(stored?.sections || {}).map(
            (section: ExposureDraftSection | undefined): string => {
              return section?.editedByUserId || "";
            },
          ),
          stored?.peopleLiveIn?.saidByUserId || "",
          stored?.startedByUserId || "",
        ].filter((id: string): boolean => {
          return ObjectID.isValidUUID(id);
        }),
      ),
    ];

    // Each as the project knows them: someone only invited by their invitation's name.
    for (const id of editorIds) {
      editors[id] = await FeedPersonName.getText({
        userId: new ObjectID(id),
        projectId: data.projectId,
      });
    }

    const checklist: Array<ExposureChecklistAnswer> = stored
      ? await ExposureAssessmentReader.readChecklist({
          projectId: data.projectId,
          securityCaseId: data.scope.securityCaseId,
          props: data.props,
        })
      : [];
    /*
     * Who read the store, by name, only for a reader who may see who can
     * reach it; everyone else gets the counts (#10951).
     */
    const mayReadAccess: boolean = ExposureAssessmentReader.mayReadAccess(
      data.props,
    );
    const view: ExposureAssessmentView | null = data.context?.read.view || null;
    const shownStored: StoredExposureAssessment | null =
      stored && stored.logRead && !mayReadAccess
        ? { ...stored, logRead: withoutLogPrincipals(stored.logRead) }
        : stored;
    const shownView: ExposureAssessmentView | null =
      view && view.reads.fromLogs && !mayReadAccess
        ? {
            ...view,
            reads: {
              ...view.reads,
              fromLogs: withoutLogPrincipals(view.reads.fromLogs),
            },
          }
        : view;

    return {
      securityCaseId: data.scope.securityCaseId.toString(),
      stores: data.scope.stores,
      dataStoreId: stored?.dataStoreId,
      assessment: shownStored,
      view: shownView,
      facts,
      staleParts: getStaleExposureDraftParts({ assessment: stored, facts }),
      editors,
      checklist,
      isAiEnabled,
      canChange,
      canDraft:
        canChange &&
        isAiEnabled &&
        (!stored || getDraftableExposureParts(stored).length > 0),
    };
  }
}
