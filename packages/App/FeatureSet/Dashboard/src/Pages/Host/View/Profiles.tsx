import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ProfileTable from "../../../Components/Profiles/ProfileTable";
import AggregatedFlamegraph from "../../../Components/Profiles/AggregatedFlamegraph";
import ProfileTypeSelector from "../../../Components/Profiles/ProfileTypeSelector";
import Query from "Common/Types/BaseDatabase/Query";
import Profile from "Common/Models/AnalyticsModels/Profile";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";

/** Each selectable time-range chip above the aggregate flame graph. */
interface TimeRange {
  label: string;
  minutes: number;
}

/*
 * Same presets and defaults as the profiler home page so the two
 * surfaces feel like one product: 1h is wide enough to smooth sampling
 * noise, narrow enough that the graph still answers "what is this
 * host doing right now?".
 */
const TIME_RANGES: Array<TimeRange> = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "24h", minutes: 60 * 24 },
  { label: "7d", minutes: 60 * 24 * 7 },
];

const DEFAULT_RANGE_MINUTES: number = 60;
const DEFAULT_PROFILE_TYPE: string = "cpu";

const HostProfiles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rangeMinutes, setRangeMinutes] = useState<number>(
    DEFAULT_RANGE_MINUTES,
  );
  const [profileType, setProfileType] = useState<string | undefined>(
    DEFAULT_PROFILE_TYPE,
  );

  /*
   * A single memoised (startTime, endTime) pair so the flame graph
   * fetch only re-fires when the user actually picks a different
   * range — recomputing Date objects every render would otherwise
   * look like a new window each time.
   */
  const { startTime, endTime } = useMemo(() => {
    const now: Date = OneUptimeDate.getCurrentDate();
    return {
      startTime: OneUptimeDate.addRemoveMinutes(now, -rangeMinutes),
      endTime: now,
    };
  }, [rangeMinutes]);

  /*
   * Host-level eBPF profiles (no service.name on the batch) are routed
   * to the Host row at ingest, so primaryEntityId IS this Host's id —
   * exactly the column the aggregate flamegraph endpoint filters on
   * via serviceIds (see OtelIngestBaseService.selectPrimaryEntity).
   */
  const flamegraphServiceIds: Array<ObjectID> = useMemo(() => {
    return [modelId];
  }, [modelId.toString()]);

  const [host, setHost] = useState<Host | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const profileQuery: Query<Profile> = useMemo(() => {
    /*
     * `any` sidesteps a TS2589 deep-instantiation on Query<Profile>:
     * "entityScope" is a synthetic query key the Query generic does not
     * model — same workaround the Host/Docker logs pages use.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {};
    /*
     * entityScope is the sole scope predicate (contract C4 — compiled by
     * StatementGenerator to hasAny(entityKeys, [...]) OR the attribute
     * equality): new rows ride the bloom-indexed `entityKeys` membership
     * column, pre-column rows (no backfill, empty array) still match via
     * the attribute fallback inside the same OR. Do not AND a separate
     * `attributes` equality on top — that collapses the OR to the
     * attribute side and turns the indexed path into dead weight. Drop
     * the attributeKey/attributeValue fallback once deploy-date + max
     * retention has passed.
     */
    if (host?.hostIdentifier) {
      q["entityScope"] = {
        entityKeys: [
          keyForHost(
            ProjectUtil.getCurrentProjectId()!.toString(),
            host.hostIdentifier,
          ),
        ],
        attributeKey: "resource.host.name",
        attributeValue: host.hostIdentifier,
      };
    }
    return q as Query<Profile>;
  }, [host?.hostIdentifier]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host?.hostIdentifier) {
    return <ErrorMessage message="Host not found." />;
  }

  return (
    <Fragment>
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Where the time is going
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Every profile captured on this host in the window, merged into one
              view. Click a frame to zoom in.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                Time window
              </div>
              <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
                {TIME_RANGES.map((r: TimeRange) => {
                  const active: boolean = rangeMinutes === r.minutes;
                  return (
                    <button
                      key={r.label}
                      type="button"
                      onClick={() => {
                        setRangeMinutes(r.minutes);
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        active
                          ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                What to analyze
              </div>
              <ProfileTypeSelector
                selectedProfileType={profileType}
                onChange={setProfileType}
              />
            </div>
          </div>
        </div>
        <AggregatedFlamegraph
          startTime={startTime}
          endTime={endTime}
          serviceIds={flamegraphServiceIds}
          profileType={profileType}
        />
      </div>
      <ProfileTable
        profileQuery={profileQuery}
        noItemsMessage="No performance profiles found for this host."
      />
    </Fragment>
  );
};

export default HostProfiles;
