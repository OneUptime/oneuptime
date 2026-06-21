import AggregatedFlamegraph from "../../../Components/Profiles/AggregatedFlamegraph";
import ProfileTable from "../../../Components/Profiles/ProfileTable";
import ProfileTypeSelector from "../../../Components/Profiles/ProfileTypeSelector";
import PageComponentProps from "../../PageComponentProps";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/** Each selectable time-range chip above the aggregate flame graph. */
interface TimeRange {
  label: string;
  minutes: number;
}

/*
 * Same presets and defaults as the profiler home page so the two
 * surfaces feel like one product: 1h is wide enough to smooth sampling
 * noise, narrow enough that the graph still answers "what is this
 * service doing right now?".
 */
const TIME_RANGES: Array<TimeRange> = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "24h", minutes: 60 * 24 },
  { label: "7d", minutes: 60 * 24 * 7 },
];

const DEFAULT_RANGE_MINUTES: number = 60;
const DEFAULT_PROFILE_TYPE: string = "cpu";

const ServiceProfiles: FunctionComponent<
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
   * Profiles ingested with an explicit service.name carry this Service
   * row's id as primaryEntityId, which is exactly the column the
   * aggregate flamegraph endpoint filters on via serviceIds — so the
   * graph and the table below describe the same set of profiles.
   */
  const serviceIds: Array<ObjectID> = useMemo(() => {
    return [modelId];
  }, [modelId.toString()]);

  return (
    <Fragment>
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Where the time is going
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Every profile captured for this service in the window, merged into
              one view. Click a frame to zoom in.
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
          serviceIds={serviceIds}
          profileType={profileType}
        />
      </div>
      <ProfileTable
        modelId={modelId}
        noItemsMessage="No profiles found for this service."
      />
    </Fragment>
  );
};

export default ServiceProfiles;
