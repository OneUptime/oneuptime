import {
  AI_OFF,
  BREACH_NOTICES,
  BREACH_NOTICES_DESCRIPTION,
  DRAFT_AGAIN,
  DRAFT_NOT_LEGAL_ADVICE,
  DRAFT_WITH_AI,
  DRAFTED_TOAST,
  EXPOSURE_TEST_IDS,
  HIDE_TEXT,
  NOT_LEGAL_ADVICE,
  NOT_WRITTEN,
  SHOW_TEXT,
  UNSAVED_NOTICES,
} from "./ExposureAssessmentCopy";
import { say } from "./ExposureAssessmentModel";
import { getFactsByKeys } from "../../DataSecurity/ComplianceFacts";
import CompliancePaperSection from "../../DataSecurity/CompliancePaperSection";
import DataSecurityApi from "../../DataSecurity/DataSecurityApi";
import LeaveWithoutSavingQuestion from "../../UnsavedChanges/LeaveWithoutSavingQuestion";
import useUnsavedParts, {
  UnsavedParts,
} from "../../UnsavedChanges/UseUnsavedParts";
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
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import useLeaveGuard, {
  LeavePrompt,
  SaveBeforeLeavingFunction,
} from "Common/UI/Utils/UseLeaveGuard";
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
  const [draftError, setDraftError] = useState<string>("");
  // The parts a person is mid-edit on, each with its save (#7402).
  const unsaved: UnsavedParts = useUnsavedParts();
  const hasUnsaved: boolean = unsaved.hasUnsaved;
  const leavePrompt: LeavePrompt = useLeaveGuard(hasUnsaved);
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

  return (
    <Fragment>
      <Card title={BREACH_NOTICES} description={BREACH_NOTICES_DESCRIPTION}>
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
                      props.onChanged(
                        await DataSecurityApi.editExposureAssessment({
                          securityCaseId: props.caseId,
                          part,
                          markdown,
                        }),
                      );
                    }}
                    onEditingChange={(
                      isEditing: boolean,
                      save: SaveBeforeLeavingFunction,
                    ) => {
                      unsaved.onPartChange(part, isEditing, save);
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
        onSaveChanges={unsaved.saveAll}
      />
    </Fragment>
  );
};

export default ExposureNoticesCard;
