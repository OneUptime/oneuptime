import {
  IMPORT_CHOOSE_FILE,
  IMPORT_DESCRIPTION,
  IMPORT_DONE,
  IMPORT_DONE_ADDED,
  IMPORT_DONE_NOW_HOLDS,
  IMPORT_DONE_REMOVED,
  IMPORT_DONE_TITLE,
  IMPORT_DONE_UNCHANGED,
  IMPORT_FILE_TOO_LARGE,
  IMPORT_FILE_UNREADABLE,
  IMPORT_MODE_ADD_DESCRIPTION,
  IMPORT_MODE_ADD_TITLE,
  IMPORT_MODE_LABEL,
  IMPORT_MODE_REPLACE_DESCRIPTION,
  IMPORT_MODE_REPLACE_TITLE,
  IMPORT_NOTHING,
  IMPORT_PROBLEMS_MORE,
  IMPORT_PROBLEM_LINE,
  IMPORT_SUBMIT,
  IMPORT_TEXT_LABEL,
  IMPORT_VALUES,
  WATCHLISTS_TEST_IDS,
} from "./WatchlistsCopy";
import {
  WATCHLIST_IMPORT_PROBLEMS_SHOWN,
  describeWatchlistImportPreview,
} from "./WatchlistsModel";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS,
  SecurityWatchlistImportMode,
  SecurityWatchlistImportProblem,
  SecurityWatchlistImportResult,
  parseSecurityWatchlistImport,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import GroupRadioButtons from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import SecurityCaseApi from "../../SecurityCase/SecurityCaseApi";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";

// What an import did, as the API answers it.
export interface WatchlistImportSummary {
  added: number;
  removed: number;
  unchanged: number;
  duplicates: number;
  problemCount: number;
  valueCount: number;
}

export function readWatchlistImportSummary(
  json: JSONObject,
): WatchlistImportSummary {
  const read: (key: string) => number = (key: string): number => {
    const value: number = Number(json[key]);
    return Number.isFinite(value) ? value : 0;
  };

  return {
    added: read("added"),
    removed: read("removed"),
    unchanged: read("unchanged"),
    duplicates: read("duplicates"),
    problemCount: read("problemCount"),
    valueCount: read("valueCount"),
  };
}

// The lines of what an import did, each in the reader's words.
export function describeWatchlistImportSummary(
  translator: Translator,
  summary: WatchlistImportSummary,
): Array<string> {
  const lines: Array<string> = [
    translator.translatePlural(IMPORT_DONE_ADDED, summary.added, {
      count: translator.formatNumber(summary.added),
    }),
  ];

  if (summary.removed > 0) {
    lines.push(
      translator.translatePlural(IMPORT_DONE_REMOVED, summary.removed, {
        count: translator.formatNumber(summary.removed),
      }),
    );
  }

  if (summary.unchanged > 0) {
    lines.push(
      translator.translatePlural(IMPORT_DONE_UNCHANGED, summary.unchanged, {
        count: translator.formatNumber(summary.unchanged),
      }),
    );
  }

  lines.push(
    translator.translatePlural(IMPORT_DONE_NOW_HOLDS, summary.valueCount, {
      count: translator.formatNumber(summary.valueCount),
    }),
  );

  return lines;
}

export interface ComponentProps {
  watchlistId: ObjectID;
  entityType: SecurityEntityType | string | undefined;
  onClose: () => void;
  // After an import that wrote: the values table reads again.
  onImported: () => void;
}

/*
 * IMPORT VALUES: a paste, or a .txt or .csv file read in the browser, put on
 * a list the team keeps - added to what it holds (the usual), or replacing
 * it. What it is about to do shows as it is typed, from the same reader the
 * API uses (parseSecurityWatchlistImport): how many values, the repeated
 * lines it skips, and the lines it leaves out, each with its line number and
 * why. The import itself is one request; what it did is the dialog's last
 * word, and Done closes it.
 */
const WatchlistImportModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const fileInput: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  const [text, setText] = useState<string>("");
  const [mode, setMode] = useState<SecurityWatchlistImportMode>(
    SecurityWatchlistImportMode.Add,
  );
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [summary, setSummary] = useState<WatchlistImportSummary | null>(null);

  const preview: SecurityWatchlistImportResult = useMemo(() => {
    return parseSecurityWatchlistImport({
      text,
      entityType: props.entityType,
    });
  }, [text, props.entityType]);

  const readFile: (file: File) => void = (file: File): void => {
    setError("");

    if (file.size > SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS) {
      setError(
        translator.translateText(IMPORT_FILE_TOO_LARGE) ||
          IMPORT_FILE_TOO_LARGE,
      );
      return;
    }

    const reader: FileReader = new FileReader();

    reader.onload = (): void => {
      setText(typeof reader.result === "string" ? reader.result : "");
    };

    reader.onerror = (): void => {
      setError(
        translator.translateText(IMPORT_FILE_UNREADABLE) ||
          IMPORT_FILE_UNREADABLE,
      );
    };

    reader.readAsText(file);
  };

  const runImport: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsImporting(true);

    try {
      const answer: JSONObject = await SecurityCaseApi.importWatchlistValues({
        watchlistId: props.watchlistId,
        text,
        mode,
      });

      setSummary(readWatchlistImportSummary(answer));
      props.onImported();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsImporting(false);
  };

  if (summary) {
    return (
      <Modal
        title={IMPORT_DONE_TITLE}
        onClose={props.onClose}
        onSubmit={props.onClose}
        submitButtonText={IMPORT_DONE}
        modalWidth={ModalWidth.Medium}
      >
        <ul
          className="space-y-1 text-sm text-gray-700"
          data-testid={WATCHLISTS_TEST_IDS.importSummary}
        >
          {describeWatchlistImportSummary(translator, summary).map(
            (line: string, index: number): ReactElement => {
              return (
                <li key={index} className="flex items-start gap-2">
                  <Icon
                    icon={index === 0 ? IconProp.Check : IconProp.Info}
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                      index === 0 ? "text-emerald-600" : "text-gray-400"
                    }`}
                  />
                  <span>{line}</span>
                </li>
              );
            },
          )}
        </ul>
      </Modal>
    );
  }

  const count: number = preview.values.length;
  const shownProblems: Array<SecurityWatchlistImportProblem> =
    preview.problems.slice(0, WATCHLIST_IMPORT_PROBLEMS_SHOWN);
  const moreProblems: number = preview.problems.length - shownProblems.length;

  return (
    <Modal
      title={IMPORT_VALUES}
      description={IMPORT_DESCRIPTION}
      onClose={props.onClose}
      onSubmit={() => {
        void runImport();
      }}
      submitButtonText={
        count > 0
          ? translator.translatePlural(IMPORT_SUBMIT, count, {
              count: translator.formatNumber(count),
            })
          : IMPORT_NOTHING
      }
      disableSubmitButton={count === 0}
      isLoading={isImporting}
      error={error || undefined}
      modalWidth={ModalWidth.Medium}
    >
      <div className="space-y-4" data-testid={WATCHLISTS_TEST_IDS.importModal}>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label
              htmlFor={WATCHLISTS_TEST_IDS.importText}
              className="text-sm font-medium text-gray-700"
            >
              {translator.translateText(IMPORT_TEXT_LABEL)}
            </label>
            <Button
              title={IMPORT_CHOOSE_FILE}
              icon={IconProp.Upload}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId={WATCHLISTS_TEST_IDS.importFile}
              onClick={() => {
                fileInput.current?.click();
              }}
            />
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="hidden"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const file: File | undefined = event.target.files?.[0];

                if (file) {
                  readFile(file);
                }

                // The same file chosen again reads again.
                event.target.value = "";
              }}
            />
          </div>
          <TextArea
            id={WATCHLISTS_TEST_IDS.importText}
            value={text}
            onChange={(value: string) => {
              setText(value);
            }}
            rows={8}
            maxRows={14}
            disableSpellCheck={true}
            className="font-mono"
            dataTestId={WATCHLISTS_TEST_IDS.importText}
          />
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-gray-700">
            {translator.translateText(IMPORT_MODE_LABEL)}
          </p>
          <GroupRadioButtons
            initialValue={mode}
            onChange={(value: string) => {
              setMode(
                value === SecurityWatchlistImportMode.Replace
                  ? SecurityWatchlistImportMode.Replace
                  : SecurityWatchlistImportMode.Add,
              );
            }}
            options={[
              {
                value: SecurityWatchlistImportMode.Add,
                title:
                  translator.translateText(IMPORT_MODE_ADD_TITLE) ||
                  IMPORT_MODE_ADD_TITLE,
                description:
                  translator.translateText(IMPORT_MODE_ADD_DESCRIPTION) ||
                  IMPORT_MODE_ADD_DESCRIPTION,
              },
              {
                value: SecurityWatchlistImportMode.Replace,
                title:
                  translator.translateText(IMPORT_MODE_REPLACE_TITLE) ||
                  IMPORT_MODE_REPLACE_TITLE,
                description:
                  translator.translateText(IMPORT_MODE_REPLACE_DESCRIPTION) ||
                  IMPORT_MODE_REPLACE_DESCRIPTION,
              },
            ]}
          />
        </div>

        {text.trim() ? (
          <div
            className="rounded-md bg-gray-50 p-3 text-sm text-gray-700"
            data-testid={WATCHLISTS_TEST_IDS.importPreview}
          >
            <p className="font-medium">
              {describeWatchlistImportPreview(translator, preview).join(" · ")}
            </p>
            {shownProblems.length > 0 ? (
              <ul
                className="mt-2 space-y-1 text-xs text-gray-600"
                data-testid={WATCHLISTS_TEST_IDS.importProblems}
              >
                {shownProblems.map(
                  (problem: SecurityWatchlistImportProblem): ReactElement => {
                    return (
                      <li key={problem.line} className="break-words">
                        <span className="font-medium text-gray-700">
                          {translator.translateTemplate(IMPORT_PROBLEM_LINE, {
                            line: translator.formatNumber(problem.line),
                          })}
                        </span>
                        {": "}
                        <IsolatedText
                          text={problem.value}
                          className="font-mono"
                        />
                        {" - "}
                        {translator.translateText(problem.message) ||
                          problem.message}
                      </li>
                    );
                  },
                )}
                {moreProblems > 0 ? (
                  <li>
                    {translator.translatePlural(
                      IMPORT_PROBLEMS_MORE,
                      moreProblems,
                      { count: translator.formatNumber(moreProblems) },
                    )}
                  </li>
                ) : (
                  <></>
                )}
              </ul>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default WatchlistImportModal;
