import DataSecurityApi from "./DataSecurityApi";
import {
  ApplyToSimilarCopy,
  DATA_STORE_FINDING_VERDICT_TITLES,
  FINDING_VERDICT_TONES,
} from "./FindingVerdictCopy";
import { getShownVerdict } from "./FindingRowNote";
import StoreNotSensitiveModal from "./StoreNotSensitiveModal";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import {
  DataSecurityApplyToSimilarResult,
  DataSecuritySimilarFinding,
  DataSecuritySimilarFindings,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  DataStoreFindingDecision,
  DataStoreFindingVerdict,
  DataStoreFindingVerdictRecord,
  isDataStoreFindingVerdict,
} from "Common/Types/DataSecurity/DataStoreFindingVerdict";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A PERSON'S DECISION ON A FINDING, AND THE SAME ON EVERY FINDING LIKE IT
 * (#10372).
 *
 * Mark as Not Sensitive asks why, starting from OneUptime AI's draft when
 * its verdict was Not sensitive - the person may change every word, and
 * what they save is theirs. Then, as after Confirm, Apply to similar lists
 * the findings like it that nobody decided yet - the same data type in a
 * field of the same name, on this store and every other one the person may
 * read - each ticked, in one list: a person unticks any to judge on its
 * own, and the rest get the same decision with the same reason, as their
 * own update. With nothing like it, nothing more is asked.
 */

export const APPLY_TO_SIMILAR_TEST_ID: string =
  "data-security-apply-to-similar";

export interface ApplyToSimilarModalProps {
  findingId: ObjectID;
  similar: DataSecuritySimilarFindings;
  onClose: () => void;
  onApplied: (result: DataSecurityApplyToSimilarResult) => void;
}

export const ApplyToSimilarModal: FunctionComponent<
  ApplyToSimilarModalProps
> = (props: ApplyToSimilarModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const findings: Array<DataSecuritySimilarFinding> = props.similar.findings;
  const [ticked, setTicked] = useState<Set<string>>(
    new Set(
      findings.map((finding: DataSecuritySimilarFinding): string => {
        return finding.findingId;
      }),
    ),
  );
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const isNotSensitive: boolean =
    props.similar.decision === DataStoreFindingDecision.NotSensitive;
  const isAllTicked: boolean = ticked.size === findings.length;

  return (
    <Modal
      title={ApplyToSimilarCopy.title}
      description={
        isNotSensitive
          ? ApplyToSimilarCopy.notSensitiveDescription
          : ApplyToSimilarCopy.confirmDescription
      }
      modalWidth={ModalWidth.Large}
      isLoading={isApplying}
      disableSubmitButton={ticked.size === 0}
      submitButtonText={translator.translatePlural(
        isNotSensitive
          ? ApplyToSimilarCopy.markNotSensitive
          : ApplyToSimilarCopy.confirmThem,
        ticked.size,
      )}
      closeButtonText={ApplyToSimilarCopy.notNow}
      error={error}
      errorWhatFailed={ApplyToSimilarCopy.whatFailed}
      onClose={props.onClose}
      onSubmit={async () => {
        setIsApplying(true);
        setError("");

        try {
          const result: DataSecurityApplyToSimilarResult =
            await DataSecurityApi.applyToSimilarFindings({
              findingId: props.findingId,
              findingIds: findings
                .filter((finding: DataSecuritySimilarFinding): boolean => {
                  return ticked.has(finding.findingId);
                })
                .map((finding: DataSecuritySimilarFinding): string => {
                  return finding.findingId;
                }),
            });

          setIsApplying(false);
          props.onApplied(result);
        } catch (err) {
          setIsApplying(false);
          setError(API.getFriendlyMessage(err));
        }
      }}
    >
      <div data-testid={APPLY_TO_SIMILAR_TEST_ID}>
        {isNotSensitive && props.similar.reason ? (
          <p className="mb-3 text-sm text-gray-600 [overflow-wrap:anywhere]">
            {translator.translateTemplate(ApplyToSimilarCopy.withReason, {
              reason: props.similar.reason,
            })}
          </p>
        ) : (
          <></>
        )}

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-gray-600">
            {translator.translateTemplate(ApplyToSimilarCopy.ticked, {
              ticked: translator.formatNumber(ticked.size),
              total: translator.formatNumber(findings.length),
            })}
          </span>
          <Button
            title={
              isAllTicked
                ? ApplyToSimilarCopy.tickNone
                : ApplyToSimilarCopy.tickAll
            }
            buttonStyle={ButtonStyleType.LINK}
            onClick={() => {
              setTicked(
                isAllTicked
                  ? new Set()
                  : new Set(
                      findings.map(
                        (finding: DataSecuritySimilarFinding): string => {
                          return finding.findingId;
                        },
                      ),
                    ),
              );
            }}
          />
        </div>

        <ul
          className="divide-y divide-gray-100 rounded-md border border-gray-200"
          aria-label={translator.translateText(ApplyToSimilarCopy.listLabel)}
        >
          {findings.map((finding: DataSecuritySimilarFinding): ReactElement => {
            const isTicked: boolean = ticked.has(finding.findingId);
            const verdict: DataStoreFindingVerdict | null =
              isDataStoreFindingVerdict(finding.aiVerdict)
                ? finding.aiVerdict
                : null;

            return (
              <li
                key={finding.findingId}
                className="flex items-start gap-3 px-3 py-2.5"
              >
                <CheckboxElement
                  value={isTicked}
                  ariaLabel={`${finding.storeName} · ${finding.location}`}
                  isAriaLabelTranslated={true}
                  dataTestId={`apply-to-similar-${finding.findingId}`}
                  onChange={(value: boolean) => {
                    const next: Set<string> = new Set(ticked);

                    if (value) {
                      next.add(finding.findingId);
                    } else {
                      next.delete(finding.findingId);
                    }

                    setTicked(next);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                      <IsolatedText text={finding.storeName} />
                    </span>
                    {finding.isSameStore ? (
                      <Pill
                        text={ApplyToSimilarCopy.sameStore}
                        isDotHidden={true}
                      />
                    ) : (
                      <></>
                    )}
                    {verdict ? (
                      <Pill
                        text={DATA_STORE_FINDING_VERDICT_TITLES[verdict]}
                        tone={FINDING_VERDICT_TONES[verdict]}
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                  <code className="mt-0.5 block font-mono text-xs text-gray-700 [overflow-wrap:anywhere]">
                    {finding.location}
                  </code>
                  {finding.storeKind ? (
                    <span className="text-xs text-gray-500">
                      {translator.translateText(finding.storeKind) ||
                        finding.storeKind}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
};

export interface FindingDecisions {
  // Mark as Not Sensitive: the reason first, then the findings like it.
  markNotSensitive: (finding: DataStoreFinding) => void;
  // After a confirmation was saved: the findings like it.
  afterConfirm: (finding: DataStoreFinding) => void;
  dialogs: ReactElement;
}

export function useFindingDecisions(onChanged: () => void): FindingDecisions {
  const translator: Translator = useTranslator();
  const [notSensitive, setNotSensitive] = useState<DataStoreFinding | null>(
    null,
  );
  const [similar, setSimilar] = useState<{
    findingId: ObjectID;
    list: DataSecuritySimilarFindings;
  } | null>(null);

  // The findings like one just decided, offered when there are any.
  const offerSimilar: (findingId: ObjectID) => Promise<void> = async (
    findingId: ObjectID,
  ): Promise<void> => {
    try {
      const list: DataSecuritySimilarFindings =
        await DataSecurityApi.getSimilarFindings(findingId);

      if (list.findings.length > 0) {
        setSimilar({ findingId, list });
      }
    } catch {
      // The decision stands; only the offer is left out.
    }
  };

  const idOf: (finding: DataStoreFinding) => ObjectID = (
    finding: DataStoreFinding,
  ): ObjectID => {
    return new ObjectID(finding._id!.toString());
  };

  // What OneUptime AI drafted, for the dialog to start from.
  const draftOf: (finding: DataStoreFinding) => string = (
    finding: DataStoreFinding,
  ): string => {
    const verdict: DataStoreFindingVerdictRecord | null =
      getShownVerdict(finding);

    return verdict?.verdict === DataStoreFindingVerdict.NotSensitive
      ? verdict.draft
      : "";
  };

  const dialogs: ReactElement = (
    <>
      {notSensitive?._id ? (
        <StoreNotSensitiveModal
          findingId={idOf(notSensitive)}
          initialReason={draftOf(notSensitive)}
          onClose={() => {
            setNotSensitive(null);
          }}
          onDone={() => {
            const findingId: ObjectID = idOf(notSensitive);

            setNotSensitive(null);
            onChanged();
            void offerSimilar(findingId);
          }}
        />
      ) : (
        <></>
      )}

      {similar ? (
        <ApplyToSimilarModal
          findingId={similar.findingId}
          similar={similar.list}
          onClose={() => {
            setSimilar(null);
          }}
          onApplied={(result: DataSecurityApplyToSimilarResult) => {
            const isNotSensitive: boolean =
              result.decision === DataStoreFindingDecision.NotSensitive;

            setSimilar(null);

            if (result.applied > 0) {
              Toast.success(
                translator.translatePlural(
                  isNotSensitive
                    ? ApplyToSimilarCopy.markedNotSensitiveToast
                    : ApplyToSimilarCopy.confirmedToast,
                  result.applied,
                ),
              );
            }

            if (result.skipped > 0) {
              Toast.info(
                translator.translatePlural(
                  ApplyToSimilarCopy.skippedToast,
                  result.skipped,
                ),
              );
            }

            onChanged();
          }}
        />
      ) : (
        <></>
      )}
    </>
  );

  return {
    markNotSensitive: (finding: DataStoreFinding): void => {
      setNotSensitive(finding);
    },
    afterConfirm: (finding: DataStoreFinding): void => {
      void offerSimilar(idOf(finding));
    },
    dialogs,
  };
}
