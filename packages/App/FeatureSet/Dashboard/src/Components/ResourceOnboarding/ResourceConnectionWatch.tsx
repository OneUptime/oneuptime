import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  RESOURCE_CONNECTION_CONNECTED,
  RESOURCE_CONNECTION_POLL_INTERVAL_MS,
  RESOURCE_CONNECTION_WAITING,
  RESOURCE_CONNECTION_WAITING_FOR_NAME,
  getResourceConnectionWatchStart,
  hasReportedSince,
  pickConnectedRecord,
} from "./ResourceOnboarding";

/*
 * The last step of an Add guide: waiting for the resource. Every few
 * seconds it asks for one that registered since the guide opened - ingest
 * creates the record when the first data arrives - and says so when one
 * does, with a link to it. The same moment the agent's own logs show, seen
 * from OneUptime.
 *
 * Registered, not merely reporting: every connected resource reports, and
 * one already running would read as the one just added. So a resource the
 * project already had under the guide's name counts only once it reports
 * again after the guide looked it up (`existing`), and a record added by a
 * form a moment ago (a database, a queue) counts once its first data is in
 * (`recordId`).
 */

export interface ExistingRecordSnapshot {
  id: ObjectID;
  // As the server had it when the guide looked the record up.
  lastSeenAt: Date | null;
}

export interface ComponentProps {
  modelType: { new (): BaseModel };
  // When the guide opened.
  since: Date;
  // The name the guide installs with: the record of that name wins.
  name?: string | undefined;
  // The column that name lands in ("clusterIdentifier", "name").
  nameField?: string | undefined;
  // What every record of the list has too (a cloud environment's kind).
  query?: Query<BaseModel> | undefined;
  // The project's record of the guide's name, while it was not reporting.
  existing?: ExistingRecordSnapshot | undefined;
  // Only this record: one a form added a moment ago.
  recordId?: ObjectID | undefined;
  /*
   * When that record's data counts as arrived: "lastSeenAt" unless the
   * guide sets up one source of it - a database's engine metrics
   * ("collectorLastSeenAt"), which its applications' traces do not move.
   */
  seenField?: string | undefined;
  viewPage: PageMap;
  // English: "View cluster".
  viewText: string;
  onConnected?: ((record: BaseModel) => void) | undefined;
}

interface ConnectedResource {
  id: ObjectID;
  name: string;
}

const getRecordName: (
  record: BaseModel,
  field: string | undefined,
) => string | undefined = (
  record: BaseModel,
  field: string | undefined,
): string | undefined => {
  const value: unknown = record.getColumnValue(field || "name");
  return typeof value === "string" ? value : undefined;
};

const ResourceConnectionWatch: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [connected, setConnected] = useState<ConnectedResource | null>(null);

  // The latest name and callback, without restarting the watch on each key.
  const nameRef: MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(props.name);
  nameRef.current = props.name;
  const onConnectedRef: MutableRefObject<
    ((record: BaseModel) => void) | undefined
  > = useRef<((record: BaseModel) => void) | undefined>(props.onConnected);
  onConnectedRef.current = props.onConnected;

  const existingId: string | undefined = props.existing?.id.toString();
  const existingLastSeenAt: number | undefined =
    props.existing?.lastSeenAt?.getTime();

  useEffect(() => {
    if (connected) {
      return;
    }

    let isMounted: boolean = true;
    const nameField: string = props.nameField || "name";
    const seenField: string = props.seenField || "lastSeenAt";
    const start: Date = getResourceConnectionWatchStart(props.since);

    const select: Select<BaseModel> = {
      _id: true,
      name: true,
      [nameField]: true,
      lastSeenAt: true,
    } as Select<BaseModel>;

    const found: (record: BaseModel) => void = (record: BaseModel): void => {
      if (!isMounted) {
        return;
      }
      setConnected({
        id: new ObjectID(record._id as string),
        name:
          getRecordName(record, "name") ||
          getRecordName(record, nameField) ||
          nameRef.current ||
          "",
      });
      onConnectedRef.current?.(record);
    };

    // A record a form added: its first data.
    const checkRecord: (recordId: ObjectID) => Promise<boolean> = async (
      recordId: ObjectID,
    ): Promise<boolean> => {
      const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: props.modelType,
        query: {
          _id: recordId,
          [seenField]: new GreaterThanOrEqual<Date>(start),
        } as Query<BaseModel>,
        select: select,
        sort: {},
        limit: 1,
        skip: 0,
      });

      const record: BaseModel | undefined = result.data[0];
      if (record) {
        found(record);
        return true;
      }
      return false;
    };

    // Registered since the guide opened, newest first.
    const checkNew: () => Promise<boolean> = async (): Promise<boolean> => {
      const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: props.modelType,
        query: {
          ...(props.query || {}),
          createdAt: new GreaterThanOrEqual<Date>(start),
        } as Query<BaseModel>,
        select: select,
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: 10,
        skip: 0,
      });

      const record: BaseModel | undefined = pickConnectedRecord<BaseModel>({
        records: result.data,
        name: nameRef.current,
        getName: (item: BaseModel): string | undefined => {
          return getRecordName(item, nameField);
        },
      });

      if (record) {
        found(record);
        return true;
      }
      return false;
    };

    // The project's record of that name, reporting again.
    const checkExisting: (id: string) => Promise<boolean> = async (
      id: string,
    ): Promise<boolean> => {
      const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: props.modelType,
        query: { _id: new ObjectID(id) } as Query<BaseModel>,
        select: select,
        sort: {},
        limit: 1,
        skip: 0,
      });

      const record: BaseModel | undefined = result.data[0];
      const lastSeenAtNow: unknown = record?.getColumnValue("lastSeenAt");

      if (
        record &&
        hasReportedSince({
          lastSeenAtThen:
            existingLastSeenAt === undefined
              ? null
              : new Date(existingLastSeenAt),
          lastSeenAtNow: lastSeenAtNow as Date | string | null | undefined,
        })
      ) {
        found(record);
        return true;
      }
      return false;
    };

    const check: () => Promise<void> = async (): Promise<void> => {
      try {
        if (props.recordId) {
          await checkRecord(props.recordId);
          return;
        }

        if (await checkNew()) {
          return;
        }

        if (existingId) {
          await checkExisting(existingId);
        }
      } catch {
        // A failed check waits for the next one; the step keeps waiting.
      }
    };

    void check();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void check();
    }, RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [
    connected,
    props.since,
    props.recordId?.toString(),
    props.seenField,
    existingId,
    existingLastSeenAt,
    JSON.stringify(props.query || {}),
  ]);

  if (!connected) {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
        role="status"
        aria-live="polite"
        data-testid="resource-connection-waiting"
      >
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          {/* The dot's own indigo: a mid-tone reads the same in the dark theme. */}
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
        </span>
        <span className="min-w-0 break-words">
          {props.name ? (
            <TranslatedSentence
              template={RESOURCE_CONNECTION_WAITING_FOR_NAME}
              slots={{
                name: (
                  <span
                    className="font-semibold text-gray-800"
                    data-testid="resource-connection-waiting-name"
                  >
                    {props.name}
                  </span>
                ),
              }}
            />
          ) : (
            translator.translateText(RESOURCE_CONNECTION_WAITING)
          )}
        </span>
      </div>
    );
  }

  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[props.viewPage] as Route,
    { modelId: connected.id },
  );

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      role="status"
      aria-live="polite"
      data-testid="resource-connection-connected"
    >
      <Icon
        icon={IconProp.CheckCircle}
        className="h-5 w-5 flex-shrink-0 text-emerald-600"
      />
      {/*
       * The sentence keeps at least 14rem: in a narrow box (a phone) the
       * link goes under it, lined up with it, instead of squeezing it into a
       * column a word wide.
       */}
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 basis-56 break-words">
          <TranslatedSentence
            template={RESOURCE_CONNECTION_CONNECTED}
            slots={{
              name: (
                <span
                  className="font-semibold"
                  data-testid="connected-resource-name"
                >
                  {connected.name}
                </span>
              ),
            }}
          />
        </span>
        <AppLink
          to={route}
          className="font-medium text-emerald-700 underline hover:text-emerald-900"
        >
          {translator.translateText(props.viewText) || props.viewText}
        </AppLink>
      </div>
    </div>
  );
};

export default ResourceConnectionWatch;
