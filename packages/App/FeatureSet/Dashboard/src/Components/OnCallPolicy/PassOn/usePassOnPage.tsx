import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnLevelChoice,
} from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Radio, { RadioValue } from "Common/UI/Components/Radio/Radio";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement, useCallback, useEffect, useState } from "react";
import { EventPanelAction } from "../../EventView/EventStatusPanel";
import {
  PAGE_AGAIN_TEXT,
  PASS_ON_PAGE_TEXT,
  PassOnDialogLine,
  PassOnLevelPicks,
  PassOnLinePiece,
  acknowledgePagesAgain,
  fetchOpenPages,
  getPassOnAnswerLines,
  getPassOnAnswerTitle,
  getPassOnEscalateTo,
  getPassOnKeptTogether,
  getPassOnLevelChoiceLabel,
  getPassOnLevelChoices,
  getPassOnLevelPickerLabel,
  getPassOnLinePieces,
  getPassOnPickedLevel,
  getPassOnQuestionKeptTogether,
  getPassOnQuestionLines,
  getPassOnQuestionTitle,
  getPassedOnResults,
  hasPageAgain,
  isAnyPassedOn,
  isRecordTakenMeanwhile,
  passOnPages,
} from "./PassOnPage";

/*
 * "ESCALATE" IN A RECORD'S HEADER, FOR THE PERSON BEING PAGED.
 *
 * Reads whether the signed-in person is being paged about the record, and
 * when they are, hands the header an "Escalate" button and the dialog it
 * opens: "Escalate Incident?" with what escalating will do, then - once
 * escalated - what it did. For everybody else it hands nothing, and the
 * header is as it was. If whether they are paged cannot be read, the button
 * is left out: it is a shortcut, and acknowledging works as it always did.
 */

export interface PassOnPageControls {
  // The header's button, or none.
  actions: Array<EventPanelAction>;
  // The dialog, while it is open.
  dialog: ReactElement;
  /*
   * Reads again whether the person is paged about the record: after its
   * state changed, say - acknowledging it ends their page.
   */
  refresh: () => void;
}

enum DialogStage {
  Closed = "Closed",
  Asking = "Asking",
  Passing = "Passing",
  Done = "Done",
}

interface LoadedPages {
  recordKey: string;
  pages: Array<OnCallOpenPage>;
}

/*
 * The dialog's text: a warning first when escalating leaves nobody being
 * paged (PassOnDialogLine), then each sentence as a paragraph of its own.
 *
 * A level's place - "(Level 2 of 3)" - and a time stay on one line
 * (`kept`, getPassOnKeptTogether): a phone broke the place as "(Level 2
 * of" / "3)". And a paragraph never leaves its last word alone on a line
 * ("... without" / "waiting."): text-pretty.
 */
function dialogText(
  lines: Array<PassOnDialogLine>,
  testId: string,
  kept: Array<string>,
  /*
   * What goes between the warnings and the sentences: the levels to pick
   * from, so the sentence under them says what the pick does.
   */
  afterWarnings?: ReactElement | undefined,
): ReactElement {
  const warnings: Array<PassOnDialogLine> = lines.filter(
    (line: PassOnDialogLine): boolean => {
      return line.isWarning;
    },
  );
  const sentences: Array<PassOnDialogLine> = lines.filter(
    (line: PassOnDialogLine): boolean => {
      return !line.isWarning;
    },
  );

  return (
    <div className="space-y-3" data-testid={testId}>
      {[...warnings, ...sentences].map(
        (line: PassOnDialogLine, index: number) => {
          const drawn: ReactElement = line.isWarning ? (
            <Alert
              key={index}
              type={AlertType.WARNING}
              title={line.text}
              dataTestId="pass-on-warning"
            />
          ) : (
            <p key={index} className="text-pretty">
              {getPassOnLinePieces(line.text, kept).map(
                (piece: PassOnLinePiece, pieceIndex: number) => {
                  return piece.keepTogether ? (
                    <span
                      key={pieceIndex}
                      className="whitespace-nowrap"
                      data-testid="pass-on-kept-together"
                    >
                      {piece.text}
                    </span>
                  ) : (
                    <React.Fragment key={pieceIndex}>
                      {piece.text}
                    </React.Fragment>
                  );
                },
              )}
            </p>
          );

          // The levels to pick from come right after the last warning.
          return index === warnings.length && afterWarnings ? (
            <React.Fragment key={index}>
              {afterWarnings}
              {drawn}
            </React.Fragment>
          ) : (
            drawn
          );
        },
      )}
    </div>
  );
}

/*
 * "Escalate to" and a radio for each level a page offers, the next level
 * picked: drawn only for a page with two or more levels after the
 * person's. Its label names the policy when two policies page them about
 * the record.
 */
function levelPickers(data: {
  pages: Array<OnCallOpenPage>;
  picks: PassOnLevelPicks;
  onPick: (executionLogId: string, escalationRuleId: string) => void;
  translator: Translator;
}): ReactElement | undefined {
  const pickers: Array<ReactElement> = [];

  for (const page of data.pages) {
    const choices: Array<OnCallPassOnLevelChoice> = getPassOnLevelChoices(page);

    if (choices.length === 0) {
      continue;
    }

    const labelId: string = `pass-on-levels-label-${page.executionLogId}`;

    pickers.push(
      <div key={page.executionLogId} data-testid="pass-on-levels">
        <div
          id={labelId}
          className="text-sm font-medium text-gray-900"
          data-testid="pass-on-levels-label"
        >
          {getPassOnLevelPickerLabel(page, data.pages, data.translator)}
        </div>
        <Radio
          className=""
          ariaLabelledby={labelId}
          dataTestId="pass-on-levels-options"
          options={choices.map((choice: OnCallPassOnLevelChoice) => {
            return {
              value: choice.escalationRuleId,
              label: getPassOnLevelChoiceLabel(
                choice,
                page.preview.ruleCount,
                data.translator,
              ),
            };
          })}
          value={getPassOnPickedLevel(page, data.picks)?.escalationRuleId}
          onChange={(value: RadioValue | null): void => {
            if (value) {
              data.onPick(page.executionLogId, String(value));
            }
          }}
        />
      </div>,
    );
  }

  if (pickers.length === 0) {
    return undefined;
  }

  return <div className="space-y-4">{pickers}</div>;
}

/*
 * And, for the person a policy pages AGAIN about a record that stayed
 * acknowledged without being resolved (OnCallAcknowledgementTimeout), an
 * "Acknowledge again" of its own before Escalate: the record was
 * acknowledged all along, so its own Acknowledge is not there, and this
 * answers their page instead - their notifications stop, and the policy
 * counts its time again from now. Nobody else sees it.
 */
export default function usePassOnPage(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
  // After a page was escalated or acknowledged here: the record's feed has news.
  onPassedOn?: (() => void) | undefined;
  /*
   * Somebody acknowledged or resolved the record while the dialog asked
   * ("Already acknowledged", isRecordTakenMeanwhile): the page reads it
   * again, so its header stops offering Acknowledge for a record already
   * taken.
   */
  onRecordChanged?: (() => void) | undefined;
}): PassOnPageControls {
  const translator: Translator = useTranslator();
  const recordKey: string = `${data.recordType}:${data.recordId.toString()}`;

  const [loaded, setLoaded] = useState<LoadedPages | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const [stage, setStage] = useState<DialogStage>(DialogStage.Closed);
  const [answers, setAnswers] = useState<Array<OnCallPassOnAnswer>>([]);
  const [error, setError] = useState<string>("");
  // The later level picked for each page, by its run; none, the next level.
  const [picks, setPicks] = useState<PassOnLevelPicks>({});
  // A page again being acknowledged, and why it could not be.
  const [isAcknowledging, setIsAcknowledging] = useState<boolean>(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchOpenPages({ recordType: data.recordType, recordId: data.recordId })
      .then((pages: Array<OnCallOpenPage>) => {
        if (isCurrent) {
          setLoaded({ recordKey, pages });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setLoaded({ recordKey, pages: [] });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [recordKey, attempt]);

  const pages: Array<OnCallOpenPage> =
    loaded && loaded.recordKey === recordKey ? loaded.pages : [];

  const close: () => void = useCallback((): void => {
    setStage(DialogStage.Closed);
    setError("");
  }, []);

  const passOn: () => void = useCallback((): void => {
    setStage(DialogStage.Passing);
    setError("");

    passOnPages({
      recordType: data.recordType,
      recordId: data.recordId,
      escalateTo: getPassOnEscalateTo(pages, picks),
    })
      .then((passed: Array<OnCallPassOnAnswer>) => {
        setAnswers(passed);
        setStage(DialogStage.Done);
        // Whether they are paged about it is read again: now they are not.
        setAttempt((count: number): number => {
          return count + 1;
        });

        if (isAnyPassedOn(passed)) {
          data.onPassedOn?.();
        }

        if (isRecordTakenMeanwhile(passed)) {
          data.onRecordChanged?.();
        }
      })
      .catch(() => {
        setError(
          translator.translateText(PASS_ON_PAGE_TEXT.failed) ||
            PASS_ON_PAGE_TEXT.failed,
        );
        setStage(DialogStage.Asking);
      });
  }, [
    recordKey,
    data.onPassedOn,
    data.onRecordChanged,
    translator,
    pages,
    picks,
  ]);

  const acknowledge: () => void = useCallback((): void => {
    setIsAcknowledging(true);
    setAcknowledgeError("");

    acknowledgePagesAgain({
      recordType: data.recordType,
      recordId: data.recordId,
    })
      .then((acknowledged: number) => {
        // Whether they are paged about it is read again: now they are not.
        setAttempt((count: number): number => {
          return count + 1;
        });

        if (acknowledged > 0) {
          data.onPassedOn?.();
        }
      })
      .catch(() => {
        setAcknowledgeError(
          translator.translateText(PAGE_AGAIN_TEXT.failed) ||
            PAGE_AGAIN_TEXT.failed,
        );
      })
      .finally(() => {
        setIsAcknowledging(false);
      });
  }, [recordKey, data.onPassedOn, translator]);

  const actions: Array<EventPanelAction> = [];

  /*
   * A page again: Acknowledge again first, as the record's own Acknowledge
   * comes first on a record that is not acknowledged yet. No dialog:
   * answering a page is what every link, call and text of it does in one
   * step too.
   */
  if (hasPageAgain(pages)) {
    actions.push({
      id: "acknowledge-page-again",
      label: PAGE_AGAIN_TEXT.button,
      icon: IconProp.Check,
      isDisabled: isAcknowledging,
      onClick: acknowledge,
    });
  }

  if (pages.length > 0) {
    actions.push({
      /*
       * No tooltip: the header shows one only on a disabled action, and
       * the dialog says what escalating does before it does it. The
       * arrow points up the levels: escalating hands the page up to
       * the next one. The id keeps the action's first name.
       */
      id: "pass-on-page",
      label: PASS_ON_PAGE_TEXT.button,
      icon: IconProp.ArrowCircleUp,
      onClick: () => {
        setAnswers([]);
        setError("");
        // Every time it asks, the next level is picked.
        setPicks({});
        setStage(DialogStage.Asking);
      },
    });
  }

  let dialog: ReactElement = <></>;

  if (stage === DialogStage.Asking || stage === DialogStage.Passing) {
    dialog = (
      <ConfirmModal
        title={getPassOnQuestionTitle(data.recordType)}
        description={dialogText(
          getPassOnQuestionLines(pages, translator, data.recordType, picks),
          "pass-on-preview",
          getPassOnQuestionKeptTogether(pages, picks, translator),
          levelPickers({
            pages: pages,
            picks: picks,
            onPick: (
              executionLogId: string,
              escalationRuleId: string,
            ): void => {
              setPicks((current: PassOnLevelPicks): PassOnLevelPicks => {
                return { ...current, [executionLogId]: escalationRuleId };
              });
            },
            translator: translator,
          }),
        )}
        submitButtonText={PASS_ON_PAGE_TEXT.button}
        onSubmit={passOn}
        onClose={close}
        isLoading={stage === DialogStage.Passing}
        error={error || undefined}
      />
    );
  }

  if (stage === DialogStage.Done) {
    dialog = (
      <ConfirmModal
        title={getPassOnAnswerTitle(answers, data.recordType)}
        description={dialogText(
          getPassOnAnswerLines(answers, translator, data.recordType),
          "pass-on-answer",
          getPassOnKeptTogether(getPassedOnResults(answers), translator),
        )}
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={close}
      />
    );
  }

  // Acknowledging a page again failed: said once, and closed.
  if (acknowledgeError) {
    dialog = (
      <ConfirmModal
        title={PAGE_AGAIN_TEXT.failedTitle}
        description={acknowledgeError}
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={(): void => {
          setAcknowledgeError("");
        }}
      />
    );
  }

  const refresh: () => void = useCallback((): void => {
    setAttempt((count: number): number => {
      return count + 1;
    });
  }, []);

  return { actions, dialog, refresh };
}
