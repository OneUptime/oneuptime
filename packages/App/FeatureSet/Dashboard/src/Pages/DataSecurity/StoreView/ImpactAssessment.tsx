import PageComponentProps from "../../PageComponentProps";
import {
  ASSESSMENT_DESCRIPTION,
  ASSESSMENT_DRAFTED_TOAST,
  ASSESSMENT_TITLE,
  DRAFT_AGAIN,
  DRAFT_ASSESSMENT,
  EXPORT_MARKDOWN,
  EXPORT_PDF,
  LEAVES_COUNTRIES,
  MANY_PEOPLE,
  NO_ASSESSMENT_YET,
  NOT_LEGAL_ADVICE,
  NOT_NEEDED_DESCRIPTION,
  NOT_NEEDED_TITLE,
  NOT_WRITTEN_YET,
  SPECIAL_CATEGORIES,
  UNSAVED_ASSESSMENT,
  WHY_IT_NEEDS_ONE,
} from "../../../Components/DataSecurity/ComplianceDraftsCopy";
import { getFactsByKeys } from "../../../Components/DataSecurity/ComplianceFacts";
import CompliancePaperSection from "../../../Components/DataSecurity/CompliancePaperSection";
import {
  PaperworkExportNames,
  downloadMarkdown,
  downloadMarkdownPdf,
  getImpactAssessmentExportNames,
  getImpactAssessmentMarkdown,
} from "../../../Components/DataSecurity/CompliancePaperworkExport";
import DataSecurityApi from "../../../Components/DataSecurity/DataSecurityApi";
import { describeTransfer } from "../../../Components/DataSecurity/StoreRecord";
import LeaveWithoutSavingQuestion from "../../../Components/UnsavedChanges/LeaveWithoutSavingQuestion";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import { DataSecurityImpactAssessmentResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  IMPACT_ASSESSMENT_PART_ARTICLES,
  IMPACT_ASSESSMENT_PART_TITLES,
  IMPACT_ASSESSMENT_PARTS,
  ImpactAssessmentPart,
  ImpactAssessmentSection,
  ImpactAssessmentSectionSource,
  ImpactAssessmentTrigger,
  ImpactAssessmentTriggerView,
} from "Common/Types/DataSecurity/ImpactAssessment";
import { RecordTransfer } from "Common/Types/DataSecurity/RecordOfProcessing";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import useLeaveGuard, { LeavePrompt } from "Common/UI/Utils/UseLeaveGuard";
import {
  Translator,
  composedValue,
  formatList,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A STORE'S DATA PROTECTION IMPACT ASSESSMENT (#10375).
 *
 * A document, not a form: why the store needs one - special category
 * data, data about many people, data that leaves its people's countries -
 * then GDPR Article 35(7)'s four parts, each with who wrote it and when,
 * its words, and the facts a drafted part rests on one click away. Draft
 * the Assessment asks OneUptime AI for every part no person edited; Edit
 * makes a part the person's own, never drafted again. Exported as Markdown
 * and PDF. "Not legal advice" is said once, under the title.
 */

export const IMPACT_ASSESSMENT_TEST_ID: string =
  "data-security-impact-assessment";

// Why the store needs an assessment, in the reader's words.
function describeTrigger(
  trigger: ImpactAssessmentTriggerView,
  translator: Translator,
): string {
  switch (trigger.trigger) {
    case ImpactAssessmentTrigger.SpecialCategory:
      return translator.translateTemplate(SPECIAL_CATEGORIES, {
        categories: composedValue((sentence: Translator): string => {
          return formatList(
            (trigger.categories || []).map((category: string): string => {
              return sentence.translateText(category) || category;
            }),
            sentence,
          );
        }),
      });
    case ImpactAssessmentTrigger.LargeScale:
      return translator.translatePlural(MANY_PEOPLE, trigger.records || 0);
    case ImpactAssessmentTrigger.LeavesCountries:
      return translator.translateTemplate(LEAVES_COUNTRIES, {
        transfers: composedValue((sentence: Translator): string => {
          return formatList(
            (trigger.transfers || []).map(
              (transfer: RecordTransfer): string => {
                return describeTransfer(transfer, sentence);
              },
            ),
            sentence,
          );
        }),
      });
    default:
      return "";
  }
}

const DataStoreImpactAssessment: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId } = useDataStoreViewContext();
  const [answer, setAnswer] =
    useState<DataSecurityImpactAssessmentResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [isDrafting, setIsDrafting] = useState<boolean>(false);
  const [draftError, setDraftError] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const hasUnsaved: boolean = Object.values(editing).some(Boolean);
  const leavePrompt: LeavePrompt = useLeaveGuard(hasUnsaved);

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");
    DataSecurityApi.getImpactAssessment(dataStoreId)
      .then((read: DataSecurityImpactAssessmentResponse) => {
        if (isCurrent) {
          setAnswer(read);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [dataStoreId.toString(), readCount]);

  const draft: () => Promise<void> = async (): Promise<void> => {
    setIsDrafting(true);
    setDraftError("");

    try {
      setAnswer(await DataSecurityApi.draftImpactAssessment(dataStoreId));
      Toast.success(translator.translateText(ASSESSMENT_DRAFTED_TOAST) || "");
    } catch (err) {
      setDraftError(API.getFriendlyMessage(err));
    } finally {
      setIsDrafting(false);
    }
  };

  const exportAs: (kind: "md" | "pdf") => Promise<void> = async (
    kind: "md" | "pdf",
  ): Promise<void> => {
    if (!answer) {
      return;
    }

    const exportedAt: Date = new Date();
    const markdown: string = getImpactAssessmentMarkdown({
      assessment: answer,
      exportedAt,
    });
    const names: PaperworkExportNames = getImpactAssessmentExportNames(
      answer.storeName,
    );

    if (kind === "md") {
      downloadMarkdown({ markdown, label: names.fileLabel, exportedAt });
      return;
    }

    setIsExporting(true);

    try {
      await downloadMarkdownPdf({
        title: names.pdfTitle,
        markdown,
        label: names.fileLabel,
        exportedAt,
      });
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  if (error) {
    return (
      <Card title={ASSESSMENT_TITLE} description={ASSESSMENT_DESCRIPTION}>
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setAnswer(null);
            setReadCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      </Card>
    );
  }

  if (!answer) {
    return (
      <Card title={ASSESSMENT_TITLE} description={ASSESSMENT_DESCRIPTION}>
        <DetailListSkeleton />
      </Card>
    );
  }

  const hasAssessment: boolean = Boolean(answer.assessment);
  const buttons: Array<CardButtonSchema> = [];

  // The PDF in sight - what is handed to a regulator - the Markdown in the ⋯.
  if (hasAssessment) {
    buttons.push(
      {
        title: EXPORT_PDF,
        icon: IconProp.Download,
        buttonStyle: ButtonStyleType.NORMAL,
        isLoading: isExporting,
        onClick: () => {
          void exportAs("pdf");
        },
      },
      {
        title: EXPORT_MARKDOWN,
        icon: IconProp.Download,
        buttonStyle: ButtonStyleType.OUTLINE,
        onClick: () => {
          void exportAs("md");
        },
      },
    );
  }

  if (answer.triggers.length === 0 && !hasAssessment) {
    return (
      <Card title={ASSESSMENT_TITLE} description={ASSESSMENT_DESCRIPTION}>
        <EmptyState
          id={`${IMPACT_ASSESSMENT_TEST_ID}-not-needed`}
          icon={IconProp.ShieldCheck}
          title={NOT_NEEDED_TITLE}
          description={NOT_NEEDED_DESCRIPTION}
        />
      </Card>
    );
  }

  const draftButton: ReactElement | null =
    answer.canDraft && answer.triggers.length > 0 ? (
      <Button
        title={hasAssessment ? DRAFT_AGAIN : DRAFT_ASSESSMENT}
        icon={IconProp.Sparkles}
        buttonStyle={
          hasAssessment ? ButtonStyleType.OUTLINE : ButtonStyleType.PRIMARY
        }
        isLoading={isDrafting}
        disabled={hasUnsaved}
        dataTestId={`${IMPACT_ASSESSMENT_TEST_ID}-draft`}
        onClick={() => {
          void draft();
        }}
      />
    ) : null;

  return (
    <Fragment>
      <Card
        title={ASSESSMENT_TITLE}
        description={ASSESSMENT_DESCRIPTION}
        buttons={getTableHeaderButtons(buttons)}
      >
        <div className="space-y-4" data-testid={IMPACT_ASSESSMENT_TEST_ID}>
          <p className="text-xs text-gray-600">
            {translator.translateText(NOT_LEGAL_ADVICE)}
          </p>
          {answer.triggers.length > 0 ? (
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium text-gray-900">
                {translator.translateText(WHY_IT_NEEDS_ONE)}
              </h3>
              <ul
                className="list-disc space-y-1 ps-5 text-sm text-gray-700"
                data-testid={`${IMPACT_ASSESSMENT_TEST_ID}-triggers`}
              >
                {answer.triggers.map(
                  (trigger: ImpactAssessmentTriggerView): ReactElement => {
                    return (
                      <li key={trigger.trigger}>
                        {describeTrigger(trigger, translator)}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}
          {!hasAssessment ? (
            <p className="text-sm text-gray-600">
              {translator.translateText(NO_ASSESSMENT_YET)}
            </p>
          ) : (
            <></>
          )}
          {draftError ? <ErrorLine message={draftError} /> : <></>}
          {draftButton ? (
            <div className="flex flex-wrap gap-2">{draftButton}</div>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {hasAssessment ? (
        <Card>
          <div
            className="divide-y divide-gray-100"
            data-testid={`${IMPACT_ASSESSMENT_TEST_ID}-document`}
          >
            {IMPACT_ASSESSMENT_PARTS.map(
              (part: ImpactAssessmentPart, index: number): ReactElement => {
                const section: ImpactAssessmentSection | undefined =
                  answer.assessment?.sections[part];

                return (
                  <CompliancePaperSection
                    key={`${part}:${section?.editedAt || ""}:${section?.draftedAt || ""}`}
                    id={`${IMPACT_ASSESSMENT_TEST_ID}-${part}`}
                    heading={`${translator.formatNumber(index + 1)}. ${
                      translator.translateText(
                        IMPACT_ASSESSMENT_PART_TITLES[part],
                      ) || IMPACT_ASSESSMENT_PART_TITLES[part]
                    }`}
                    aside={
                      <span className="text-xs text-gray-500">
                        {IMPACT_ASSESSMENT_PART_ARTICLES[part]}
                      </span>
                    }
                    words={section?.markdown || ""}
                    isMarkdown={true}
                    isEdited={
                      section?.source === ImpactAssessmentSectionSource.Edited
                    }
                    draftedAt={section?.draftedAt}
                    editedAt={section?.editedAt}
                    editorName={
                      section?.editedByUserId
                        ? answer.editors[section.editedByUserId]
                        : undefined
                    }
                    isStale={answer.staleParts.includes(part)}
                    facts={getFactsByKeys(
                      answer.assessment?.facts || [],
                      section?.factKeys || [],
                    )}
                    emptyElement={
                      <p className="text-sm text-gray-500">
                        {translator.translateText(NOT_WRITTEN_YET)}
                      </p>
                    }
                    canEdit={answer.canEdit}
                    onSave={async (markdown: string): Promise<void> => {
                      setAnswer(
                        await DataSecurityApi.editImpactAssessment({
                          dataStoreId,
                          part,
                          markdown,
                        }),
                      );
                    }}
                    onEditingChange={(isEditing: boolean) => {
                      setEditing((current: Record<string, boolean>) => {
                        return current[part] === isEditing
                          ? current
                          : { ...current, [part]: isEditing };
                      });
                    }}
                  />
                );
              },
            )}
          </div>
        </Card>
      ) : (
        <></>
      )}

      <LeaveWithoutSavingQuestion
        prompt={leavePrompt}
        description={UNSAVED_ASSESSMENT}
      />
    </Fragment>
  );
};

export default DataStoreImpactAssessment;
