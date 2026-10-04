import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import { StatusPageListingMonitors } from "Common/Types/StatusPage/StatusPagesListingMonitors";
import { FieldFooterProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { getIdsFromFormValue } from "../Incident/IncidentStatusPageScopeForm";
import {
  ADDED_SUGGESTED_STATUS_PAGES_ANNOUNCEMENT,
  ADDED_SUGGESTED_STATUS_PAGE_ANNOUNCEMENT,
  ADD_ALL_SUGGESTED_STATUS_PAGES,
  ADD_SUGGESTED_STATUS_PAGE_LABEL,
  STATUS_PAGE_SUGGESTIONS_LABEL,
  UNTITLED_STATUS_PAGE,
  addStatusPagesToFormValue,
  getMonitorIdsFromFormValue,
  getStatusPagesToSuggest,
} from "./StatusPageSuggestionRules";
import useStatusPagesListingMonitors, {
  StatusPagesListingMonitorsState,
} from "./useStatusPagesListingMonitors";

/*
 * "Status pages that show the affected monitors: [+ Public] [+ EU] Add all"
 * - drawn under the status page picker of a scheduled maintenance event or an
 * announcement (StatusPageSuggestionRules says why). One click adds a page,
 * Add all adds every one; nothing is picked by itself. The line is not
 * there while there is nothing to add.
 *
 * A page's button goes once its page is added, so focus moves on to the
 * next button, or - once none is left - to where the line was, and a polite
 * status says what was added.
 */

export interface StatusPageSuggestionsProps {
  // The affected monitors, as the form holds them.
  monitorIds: unknown;
  // The status pages picked, as the form holds them.
  statusPageIds: unknown;
  // The kind of event: a page that does not show it is not suggested.
  eventType: StatusPageEventType;
  // The picker's new value, the added pages after those already picked.
  onChange: (statusPageIds: Array<string>) => void;
  /*
   * The monitors are being picked on the form: ask once the picking has
   * settled. False for monitors read from a saved record.
   */
  waitForPickingToSettle?: boolean | undefined;
}

const StatusPageSuggestions: FunctionComponent<StatusPageSuggestionsProps> = (
  props: StatusPageSuggestionsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `status-page-suggestions-${useId()}`;
  const rootRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  /*
   * Where focus goes once an add has been drawn: the suggestion button now
   * at this position, or the line itself when none is left.
   */
  const focusAfterAddRef: MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  const [announcement, setAnnouncement] = useState<string>("");

  const { statusPages }: StatusPagesListingMonitorsState =
    useStatusPagesListingMonitors(
      {
        monitorIds: props.monitorIds,
        eventType: props.eventType,
      },
      { waitForPickingToSettle: props.waitForPickingToSettle },
    );

  const toSuggest: Array<StatusPageListingMonitors> = getStatusPagesToSuggest({
    listing: statusPages,
    picked: props.statusPageIds,
    language: translator.language,
  });

  // A page's name, or what a page without one is called.
  const nameOf: (page: StatusPageListingMonitors) => string = (
    page: StatusPageListingMonitors,
  ): string => {
    return (
      page.name.trim() ||
      translator.translateText(UNTITLED_STATUS_PAGE) ||
      UNTITLED_STATUS_PAGE
    );
  };

  useLayoutEffect(() => {
    const position: number | null = focusAfterAddRef.current;

    if (position === null) {
      return;
    }

    focusAfterAddRef.current = null;

    const buttons: Array<HTMLElement> = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        "[data-status-page-suggestion]",
      ) || [],
    );

    const next: HTMLElement | undefined =
      buttons[Math.min(position, buttons.length - 1)];

    if (next) {
      next.focus();
      return;
    }

    rootRef.current?.focus();
  });

  const add: (
    pages: Array<StatusPageListingMonitors>,
    focusPosition: number,
  ) => void = (
    pages: Array<StatusPageListingMonitors>,
    focusPosition: number,
  ): void => {
    if (pages.length === 0) {
      return;
    }

    focusAfterAddRef.current = focusPosition;

    props.onChange(
      addStatusPagesToFormValue({
        picked: props.statusPageIds,
        statusPageIds: pages.map((page: StatusPageListingMonitors): string => {
          return page.statusPageId;
        }),
      }),
    );

    setAnnouncement(
      pages.length === 1
        ? translator.translateTemplate(
            ADDED_SUGGESTED_STATUS_PAGE_ANNOUNCEMENT,
            { statusPageName: nameOf(pages[0]!) },
          )
        : translator.translatePlural(
            ADDED_SUGGESTED_STATUS_PAGES_ANNOUNCEMENT,
            pages.length,
          ),
    );
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="focus:outline-none"
      data-testid="status-page-suggestions"
    >
      {toSuggest.length > 0 ? (
        <div
          role="group"
          aria-labelledby={labelId}
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5"
          data-testid="status-page-suggestions-line"
        >
          <span id={labelId} className="text-sm text-gray-600">
            {translator.translatePlural(
              STATUS_PAGE_SUGGESTIONS_LABEL,
              getMonitorIdsFromFormValue(props.monitorIds).length,
            )}
          </span>
          {toSuggest.map(
            (page: StatusPageListingMonitors, position: number) => {
              return (
                <button
                  key={page.statusPageId}
                  type="button"
                  data-status-page-suggestion={page.statusPageId}
                  data-testid="status-page-suggestion"
                  aria-label={translator.translateTemplate(
                    ADD_SUGGESTED_STATUS_PAGE_LABEL,
                    { statusPageName: nameOf(page) },
                  )}
                  title={nameOf(page)}
                  onClick={() => {
                    add([page], position);
                  }}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <svg
                    className="h-3 w-3 shrink-0"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                  <span className="truncate">{nameOf(page)}</span>
                </button>
              );
            },
          )}
          {toSuggest.length > 1 ? (
            <button
              type="button"
              data-testid="status-page-suggestions-add-all"
              onClick={() => {
                add(toSuggest, 0);
              }}
              className="rounded text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {translator.translateText(ADD_ALL_SUGGESTED_STATUS_PAGES)}
            </button>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      <span
        role="status"
        className="sr-only"
        data-testid="status-page-suggestions-status"
      >
        {announcement}
      </span>
    </div>
  );
};

export default StatusPageSuggestions;

/*
 * For an Edit form that does not hold the monitors - the maintenance event's
 * and the template's details cards edit them in a card of their own: the
 * monitors are read from the record (with the reader's own permissions)
 * each time the form shows the picker, so they are as the record has them
 * now.
 */
export interface RecordStatusPageSuggestionsProps
  extends Omit<
    StatusPageSuggestionsProps,
    "monitorIds" | "waitForPickingToSettle"
  > {
  // A model with a `monitors` relation.
  modelType: DatabaseBaseModelType;
  modelId: ObjectID;
}

export const RecordStatusPageSuggestions: FunctionComponent<
  RecordStatusPageSuggestionsProps
> = (props: RecordStatusPageSuggestionsProps): ReactElement => {
  const [monitorIds, setMonitorIds] = useState<Array<string>>([]);
  const modelId: string = props.modelId.toString();

  useEffect(() => {
    let isCancelled: boolean = false;

    ModelAPI.getItem<BaseModel>({
      modelType: props.modelType,
      id: new ObjectID(modelId),
      select: {
        monitors: {
          _id: true,
        },
      } as unknown as Select<BaseModel>,
    })
      .then((item: BaseModel | null) => {
        if (!isCancelled) {
          setMonitorIds(
            getIdsFromFormValue(
              (item as unknown as { monitors?: unknown } | null)?.monitors,
            ),
          );
        }
      })
      .catch(() => {
        // Advisory: a record that cannot be read suggests nothing.
        if (!isCancelled) {
          setMonitorIds([]);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [props.modelType, modelId]);

  return (
    <StatusPageSuggestions
      monitorIds={monitorIds}
      statusPageIds={props.statusPageIds}
      eventType={props.eventType}
      onChange={props.onChange}
      // A saved record's monitors do not change while the picker is open.
      waitForPickingToSettle={false}
    />
  );
};

export interface StatusPageSuggestionsFooterOptions {
  eventType: StatusPageEventType;
  /*
   * The record to read the monitors from, for an Edit form that does not
   * hold them. Left out, they are the form's own `monitors` value.
   */
  monitorsOf?:
    | {
        modelType: DatabaseBaseModelType;
        modelId: ObjectID;
      }
    | undefined;
}

/*
 * The getFooterElement of a `statusPages` picker field: the suggestions,
 * adding to the field through the footer's setValue (FieldFooterProps).
 *
 *   {
 *     field: { statusPages: true },
 *     fieldType: FormFieldSchemaType.MultiSelectDropdown,
 *     ...
 *     getFooterElement: getStatusPageSuggestionsFooter<ScheduledMaintenance>({
 *       eventType: StatusPageEventType.ScheduledEvent,
 *     }),
 *   }
 */
export const getStatusPageSuggestionsFooter: <TEntity>(
  options: StatusPageSuggestionsFooterOptions,
) => (
  values: FormValues<TEntity>,
  error?: string,
  footer?: FieldFooterProps,
) => ReactElement | undefined = <TEntity,>(
  options: StatusPageSuggestionsFooterOptions,
): ((
  values: FormValues<TEntity>,
  error?: string,
  footer?: FieldFooterProps,
) => ReactElement | undefined) => {
  const getFooterElement: (
    values: FormValues<TEntity>,
    error?: string,
    footer?: FieldFooterProps,
  ) => ReactElement | undefined = (
    values: FormValues<TEntity>,
    _error?: string,
    footer?: FieldFooterProps,
  ): ReactElement | undefined => {
    // Drawn outside a form, there is no field to add to.
    if (!footer) {
      return undefined;
    }

    const record: Record<string, unknown> = (values || {}) as Record<
      string,
      unknown
    >;

    const onChange: (statusPageIds: Array<string>) => void = (
      statusPageIds: Array<string>,
    ): void => {
      footer.setValue(statusPageIds);
    };

    if (options.monitorsOf) {
      return (
        <RecordStatusPageSuggestions
          modelType={options.monitorsOf.modelType}
          modelId={options.monitorsOf.modelId}
          statusPageIds={record["statusPages"]}
          eventType={options.eventType}
          onChange={onChange}
        />
      );
    }

    return (
      <StatusPageSuggestions
        monitorIds={record["monitors"]}
        statusPageIds={record["statusPages"]}
        eventType={options.eventType}
        onChange={onChange}
      />
    );
  };

  return getFooterElement;
};
