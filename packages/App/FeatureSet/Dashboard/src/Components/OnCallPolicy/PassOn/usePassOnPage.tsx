import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
} from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement, useCallback, useEffect, useState } from "react";
import { EventPanelAction } from "../../EventView/EventStatusPanel";
import {
  PASS_ON_PAGE_TEXT,
  describePassOnAnswers,
  describePassOnPreview,
  fetchOpenPages,
  isAnyPassedOn,
  passOnPages,
} from "./PassOnPage";

/*
 * "PASS IT ON" IN A RECORD'S HEADER, FOR THE PERSON BEING PAGED.
 *
 * Reads whether the signed-in person is being paged about the record, and
 * when they are, hands the header a "Pass it on" button and the dialog it
 * opens: what passing on will do, then - once passed on - what it did. For
 * everybody else it hands nothing, and the header is as it was. If whether
 * they are paged cannot be read, the button is left out: it is a shortcut,
 * and acknowledging works as it always did.
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

// The paragraphs of a dialog's text, each on its own.
function paragraphs(lines: Array<string>, testId: string): ReactElement {
  return (
    <div className="space-y-2" data-testid={testId}>
      {lines.map((line: string, index: number) => {
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

export default function usePassOnPage(data: {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
  // After a page was passed on: the record's feed has news.
  onPassedOn?: (() => void) | undefined;
}): PassOnPageControls {
  const translator: Translator = useTranslator();
  const recordKey: string = `${data.recordType}:${data.recordId.toString()}`;

  const [loaded, setLoaded] = useState<LoadedPages | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const [stage, setStage] = useState<DialogStage>(DialogStage.Closed);
  const [answers, setAnswers] = useState<Array<OnCallPassOnAnswer>>([]);
  const [error, setError] = useState<string>("");

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

    passOnPages({ recordType: data.recordType, recordId: data.recordId })
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
      })
      .catch(() => {
        setError(
          translator.translateText(PASS_ON_PAGE_TEXT.failed) ||
            PASS_ON_PAGE_TEXT.failed,
        );
        setStage(DialogStage.Asking);
      });
  }, [recordKey, data.onPassedOn, translator]);

  const actions: Array<EventPanelAction> =
    pages.length > 0
      ? [
          {
            /*
             * No tooltip: the header shows one only on a disabled action, and
             * the dialog says what passing on does before it does it.
             */
            id: "pass-on-page",
            label: PASS_ON_PAGE_TEXT.button,
            icon: IconProp.Forward,
            onClick: () => {
              setAnswers([]);
              setError("");
              setStage(DialogStage.Asking);
            },
          },
        ]
      : [];

  let dialog: ReactElement = <></>;

  if (stage === DialogStage.Asking || stage === DialogStage.Passing) {
    dialog = (
      <ConfirmModal
        title={PASS_ON_PAGE_TEXT.dialogTitle}
        description={paragraphs(
          [
            translator.translateText(PASS_ON_PAGE_TEXT.notPagedAgain) ||
              PASS_ON_PAGE_TEXT.notPagedAgain,
            ...describePassOnPreview(pages, translator),
          ],
          "pass-on-preview",
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
    const passed: boolean = isAnyPassedOn(answers);

    dialog = (
      <ConfirmModal
        title={passed ? PASS_ON_PAGE_TEXT.doneTitle : PASS_ON_PAGE_TEXT.button}
        description={paragraphs(
          [
            ...describePassOnAnswers(answers, translator),
            ...(passed
              ? [
                  translator.translateText(PASS_ON_PAGE_TEXT.notPagedAgain) ||
                    PASS_ON_PAGE_TEXT.notPagedAgain,
                ]
              : []),
          ],
          "pass-on-answer",
        )}
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={close}
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
