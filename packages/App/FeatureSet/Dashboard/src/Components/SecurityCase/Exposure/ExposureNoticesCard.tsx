import {
  AI_OFF,
  BREACH_NOTICES,
  BREACH_NOTICES_DESCRIPTION,
  DRAFT_AGAIN,
  DRAFT_NOT_LEGAL_ADVICE,
  DRAFT_WITH_AI,
  DRAFTED_TOAST,
  EXPORT_WAITS_FOR_SAVE,
  EXPOSURE_TEST_IDS,
  HIDE_TEXT,
  NOT_LEGAL_ADVICE,
  NOT_WRITTEN,
  SHOW_TEXT,
  UNSAVED_NOTICES,
} from "./ExposureAssessmentCopy";
import { say } from "./ExposureAssessmentModel";
import {
  getExposureNoticesExportNames,
  getExposureNoticesMarkdown,
} from "./ExposureNoticesExport";
import {
  EXPORT_MARKDOWN,
  EXPORT_PDF,
} from "../../DataSecurity/ComplianceDraftsCopy";
import { getFactsByKeys } from "../../DataSecurity/ComplianceFacts";
import CompliancePaperSection from "../../DataSecurity/CompliancePaperSection";
import {
  PaperworkExportNames,
  downloadMarkdown,
} from "../../DataSecurity/CompliancePaperworkExport";
import { downloadMarkdownPdf } from "../../DataSecurity/CompliancePaperworkPdfDownload";
import DataSecurityApi from "../../DataSecurity/DataSecurityApi";
import LeaveWithoutSavingQuestion from "../../UnsavedChanges/LeaveWithoutSavingQuestion";
import usePendingEdits, {
  PendingEdits,
} from "../../UnsavedChanges/UsePendingEdits";
import { DataSecurityExposureAssessmentResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  EXPOSURE_DRAFT_PART_TITLES,
  EXPOSURE_DRAFT_PARTS,
  ExposureDraftPart,
  ExposureDraftSection,
} from "Common/Types/DataSecurity/ExposureAssessment";
import { ImpactAssessmentSectionSource } from "Common/Types/DataSecurity/ImpactAssessment";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import useLeaveGuard, { LeavePrompt } from "Common/UI/Utils/UseLeaveGuard";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * BREACH NOTICES (#10377): OneUptime AI's write-up of a case's exposure
 * assessment, for a person to review, edit and copy - what it means, a
 * notice to the regulator, a notice to the people affected and an internal
 * summary. Each was held to the assessment's facts before it was kept: a
 * number or a law none of them holds dropped it. What it means is open; the
 * three others are folded until opened, each with a Copy button and "a
 * draft, not legal advice" above its words. Draft With OneUptime AI writes
 * every part no person edited; Edit makes a part the person's own, never
 * drafted again. Nothing is sent anywhere: a notice is text a person sends
 * themselves.
 *
 * Export PDF and Export Markdown (#10955) download the notices as one
 * document - still drafts, "not legal advice" at its top - with the law due
 * first, the window, whose data, the secrets to rotate, each law that may
 * apply with its source and checked date, and each part as a person last
 * saved it (ExposureNoticesExport). While a part is being edited they wait:
 * the document holds what was saved.
 */

export interface ComponentProps {
  caseId: ObjectID;
  answer: DataSecurityExposureAssessmentResponse;
  onChanged: (answer: DataSecurityExposureAssessmentResponse) => void;
}

const ExposureNoticesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isDrafting, setIsDrafting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [draftError, setDraftError] = useState<string>("");
  // The parts a person is mid-edit on, with their words not saved yet.
  const pending: PendingEdits<string> = usePendingEdits<string>();
  const hasUnsaved: boolean = pending.hasUnsaved;
  const leavePrompt: LeavePrompt = useLeaveGuard(hasUnsaved);

  // A part in a person's own words, as its Save and the leave question's Save Changes write it.
  const savePart: (part: string, markdown: string) => Promise<void> = async (
    part: string,
    markdown: string,
  ): Promise<void> => {
    props.onChanged(
      await DataSecurityApi.editExposureAssessment({
        securityCaseId: props.caseId,
        part: part as ExposureDraftPart,
        markdown,
      }),
    );
  };
  const sections: Partial<Record<ExposureDraftPart, ExposureDraftSection>> =
    props.answer.assessment?.sections || {};
  const hasDrafts: boolean = EXPOSURE_DRAFT_PARTS.some(
    (part: ExposureDraftPart): boolean => {
      return sections[part]?.source === ImpactAssessmentSectionSource.Drafted;
    },
  );

  const draft: () => Promise<void> = async (): Promise<void> => {
    setIsDrafting(true);
    setDraftError("");

    try {
      props.onChanged(
        await DataSecurityApi.draftExposureAssessment(props.caseId),
      );
      Toast.success(say(translator, DRAFTED_TOAST));
    } catch (err) {
      setDraftError(API.getFriendlyMessage(err));
    } finally {
      setIsDrafting(false);
    }
  };

  // The notices as one document, each part as it was last saved.
  const exportAs: (kind: "md" | "pdf") => Promise<void> = async (
    kind: "md" | "pdf",
  ): Promise<void> => {
    const exportedAt: Date = new Date();
    const markdown: string = getExposureNoticesMarkdown({
      answer: props.answer,
      exportedAt,
    });
    const names: PaperworkExportNames = getExposureNoticesExportNames(
      props.answer.view?.store.name || "",
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

  // The PDF in sight - what is handed on - the Markdown in the ⋯.
  const exportButtons: Array<CardButtonSchema> = props.answer.view
    ? [
        {
          title: EXPORT_PDF,
          icon: IconProp.Download,
          buttonStyle: ButtonStyleType.NORMAL,
          isLoading: isExporting,
          disabled: hasUnsaved,
          tooltip: hasUnsaved ? EXPORT_WAITS_FOR_SAVE : undefined,
          onClick: () => {
            void exportAs("pdf");
          },
        },
        {
          title: EXPORT_MARKDOWN,
          icon: IconProp.Download,
          buttonStyle: ButtonStyleType.OUTLINE,
          disabled: hasUnsaved,
          tooltip: hasUnsaved ? EXPORT_WAITS_FOR_SAVE : undefined,
          onClick: () => {
            void exportAs("md");
          },
        },
      ]
    : [];

  return (
    <Fragment>
      <Card
        title={BREACH_NOTICES}
        description={BREACH_NOTICES_DESCRIPTION}
        buttons={getTableHeaderButtons(exportButtons)}
      >
        <div className="space-y-4" data-testid={EXPOSURE_TEST_IDS.notices}>
          <p className="text-xs text-gray-600">
            {say(translator, NOT_LEGAL_ADVICE)}
          </p>
          {!props.answer.isAiEnabled ? (
            <p className="text-sm text-gray-700">{say(translator, AI_OFF)}</p>
          ) : (
            <></>
          )}
          {draftError ? <ErrorLine message={draftError} /> : <></>}
          {props.answer.canDraft ? (
            <div className="flex flex-wrap gap-2">
              <Button
                title={hasDrafts ? DRAFT_AGAIN : DRAFT_WITH_AI}
                icon={IconProp.Sparkles}
                buttonStyle={
                  hasDrafts ? ButtonStyleType.OUTLINE : ButtonStyleType.PRIMARY
                }
                isLoading={isDrafting}
                disabled={hasUnsaved}
                dataTestId={EXPOSURE_TEST_IDS.draft}
                onClick={() => {
                  void draft();
                }}
              />
            </div>
          ) : (
            <></>
          )}
          <div className="divide-y divide-gray-100">
            {EXPOSURE_DRAFT_PARTS.map(
              (part: ExposureDraftPart): ReactElement => {
                const section: ExposureDraftSection | undefined =
                  sections[part];
                // The notices and the summary are folded, each a draft to review before it is used.
                const isFolded: boolean =
                  part !== ExposureDraftPart.Explanation;
                const words: string = section?.markdown || "";

                return (
                  <CompliancePaperSection
                    key={`${part}:${section?.editedAt || ""}:${section?.draftedAt || ""}`}
                    id={`${EXPOSURE_TEST_IDS.part}-${part}`}
                    heading={say(translator, EXPOSURE_DRAFT_PART_TITLES[part])}
                    aside={
                      words.trim() ? (
                        <CopyTextButton
                          textToBeCopied={words}
                          size="sm"
                          variant="soft"
                        />
                      ) : undefined
                    }
                    words={words}
                    isMarkdown={true}
                    isEdited={
                      section?.source === ImpactAssessmentSectionSource.Edited
                    }
                    draftedAt={section?.draftedAt}
                    editedAt={section?.editedAt}
                    editorName={
                      section?.editedByUserId
                        ? props.answer.editors[section.editedByUserId]
                        : undefined
                    }
                    isStale={props.answer.staleParts.includes(part)}
                    facts={getFactsByKeys(
                      props.answer.assessment?.facts || [],
                      section?.factKeys || [],
                    )}
                    emptyElement={
                      <p className="text-sm text-gray-500">
                        {say(translator, NOT_WRITTEN)}
                      </p>
                    }
                    canEdit={props.answer.canChange}
                    noteAboveWords={
                      isFolded ? DRAFT_NOT_LEGAL_ADVICE : undefined
                    }
                    fold={
                      !isFolded
                        ? undefined
                        : {
                            isOpenAtFirst: false,
                            showLabel: SHOW_TEXT,
                            hideLabel: HIDE_TEXT,
                          }
                    }
                    onSave={async (markdown: string): Promise<void> => {
                      await savePart(part, markdown);
                    }}
                    onEditingChange={(isEditing: boolean, words: string) => {
                      pending.track(part, isEditing, words);
                    }}
                  />
                );
              },
            )}
          </div>
        </div>
      </Card>
      <LeaveWithoutSavingQuestion
        prompt={leavePrompt}
        description={UNSAVED_NOTICES}
        onSaveChanges={pending.saveAllWith(savePart)}
      />
    </Fragment>
  );
};

export default ExposureNoticesCard;
