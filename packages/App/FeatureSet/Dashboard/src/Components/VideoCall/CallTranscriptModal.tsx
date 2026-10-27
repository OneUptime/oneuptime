import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import ObjectID from "Common/Types/ObjectID";
import TranscriptText, {
  TranscriptLine,
} from "Common/Utils/VideoCall/TranscriptText";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Input from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * A call's transcript, to read (issue #4875): one remark a row - when, who,
 * what was said - with a box that narrows it to the remarks holding a word,
 * and Copy, for the whole transcript as text. The transcript is read when
 * the dialog opens: the page's list of calls never carries it.
 *
 * A long call is hundreds of remarks; the first TRANSCRIPT_ROWS_SHOWN_AT_ONCE
 * are drawn and a button draws the rest, so a dialog never builds twenty
 * thousand rows at once.
 *
 * Opened from what OneUptime AI read, it starts on the first line the
 * suggestion quotes - drawn, however far into the call it is, and scrolled
 * to - with every quoted line highlighted.
 */

export interface ComponentProps {
  callId: ObjectID;
  // "Zoom meeting", or a link's own title.
  callLabel: string;
  // Remark numbers to start on, highlighted: the lines a summary cites.
  highlightLines?: Array<number> | undefined;
  onClose: () => void;
}

export const TRANSCRIPT_ROWS_SHOWN_AT_ONCE: number = 400;

/*
 * How many rows to draw first: enough to reach the first highlighted line,
 * in steps of TRANSCRIPT_ROWS_SHOWN_AT_ONCE.
 */
export function getRowsShownFirst(highlightLines: Array<number> = []): number {
  const first: number = Math.min(
    ...highlightLines.filter((line: number): boolean => {
      return Number.isInteger(line) && line > 0;
    }),
  );

  if (!Number.isFinite(first)) {
    return TRANSCRIPT_ROWS_SHOWN_AT_ONCE;
  }

  return (
    Math.ceil(first / TRANSCRIPT_ROWS_SHOWN_AT_ONCE) *
    TRANSCRIPT_ROWS_SHOWN_AT_ONCE
  );
}

interface NumberedLine {
  number: number;
  line: TranscriptLine;
}

// The remarks holding `query`, whatever its case; all of them for none.
export function filterTranscriptLines(
  lines: Array<TranscriptLine>,
  query: string,
): Array<NumberedLine> {
  const needle: string = query.trim().toLowerCase();

  return lines
    .map((line: TranscriptLine, index: number): NumberedLine => {
      return { number: index + 1, line };
    })
    .filter((entry: NumberedLine): boolean => {
      if (!needle) {
        return true;
      }

      return (
        entry.line.text.toLowerCase().includes(needle) ||
        (entry.line.speaker || "").toLowerCase().includes(needle)
      );
    });
}

const CallTranscriptModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [lines, setLines] = useState<Array<TranscriptLine> | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState<string>("");
  const [shown, setShown] = useState<number>(
    getRowsShownFirst(props.highlightLines),
  );
  const [loadCount, setLoadCount] = useState<number>(0);
  const listRef: React.RefObject<HTMLOListElement> =
    useRef<HTMLOListElement>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    setError(undefined);

    ModelAPI.getItem<IncidentVideoCall>({
      modelType: IncidentVideoCall,
      id: props.callId,
      select: { _id: true, transcript: true },
    })
      .then((call: IncidentVideoCall | null) => {
        if (isCurrent) {
          setLines(TranscriptText.deserialize(call?.transcript));
        }
      })
      .catch((err: Error) => {
        if (isCurrent) {
          setError(API.getFriendlyErrorMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.callId.toString(), loadCount]);

  const matching: Array<NumberedLine> = useMemo(() => {
    return filterTranscriptLines(lines || [], query);
  }, [lines, query]);

  const highlighted: Set<number> = new Set<number>(props.highlightLines || []);

  // Once the transcript is drawn, the first highlighted line is in view.
  useEffect(() => {
    if (!lines || highlighted.size === 0) {
      return;
    }

    const first: HTMLElement | null | undefined =
      listRef.current?.querySelector<HTMLElement>("[data-highlighted='true']");

    if (first && typeof first.scrollIntoView === "function") {
      first.scrollIntoView({ block: "center" });
    }
  }, [lines]);

  let body: ReactElement;

  if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setLoadCount((count: number) => {
            return count + 1;
          });
        }}
      />
    );
  } else if (lines === null) {
    body = <ComponentLoader />;
  } else if (lines.length === 0) {
    body = (
      <p className="text-sm text-gray-500">
        {translator.translateText("This call has no transcript.")}
      </p>
    );
  } else {
    body = (
      <div className="space-y-3">
        <Input
          isSearchOrFilter={true}
          id="call-transcript-search"
          dataTestId="call-transcript-search"
          value={query}
          placeholder={translator.translateText("Find in the transcript")}
          onChange={(value: string) => {
            setQuery(value);
            setShown(TRANSCRIPT_ROWS_SHOWN_AT_ONCE);
          }}
        />

        {highlighted.size > 0 ? (
          <p
            data-testid="call-transcript-highlight-legend"
            className="flex items-center gap-2 text-xs text-gray-500"
          >
            <span className="h-3 w-3 flex-shrink-0 rounded-sm bg-amber-50 ring-1 ring-inset ring-amber-200" />
            {translator.translateText(
              "Highlighted: the lines the suggested root cause quotes.",
            )}
          </p>
        ) : (
          <></>
        )}

        {matching.length === 0 ? (
          <p className="text-sm text-gray-500">
            {translator.translateText("No remark has these words.")}
          </p>
        ) : (
          <ol
            ref={listRef}
            data-testid="call-transcript-lines"
            aria-label={translator.translateText("Transcript")}
            className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto"
          >
            {matching
              .slice(0, shown)
              .map((entry: NumberedLine): ReactElement => {
                const isHighlighted: boolean = highlighted.has(entry.number);

                return (
                  <li
                    key={entry.number}
                    data-testid="call-transcript-line"
                    data-line={entry.number}
                    data-highlighted={isHighlighted ? "true" : undefined}
                    className={`flex gap-3 px-2 py-2 ${isHighlighted ? "bg-amber-50" : ""}`}
                  >
                    {/*
                      The page's own type, with figures of one width: the
                      times line up, and read like the quoted lines' times
                      on the AI Investigation card.
                    */}
                    <span className="w-14 flex-shrink-0 pt-0.5 text-xs tabular-nums text-gray-500">
                      {entry.line.offsetInSeconds === undefined
                        ? ""
                        : TranscriptText.formatOffset(
                            entry.line.offsetInSeconds,
                          )}
                    </span>
                    <div className="min-w-0 flex-1">
                      {entry.line.speaker ? (
                        <p className="text-xs font-semibold text-gray-700">
                          {entry.line.speaker}
                        </p>
                      ) : (
                        <></>
                      )}
                      <p className="whitespace-pre-wrap break-words text-sm text-gray-900">
                        {entry.line.text}
                      </p>
                    </div>
                  </li>
                );
              })}
          </ol>
        )}

        {matching.length > shown ? (
          <button
            type="button"
            data-testid="call-transcript-show-more"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => {
              setShown((count: number) => {
                return count + TRANSCRIPT_ROWS_SHOWN_AT_ONCE;
              });
            }}
          >
            {translator.translatePlural(
              {
                one: "Show {{count}} more remark",
                other: "Show {{count}} more remarks",
              },
              Math.min(TRANSCRIPT_ROWS_SHOWN_AT_ONCE, matching.length - shown),
            )}
          </button>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <Modal
      title={translator.translateTemplate("Transcript of the {{call}}", {
        call: props.callLabel,
      })}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
      leftFooterElement={
        lines && lines.length > 0 ? (
          <CopyTextButton
            textToBeCopied={TranscriptText.toReadableText(lines)}
            label="Copy transcript"
            size="md"
            variant="soft"
          />
        ) : undefined
      }
    >
      <div data-testid="call-transcript">{body}</div>
    </Modal>
  );
};

export default CallTranscriptModal;
