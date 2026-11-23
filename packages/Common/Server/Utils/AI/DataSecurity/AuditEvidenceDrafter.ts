import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecuritySetting from "../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import {
  AuditEvidenceAnswerParagraph,
  AuditEvidenceParagraph,
  AuditEvidenceParagraphSource,
  editAuditEvidenceParagraph,
  FrameworkAuditEvidence,
  getAuditEvidenceEntryKey,
  getRequirementFacts,
  holdAuditEvidenceToFacts,
  isEvidenceParagraphStale,
  mergeAuditEvidenceDraft,
  ProjectAuditEvidence,
  readProjectAuditEvidence,
  summarizeRequirementFacts,
  toProjectAuditEvidenceJson,
} from "../../../../Types/DataSecurity/AuditEvidence";
import ComplianceFramework from "../../../../Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataSecurityAuditEvidenceRequirement,
  DataSecurityAuditEvidenceResponse,
  DataSecurityRecordOfProcessingRow,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import AIService, { AILogResponse } from "../../../Services/AIService";
import DataSecuritySettingService from "../../../Services/DataSecuritySettingService";
import ProjectService from "../../../Services/ProjectService";
import AuditEvidenceReader, {
  AuditEvidenceRead,
} from "../../DataSecurity/AuditEvidenceReader";
import RecordOfProcessingReader from "../../DataSecurity/RecordOfProcessingReader";
import FeedPersonName from "../../Feed/FeedPersonName";
import ProjectLanguage from "../../Notification/ProjectLanguage";
import UserLanguage from "../../Notification/UserLanguage";
import CallerPermission from "../../Permission/CallerPermission";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  AUDIT_EVIDENCE_MAX_TOKENS,
  AUDIT_EVIDENCE_TEMPERATURE,
  buildFrameworkEvidencePrompt,
  readAuditEvidenceAnswer,
} from "./AuditEvidencePrompt";
import DataSecurityAiCall from "./DataSecurityAiCall";
import DataSecurityAiInput, { AiComplianceFacts } from "./DataSecurityAiInput";

/*
 * A FRAMEWORK'S AUDIT EVIDENCE (#10375): READ, ITS PARAGRAPHS DRAFTED BY
 * ONEUPTIME AI WHEN A PERSON ASKS, AND EDITED ONE BY ONE.
 *
 * Each requirement's facts are worked out by plain code for the period
 * (AuditEvidenceReader) and made into facts as the builder makes them
 * (DataSecurityAiInput.auditEvidenceFacts); OneUptime AI drafts, from those
 * alone, the paragraph an auditor reads under each requirement, asked
 * through the one Data Security call and held to the facts
 * (holdAuditEvidenceToFacts). A paragraph a person edited is never drafted
 * again (mergeAuditEvidenceDraft); one written over facts that say
 * something else now says so. The project keeps them for each framework
 * and period (DataSecuritySetting.auditEvidence).
 *
 * Its readers may read the project's stores and its issues: the evidence
 * is the issues' history. Drafting and editing take the permission to
 * change Data Security issues, as accepting a risk does.
 */

export const STORES_REFUSED_MESSAGE: string =
  "Audit evidence names the stores in each requirement's scope, and you may not read data stores in this project.";

export const EVIDENCE_NOTHING_TO_DRAFT_MESSAGE: string =
  "Every paragraph of this evidence was written by a person, so there is nothing for OneUptime AI to draft.";

export const EVIDENCE_ANSWER_UNREAD_MESSAGE: string =
  "OneUptime AI's answer could not be read as audit evidence. Try again in a moment.";

interface EvidenceContext {
  read: AuditEvidenceRead;
  built: AiComplianceFacts;
  stored: FrameworkAuditEvidence | null;
  project: ProjectAuditEvidence;
  settingId: ObjectID | null;
}

export default class AuditEvidenceDrafter {
  private static assertMayRead(props: DatabaseCommonInteractionProps): void {
    if (
      props.isRoot !== true &&
      !CallerPermission.holdsModelPermission(props, {
        model: new DataStore(),
        operation: "read",
      })
    ) {
      throw new NotAuthorizedException(STORES_REFUSED_MESSAGE);
    }
  }

  private static async readContext(data: {
    projectId: ObjectID;
    framework: ComplianceFramework;
    periodInDays: number;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<EvidenceContext> {
    this.assertMayRead(data.props);

    const read: AuditEvidenceRead = await AuditEvidenceReader.read(data);
    const setting: DataSecuritySetting | null =
      await DataSecuritySettingService.findOneBy({
        query: { projectId: data.projectId },
        select: { _id: true, auditEvidence: true },
        props: { isRoot: true },
      });
    const project: ProjectAuditEvidence = readProjectAuditEvidence(
      setting?.auditEvidence,
    );

    return {
      read,
      built: DataSecurityAiInput.auditEvidenceFacts({
        framework: data.framework,
        periodInDays: data.periodInDays,
        requirements: read.requirements,
      }),
      stored:
        project.entries[
          getAuditEvidenceEntryKey(data.framework, data.periodInDays)
        ] || null,
      project,
      settingId: setting?.id || null,
    };
  }

  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    framework: ComplianceFramework;
    periodInDays: number;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityAuditEvidenceResponse> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const context: EvidenceContext = await this.readContext({ ...data, now });

    return await this.toResponse({ ...data, context, stored: context.stored });
  }

  /*
   * A person asked OneUptime AI for the evidence: a paragraph for every
   * requirement no person wrote, in the language of the person who asked.
   */
  @CaptureSpan()
  public static async draftForPerson(data: {
    projectId: ObjectID;
    framework: ComplianceFramework;
    periodInDays: number;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityAuditEvidenceResponse> {
    await AIService.assertProjectAIEnabled(data.projectId);

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const context: EvidenceContext = await this.readContext({ ...data, now });
    const toDraft: Array<{
      requirement: string;
      title: string;
      status: string;
    }> = context.read.framework.requirements
      .filter(
        (requirement: {
          requirement: string;
          status: ComplianceRequirementStatus;
        }): boolean => {
          return (
            context.stored?.paragraphs[requirement.requirement]?.source !==
            AuditEvidenceParagraphSource.Edited
          );
        },
      )
      .map(
        (requirement: {
          requirement: string;
          title: string;
          status: ComplianceRequirementStatus;
        }) => {
          return {
            requirement: requirement.requirement,
            title: requirement.title,
            status: requirement.status,
          };
        },
      );

    if (toDraft.length === 0) {
      throw new BadDataException(EVIDENCE_NOTHING_TO_DRAFT_MESSAGE);
    }

    const language: string = data.props.userId
      ? await UserLanguage.getLanguage(data.props.userId)
      : await ProjectLanguage.getLanguage(data.projectId);
    const response: AILogResponse = await DataSecurityAiCall.ask({
      projectId: data.projectId,
      userId: data.props.userId || undefined,
      prompt: buildFrameworkEvidencePrompt({
        built: context.built,
        framework: data.framework,
        frameworkName: context.read.framework.fullName,
        periodInDays: data.periodInDays,
        requirements: toDraft,
        language,
      }),
      maxTokens: AUDIT_EVIDENCE_MAX_TOKENS,
      temperature: AUDIT_EVIDENCE_TEMPERATURE,
    });
    const answer: Array<AuditEvidenceAnswerParagraph> | null =
      readAuditEvidenceAnswer(response.content);
    const asked: Set<string> = new Set(
      toDraft.map((entry: { requirement: string }): string => {
        return entry.requirement;
      }),
    );
    const drafted: Record<string, AuditEvidenceParagraph> = answer
      ? holdAuditEvidenceToFacts({
          framework: data.framework,
          answer: answer.filter(
            (paragraph: AuditEvidenceAnswerParagraph): boolean => {
              return asked.has(paragraph.requirement);
            },
          ),
          facts: context.built.facts,
          now,
        })
      : {};

    if (Object.keys(drafted).length === 0) {
      throw new BadDataException(EVIDENCE_ANSWER_UNREAD_MESSAGE);
    }

    const stored: FrameworkAuditEvidence = await this.write({
      projectId: data.projectId,
      framework: data.framework,
      periodInDays: data.periodInDays,
      change: (previous: FrameworkAuditEvidence | null) => {
        return mergeAuditEvidenceDraft({
          previous,
          framework: data.framework,
          periodInDays: data.periodInDays,
          drafted,
          facts: context.built.facts,
          language,
          now,
        });
      },
    });

    return await this.toResponse({ ...data, context, stored });
  }

  // A person's paragraph for one requirement: theirs from then on.
  @CaptureSpan()
  public static async editParagraph(data: {
    projectId: ObjectID;
    framework: ComplianceFramework;
    periodInDays: number;
    requirement: string;
    text: string;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityAuditEvidenceResponse> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const context: EvidenceContext = await this.readContext({ ...data, now });
    const language: string =
      context.stored?.language ||
      (data.props.userId
        ? await UserLanguage.getLanguage(data.props.userId)
        : await ProjectLanguage.getLanguage(data.projectId));
    const refused: { refusal: string | null } = { refusal: null };
    const stored: FrameworkAuditEvidence = await this.write({
      projectId: data.projectId,
      framework: data.framework,
      periodInDays: data.periodInDays,
      change: (previous: FrameworkAuditEvidence | null) => {
        const edited:
          | { isDone: true; evidence: FrameworkAuditEvidence }
          | { isDone: false; refusal: string } = editAuditEvidenceParagraph({
          evidence: previous,
          framework: data.framework,
          periodInDays: data.periodInDays,
          requirement: data.requirement,
          text: data.text,
          facts: context.built.facts,
          userId: data.props.userId?.toString(),
          language,
          now,
        });

        if (!edited.isDone) {
          refused.refusal = edited.refusal;
          return null;
        }

        return edited.evidence;
      },
    });

    if (refused.refusal) {
      throw new BadDataException(refused.refusal);
    }

    return await this.toResponse({ ...data, context, stored });
  }

  /*
   * The framework's evidence for the period, changed over what the project
   * keeps now - another framework's, or another period's, stays as it is.
   * A change that answers null writes nothing.
   */
  private static async write(data: {
    projectId: ObjectID;
    framework: ComplianceFramework;
    periodInDays: number;
    change: (
      previous: FrameworkAuditEvidence | null,
    ) => FrameworkAuditEvidence | null;
  }): Promise<FrameworkAuditEvidence> {
    const setting: DataSecuritySetting =
      await DataSecuritySettingService.getOrCreateForProject(data.projectId);
    const fresh: DataSecuritySetting | null =
      await DataSecuritySettingService.findOneBy({
        query: { _id: setting.id!, projectId: data.projectId },
        select: { _id: true, auditEvidence: true },
        props: { isRoot: true },
      });
    const project: ProjectAuditEvidence = readProjectAuditEvidence(
      fresh?.auditEvidence,
    );
    const key: string = getAuditEvidenceEntryKey(
      data.framework,
      data.periodInDays,
    );
    const previous: FrameworkAuditEvidence | null = project.entries[key] || null;
    const next: FrameworkAuditEvidence | null = data.change(previous);

    if (!next) {
      return (
        previous || {
          framework: data.framework,
          periodInDays: data.periodInDays,
          language: "en",
          paragraphs: {},
          facts: [],
        }
      );
    }

    project.entries[key] = next;

    await DataSecuritySettingService.updateColumnsByIdWithoutHooks({
      id: setting.id!,
      data: { auditEvidence: toProjectAuditEvidenceJson(project) } as never,
    });

    return next;
  }

  private static async toResponse(data: {
    projectId: ObjectID;
    framework: ComplianceFramework;
    periodInDays: number;
    props: DatabaseCommonInteractionProps;
    context: EvidenceContext;
    stored: FrameworkAuditEvidence | null;
  }): Promise<DataSecurityAuditEvidenceResponse> {
    const read: AuditEvidenceRead = data.context.read;
    const facts: AiComplianceFacts = data.context.built;
    const requirements: Array<DataSecurityAuditEvidenceRequirement> =
      read.framework.requirements.map(
        (requirement: {
          requirement: string;
          title: string;
          status: ComplianceRequirementStatus;
        }): DataSecurityAuditEvidenceRequirement => {
          const own: ReturnType<typeof getRequirementFacts> =
            getRequirementFacts(facts.facts, requirement.requirement);
          const paragraph: AuditEvidenceParagraph | null =
            data.stored?.paragraphs[requirement.requirement] || null;

          return {
            requirement: requirement.requirement,
            title: requirement.title,
            status: requirement.status,
            facts: own,
            paragraph,
            isParagraphStale: paragraph
              ? isEvidenceParagraphStale({ paragraph, facts: facts.facts })
              : false,
            summary: summarizeRequirementFacts(own),
          };
        },
      );
    const readable: Set<string> = new Set(read.readableStoreIds);
    const record: Array<DataSecurityRecordOfProcessingRow> = (
      await RecordOfProcessingReader.read({
        projectId: data.projectId,
        props: data.props,
      })
    ).rows.filter((row: DataSecurityRecordOfProcessingRow): boolean => {
      return readable.has(row.dataStoreId.toLowerCase());
    });
    const project: { enableAi?: boolean | undefined } | null =
      await ProjectService.findOneById({
        id: data.projectId,
        select: { _id: true, enableAi: true },
        props: { isRoot: true },
      });
    const isAiEnabled: boolean = project?.enableAi !== false;
    const canEdit: boolean =
      data.props.isRoot === true ||
      CallerPermission.holdsModelPermission(data.props, {
        model: new DataSecurityIssue(),
        operation: "update",
      });
    const editors: Record<string, string> = {};

    for (const paragraph of Object.values(data.stored?.paragraphs || {})) {
      const id: string = paragraph.editedByUserId || "";

      if (ObjectID.isValidUUID(id) && !editors[id]) {
        editors[id] = await FeedPersonName.getText({
          userId: new ObjectID(id),
          projectId: data.projectId,
        });
      }
    }

    return {
      framework: data.framework,
      fullName: read.framework.fullName,
      scope: read.framework.scope,
      score: read.framework.score,
      storesInScope: read.framework.storesInScope,
      periodInDays: data.periodInDays,
      requirements,
      record,
      issueHistory: read.issueHistory,
      draftedAt: data.stored?.draftedAt,
      language: data.stored?.language,
      editors,
      isAiEnabled,
      canEdit,
      canDraft:
        canEdit &&
        isAiEnabled &&
        requirements.some(
          (requirement: DataSecurityAuditEvidenceRequirement): boolean => {
            return (
              requirement.paragraph?.source !==
              AuditEvidenceParagraphSource.Edited
            );
          },
        ),
    };
  }
}
