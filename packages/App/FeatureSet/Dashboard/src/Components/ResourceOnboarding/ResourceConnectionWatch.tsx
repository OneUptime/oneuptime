import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectMilestone from "Common/Models/DatabaseModels/ProjectMilestone";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import Route from "Common/Types/API/Route";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import ProjectProducts from "../../Utils/ProjectProducts/ProjectProductsStore";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  RESOURCE_CONNECTION_ALREADY_RECEIVING,
  RESOURCE_CONNECTION_CONNECTED,
  RESOURCE_CONNECTION_DATA_ARRIVED,
  RESOURCE_CONNECTION_DATA_NAMES_NO_SERVICE,
  RESOURCE_CONNECTION_FIRST_DATA_ARRIVED,
  RESOURCE_CONNECTION_POLL_INTERVAL_MS,
  RESOURCE_CONNECTION_WAITING,
  RESOURCE_CONNECTION_WAITING_FOR_NAME,
  SERVICE_NAME_ATTRIBUTE,
  canOnlySpotNewService,
  hasKeySentFirstData,
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
 * one already running would read as the one just added. And registered
 * after the guide opened by the server's own clock: the first look notes
 * the records the project has, and only a newer one counts - so neither one
 * that registered a minute earlier nor a browser clock that is off can pass
 * for the resource just added. A resource the project already had under the
 * guide's name counts once it reports again after the guide looked it up
 * (`existing`), and a record a form added a moment ago (a database, a
 * queue) once its first data is in (`recordId`).
 *
 * A telemetry guide watches its ingestion key too (`ingestionKey`, #7754):
 * telemetry that names no service - FluentBit's logs as the guide
 * configures them, OTLP without service.name - registers none, so the
 * key's first data finishes the step instead, linking to the product's
 * explorer (`dataPage`). A service that registers after that still takes
 * over, with its own link.
 *
 * Only a key's first data counts, so a key that already sends - traces,
 * say, now joined by FluentBit's logs - finishes nothing that way. The
 * guide's signals' first-data marks do (`firstDataMilestones`, #7888): the
 * project's first logs, kept by the server once they are stored, whichever
 * key sent them and whether or not they name a service. The first look
 * notes the marks the project has, and one that arrives after it finishes
 * the step, with the explorer's link. Read before the services, so a
 * service the data names - registered before the data is stored, and so
 * before its mark - wins.
 *
 * The telemetry guided setup alerts on the service that reports, so data
 * alone does not finish its step (`isServiceRequired`): a mark that arrives
 * with no service says the data names none, and how to name one, and the
 * step waits on.
 *
 * A project that has the guide's data already, on a key that sends already
 * - the Logs Setup Guide opened to add a second shipper - has neither a
 * mark nor a key's first data still to come, so data that names no service
 * cannot be told from what came before it (#9456). The step says so: only
 * a new service finishes it, and such data shows in the explorer, which it
 * links to (canOnlySpotNewService).
 *
 * Either moment tells the products menu (#8204), so it does not say
 * "Logs - Not set up" beside a guide that says the data is in: the record
 * that arrived marks its product in use at once (noteRecordFound), and the
 * store asks the server again until the products the guide set up
 * (`products`) are in use - the server keeps the first logs a few seconds
 * after the guide sees them sent (expectProductsInUse).
 */

export interface ExistingRecordSnapshot {
  id: ObjectID;
  // As the server had it when the guide looked the record up.
  lastSeenAt: Date | null;
}

export interface ComponentProps {
  modelType: { new (): BaseModel };
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
  /*
   * The ingestion key the guide's snippets carry: its first data finishes
   * the step too (hasKeySentFirstData), whether or not it names a service.
   */
  ingestionKey?: TelemetryIngestionKey | null | undefined;
  // Where that data shows: the product's explorer, linked as viewText.
  dataPage?: PageMap | undefined;
  // The key's first data arrived; a service may still connect after it.
  onDataArrived?: (() => void) | undefined;
  /*
   * The project's first-data marks of the guide's signals
   * (getFirstDataMilestonesOfProducts): one that arrives after the step
   * first looked is the guide's first data (#7888).
   */
  firstDataMilestones?: ReadonlyArray<ActivationMilestone> | undefined;
  /*
   * Only a service finishes the step: data that names none says so, and
   * how to name one, and the step waits on (the telemetry guided setup).
   */
  isServiceRequired?: boolean | undefined;
  /*
   * The products the guide sets up (Logs for the Logs guide): once its data
   * arrives, the products menu asks until they are in use.
   */
  products?: ReadonlyArray<ProductKey> | undefined;
  /*
   * A link here was followed: a dialog drawn over the page it links to (the
   * explorer the dialog was opened from) closes, as it would not by itself.
   */
  onView?: (() => void) | undefined;
}

interface ConnectedResource {
  id: ObjectID;
  name: string;
}

/*
 * The guide's first data, with no service: the key's first data (its name
 * said), or the project's first data of the guide's signal (no key named).
 */
interface ArrivedData {
  keyName: string | null;
}

// The project's newest records when the step first looked.
interface KnownRecords {
  ids: Set<string>;
  newestCreatedAt: Date | null;
}

/*
 * How many of the newest records the first look notes, and each check
 * reads: more than register in the seconds between two checks.
 */
const RECORDS_PER_CHECK: number = 10;

const getRecordId: (record: BaseModel) => string = (
  record: BaseModel,
): string => {
  return record._id?.toString() || "";
};

const getRecordDate: (record: BaseModel | undefined) => Date | null = (
  record: BaseModel | undefined,
): Date | null => {
  const value: unknown = record?.getColumnValue("createdAt");

  if (!value) {
    return null;
  }

  const date: Date = new Date(value as string | Date);
  return Number.isFinite(date.getTime()) ? date : null;
};

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
  const [arrived, setArrived] = useState<ArrivedData | null>(null);
  // Data arrived that names no service, where only a service will do.
  const [hasDataWithoutService, setHasDataWithoutService] =
    useState<boolean>(false);
  /*
   * The project receives the guide's data already, on the key watched:
   * only a new service is still to come (canOnlySpotNewService).
   */
  const [isOnlyNewServiceToCome, setIsOnlyNewServiceToCome] =
    useState<boolean>(false);

  // The latest name and callback, without restarting the watch on each key.
  const nameRef: MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(props.name);
  nameRef.current = props.name;
  const onConnectedRef: MutableRefObject<
    ((record: BaseModel) => void) | undefined
  > = useRef<((record: BaseModel) => void) | undefined>(props.onConnected);
  onConnectedRef.current = props.onConnected;
  const onDataArrivedRef: MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(props.onDataArrived);
  onDataArrivedRef.current = props.onDataArrived;
  const keyNameRef: MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(props.ingestionKey?.name);
  keyNameRef.current = props.ingestionKey?.name;
  const productsRef: MutableRefObject<ReadonlyArray<ProductKey>> = useRef<
    ReadonlyArray<ProductKey>
  >(props.products || []);
  productsRef.current = props.products || [];
  const firstDataMilestonesRef: MutableRefObject<
    ReadonlyArray<ActivationMilestone>
  > = useRef<ReadonlyArray<ActivationMilestone>>(
    props.firstDataMilestones || [],
  );
  firstDataMilestonesRef.current = props.firstDataMilestones || [];
  const isServiceRequiredRef: MutableRefObject<boolean> = useRef<boolean>(
    Boolean(props.isServiceRequired),
  );
  isServiceRequiredRef.current = Boolean(props.isServiceRequired);
  /*
   * The first-data marks the project had when the step first looked, and
   * whether one has arrived since: kept across the checks, as knownRef is.
   */
  const firstDataLookRef: MutableRefObject<Set<string> | null> =
    useRef<Set<string> | null>(null);
  // Every one of the guide's marks was kept at that first look.
  const hadEveryMarkAtFirstLookRef: MutableRefObject<boolean | null> = useRef<
    boolean | null
  >(null);
  const hasFirstDataArrivedRef: MutableRefObject<boolean> =
    useRef<boolean>(false);
  // The guide's first data was said: the products told, the callback called.
  const hasToldDataArrivedRef: MutableRefObject<boolean> =
    useRef<boolean>(false);
  // The resource connected: the page told.
  const hasConnectedRef: MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * The products menu hears the moment (#8204): the record that arrived is
   * there, so its product is in use; the products the guide set up are
   * about to be.
   */
  const tellProducts: (record: BaseModel | null) => void = (
    record: BaseModel | null,
  ): void => {
    try {
      if (record?.tableName) {
        ProjectProducts.noteRecordFound({
          tableName: record.tableName,
          projectId: null,
        });
      }

      ProjectProducts.expectProductsInUse({ products: productsRef.current });
    } catch {
      // The menu catches up on its next look; the guide goes on.
    }
  };
  /*
   * The guide's first data, with no service (yet): said once - the
   * products menu told, the page's callback called. The key's own sentence
   * names it; the first-data mark's does not know which key sent it.
   */
  const dataArrived: (data: ArrivedData) => void = (
    data: ArrivedData,
  ): void => {
    if (hasToldDataArrivedRef.current) {
      return;
    }

    hasToldDataArrivedRef.current = true;
    tellProducts(null);

    if (isServiceRequiredRef.current) {
      setHasDataWithoutService(true);
      return;
    }

    setArrived(data);
    onDataArrivedRef.current?.();
  };

  /*
   * Kept across the checks, and across a new name or a new existing record:
   * what the project had when the step first looked.
   */
  const knownRef: MutableRefObject<KnownRecords | null> =
    useRef<KnownRecords | null>(null);
  /*
   * Each key's lastUsedAt when the step first looked at it, kept across a
   * change of key: going back to one keeps what it had sent then.
   */
  const keyFirstLooksRef: MutableRefObject<Map<string, Date | string | null>> =
    useRef<Map<string, Date | string | null>>(
      new Map<string, Date | string | null>(),
    );
  const ingestionKeyId: string | undefined =
    props.ingestionKey?.id?.toString() || undefined;
  const ingestionKeyIdRef: MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(ingestionKeyId);
  ingestionKeyIdRef.current = ingestionKeyId;

  /*
   * Whether only a new service is still to come, once the first looks are
   * in: the marks', and the watched key's.
   */
  const noteWhatIsStillToCome: () => void = (): void => {
    const keyId: string | undefined = ingestionKeyIdRef.current;

    setIsOnlyNewServiceToCome(
      canOnlySpotNewService({
        hadEveryMarkAtFirstLook: hadEveryMarkAtFirstLookRef.current,
        isWatchingKey: Boolean(keyId),
        keyLastUsedAtFirstLook:
          keyId && keyFirstLooksRef.current.has(keyId)
            ? keyFirstLooksRef.current.get(keyId)
            : undefined,
      }),
    );
  };

  // Another key watched: what it had sent decides again.
  useEffect(() => {
    noteWhatIsStillToCome();
  }, [ingestionKeyId]);

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

    const select: Select<BaseModel> = {
      _id: true,
      name: true,
      [nameField]: true,
      lastSeenAt: true,
      createdAt: true,
    } as Select<BaseModel>;

    /*
     * Once: two checks in flight together (a slow answer outlasting the
     * interval) both find the record, and the page hears of it once.
     */
    const found: (record: BaseModel) => void = (record: BaseModel): void => {
      if (!isMounted || hasConnectedRef.current) {
        return;
      }
      hasConnectedRef.current = true;
      tellProducts(record);
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

    /*
     * A record a form added: its first data. It was saved a moment ago with
     * nothing seen yet, so any value at all is that data.
     */
    const checkRecord: (recordId: ObjectID) => Promise<boolean> = async (
      recordId: ObjectID,
    ): Promise<boolean> => {
      const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: props.modelType,
        query: {
          _id: recordId,
          [seenField]: new NotNull(),
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

    /*
     * Registered since the step first looked, newest first. That first look
     * only notes what the project has: the newest records, and when the
     * newest of them was created. Each check after it reads from that
     * moment on - the server's createdAt against the server's - and leaves
     * out the records it noted.
     */
    const checkNew: () => Promise<boolean> = async (): Promise<boolean> => {
      const known: KnownRecords | null = knownRef.current;

      const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: props.modelType,
        query: {
          ...(props.query || {}),
          ...(known?.newestCreatedAt
            ? {
                createdAt: new GreaterThanOrEqual<Date>(known.newestCreatedAt),
              }
            : {}),
        } as Query<BaseModel>,
        select: select,
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: RECORDS_PER_CHECK,
        skip: 0,
      });

      if (!known) {
        knownRef.current = {
          ids: new Set<string>(result.data.map(getRecordId)),
          newestCreatedAt: getRecordDate(result.data[0]),
        };
        return false;
      }

      const record: BaseModel | undefined = pickConnectedRecord<BaseModel>({
        records: result.data.filter((item: BaseModel): boolean => {
          return !known.ids.has(getRecordId(item));
        }),
        name: nameRef.current,
        getName: (item: BaseModel): string | undefined => {
          return getRecordName(item, nameField);
        },
        isNameTaken: Boolean(existingId),
      });

      if (record) {
        found(record);
        return true;
      }
      return false;
    };

    /*
     * The guide's signals' first-data marks: whether one arrived since the
     * step first looked (that first look only notes them). A read that
     * fails says no, and the services are checked all the same.
     */
    const checkFirstData: () => Promise<boolean> =
      async (): Promise<boolean> => {
        const milestones: ReadonlyArray<ActivationMilestone> =
          firstDataMilestonesRef.current;

        if (milestones.length === 0) {
          return false;
        }

        if (hasFirstDataArrivedRef.current) {
          return true;
        }

        try {
          const result: ListResult<ProjectMilestone> =
            await ModelAPI.getList<ProjectMilestone>({
              modelType: ProjectMilestone,
              query: {
                milestone: new Includes([...milestones]),
              },
              select: { _id: true, milestone: true },
              sort: {},
              limit: milestones.length,
              skip: 0,
            });

          const reached: Set<string> = new Set<string>(
            result.data.map((mark: ProjectMilestone): string => {
              return String(mark.milestone || "");
            }),
          );
          const firstLook: Set<string> | null = firstDataLookRef.current;

          if (!firstLook) {
            firstDataLookRef.current = reached;
            hadEveryMarkAtFirstLookRef.current = milestones.every(
              (milestone: ActivationMilestone): boolean => {
                return reached.has(milestone);
              },
            );

            if (isMounted) {
              noteWhatIsStillToCome();
            }

            return false;
          }

          hasFirstDataArrivedRef.current = Array.from(reached).some(
            (milestone: string): boolean => {
              return milestone.length > 0 && !firstLook.has(milestone);
            },
          );

          return hasFirstDataArrivedRef.current;
        } catch {
          return false;
        }
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

        // First: a service the data names is registered before its mark.
        const hasFirstData: boolean = await checkFirstData();

        if (await checkNew()) {
          return;
        }

        if (existingId && (await checkExisting(existingId))) {
          return;
        }

        if (hasFirstData && isMounted) {
          dataArrived({ keyName: null });
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
    props.recordId?.toString(),
    props.seenField,
    existingId,
    existingLastSeenAt,
    JSON.stringify(props.query || {}),
  ]);

  /*
   * The guide's key: the first look notes what it had sent, and a check
   * after it finds its first data. Done once that arrives, or once a
   * service connects first; the services are checked on until one does.
   */
  useEffect(() => {
    if (connected || arrived || hasDataWithoutService || !ingestionKeyId) {
      return;
    }

    let isMounted: boolean = true;
    const keyId: string = ingestionKeyId;

    const checkKey: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<TelemetryIngestionKey> =
          await ModelAPI.getList<TelemetryIngestionKey>({
            modelType: TelemetryIngestionKey,
            query: { _id: new ObjectID(keyId) },
            select: { _id: true, name: true, lastUsedAt: true },
            sort: {},
            limit: 1,
            skip: 0,
          });

        const key: TelemetryIngestionKey | undefined = result.data[0];

        if (!isMounted || !key) {
          return;
        }

        const firstLooks: Map<string, Date | string | null> =
          keyFirstLooksRef.current;

        if (!firstLooks.has(keyId)) {
          firstLooks.set(keyId, key.lastUsedAt || null);
          noteWhatIsStillToCome();
          return;
        }

        if (
          hasKeySentFirstData({
            lastUsedAtThen: firstLooks.get(keyId),
            lastUsedAtNow: key.lastUsedAt,
          })
        ) {
          dataArrived({ keyName: key.name || keyNameRef.current || "" });
        }
      } catch {
        // A failed check waits for the next one; the step keeps waiting.
      }
    };

    void checkKey();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void checkKey();
    }, RESOURCE_CONNECTION_POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [connected, arrived, hasDataWithoutService, ingestionKeyId]);

  // The step done: what arrived, and a link to it.
  const renderDone: (data: {
    sentence: ReactElement;
    route: Route | null;
    dataTestId: string;
  }) => ReactElement = (data: {
    sentence: ReactElement;
    route: Route | null;
    dataTestId: string;
  }): ReactElement => {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        role="status"
        aria-live="polite"
        data-testid={data.dataTestId}
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
            {data.sentence}
          </span>
          {data.route ? (
            <AppLink
              to={data.route}
              className="font-medium text-emerald-700 underline hover:text-emerald-900"
              onNavigateComplete={props.onView}
            >
              {translator.translateText(props.viewText) || props.viewText}
            </AppLink>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  };

  /*
   * The guide's first data, and no service has connected: the key's (it
   * names none), or the project's first data of the guide's signal.
   */
  if (!connected && arrived) {
    return renderDone({
      dataTestId: "resource-connection-data-arrived",
      route: props.dataPage
        ? RouteUtil.populateRouteParams(RouteMap[props.dataPage] as Route)
        : null,
      sentence:
        arrived.keyName === null ? (
          <span data-testid="resource-connection-first-data">
            {translator.translateText(RESOURCE_CONNECTION_FIRST_DATA_ARRIVED)}
          </span>
        ) : (
          <TranslatedSentence
            template={RESOURCE_CONNECTION_DATA_ARRIVED}
            slots={{
              name: (
                <span className="font-semibold" data-testid="arrived-key-name">
                  {arrived.keyName}
                </span>
              ),
            }}
          />
        ),
    });
  }

  /*
   * Data arrived that names no service, where only a service finishes the
   * step: what to do, in amber, while the step keeps waiting.
   */
  if (!connected && hasDataWithoutService) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        role="status"
        aria-live="polite"
        data-testid="resource-connection-waiting"
      >
        <span className="relative mt-1.5 flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
        </span>
        <span
          className="min-w-0 break-words"
          data-testid="resource-connection-names-no-service"
        >
          <TranslatedSentence
            template={RESOURCE_CONNECTION_DATA_NAMES_NO_SERVICE}
            slots={{
              attribute: (
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs text-amber-900">
                  {SERVICE_NAME_ATTRIBUTE}
                </code>
              ),
            }}
          />
        </span>
      </div>
    );
  }

  /*
   * The project receives the guide's data already, on the key watched: the
   * step waits for a new service, and says where data that names none
   * shows (#9456), instead of waiting for "the first data" for good.
   */
  if (
    !connected &&
    isOnlyNewServiceToCome &&
    !props.isServiceRequired &&
    !props.name
  ) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
        role="status"
        aria-live="polite"
        data-testid="resource-connection-waiting"
      >
        <span className="relative mt-1.5 flex h-2.5 w-2.5 flex-shrink-0">
          {/* The dot's own indigo: a mid-tone reads the same in the dark theme. */}
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
        </span>
        {/*
         * The sentence keeps at least 14rem, as the step's other lines do:
         * in a narrow box the link goes under it.
         */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span
            className="min-w-0 flex-1 basis-56 break-words"
            data-testid="resource-connection-already-receiving"
          >
            {translator.translateText(RESOURCE_CONNECTION_ALREADY_RECEIVING)}
          </span>
          {props.dataPage ? (
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[props.dataPage] as Route,
              )}
              className="font-medium text-indigo-600 underline hover:text-indigo-800"
              onNavigateComplete={props.onView}
            >
              {translator.translateText(props.viewText) || props.viewText}
            </AppLink>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  }

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

  return renderDone({
    dataTestId: "resource-connection-connected",
    route: RouteUtil.populateRouteParams(RouteMap[props.viewPage] as Route, {
      modelId: connected.id,
    }),
    sentence: (
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
    ),
  });
};

export default ResourceConnectionWatch;
