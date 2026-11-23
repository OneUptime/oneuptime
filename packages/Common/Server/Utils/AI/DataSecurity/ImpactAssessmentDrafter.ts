import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../../Models/DatabaseModels/DataStoreFeed";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Purple500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import { ComplianceFact } from "../../../../Types/DataSecurity/ComplianceFacts";
import {
  DataSecurityImpactAssessmentResponse,
  DataSecurityRecordOfProcessingRow,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { isDeclaredDataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  editImpactAssessmentSection,
  getStaleImpactAssessmentParts,
  holdImpactAssessmentToFacts,
  IMPACT_ASSESSMENT_PART_TITLES,
  IMPACT_ASSESSMENT_PARTS,
  ImpactAssessmentAnswer,
  ImpactAssessmentPart,
  ImpactAssessmentSection,
  ImpactAssessmentSectionSource,
  ImpactAssessmentTrigger,
  ImpactAssessmentTriggerView,
  mergeImpactAssessmentDraft,
  readStoreImpactAssessment,
  StoreImpactAssessment,
  toStoreImpactAssessmentJson,
} from "../../../../Types/DataSecurity/ImpactAssessment";
import {
  getRecordValueText,
  isRecordFieldValueEmpty,
  RecordFieldStatus,
  RecordFieldView,
} from "../../../../Types/DataSecurity/RecordOfProcessing";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AIService, { AILogResponse } from "../../../Services/AIService";
import DataStoreFeedService from "../../../Services/DataStoreFeedService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import UserService from "../../../Services/UserService";
import ProjectDataTypeNames from "../../DataSecurity/ProjectDataTypeNames";
import RecordOfProcessingReader, {
  getImpactAssessmentStatus,
} from "../../DataSecurity/RecordOfProcessingReader";
import FeedPersonName from "../../Feed/FeedPersonName";
import UserLanguage from "../../Notification/UserLanguage";
import ProjectLanguage from "../../Notification/ProjectLanguage";
import CallerPermission from "../../Permission/CallerPermission";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataSecurityAiCall from "./DataSecurityAiCall";
import DataSecurityAiInput, {
  AiComplianceFacts,
  AiImpactAssessmentDossier,
  AiRecordEntry,
} from "./DataSecurityAiInput";
import {
  buildStoreImpactAssessmentPrompt,
  IMPACT_ASSESSMENT_MAX_TOKENS,
  IMPACT_ASSESSMENT_TEMPERATURE,
  readImpactAssessmentAnswer,
} from "./ImpactAssessmentPrompt";
import RecordOfProcessingDossier from "./RecordOfProcessingDossier";

/*
 * A STORE'S DATA PROTECTION IMPACT ASSESSMENT (#10375): READ, DRAFTED BY
 * ONEUPTIME AI WHEN A PERSON ASKS, AND EDITED PART BY PART.
 *
 * A store needs one when it holds special category data, data about many
 * people, or data that leaves its people's countries
 * (getImpactAssessmentTriggers); only then is one drafted. Its readers are
 * the store's who may read its issues too: the assessment's risks are its
 * open issues.
 *
 * The draft is written from the store's facts (RecordOfProcessingDossier,
 * DataSecurityAiInput.impactAssessmentFacts) - its record, what it holds
 * and where, its open issues and fixes, how exposed it is, who can reach
 * it, its encryption and backups - asked through the one Data Security
 * call, read strictly and held to the facts (holdImpactAssessmentToFacts).
 * A part a person edited is never drafted again, whatever the draft says
 * (mergeImpactAssessmentDraft), and a part written over facts that changed
 * since says so.
 *
 * Each draft and each edit is one entry on the store's timeline.
 */

export const NOT_NEEDED_MESSAGE: string =
  "This store does not need an impact assessment: it holds no special category data, no data about many people, and none of its data leaves its people's countries.";

export const NOTHING_TO_DRAFT_MESSAGE: string =
  "Every part of this assessment was written by a person, so there is nothing for OneUptime AI to draft.";

export const ANSWER_UNREAD_MESSAGE: string =
  "OneUptime AI's answer could not be read as an assessment. Try again in a moment.";

export const ISSUES_REFUSED_MESSAGE: string =
  "An impact assessment rests on the store's issues, and you may not read Data Security issues in this project.";

interface AssessmentContext {
  store: DataStore;
  row: DataSecurityRecordOfProcessingRow;
  triggers: Array<ImpactAssessmentTriggerView>;
  assessment: StoreImpactAssessment | null;
  built: AiComplianceFacts;
}

// What the store's record says of each field, for its assessment's facts.
function recordEntriesOf(
  row: DataSecurityRecordOfProcessingRow,
): Array<AiRecordEntry> {
  return (row.fields || [])
    .map((view: RecordFieldView): AiRecordEntry | null => {
      const value: string = getRecordValueText(
        view.status === RecordFieldStatus.Drafted && view.draft
          ? view.draft.value
          : view.value,
      );

      return isRecordFieldValueEmpty(value)
        ? null
        : { field: view.field, value, status: view.status };
    })
    .filter((entry: AiRecordEntry | null): entry is AiRecordEntry => {
      return Boolean(entry);
    });
}

export default class ImpactAssessmentDrafter {
  // Whether the caller may read the store's issues, which the assessment rests on.
  public static mayReadIssues(props: DatabaseCommonInteractionProps): boolean {
    return (
      props.isRoot === true ||
      CallerPermission.holdsModelPermission(props, {
        model: new DataSecurityIssue(),
        operation: "read",
      })
    );
  }

  // The store, its row of the record and its assessment, with the facts as they are now.
  private static async readContext(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<AssessmentContext> {
    if (!this.mayReadIssues(data.props)) {
      throw new NotAuthorizedException(ISSUES_REFUSED_MESSAGE);
    }

    // Read as the caller first: a store they may not read is not found (readRow).
    const row: DataSecurityRecordOfProcessingRow =
      await RecordOfProcessingReader.readRow({
        projectId: data.projectId,
        props: data.props,
        dataStoreId: data.dataStoreId,
      });
    const store: DataStore = await RecordOfProcessingDossier.readStore({
      projectId: data.projectId,
      dataStoreId: data.dataStoreId,
    });
    const kept: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId, projectId: data.projectId },
      select: { _id: true, impactAssessment: true },
      props: { isRoot: true },
    });
    const dossier: AiImpactAssessmentDossier =
      await RecordOfProcessingDossier.readForAssessment({
        projectId: data.projectId,
        store,
        record: recordEntriesOf(row),
        now: data.now,
      });

    return {
      store,
      row,
      triggers: row.impactAssessment?.triggers || [],
      assessment: readStoreImpactAssessment(kept?.impactAssessment),
      built: DataSecurityAiInput.impactAssessmentFacts({
        dossier,
        dataTypeNamer: await ProjectDataTypeNames.read({
          projectId: data.projectId,
        }),
      }),
    };
  }

  // The assessment as the caller may read it, with the facts as they are now.
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityImpactAssessmentResponse> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const context: AssessmentContext = await this.readContext({
      ...data,
      now,
    });

    return await this.toResponse({
      projectId: data.projectId,
      props: data.props,
      context,
      assessment: context.assessment,
    });
  }

  /*
   * A person asked OneUptime AI for the assessment: every part no person
   * edited is drafted, in the language of the person who asked.
   */
  @CaptureSpan()
  public static async draftForPerson(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityImpactAssessmentResponse> {
    await AIService.assertProjectAIEnabled(data.projectId);

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const context: AssessmentContext = await this.readContext({
      ...data,
      now,
    });

    if (isDeclaredDataStoreKind(context.store.kind)) {
      throw new BadDataException(NOT_NEEDED_MESSAGE);
    }

    if (context.triggers.length === 0) {
      throw new BadDataException(NOT_NEEDED_MESSAGE);
    }

    const parts: Array<ImpactAssessmentPart> = IMPACT_ASSESSMENT_PARTS.filter(
      (part: ImpactAssessmentPart): boolean => {
        return (
          context.assessment?.sections[part]?.source !==
          ImpactAssessmentSectionSource.Edited
        );
      },
    );

    if (parts.length === 0) {
      throw new BadDataException(NOTHING_TO_DRAFT_MESSAGE);
    }

    const language: string = data.props.userId
      ? await UserLanguage.getLanguage(data.props.userId)
      : await ProjectLanguage.getLanguage(data.projectId);
    const response: AILogResponse = await DataSecurityAiCall.ask({
      projectId: data.projectId,
      userId: data.props.userId || undefined,
      prompt: buildStoreImpactAssessmentPrompt({
        built: context.built,
        triggers: context.triggers,
        parts,
        language,
      }),
      maxTokens: IMPACT_ASSESSMENT_MAX_TOKENS,
      temperature: IMPACT_ASSESSMENT_TEMPERATURE,
    });
    const answer: ImpactAssessmentAnswer | null = readImpactAssessmentAnswer(
      response.content,
    );
    const drafted: Partial<
      Record<ImpactAssessmentPart, ImpactAssessmentSection>
    > = answer
      ? holdImpactAssessmentToFacts({
          answer: Object.fromEntries(
            parts
              .filter((part: ImpactAssessmentPart): boolean => {
                return Boolean(answer[part]);
              })
              .map((part: ImpactAssessmentPart) => {
                return [part, answer[part]];
              }),
          ) as ImpactAssessmentAnswer,
          facts: context.built.facts,
          now,
        })
      : {};

    if (Object.keys(drafted).length === 0) {
      throw new BadDataException(ANSWER_UNREAD_MESSAGE);
    }

    // Over the assessment as it is now: a part a person saved meanwhile stands.
    const fresh: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId, projectId: data.projectId },
      select: { _id: true, impactAssessment: true },
      props: { isRoot: true },
    });
    const merged: StoreImpactAssessment = mergeImpactAssessmentDraft({
      previous: readStoreImpactAssessment(fresh?.impactAssessment),
      drafted,
      facts: context.built.facts,
      triggers: context.triggers.map(
        (trigger: ImpactAssessmentTriggerView): ImpactAssessmentTrigger => {
          return trigger.trigger;
        },
      ),
      language,
      now,
    });

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: data.dataStoreId,
      data: {
        impactAssessment: toStoreImpactAssessmentJson(merged),
      } as never,
    });

    await DataStoreFeedService.createDataStoreFeedItem({
      projectId: data.projectId,
      dataStoreId: data.dataStoreId,
      dataStoreFeedEventType: DataStoreFeedEventType.AiProposed,
      displayColor: Purple500,
      feedInfoInMarkdown:
        mdText`OneUptime AI drafted this store's data protection impact assessment, for you to review and edit: **${(
          Object.keys(drafted) as Array<ImpactAssessmentPart>
        )
          .map((part: ImpactAssessmentPart): string => {
            return IMPACT_ASSESSMENT_PART_TITLES[part];
          })
          .join(", ")}**.`.toString(),
      userId: data.props.userId || undefined,
    });

    return await this.toResponse({
      projectId: data.projectId,
      props: data.props,
      context,
      assessment: merged,
    });
  }

  // A person's words for one part: theirs from then on, never drafted again.
  @CaptureSpan()
  public static async editPart(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
    part: ImpactAssessmentPart;
    markdown: string;
    now?: Date | undefined;
  }): Promise<DataSecurityImpactAssessmentResponse> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const context: AssessmentContext = await this.readContext({
      ...data,
      now,
    });
    const project: { language: string } = {
      language:
        context.assessment?.language ||
        (data.props.userId
          ? await UserLanguage.getLanguage(data.props.userId)
          : await ProjectLanguage.getLanguage(data.projectId)),
    };
    const edited:
      | { isDone: true; assessment: StoreImpactAssessment }
      | { isDone: false; refusal: string } = editImpactAssessmentSection({
      assessment: context.assessment,
      part: data.part,
      markdown: data.markdown,
      facts: context.built.facts,
      userId: data.props.userId?.toString(),
      language: project.language,
      now,
    });

    if (!edited.isDone) {
      throw new BadDataException(edited.refusal);
    }

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: data.dataStoreId,
      data: {
        impactAssessment:
          Object.keys(edited.assessment.sections).length > 0
            ? toStoreImpactAssessmentJson(edited.assessment)
            : null,
      } as never,
    });

    const byWhom: MarkdownText | null = data.props.userId
      ? await UserService.getUserMarkdownString({
          userId: data.props.userId,
          projectId: data.projectId,
        })
      : null;
    const part: string = IMPACT_ASSESSMENT_PART_TITLES[data.part];

    await DataStoreFeedService.createDataStoreFeedItem({
      projectId: data.projectId,
      dataStoreId: data.dataStoreId,
      dataStoreFeedEventType: DataStoreFeedEventType.DataStoreUpdated,
      displayColor: Gray500,
      feedInfoInMarkdown: (byWhom
        ? mdText`📝 The impact assessment's **${part}** was edited by **${byWhom}**.`
        : mdText`📝 The impact assessment's **${part}** was edited.`
      ).toString(),
      userId: data.props.userId || undefined,
    });

    return await this.toResponse({
      projectId: data.projectId,
      props: data.props,
      context,
      assessment: edited.assessment,
    });
  }

  private static async toResponse(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    context: AssessmentContext;
    assessment: StoreImpactAssessment | null;
  }): Promise<DataSecurityImpactAssessmentResponse> {
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
        model: new DataStore(),
        operation: "update",
      });
    const editorIds: Array<string> = [
      ...new Set(
        Object.values(data.assessment?.sections || {})
          .map((section: ImpactAssessmentSection | undefined): string => {
            return section?.editedByUserId || "";
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    ];
    const editors: Record<string, string> = {};

    // Each as the project knows them: someone only invited by their invitation's name.
    for (const id of editorIds) {
      editors[id] = await FeedPersonName.getText({
        userId: new ObjectID(id),
        projectId: data.projectId,
      });
    }

    const facts: Array<ComplianceFact> = data.context.built.facts;

    return {
      dataStoreId: data.context.row.dataStoreId,
      storeName: data.context.row.name,
      storeKind: data.context.row.kind,
      region: data.context.row.region,
      status: getImpactAssessmentStatus({
        triggers: data.context.triggers,
        assessment: data.assessment,
      }),
      triggers: data.context.triggers,
      assessment: data.assessment,
      facts,
      staleParts: getStaleImpactAssessmentParts({
        assessment: data.assessment,
        facts,
      }),
      editors,
      isAiEnabled,
      canEdit,
      canDraft:
        canEdit &&
        isAiEnabled &&
        data.context.triggers.length > 0 &&
        IMPACT_ASSESSMENT_PARTS.some((part: ImpactAssessmentPart): boolean => {
          return (
            data.assessment?.sections[part]?.source !==
            ImpactAssessmentSectionSource.Edited
          );
        }),
    };
  }
}
