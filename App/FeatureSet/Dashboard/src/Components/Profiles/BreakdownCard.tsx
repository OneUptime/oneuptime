import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProfileUtil from "../../Utils/ProfileUtil";

export interface BreakdownCardProps {
  startTime: Date;
  endTime: Date;
  profileType?: string | undefined;
  serviceIds?: Array<ObjectID> | undefined;
}

/** One row from /telemetry/profiles/breakdown. */
interface BreakdownItem {
  value: string;
  sampleCount: number;
  profileCount: number;
  share: number;
}

/*
 * Sentinel value for the dimension select. "service" groups by
 * primaryEntityId server-side; any other value is treated as a
 * Profile attribute key.
 */
const SERVICE_BREAKDOWN_KEY: string = "service";

/*
 * How many slices to ask the server for. Ten covers the "did one
 * deploy / pod / version eat the window?" question without turning
 * the card into a table.
 */
const BREAKDOWN_LIMIT: number = 10;

/**
 * "Break down by" card: splits the samples in the current window
 * along one dimension (service, or any Profile attribute such as a
 * version or pod label) and shows each slice's share as a horizontal
 * bar. The point is deploy triage — when one slice dominates, that
 * is where to look first.
 */
const BreakdownCard: FunctionComponent<BreakdownCardProps> = (
  props: BreakdownCardProps,
): ReactElement => {
  const [breakdownBy, setBreakdownBy] = useState<string>(SERVICE_BREAKDOWN_KEY);
  const [items, setItems] = useState<Array<BreakdownItem>>([]);
  const [totalSampleCount, setTotalSampleCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  /*
   * Retry nonce: bumping it re-runs the fetch effect even though no
   * scope input changed — the effect deps are all value-compared.
   */
  const [nonce, setNonce] = useState<number>(0);

  /*
   * Attribute keys for the dimension select. Fetched lazily the first
   * time the user opens the select — most visits never leave the
   * default "by Service" view, so eagerly loading attributes would be
   * a wasted ClickHouse query on every page load.
   */
  const [attributes, setAttributes] = useState<Array<string>>([]);
  const [attributesLoaded, setAttributesLoaded] = useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] = useState<boolean>(false);

  /*
   * primaryEntityId -> service name. Loaded once; failure is
   * non-fatal — rows then fall back to a short id, which still lets
   * the user compare slices.
   */
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      try {
        const servicesResult: { data: Array<Service> } = await ModelAPI.getList(
          {
            modelType: Service,
            query: { projectId: ProjectUtil.getCurrentProjectId()! },
            select: { name: true },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: { name: SortOrder.Ascending },
          },
        );
        if (cancelled) {
          return;
        }
        const next: Record<string, string> = {};
        for (const svc of servicesResult.data || []) {
          const id: string = svc.id?.toString() || "";
          if (id && svc.name) {
            next[id] = svc.name;
          }
        }
        setServiceNames(next);
      } catch {
        // Non-fatal — slices fall back to short ids.
        if (!cancelled) {
          setServiceNames({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAttributes: () => Promise<void> = async (): Promise<void> => {
    if (attributesLoading || attributesLoaded) {
      return;
    }
    try {
      setAttributesLoading(true);
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/profiles/get-attributes",
          ),
          data: {},
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
      setAttributes((response.data["attributes"] || []) as Array<string>);
      setAttributesLoaded(true);
    } catch {
      /*
       * Non-fatal — the select simply keeps offering "by Service".
       * The flag stays false so the next open retries.
       */
      setAttributes([]);
    } finally {
      setAttributesLoading(false);
    }
  };

  useEffect(() => {
    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError("");

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/profiles/breakdown",
            ),
            data: {
              startTime: props.startTime.toISOString(),
              endTime: props.endTime.toISOString(),
              breakdownBy: breakdownBy,
              serviceIds: props.serviceIds?.map((id: ObjectID) => {
                return id.toString();
              }),
              profileType: props.profileType,
              /*
               * Expand the UI selection (category or raw type) to the
               * raw type strings agents actually emit, so the server
               * filters with IN (...) instead of a literal equality
               * that would miss rows.
               */
              profileTypes: ProfileUtil.getQueryProfileTypes(props.profileType),
              limit: BREAKDOWN_LIMIT,
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (cancelled) {
          return;
        }
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setItems(
          (response.data["items"] || []) as unknown as Array<BreakdownItem>,
        );
        setTotalSampleCount(Number(response.data["totalSampleCount"]) || 0);
      } catch (err) {
        if (!cancelled) {
          setItems([]);
          setTotalSampleCount(0);
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    // Dates compared by epoch millis — never by object identity.
    props.startTime.getTime(),
    props.endTime.getTime(),
    breakdownBy,
    props.profileType,
    // serviceIds intentionally re-joined to compare by value.
    (props.serviceIds || [])
      .map((i: ObjectID) => {
        return i.toString();
      })
      .join(","),
    nonce,
  ]);

  /*
   * Resolve the display label for a slice. Service slices carry the
   * primaryEntityId — map it to the service's name, falling back to a
   * short id so the row is still distinguishable when the lookup has
   * nothing (e.g. host-level profiles whose ids are not Service rows).
   */
  const resolveLabel: (item: BreakdownItem) => string = (
    item: BreakdownItem,
  ): string => {
    if (breakdownBy !== SERVICE_BREAKDOWN_KEY) {
      return item.value || "(empty)";
    }
    if (!item.value) {
      return "(unknown)";
    }
    return serviceNames[item.value] || item.value.substring(0, 8);
  };

  /*
   * Bars scale to the largest slice (not to 100%) so relative sizes
   * stay readable even when no slice dominates the window. The share
   * number next to each bar remains the honest 0-100 value.
   */
  const maxSampleCount: number = items.reduce(
    (acc: number, item: BreakdownItem) => {
      return Math.max(acc, item.sampleCount);
    },
    0,
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Breakdown</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Share of samples in the window — a value that dominates here is
            where to look first.
          </p>
        </div>
        <select
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={breakdownBy}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setBreakdownBy(e.target.value);
          }}
          onFocus={() => {
            void loadAttributes();
          }}
          onMouseDown={() => {
            void loadAttributes();
          }}
        >
          <option value={SERVICE_BREAKDOWN_KEY}>by Service</option>
          {attributes.map((attribute: string) => {
            return (
              <option key={attribute} value={attribute}>
                by {attribute}
              </option>
            );
          })}
          {attributesLoading && (
            <option disabled={true}>Loading attributes…</option>
          )}
        </select>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i: number) => {
            return (
              <div
                key={i}
                className="h-9 animate-pulse rounded-md border border-gray-100 bg-gray-50"
              />
            );
          })}
        </div>
      )}

      {!isLoading && error && (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setNonce((n: number) => {
              return n + 1;
            });
          }}
        />
      )}

      {!isLoading && !error && items.length === 0 && (
        <p className="py-6 text-center text-xs text-gray-500">
          No data to break down in this window.
        </p>
      )}

      {!isLoading && !error && items.length > 0 && (
        <div className="divide-y divide-gray-100">
          {items.map((item: BreakdownItem, index: number) => {
            const barPct: number =
              maxSampleCount > 0
                ? (item.sampleCount / maxSampleCount) * 100
                : 0;
            return (
              <div key={`${item.value}-${index}`} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="min-w-0 truncate text-sm font-medium text-gray-900"
                    title={
                      breakdownBy === SERVICE_BREAKDOWN_KEY
                        ? item.value
                        : undefined
                    }
                  >
                    {resolveLabel(item)}
                  </span>
                  <span className="flex-shrink-0 text-[11px] text-gray-500">
                    <span className="font-mono font-semibold text-gray-900">
                      {item.sampleCount.toLocaleString()}
                    </span>{" "}
                    samples · {item.profileCount.toLocaleString()}{" "}
                    {item.profileCount === 1 ? "profile" : "profiles"} ·{" "}
                    {ProfileUtil.formatPercent(item.share)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-indigo-400"
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {totalSampleCount > 0 && (
            <div className="pt-2 text-right text-[11px] text-gray-400">
              {totalSampleCount.toLocaleString()} samples in window
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BreakdownCard;
