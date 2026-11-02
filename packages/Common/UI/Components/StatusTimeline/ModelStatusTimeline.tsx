import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../ActionButton/ActionButtonSchema";
import RowActions from "../ActionButton/RowActions";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import { getRefreshButton } from "../Card/CardButtons/Refresh";
import Card, { CardButtonSchema } from "../Card/Card";
import { getTableHeaderButtons } from "../Table/TableHeaderControls";
import DeleteConfirmationMessage from "../DeleteConfirmation/DeleteConfirmationMessage";
import {
  getDeleteConsequence,
  joinSentences,
} from "../DeleteConfirmation/DeleteConsequences";
import { FormType, ModelField } from "../Forms/ModelForm";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "../Modal/ConfirmModal";
import Modal, { ModalWidth } from "../Modal/Modal";
import ModelFormModal from "../ModelFormModal/ModelFormModal";
import {
  DeleteConfirmation,
  translateCreateAction,
} from "../ModelTable/BaseModelTable";
import RecordIdModal from "../ObjectID/RecordIdModal";
import { getRecordIdText, hasRecordId } from "../ObjectID/RecordIdText";
import SimpleLogViewer from "../SimpleLogViewer/SimpleLogViewer";
import StatusTimeline, { StatusTimelineDisplayEntry } from "./StatusTimeline";
import {
  getStatusTimelineFitWindow,
  getStatusTimelineZoomWindow,
  isStatusTimelineWindowAtNow,
  shiftStatusTimelineWindow,
  StatusTimelineWindow,
  StatusTimelineWindowFollow,
} from "./StatusTimelineLayout";
import StatusTimelineWindowControls from "./StatusTimelineWindowControls";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import Sort from "../../../Types/BaseDatabase/Sort";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { getApiReferencePagePath } from "../../../Utils/ApiReferencePage";
import { BILLING_ENABLED } from "../../Config";
import API from "../../Utils/API/API";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
  PermissionGateOptions,
} from "../../Utils/PermissionGate";
import {
  usePrivateRecordGateOptions,
  withPrivateRecordGateOptions,
} from "../../Utils/PrivateRecordScope";
import {
  translateNamedAction,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * ---------------------------------------------------------------------------
 * A record's status (or state) timeline, read from its model's rows
 * ---------------------------------------------------------------------------
 *
 * The timeline view of a page that used to be a table of the record's
 * MonitorStatusTimeline / IncidentStateTimeline / ... rows. It reads the
 * same rows, through the same API and permissions, and keeps everything the
 * table did - Create, View Cause, View Logs, Show ID and Delete, each gated
 * and worded as the table gates and words them - while drawing them as a
 * StatusTimeline.
 *
 * It never reads every row of a record with years of history. A record
 * whose history grows for ever (a monitor, a network site) is read one
 * period at a time (`defaultRange`): the rows that began in the period,
 * newest first and STATUS_TIMELINE_PAGE_SIZE at a time, plus the one row in
 * effect when the period began, each read through the (record, startsAt)
 * index. A record whose whole history fits on one band (an incident, an
 * alert, a maintenance event, an episode) is read newest first, the same
 * page at a time, and the band is fitted to it.
 */

export const STATUS_TIMELINE_PAGE_SIZE: number = 500;

/*
 * Whether a record in this state is done with: an incident in its project's
 * Resolved state, or in a state the project placed after it. Answered per
 * state, from the project's own list of states.
 */
export type StatusTimelineFinalStateRule = (state: JSONObject) => boolean;

// The create dialog's title, as the table words it.
const CREATE_NEW_TEMPLATE: string = translationKey("Create New {{itemName}}");

const DEFAULT_NO_CAUSE_TEXT: string = translationKey(
  "No root cause identified.",
);
const DEFAULT_NO_LOGS_TEXT: string = translationKey(
  "No logs for this status event.",
);
const DEFAULT_LOGS_TITLE: string = translationKey("Why did the status change?");
const DEFAULT_LOG_VIEWER_TITLE: string = translationKey("Status Change Log");

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  // Prefix of the test ids, and the form's name.
  id: string;
  name: string;
  title: string;
  description: string;
  // First in the card's header, before Create (the view switch).
  headerElement?: ReactElement | undefined;
  // The record's rows: { monitorId, projectId }.
  query: Query<TBaseModel>;
  // The relation holding the status, with its name and colour: "monitorStatus".
  stateColumn: string;
  // More of the status to read, such as a monitor status's priority.
  stateSelect?: JSONObject | undefined;
  // How serious a status is, higher being worse (StatusTimelineEntry.rank).
  getStateRank?: ((state: JSONObject) => number | undefined) | undefined;
  /*
   * Which states the record is done with - an incident's Resolved, and any
   * state its project placed after it - read with the rows, so the band is
   * drawn once: the project's own list of states decides it
   * (Common/Utils/ResolvedState, ScheduledMaintenanceStart), never a flag
   * on its own. A whole-history band of a record that is not done runs on
   * to now (getStatusTimelineFitWindow's isOpen). The state's columns the
   * rule reads go in stateSelect. A rule that can't be read leaves the
   * band fitted to the changes.
   */
  getFinalStateRule?: (() => Promise<StatusTimelineFinalStateRule>) | undefined;
  /*
   * The period the timeline opens on, for a record whose history grows for
   * ever. Absent: the whole history, fitted to the band.
   */
  defaultRange?: TimeRange | undefined;
  // Say each status's share of the period (a monitor's uptime).
  showShare?: boolean | undefined;
  // The band's name for a screen reader: "Status timeline of this monitor".
  ariaLabel: string;
  emptyMessage: string;

  // Creating a row, as the table did.
  isCreateable?: boolean | undefined;
  formFields?: Array<ModelField<TBaseModel>> | undefined;
  onBeforeCreate?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
  // What one row is called: "State Change". The model's own name otherwise.
  singularName?: string | undefined;

  // Deleting a row, as the table did.
  isDeleteable?: boolean | undefined;
  getDeleteDisabledReason?:
    | ((item: TBaseModel) => string | undefined)
    | undefined;
  getDeleteConfirmation?:
    | ((item: TBaseModel) => Promise<DeleteConfirmation>)
    | undefined;
  getItemName?: ((item: TBaseModel) => string) | undefined;
  deleteConfirmationWarning?: string | undefined;
  // After every load: what reads the rows a delete is refused for.
  onFetchSuccess?: (() => void) | undefined;

  // The row's cause and log, read when asked for.
  causeColumn?: string | undefined;
  noCauseText?: string | undefined;
  logColumn?: string | undefined;
  logsTitle?: string | undefined;
  logsDescription?: string | undefined;
  logViewerTitle?: string | undefined;
  noLogsText?: string | undefined;
  showViewIdButton?: boolean | undefined;

  // More fields of each row, for renderEntryDetails.
  selectMoreFields?: Select<TBaseModel> | undefined;
  // Under an entry: what the page adds (a notification's status, say).
  renderEntryDetails?:
    | ((item: TBaseModel, refresh: () => void) => ReactElement | null)
    | undefined;
  refreshToggle?: string | undefined;
}

interface LoadedTimeline<TBaseModel extends BaseModel> {
  // The period the rows were read for (null: the whole history).
  window: StatusTimelineWindow | null;
  // Newest first.
  rows: Array<TBaseModel>;
  // The row in effect when the period began (a period only).
  rowBeforeWindow: TBaseModel | null;
  // How many rows the period (or the whole history) holds.
  totalCount: number;
  // Which states the record is done with (getFinalStateRule), when known.
  isFinalState: StatusTimelineFinalStateRule | null;
}

const DEFAULT_STATUS_COLOR: string = "#6b7280";

// A row's value, read without the model's types: the column is a prop.
const readValue: (row: BaseModel, column: string) => unknown = (
  row: BaseModel,
  column: string,
): unknown => {
  return (row as unknown as Record<string, unknown>)[column];
};

const readDate: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (!value) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(value as Date);

  return isNaN(date.getTime()) ? null : date;
};

const getRowId: (row: BaseModel) => string = (row: BaseModel): string => {
  return getRecordIdText(row._id || row.id);
};

type ModelStatusTimelineFunction = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement;

const ModelStatusTimeline: ModelStatusTimelineFunction = <
  TBaseModel extends BaseModel,
>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const model: TBaseModel = useMemo(() => {
    return new props.modelType();
  }, [props.modelType]);

  /*
   * On a private incident, alert or episode's page, what the reader holds
   * on it: its changes are offered only when a team of theirs that owns it
   * may make them (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(model);
  const singularName: string =
    props.singularName?.trim() || model.singularName || "";

  const isRangeMode: boolean = Boolean(props.defaultRange);

  const [range, setRange] = useState<RangeStartAndEndDateTime | null>(
    props.defaultRange ? { range: props.defaultRange } : null,
  );
  const [zoom, setZoom] = useState<StatusTimelineWindow | null>(null);
  const [loaded, setLoaded] = useState<LoadedTimeline<TBaseModel> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [reloadCounter, setReloadCounter] = useState<number>(0);

  // Only the newest request's answer is drawn.
  const requestCounter: React.MutableRefObject<number> = useRef<number>(0);

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [itemToDelete, setItemToDelete] = useState<TBaseModel | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [errorModalText, setErrorModalText] = useState<string>("");
  const [viewId, setViewId] = useState<string | null>(null);
  const [cause, setCause] = useState<{
    isLoading: boolean;
    text: string;
  } | null>(null);
  const [logs, setLogs] = useState<{ isLoading: boolean; text: string } | null>(
    null,
  );

  const queryKey: string = JSON.stringify(props.query);

  // ---- what is read ------------------------------------------------------
  const select: Select<TBaseModel> = useMemo(() => {
    const fields: JSONObject = {
      _id: true,
      startsAt: true,
      endsAt: true,
      [props.stateColumn]: {
        _id: true,
        name: true,
        color: true,
        ...(props.stateSelect || {}),
      },
    };

    // Who changed it - only for a viewer who may read who did.
    if (
      model.hasColumn("createdByUser") &&
      PermissionGate.canReadColumn(model, "createdByUser")
    ) {
      fields["createdByUser"] = { _id: true, name: true, email: true };
    }

    return {
      ...fields,
      ...((props.selectMoreFields as JSONObject | undefined) || {}),
    } as Select<TBaseModel>;
  }, [props.stateColumn, model]);

  const sort: Sort<TBaseModel> = {
    startsAt: SortOrder.Descending,
  } as Sort<TBaseModel>;

  // The period a load reads: a zoom, else the range picked, as of now.
  const getTargetWindow: () => StatusTimelineWindow | null =
    (): StatusTimelineWindow | null => {
      if (!isRangeMode) {
        return null;
      }

      if (zoom) {
        return zoom;
      }

      const between: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(
          range || { range: props.defaultRange! },
        );

      return {
        start: OneUptimeDate.fromString(between.startValue),
        end: OneUptimeDate.fromString(between.endValue),
      };
    };

  const readRows: (data: {
    window: StatusTimelineWindow | null;
    skip: number;
  }) => Promise<ListResult<TBaseModel>> = async (data: {
    window: StatusTimelineWindow | null;
    skip: number;
  }): Promise<ListResult<TBaseModel>> => {
    return ModelAPI.getList<TBaseModel>({
      modelType: props.modelType,
      query: (data.window
        ? {
            ...props.query,
            startsAt: new InBetween<Date>(data.window.start, data.window.end),
          }
        : { ...props.query }) as Query<TBaseModel>,
      limit: STATUS_TIMELINE_PAGE_SIZE,
      skip: data.skip,
      select: select,
      sort: sort,
    });
  };

  /*
   * The rule for which states the record is done with. It only shapes the
   * band (whether it runs on to now), so a rule that can't be read is no
   * error: the band is fitted to the changes instead.
   */
  const readFinalStateRule: () => Promise<StatusTimelineFinalStateRule | null> =
    async (): Promise<StatusTimelineFinalStateRule | null> => {
      if (!props.getFinalStateRule) {
        return null;
      }

      try {
        return await props.getFinalStateRule();
      } catch {
        return null;
      }
    };

  const load: () => Promise<void> = async (): Promise<void> => {
    const requestId: number = ++requestCounter.current;
    const targetWindow: StatusTimelineWindow | null = getTargetWindow();

    if (loaded) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [inWindow, before, isFinalState]: [
        ListResult<TBaseModel>,
        ListResult<TBaseModel> | null,
        StatusTimelineFinalStateRule | null,
      ] = await Promise.all([
        readRows({ window: targetWindow, skip: 0 }),
        targetWindow
          ? ModelAPI.getList<TBaseModel>({
              modelType: props.modelType,
              query: {
                ...props.query,
                startsAt: new LessThan<Date>(targetWindow.start),
              } as Query<TBaseModel>,
              limit: 1,
              skip: 0,
              select: select,
              sort: sort,
            })
          : Promise.resolve(null),
        readFinalStateRule(),
      ]);

      if (requestId !== requestCounter.current) {
        return;
      }

      setLoaded({
        window: targetWindow,
        rows: inWindow.data,
        rowBeforeWindow: before?.data[0] || null,
        totalCount: Math.max(inWindow.count, inWindow.data.length),
        isFinalState: isFinalState,
      });
      setError("");
      props.onFetchSuccess?.();
    } catch (err) {
      if (requestId !== requestCounter.current) {
        return;
      }

      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
    setIsRefreshing(false);
  };

  useEffect(() => {
    void load();
  }, [
    queryKey,
    JSON.stringify(range),
    isRangeMode ? JSON.stringify(zoom) : "",
    reloadCounter,
    props.refreshToggle,
  ]);

  const refresh: () => void = (): void => {
    setReloadCounter((count: number) => {
      return count + 1;
    });
  };

  const loadOlder: () => Promise<void> = async (): Promise<void> => {
    if (!loaded) {
      return;
    }

    const requestId: number = requestCounter.current;
    setIsLoadingOlder(true);

    try {
      const older: ListResult<TBaseModel> = await readRows({
        window: loaded.window,
        skip: loaded.rows.length,
      });

      if (requestId !== requestCounter.current) {
        return;
      }

      const knownIds: Set<string> = new Set<string>(loaded.rows.map(getRowId));

      setLoaded({
        ...loaded,
        rows: [
          ...loaded.rows,
          ...older.data.filter((row: TBaseModel): boolean => {
            return !knownIds.has(getRowId(row));
          }),
        ],
        totalCount: Math.max(older.count, loaded.totalCount),
      });
    } catch (err) {
      setErrorModalText(API.getFriendlyMessage(err));
    }

    setIsLoadingOlder(false);
  };

  // ---- the entries ---------------------------------------------------------
  const allRowsLoaded: boolean = Boolean(
    loaded && loaded.rows.length >= loaded.totalCount,
  );

  const rows: Array<TBaseModel> = useMemo(() => {
    if (!loaded) {
      return [];
    }

    const result: Array<TBaseModel> = [...loaded.rows];

    // The status the period began in, once nothing between is missing.
    if (loaded.rowBeforeWindow && loaded.rows.length >= loaded.totalCount) {
      result.push(loaded.rowBeforeWindow);
    }

    return result;
  }, [loaded]);

  const rowsById: Map<string, TBaseModel> = useMemo(() => {
    const map: Map<string, TBaseModel> = new Map<string, TBaseModel>();

    for (const row of rows) {
      map.set(getRowId(row), row);
    }

    return map;
  }, [rows]);

  const entries: Array<StatusTimelineDisplayEntry> = useMemo(() => {
    const result: Array<StatusTimelineDisplayEntry> = [];

    for (const row of rows) {
      const startsAt: Date | null = readDate(readValue(row, "startsAt"));

      if (!startsAt) {
        continue;
      }

      const state: JSONObject =
        (readValue(row, props.stateColumn) as JSONObject | undefined) || {};
      const stateName: string = state["name"] ? String(state["name"]) : "";
      const user: JSONObject | undefined = readValue(row, "createdByUser") as
        | JSONObject
        | undefined;
      const userName: string = user
        ? String(user["name"] || user["email"] || "")
        : "";

      result.push({
        id: getRowId(row),
        statusKey: state["_id"] ? String(state["_id"]) : stateName,
        /*
         * A status's name as the table's pill showed it: a built-in one in
         * the reader's language, a project's own as it was typed.
         */
        name: stateName
          ? translator.translateText(stateName) || stateName
          : translator.translateText("Unknown status") || "Unknown status",
        color: state["color"]
          ? String(state["color"].toString())
          : DEFAULT_STATUS_COLOR,
        startsAt: startsAt,
        endsAt: readDate(readValue(row, "endsAt")),
        rank: props.getStateRank ? props.getStateRank(state) : undefined,
        changedBy: userName || undefined,
      });
    }

    return result;
  }, [rows, translator.language]);

  const now: Date = OneUptimeDate.getCurrentDate();

  // The record is still open: its current state is not a final one.
  const isRecordOpen: boolean = useMemo(() => {
    const isFinalState: StatusTimelineFinalStateRule | null =
      loaded?.isFinalState || null;

    if (!isFinalState) {
      return false;
    }

    const current: TBaseModel | undefined = rows.find(
      (row: TBaseModel): boolean => {
        return !readValue(row, "endsAt");
      },
    );

    if (!current) {
      return false;
    }

    return !isFinalState(
      (readValue(current, props.stateColumn) as JSONObject | undefined) || {},
    );
  }, [rows, loaded]);

  // The period the band shows.
  const timelineWindow: StatusTimelineWindow = useMemo(() => {
    if (loaded?.window) {
      return loaded.window;
    }

    if (zoom) {
      return zoom;
    }

    return (
      getStatusTimelineFitWindow({
        entries: entries,
        now: now,
        isOpen: isRecordOpen,
      }) || {
        start: OneUptimeDate.addRemoveDays(now, -1),
        end: now,
      }
    );
  }, [loaded, zoom, entries, isRecordOpen]);

  /*
   * Whether anything happened before the period: a row before it, or rows
   * in it older than those loaded. Read off the last load, so the button
   * that would show an empty past is locked rather than leading nowhere.
   * Until the first load has answered, it is not locked.
   */
  const hasEarlierHistory: boolean =
    !loaded ||
    Boolean(loaded.rowBeforeWindow) ||
    loaded.totalCount > loaded.rows.length;

  const loadedFrom: Date | null = useMemo(() => {
    if (!loaded || allRowsLoaded || loaded.rows.length === 0) {
      return null;
    }

    return readDate(
      readValue(loaded.rows[loaded.rows.length - 1]!, "startsAt"),
    );
  }, [loaded, allRowsLoaded]);

  /*
   * A period counted back from now (Past 1 Month) slides along with the
   * clock while the page is open; a whole history fitted up to now grows
   * with it. A custom period, or a zoom, stays where it was put.
   */
  const followsNow: StatusTimelineWindowFollow | undefined = zoom
    ? undefined
    : isRangeMode
      ? range && range.range !== TimeRange.CUSTOM
        ? StatusTimelineWindowFollow.Slide
        : undefined
      : isStatusTimelineWindowAtNow({ window: timelineWindow, now: now })
        ? StatusTimelineWindowFollow.Extend
        : undefined;

  // ---- moving through time -------------------------------------------------
  /*
   * The stretch the band asked for - a drag's as it was dragged, a
   * cluster's with the band's margin around it - at least a minute long and
   * never past now.
   */
  const onZoom: (target: StatusTimelineWindow) => void = (
    target: StatusTimelineWindow,
  ): void => {
    setZoom(
      getStatusTimelineZoomWindow({
        start: target.start,
        end: target.end,
        now: OneUptimeDate.getCurrentDate(),
        paddingRatio: 0,
      }),
    );
  };

  const goTo: (target: StatusTimelineWindow) => void = (
    target: StatusTimelineWindow,
  ): void => {
    setZoom(null);
    setRange({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(target.start, target.end),
    });
  };

  const toolbar: ReactElement = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <StatusTimelineWindowControls
        /*
         * Zoomed in, the picker names the stretch on screen, not the range
         * it was zoomed from.
         */
        range={
          range && zoom
            ? {
                range: TimeRange.CUSTOM,
                startAndEndDate: new InBetween<Date>(zoom.start, zoom.end),
              }
            : range || undefined
        }
        onRangeChange={
          isRangeMode
            ? (next: RangeStartAndEndDateTime) => {
                setZoom(null);
                setRange(next);
              }
            : undefined
        }
        onEarlier={() => {
          goTo(
            shiftStatusTimelineWindow({
              window: timelineWindow,
              direction: -1,
              now: OneUptimeDate.getCurrentDate(),
            }),
          );
        }}
        onLater={() => {
          goTo(
            shiftStatusTimelineWindow({
              window: timelineWindow,
              direction: 1,
              now: OneUptimeDate.getCurrentDate(),
            }),
          );
        }}
        canGoEarlier={hasEarlierHistory}
        canGoLater={
          !isStatusTimelineWindowAtNow({
            window: timelineWindow,
            now: OneUptimeDate.getCurrentDate(),
          })
        }
        isZoomed={Boolean(zoom)}
        onResetZoom={() => {
          setZoom(null);
        }}
        dataTestIdPrefix={props.id}
      />
    </div>
  );

  // ---- permissions, as the table gates them ---------------------------------
  const getGate: (action: ModelAction) => {
    show: boolean;
    disabled: boolean;
    tooltip: string | undefined;
  } = (
    action: ModelAction,
  ): { show: boolean; disabled: boolean; tooltip: string | undefined } => {
    const result: PermissionGateResult = PermissionGate.check(
      model,
      action,
      withPrivateRecordGateOptions(
        {
          singularName: singularName || undefined,
        },
        privateRecordOptions,
      ),
    );

    if (result.isAllowed) {
      return { show: true, disabled: false, tooltip: undefined };
    }

    if (result.disabledReason) {
      return { show: true, disabled: true, tooltip: result.disabledReason };
    }

    return { show: false, disabled: false, tooltip: undefined };
  };

  // ---- the row's actions ---------------------------------------------------
  const readOneColumn: (data: {
    item: TBaseModel;
    column: string;
  }) => Promise<unknown> = async (data: {
    item: TBaseModel;
    column: string;
  }): Promise<unknown> => {
    const row: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
      modelType: props.modelType,
      id: new ObjectID(getRowId(data.item)),
      select: { [data.column]: true } as Select<TBaseModel>,
    });

    return row ? readValue(row, data.column) : undefined;
  };

  const openCause: (item: TBaseModel) => void = (item: TBaseModel): void => {
    if (!props.causeColumn) {
      return;
    }

    setCause({ isLoading: true, text: "" });

    readOneColumn({ item: item, column: props.causeColumn })
      .then((value: unknown) => {
        const noCause: string = props.noCauseText || DEFAULT_NO_CAUSE_TEXT;

        setCause({
          isLoading: false,
          // The cause is what was recorded; only our own words translate.
          text: value
            ? String(value)
            : translator.translateText(noCause) || noCause,
        });
      })
      .catch((err: unknown) => {
        setCause(null);
        setErrorModalText(API.getFriendlyMessage(err));
      });
  };

  const openLogs: (item: TBaseModel) => void = (item: TBaseModel): void => {
    if (!props.logColumn) {
      return;
    }

    setLogs({ isLoading: true, text: "" });

    readOneColumn({ item: item, column: props.logColumn })
      .then((value: unknown) => {
        const noLogs: string = props.noLogsText || DEFAULT_NO_LOGS_TEXT;

        setLogs({
          isLoading: false,
          text: value
            ? JSON.stringify(value, null, 2)
            : translator.translateText(noLogs) || noLogs,
        });
      })
      .catch((err: unknown) => {
        setLogs(null);
        setErrorModalText(API.getFriendlyMessage(err));
      });
  };

  /*
   * An entry's actions are in its ⋯ menu, worded, ordered and locked as
   * the table's row menu words, orders and locks them - all but the one
   * most entries are opened for, View cause, which is a link on the
   * entry's own line (renderEntryInlineAction), where the table had its
   * button: a column of identical buttons down the timeline would be its
   * loudest part, and the same action twice on one entry is noise.
   */
  const actionButtons: Array<ActionButtonSchema<TBaseModel>> = [];

  if (props.showViewIdButton) {
    actionButtons.push({
      title: "Show ID",
      icon: IconProp.Identification,
      buttonStyleType: ButtonStyleType.OUTLINE,
      placement: ActionButtonPlacement.MoreMenu,
      isVisible: (item: TBaseModel): boolean => {
        return hasRecordId(item["_id"]);
      },
      onClick: (item: TBaseModel, onCompleteAction: () => void) => {
        setViewId(getRecordIdText(item["_id"]));
        onCompleteAction();
      },
    });
  }

  if (props.logColumn) {
    actionButtons.push({
      title: "View Logs",
      icon: IconProp.List,
      buttonStyleType: ButtonStyleType.NORMAL,
      placement: ActionButtonPlacement.MoreMenu,
      onClick: (item: TBaseModel, onCompleteAction: () => void) => {
        openLogs(item);
        onCompleteAction();
      },
    });
  }

  const deleteGate: {
    show: boolean;
    disabled: boolean;
    tooltip: string | undefined;
  } = getGate(ModelAction.Delete);

  if (props.isDeleteable && deleteGate.show) {
    actionButtons.push({
      title: "Delete",
      icon: IconProp.Trash,
      buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
      disabled: deleteGate.disabled,
      tooltip: deleteGate.tooltip,
      getDisabledReason: props.getDeleteDisabledReason,
      placement: ActionButtonPlacement.MoreMenu,
      onClick: async (
        item: TBaseModel,
        onCompleteAction: () => void,
        onError: (error: Error) => void,
      ) => {
        try {
          setDeleteConfirmation(
            props.getDeleteConfirmation
              ? await props.getDeleteConfirmation(item)
              : null,
          );
          setItemToDelete(item);
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    });
  }

  const getItemLabel: (item: TBaseModel) => string = (
    item: TBaseModel,
  ): string => {
    return props.getItemName ? props.getItemName(item).trim() : "";
  };

  const deleteItem: () => Promise<void> = async (): Promise<void> => {
    if (!itemToDelete) {
      return;
    }

    setIsDeleting(true);

    try {
      await ModelAPI.deleteItem<TBaseModel>({
        modelType: props.modelType,
        id: new ObjectID(getRowId(itemToDelete)),
      });
      setItemToDelete(null);
      refresh();
    } catch (err) {
      setItemToDelete(null);
      setErrorModalText(API.getFriendlyMessage(err));
    }

    setIsDeleting(false);
  };

  // ---- the card --------------------------------------------------------------
  const createGate: {
    show: boolean;
    disabled: boolean;
    tooltip: string | undefined;
  } = getGate(ModelAction.Create);

  const createButtonTitle: string = translateCreateAction(translator, {
    itemName: singularName,
  });

  const headerButtons: Array<CardButtonSchema | ReactElement> = [];

  if (props.isCreateable && createGate.show) {
    headerButtons.push({
      title: createButtonTitle,
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      buttonSize: ButtonSize.Normal,
      disabled: createGate.disabled,
      tooltip: createGate.tooltip,
      onClick: () => {
        if (!createGate.disabled) {
          setShowCreateModal(true);
        }
      },
    });
  }

  return (
    <>
      <Card
        title={props.title}
        description={props.description}
        rightElement={props.headerElement}
        /*
         * The Create button in sight and Refresh in the ⋯, as every table's
         * header has them (getTableHeaderButtons). Refresh was a loose icon
         * a size smaller than the button beside it.
         */
        buttons={getTableHeaderButtons([
          ...headerButtons,
          {
            ...getRefreshButton(),
            title: "Refresh",
            onClick: refresh,
            disabled: isRefreshing,
          },
        ])}
      >
        <div
          data-testid={props.id}
          aria-busy={isRefreshing || undefined}
          className={`transition-opacity duration-150 ${
            isRefreshing ? "opacity-60" : "opacity-100"
          }`}
        >
          <StatusTimeline
            entries={entries}
            window={timelineWindow}
            isLoading={isLoading}
            error={error && !loaded ? error : undefined}
            onRetry={refresh}
            emptyMessage={props.emptyMessage}
            loadedFrom={loadedFrom}
            hiddenOlderCount={
              loaded ? Math.max(0, loaded.totalCount - loaded.rows.length) : 0
            }
            onLoadOlder={() => {
              void loadOlder();
            }}
            isLoadingOlder={isLoadingOlder}
            onZoom={onZoom}
            toolbar={isRangeMode || zoom ? toolbar : undefined}
            isWindowed={isRangeMode}
            onShowEarlier={
              isRangeMode && hasEarlierHistory
                ? () => {
                    goTo(
                      shiftStatusTimelineWindow({
                        window: timelineWindow,
                        direction: -1,
                        now: OneUptimeDate.getCurrentDate(),
                      }),
                    );
                  }
                : undefined
            }
            emptyAction={
              props.isCreateable && createGate.show ? (
                <Button
                  title={createButtonTitle}
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.NORMAL}
                  disabled={createGate.disabled}
                  tooltip={createGate.tooltip}
                  dataTestId={`${props.id}-empty-create-button`}
                  onClick={() => {
                    setShowCreateModal(true);
                  }}
                />
              ) : undefined
            }
            showShare={props.showShare}
            isWholeHistory={!isRangeMode && !zoom}
            followsNow={followsNow}
            ariaLabel={props.ariaLabel}
            renderEntryActions={(entryId: string): ReactElement | null => {
              const item: TBaseModel | undefined = rowsById.get(entryId);

              if (!item || actionButtons.length === 0) {
                return null;
              }

              return (
                <RowActions<TBaseModel>
                  item={item}
                  actionButtons={actionButtons}
                  itemLabel={getItemLabel(item) || undefined}
                />
              );
            }}
            renderEntryInlineAction={
              props.causeColumn
                ? (entryId: string): ReactElement | null => {
                    const item: TBaseModel | undefined = rowsById.get(entryId);

                    if (!item) {
                      return null;
                    }

                    const name: string = getItemLabel(item);

                    return (
                      <button
                        type="button"
                        className="rounded text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={
                          name
                            ? translator.translateTemplate(
                                "View the cause of {{name}}",
                                { name: name },
                              )
                            : undefined
                        }
                        data-testid={`${props.id}-view-cause`}
                        onClick={() => {
                          openCause(item);
                        }}
                      >
                        {translator.translateText("View cause")}
                      </button>
                    );
                  }
                : undefined
            }
            renderEntryDetails={
              props.renderEntryDetails
                ? (entryId: string): ReactElement | null => {
                    const item: TBaseModel | undefined = rowsById.get(entryId);

                    return item && props.renderEntryDetails
                      ? props.renderEntryDetails(item, refresh)
                      : null;
                  }
                : undefined
            }
          />
          {error && loaded && (
            <p
              className="mt-3 text-xs text-red-700"
              data-testid={`${props.id}-refresh-error`}
            >
              {translator.translateTemplate(
                "Couldn't load this period. {{error}}",
                { error: error },
              )}
            </p>
          )}
        </div>
      </Card>

      {showCreateModal && (
        <ModelFormModal<TBaseModel>
          modelType={props.modelType}
          title={translateNamedAction(translator, {
            template: CREATE_NEW_TEMPLATE,
            itemName: singularName,
          })}
          name={`${props.name} > Create New ${singularName}`}
          submitButtonText={createButtonTitle}
          onClose={() => {
            setShowCreateModal(false);
          }}
          onBeforeCreate={async (item: TBaseModel): Promise<TBaseModel> => {
            return props.onBeforeCreate ? props.onBeforeCreate(item) : item;
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            /*
             * A new status begins now or earlier: show the period up to now
             * it lands in - the page's own period, unzoomed.
             */
            setZoom(null);

            if (props.defaultRange) {
              setRange({ range: props.defaultRange });
            }

            refresh();
          }}
          formProps={{
            name: `create-${props.modelType.name}-from`,
            modelType: props.modelType,
            id: `create-${props.modelType.name}-from`,
            fields: props.formFields || [],
            formType: FormType.Create,
            steps: [],
          }}
        />
      )}

      {itemToDelete && (
        <ConfirmModal
          title={
            deleteConfirmation?.title ||
            translateNamedAction(translator, {
              template: "Delete {{itemName}}",
              itemName: singularName || "Item",
            })
          }
          description={
            deleteConfirmation?.description || (
              <DeleteConfirmationMessage
                kind="question"
                name={getItemLabel(itemToDelete)}
                typeLabel={singularName || "Item"}
                warning={joinSentences(
                  [
                    getDeleteConsequence(model.tableName || "", translator),
                    props.deleteConfirmationWarning
                      ? translator.translateText(
                          props.deleteConfirmationWarning,
                        ) || props.deleteConfirmationWarning
                      : "",
                  ].filter(Boolean),
                )}
              />
            )
          }
          isLoading={isDeleting}
          onClose={() => {
            setItemToDelete(null);
          }}
          submitButtonText={deleteConfirmation?.submitButtonText || "Delete"}
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            void deleteItem();
          }}
        />
      )}

      {errorModalText && (
        <ConfirmModal
          title="Error"
          description={errorModalText}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setErrorModalText("");
          }}
        />
      )}

      {viewId !== null && (
        <RecordIdModal
          recordId={viewId}
          itemName={singularName}
          apiReferencePagePath={getApiReferencePagePath(model, {
            isBillingEnabled: BILLING_ENABLED,
          })}
          onClose={() => {
            setViewId(null);
          }}
        />
      )}

      {cause && (
        <ConfirmModal
          title="Root Cause"
          description={
            <div data-testid={`${props.id}-cause`}>
              {cause.isLoading ? <></> : <MarkdownViewer text={cause.text} />}
            </div>
          }
          isLoading={cause.isLoading}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setCause(null);
          }}
        />
      )}

      {logs && (
        <Modal
          title={props.logsTitle || DEFAULT_LOGS_TITLE}
          description={props.logsDescription}
          isLoading={logs.isLoading}
          modalWidth={ModalWidth.Large}
          submitButtonText="Close"
          submitButtonStyleType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setLogs(null);
          }}
        >
          <SimpleLogViewer
            title={props.logViewerTitle || DEFAULT_LOG_VIEWER_TITLE}
            height="500px"
          >
            {logs.text}
          </SimpleLogViewer>
        </Modal>
      )}
    </>
  );
};

export default ModelStatusTimeline;
