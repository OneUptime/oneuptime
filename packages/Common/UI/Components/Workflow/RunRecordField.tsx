/*
 * The record a record trigger runs with, in the Run Workflow panel: "which
 * incident should this run act on?"
 *
 * It used to be a text box asking for the incident's ID, a UUID nobody knows
 * by heart, and found on the incident's page under a fold. It is now a
 * search: type INC-8 - or 8, or part of the title - and pick the incident
 * from the list. Opened with nothing typed it lists the newest ones, so the
 * incident someone just made is one click away. An ID pasted in still works.
 *
 * The list comes from the server (RunRecordSource), which looks records up in
 * the workflow's project with the reader's own permissions. What the field
 * holds is the picked record's ID, or what was typed until something is
 * picked: the server looks a typed number up exactly the same way when the
 * run starts, so INC-8 and Run work without a pick (RunRecordValues).
 *
 * A number or an ID typed out, which the list found one record for, becomes
 * that record when the box is left: the field shows which incident INC-8 is,
 * and the confirmation names it, before anything runs.
 *
 * Where the panel asks for it (autoFocus), the box has the focus as the
 * panel opens, so the newest records are listed at once and a number can be
 * typed straight away - except where a finger is the pointer, where focusing
 * a box throws the keyboard over the list it opens.
 */

import Icon from "../Icon/Icon";
import { LoadRunRecordsFunction, loadRunRecords } from "./RunRecordSource";
import {
  getFeedClock,
  getFeedDayKey,
  getFeedLocale,
  getFeedRelativeDay,
  formatFeedFullTime,
  formatFeedTime,
  FeedClock,
} from "../Feed/FeedTime";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  RunRecordEvent,
  RunRecordMatch,
  RunRecordOption,
  RunRecordTriggerInfo,
} from "../../../Types/Workflow/RunRecord";
import API from "../../Utils/API/API";
import prefersTouch from "../../Utils/PrefersTouch";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

// How long typing has to pause before the list is asked for again.
export const RUN_RECORD_SEARCH_DELAY_MS: number = 250;

/*
 * The widest a number may make the list's first column, in characters. A
 * number longer than this - a prefix someone wrote a word into - pushes its
 * own title along rather than every title in the list.
 */
export const RUN_RECORD_NUMBER_COLUMN_MAX_CHARACTERS: number = 14;

type GetNumberColumnCharactersFunction = (
  records: Array<RunRecordOption>,
) => number;

/**
 * How many characters wide the list's number column is: as wide as the
 * longest number listed, so "INC-8" and "INC-80" are followed by titles that
 * start on one line down the list, the way a table's column does. 0 when no
 * record listed has a number, and there is no column.
 */
export const getRunRecordNumberColumnCharacters: GetNumberColumnCharactersFunction =
  (records: Array<RunRecordOption>): number => {
    let widest: number = 0;

    for (const record of records) {
      widest = Math.max(widest, (record.number || "").length);
    }

    return Math.min(widest, RUN_RECORD_NUMBER_COLUMN_MAX_CHARACTERS);
  };

export const RunRecordFieldCopy: {
  readonly searchByNumberOrName: string;
  readonly searchByNumber: string;
  readonly searchByName: string;
  readonly pasteId: string;
  readonly mostRecent: string;
  readonly searching: string;
  readonly noneYet: string;
  readonly noMatch: string;
  readonly change: string;
  readonly clear: string;
  readonly results: string;
  readonly pickFromList: string;
  readonly pickFromListOrId: string;
  readonly runsAsIfCreated: string;
  readonly runsAsIfUpdated: string;
  readonly runsAsIfDeleted: string;
  readonly createdOn: string;
} = {
  searchByNumberOrName: translationKey("Search by number or name"),
  searchByNumber: translationKey("Type its number or ID"),
  searchByName: translationKey("Search by name, or paste an ID"),
  pasteId: translationKey("Paste its ID"),
  mostRecent: translationKey("Most recent"),
  searching: translationKey("Searching…"),
  noneYet: translationKey("There are no {{records}} in this project yet."),
  noMatch: translationKey("Nothing matches “{{search}}”."),
  change: translationKey("Change"),
  clear: translationKey("Clear"),
  results: translationKey("Search results"),
  pickFromList: translationKey(
    "Pick one from the list, or type its number or ID.",
  ),
  pickFromListOrId: translationKey("Pick one from the list, or paste its ID."),
  runsAsIfCreated: translationKey(
    "The run starts as if this {{record}} had just been created.",
  ),
  runsAsIfUpdated: translationKey(
    "The run starts as if this {{record}} had just been updated.",
  ),
  runsAsIfDeleted: translationKey(
    "The run starts as if this {{record}} had just been deleted. Nothing is deleted.",
  ),
  createdOn: translationKey("Created {{date}}"),
};

type GetRunRecordDescriptionFunction = (
  translator: Translator,
  info: RunRecordTriggerInfo,
) => string;

/**
 * The field's help: what the run does with the record. On Create or Update
 * says what its What Happened asks (RunRecord.withRunRecordEvent), and
 * created until it is asked.
 */
export const getRunRecordDescription: GetRunRecordDescriptionFunction = (
  translator: Translator,
  info: RunRecordTriggerInfo,
): string => {
  const template: string =
    info.event === RunRecordEvent.Deleted
      ? RunRecordFieldCopy.runsAsIfDeleted
      : info.event === RunRecordEvent.Updated
        ? RunRecordFieldCopy.runsAsIfUpdated
        : RunRecordFieldCopy.runsAsIfCreated;

  return translator.translateTemplate(template, {
    record: translatableTerm(info.singularName, { inSentence: true }),
  });
};

type GetRunRecordPlaceholderFunction = (info: RunRecordTriggerInfo) => string;

// What the box says it takes, from what the model's records can be found by.
export const getRunRecordPlaceholder: GetRunRecordPlaceholderFunction = (
  info: RunRecordTriggerInfo,
): string => {
  if (info.hasNumber && info.hasName) {
    return RunRecordFieldCopy.searchByNumberOrName;
  }

  if (info.hasNumber) {
    return RunRecordFieldCopy.searchByNumber;
  }

  if (info.hasName) {
    return RunRecordFieldCopy.searchByName;
  }

  return RunRecordFieldCopy.pasteId;
};

type GetRunRecordPickHintFunction = (info: RunRecordTriggerInfo) => string;

/**
 * What the field says when it has nothing to run with: no record picked, or
 * words typed that name none. One sentence for both, since the way out is
 * the same - and only a model whose records have numbers is told to type one.
 */
export const getRunRecordPickHint: GetRunRecordPickHintFunction = (
  info: RunRecordTriggerInfo,
): string => {
  return info.hasNumber
    ? RunRecordFieldCopy.pickFromList
    : RunRecordFieldCopy.pickFromListOrId;
};

type GetRunRecordLabelFunction = (record: RunRecordOption) => string;

/** "INC-8 · Database is down", or as much of that as the record has. */
export const getRunRecordLabel: GetRunRecordLabelFunction = (
  record: RunRecordOption,
): string => {
  if (record.number && record.name) {
    return `${record.number} · ${record.name}`;
  }

  return record.number || record.name || record.id;
};

type FormatCreatedAtFunction = (date: Date, clock: FeedClock) => string;

/*
 * When a record was created, short enough for a row: "Today, 3:25 PM",
 * "Oct 2, 15:25". In the reader's language, zone and hour cycle, as the
 * feeds write times (Feed/FeedTime).
 */
export const formatRunRecordCreatedAt: FormatCreatedAtFunction = (
  date: Date,
  clock: FeedClock,
): string => {
  const time: string = formatFeedTime(date, clock);
  const relativeDay: string | undefined = getFeedRelativeDay(date, clock);

  if (relativeDay) {
    return `${relativeDay}, ${time}`;
  }

  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: clock.timezone,
  };

  // The year only when it is not this one, in the reader's zone.
  if (
    getFeedDayKey(date, clock.timezone).slice(0, 4) !==
    getFeedDayKey(clock.now, clock.timezone).slice(0, 4)
  ) {
    options.year = "numeric";
  }

  try {
    return `${new Intl.DateTimeFormat(getFeedLocale(clock.language), options).format(date)}, ${time}`;
  } catch {
    return time;
  }
};

interface ListState {
  // What the list was asked for.
  search: string;
  status: "idle" | "loading" | "loaded" | "failed";
  records: Array<RunRecordOption>;
  error?: string | undefined;
}

const IDLE_LIST: ListState = { search: "", status: "idle", records: [] };

type GetExactRunRecordFunction = (data: {
  // What is typed now, trimmed.
  search: string;
  // What the records were listed for.
  listedFor: string;
  records: Array<RunRecordOption>;
}) => RunRecordOption | null;

/**
 * The record what was typed names outright: the only one the list found by
 * its number or by its ID, for exactly what is typed now. Part of a name
 * names no record until one is picked, and neither does a number two
 * records answer to.
 */
export const getExactRunRecord: GetExactRunRecordFunction = (data: {
  search: string;
  listedFor: string;
  records: Array<RunRecordOption>;
}): RunRecordOption | null => {
  if (data.search === "" || data.listedFor !== data.search) {
    return null;
  }

  const exact: Array<RunRecordOption> = data.records.filter(
    (record: RunRecordOption): boolean => {
      return (
        record.matchedBy === RunRecordMatch.Id ||
        record.matchedBy === RunRecordMatch.Number
      );
    },
  );

  return exact.length === 1 ? (exact[0] as RunRecordOption) : null;
};

export interface ComponentProps {
  workflowId: ObjectID;
  info: RunRecordTriggerInfo;
  // What the form holds: the picked record's ID, or what was typed.
  value: string;
  onChange: (value: string) => void;
  // The record picked, or null once it is changed: for the confirmation.
  onRecordChange?: ((record: RunRecordOption | null) => void) | undefined;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  tabIndex?: number | undefined;
  autoFocus?: boolean | undefined;
  // Where the records come from; the server unless a test says otherwise.
  load?: LoadRunRecordsFunction | undefined;
  // "Now", for the dates in the list; the clock unless a test says otherwise.
  now?: Date | undefined;
  dataTestId?: string | undefined;
}

const RunRecordField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const testId: string = props.dataTestId || "run-record-field";
  const idPrefix: string = useId();
  const listboxId: string = `${idPrefix}-records`;
  const load: LoadRunRecordsFunction = props.load || loadRunRecords;

  const [query, setQuery] = useState<string>(props.value || "");
  const [picked, setPicked] = useState<RunRecordOption | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [list, setList] = useState<ListState>(IDLE_LIST);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const wrapperRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const inputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);
  const changeRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  // Only the newest request may fill the list: a slow answer is dropped.
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * The request really sent and not answered yet, and for what words. The
   * list's own "loading" cannot say so: closed before the pause was over,
   * the list goes back to idle by an update that can land only after the
   * box is opened again - Run pressed straight after typing puts the focus
   * back in the box within the same click (the form focuses its first field
   * in error) - and the box then waited on a request nobody had sent:
   * "Searching…" for good.
   */
  const askingRef: React.MutableRefObject<{
    request: number;
    search: string;
  } | null> = useRef<{ request: number; search: string } | null>(null);
  /*
   * Where the focus goes after a pick or after Change. Kept as state, set
   * with the pick itself, so the move belongs to the render that swaps the
   * box for the record (or back): a ref read by an effect can be read by an
   * effect still waiting from the render before, while what it is to focus
   * is not there yet.
   */
  const [focusAfter, setFocusAfter] = useState<{
    on: "search" | "change";
  } | null>(null);

  const trimmedQuery: string = query.trim();

  useEffect(() => {
    if (!isOpen || picked) {
      return;
    }

    // The answer to these words is in the list already.
    if (
      list.search === trimmedQuery &&
      (list.status === "loaded" || list.status === "failed")
    ) {
      return;
    }

    // Or on its way: asked for, and not answered yet (askingRef).
    if (askingRef.current?.search === trimmedQuery) {
      return;
    }

    const request: number = ++requestRef.current;

    setList((current: ListState) => {
      return {
        search: trimmedQuery,
        status: "loading",
        records: current.records,
      };
    });

    // Whether the list was really asked for, or closed before the pause ended.
    let wasAsked: boolean = false;

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        wasAsked = true;
        askingRef.current = { request: request, search: trimmedQuery };

        void (async (): Promise<void> => {
          try {
            const records: Array<RunRecordOption> = await load({
              workflowId: props.workflowId,
              search: trimmedQuery,
            });

            if (request !== requestRef.current) {
              return;
            }

            setList({
              search: trimmedQuery,
              status: "loaded",
              records: records,
            });
            setActiveIndex(0);
          } catch (error: unknown) {
            if (request !== requestRef.current) {
              return;
            }

            setList({
              search: trimmedQuery,
              status: "failed",
              records: [],
              error: API.getFriendlyMessage(error),
            });
          } finally {
            // Answered, or dropped for a newer one: no longer waited on.
            if (askingRef.current?.request === request) {
              askingRef.current = null;
            }
          }
        })();
      },
      // Opened with nothing typed, the newest records come at once.
      trimmedQuery === "" ? 0 : RUN_RECORD_SEARCH_DELAY_MS,
    );

    return () => {
      clearTimeout(timer);

      /*
       * Closed, or typed on, before the pause was over: the list was never
       * asked for, so it is not waiting for an answer. Left as "loading" it
       * said "Searching…" for good the next time the box was opened on the
       * same words - type, press Run before the pause ends, and the list it
       * points at never came.
       */
      if (!wasAsked) {
        setList((current: ListState) => {
          return current.status === "loading" && current.search === trimmedQuery
            ? { ...current, status: "idle" }
            : current;
        });
      }
    };
  }, [isOpen, trimmedQuery, picked]);

  /*
   * As the panel opens, the box is where the typing goes. preventScroll:
   * the panel slides in from the side, and is not all on screen yet.
   */
  useEffect(() => {
    if (props.autoFocus && !prefersTouch()) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, []);

  /*
   * The focus follows the field: to the box when Change brings it back, and
   * to Change when a pick takes the box away - it was in the box, and would
   * otherwise be nowhere.
   */
  useEffect(() => {
    if (focusAfter?.on === "search") {
      inputRef.current?.focus();
    }

    if (focusAfter?.on === "change") {
      changeRef.current?.focus();
    }
  }, [focusAfter]);

  const records: Array<RunRecordOption> =
    list.status === "loaded" ? list.records : [];

  const activeRecord: RunRecordOption | undefined =
    records[Math.min(activeIndex, records.length - 1)];

  const numberColumnCharacters: number =
    getRunRecordNumberColumnCharacters(records);

  type OptionIdFunction = (record: RunRecordOption) => string;

  const optionId: OptionIdFunction = (record: RunRecordOption): string => {
    return `${idPrefix}-record-${record.id}`;
  };

  useEffect(() => {
    if (!isOpen || !activeRecord) {
      return;
    }

    const element: HTMLElement | null = document.getElementById(
      optionId(activeRecord),
    );

    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, isOpen, activeRecord?.id]);

  type PickFunction = (
    record: RunRecordOption,
    // False when the focus is leaving the field anyway.
    options?: { keepFocus: boolean },
  ) => void;

  const pick: PickFunction = (
    record: RunRecordOption,
    options?: { keepFocus: boolean },
  ): void => {
    setFocusAfter(options?.keepFocus === false ? null : { on: "change" });
    setPicked(record);
    setIsOpen(false);
    setQuery("");
    props.onChange(record.id);
    props.onRecordChange?.(record);
  };

  // The record a number or an ID typed out names, once the list has it.
  const exactRecord: RunRecordOption | null =
    list.status === "loaded"
      ? getExactRunRecord({
          search: trimmedQuery,
          listedFor: list.search,
          records: list.records,
        })
      : null;

  type ChangeFunction = () => void;

  // Back to the search, with the list open and the box focused.
  const change: ChangeFunction = (): void => {
    setFocusAfter({ on: "search" });
    setPicked(null);
    setIsOpen(true);
    setList(IDLE_LIST);
    props.onChange("");
    props.onRecordChange?.(null);
  };

  type OnQueryChangeFunction = (text: string) => void;

  const onQueryChange: OnQueryChangeFunction = (text: string): void => {
    setQuery(text);
    setIsOpen(true);
    props.onChange(text);
  };

  type OnKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void;

  const onKeyDown: OnKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();

        if (!isOpen) {
          setIsOpen(true);
          return;
        }

        if (records.length === 0) {
          return;
        }

        const step: number = event.key === "ArrowDown" ? 1 : -1;
        const current: number = Math.min(activeIndex, records.length - 1);

        setActiveIndex((current + step + records.length) % records.length);
        return;
      }
      case "Enter":
        // Never the panel's own submit while the list is in use.
        if (isOpen && activeRecord) {
          event.preventDefault();
          pick(activeRecord);
        }

        return;
      case "Escape":
        if (isOpen) {
          // Closes the list, not the panel.
          event.preventDefault();
          event.stopPropagation();
          setIsOpen(false);
        }

        return;
      default:
        return;
    }
  };

  const clock: FeedClock = getFeedClock({
    language: translator.language,
    now: props.now,
  });

  type RenderOptionFunction = (
    record: RunRecordOption,
    index: number,
  ) => ReactElement;

  const renderOption: RenderOptionFunction = (
    record: RunRecordOption,
    index: number,
  ): ReactElement => {
    const isActive: boolean = record === activeRecord;
    const createdAt: Date | null = record.createdAt
      ? new Date(record.createdAt)
      : null;
    const hasDate: boolean = Boolean(createdAt && !isNaN(createdAt.getTime()));

    return (
      <div
        key={record.id}
        id={optionId(record)}
        role="option"
        aria-selected={isActive}
        data-testid={`${testId}-option`}
        data-record-id={record.id}
        data-matched-by={record.matchedBy}
        className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${
          isActive ? "bg-indigo-50" : "hover:bg-gray-50"
        }`}
        onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
          // The focus stays in the box until the pick moves it.
          event.preventDefault();
        }}
        onMouseMove={() => {
          if (index !== activeIndex) {
            setActiveIndex(index);
          }
        }}
        onClick={() => {
          pick(record);
        }}
      >
        {/*
         * The numbers are a column: each sits in a slot as wide as the
         * longest one listed, so the titles after them start on one line.
         * The slot is sized in the number's own font and size (ch is the
         * width of one of its characters) plus the chip's side padding, and
         * on the element itself, which is there from the first draw.
         */}
        {numberColumnCharacters > 0 ? (
          <span
            data-part="number"
            className="inline-flex shrink-0 items-center font-mono text-xs"
            style={{ minWidth: `calc(${numberColumnCharacters}ch + 0.75rem)` }}
          >
            {record.number ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700">
                {record.number}
              </span>
            ) : null}
          </span>
        ) : null}
        <span
          data-part="name"
          className={`min-w-0 flex-1 truncate text-sm ${
            record.name ? "text-gray-900" : "font-mono text-gray-600"
          }`}
          title={record.name || record.id}
        >
          {record.name || (record.number ? "" : record.id)}
        </span>
        {/*
         * gray-500 on white, and a shade darker on the row the pointer or
         * the keys are on, whose tint would otherwise leave it at 4.3:1.
         */}
        {hasDate && createdAt ? (
          <span
            data-part="created"
            className={`max-sm:hidden shrink-0 text-xs ${
              isActive ? "text-gray-600" : "text-gray-500"
            }`}
            title={formatFeedFullTime(createdAt, clock)}
          >
            {translator.translateTemplate(RunRecordFieldCopy.createdOn, {
              date: formatRunRecordCreatedAt(createdAt, clock),
            })}
          </span>
        ) : null}
      </div>
    );
  };

  type RenderListFunction = () => ReactElement | null;

  const renderList: RenderListFunction = (): ReactElement | null => {
    if (!isOpen || picked) {
      return null;
    }

    const isLoading: boolean =
      list.status === "loading" || list.status === "idle";
    const showRecentHeading: boolean = list.search === "" && records.length > 0;

    return (
      <div
        className="mt-1 overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
        data-testid={`${testId}-list`}
      >
        {showRecentHeading ? (
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {translator.translateText(RunRecordFieldCopy.mostRecent)}
          </div>
        ) : null}
        <div
          id={listboxId}
          role="listbox"
          aria-label={translator.translateText(RunRecordFieldCopy.results)}
          className="max-h-64 overflow-y-auto py-1"
        >
          {records.map((record: RunRecordOption, index: number) => {
            return renderOption(record, index);
          })}
        </div>
        {isLoading && records.length === 0 ? (
          <p
            className="px-3 pb-2 text-xs text-gray-500"
            role="status"
            data-testid={`${testId}-searching`}
          >
            {translator.translateText(RunRecordFieldCopy.searching)}
          </p>
        ) : null}
        {list.status === "loaded" && records.length === 0 ? (
          <p
            className="px-3 pb-2 text-xs text-gray-500"
            role="status"
            data-testid={`${testId}-empty`}
          >
            {list.search === ""
              ? translator.translateTemplate(RunRecordFieldCopy.noneYet, {
                  records: translatableTerm(props.info.pluralName, {
                    inSentence: true,
                  }),
                })
              : translator.translateTemplate(RunRecordFieldCopy.noMatch, {
                  search: list.search,
                })}
          </p>
        ) : null}
        {list.status === "failed" ? (
          <p
            className="px-3 pb-2 text-xs text-amber-700"
            role="alert"
            data-testid={`${testId}-failed`}
          >
            {list.error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={wrapperRef}
      data-testid={testId}
      onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
        const next: EventTarget | null = event.relatedTarget;

        // Moving within the field keeps the list; leaving it closes it.
        if (
          next instanceof Node &&
          wrapperRef.current &&
          wrapperRef.current.contains(next)
        ) {
          return;
        }

        setIsOpen(false);

        // INC-8 typed out and left: the incident it names, shown as picked.
        if (!picked && exactRecord) {
          pick(exactRecord, { keepFocus: false });
        }

        /*
         * The form is told the field was left - which is when it says what
         * the field needs - only once there is something in it. The panel
         * puts the focus in the box as it opens: a click anywhere else
         * would have the empty box say "Pick one from the list" in red at
         * someone who has not been asked anything yet. What is missing is
         * said when Run is pressed (RunForm's showErrors).
         */
        if (trimmedQuery !== "" || picked) {
          props.onBlur?.();
        }
      }}
    >
      {picked ? (
        <div
          className="flex min-w-0 items-center gap-3 rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm"
          data-testid={`${testId}-picked`}
        >
          {picked.number ? (
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-700">
              {picked.number}
            </span>
          ) : null}
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              picked.name ? "text-gray-900" : "font-mono text-gray-600"
            }`}
            title={picked.name || picked.id}
          >
            {picked.name || (picked.number ? "" : picked.id)}
          </span>
          <button
            ref={changeRef}
            type="button"
            className="shrink-0 rounded px-1 py-0.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            data-testid={`${testId}-change`}
            onClick={change}
          >
            {translator.translateText(RunRecordFieldCopy.change)}
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon
              icon={IconProp.MagnifyingGlass}
              className="h-4 w-4 text-gray-400"
            />
          </div>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              isOpen && activeRecord ? optionId(activeRecord) : undefined
            }
            aria-labelledby={props.ariaLabelledby}
            aria-invalid={Boolean(props.error)}
            data-testid={`${testId}-search`}
            autoComplete="off"
            spellCheck={false}
            tabIndex={props.tabIndex}
            value={query}
            placeholder={translator.translateText(
              getRunRecordPlaceholder(props.info),
            )}
            className={`block w-full rounded-md border bg-white py-2 pl-9 pr-9 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-1 ${
              props.error
                ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
            onFocus={() => {
              setIsOpen(true);
            }}
            onClick={() => {
              setIsOpen(true);
            }}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              onQueryChange(event.target.value);
            }}
            onKeyDown={onKeyDown}
          />
          {query ? (
            <div className="absolute inset-y-0 right-0 flex items-center pr-2">
              <button
                type="button"
                aria-label={translator.translateText(RunRecordFieldCopy.clear)}
                data-testid={`${testId}-clear`}
                // 24px square, with a ring the keyboard can see in either theme.
                className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  onQueryChange("");
                  inputRef.current?.focus();
                }}
              >
                <Icon icon={IconProp.Close} className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      )}
      {renderList()}
      {/*
       * Whatever the form found wrong - nothing picked, or words that name
       * no record - the field says the one way out, in its own words.
       * "Incident is required." was the form's, for any box left blank.
       */}
      {props.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          data-testid={`${testId}-error`}
          role="alert"
        >
          {translator.translateText(getRunRecordPickHint(props.info))}
        </p>
      ) : null}
    </div>
  );
};

export default RunRecordField;
