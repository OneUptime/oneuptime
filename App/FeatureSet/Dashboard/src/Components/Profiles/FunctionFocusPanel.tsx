import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ProfileUtil from "../../Utils/ProfileUtil";
import FlamegraphView, {
  FlamegraphNode,
  ServerFlamegraphNode,
  normaliseServerFlamegraphNode,
} from "./FlamegraphView";

export interface FunctionFocusPanelProps {
  functionName: string;
  fileName: string;
  unit: string;
  profileId?: string | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
  serviceIds?: Array<ObjectID> | undefined;
  profileType?: string | undefined;
  onClose: () => void;
}

/**
 * Parsed payload from /telemetry/profiles/function-focus. Both trees
 * are rooted at the focused function: `callers` fans out toward the
 * stack roots (direct callers first), `callees` fans out toward the
 * leaves (what the function calls).
 */
interface FunctionFocusData {
  totalValue: number;
  selfValue: number;
  sampleCount: number;
  windowTotal: number;
  callers: ServerFlamegraphNode | null;
  callees: ServerFlamegraphNode | null;
  truncated: boolean;
}

/**
 * Right-side slide-over showing the "sandwich view" for a single
 * function: who calls it (callers tree) and what it calls (callees
 * tree), plus headline stats. Self-fetching — give it a function
 * identity and a scope (profile id or time window + filters) and it
 * loads everything itself.
 *
 * Frames are matched server-side on functionName + fileName only, so
 * the focus stays stable across deploys that shift line numbers.
 */
const FunctionFocusPanel: FunctionComponent<FunctionFocusPanelProps> = (
  props: FunctionFocusPanelProps,
): ReactElement => {
  const [data, setData] = useState<FunctionFocusData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  /*
   * Retry nonce: bumping it re-runs the fetch effect even though no
   * scope input changed — the effect deps are all value-compared.
   */
  const [nonce, setNonce] = useState<number>(0);

  /*
   * The selector pill stores either a category (e.g. "cpu") or a raw
   * type — expand it to the raw type strings agents actually emit so
   * the server filters with IN (...) instead of a literal equality
   * that would miss rows.
   */
  const queryProfileTypes: Array<string> | undefined =
    ProfileUtil.getQueryProfileTypes(props.profileType);

  useEffect(() => {
    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError("");

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/profiles/function-focus",
            ),
            data: {
              functionName: props.functionName,
              fileName: props.fileName,
              profileId: props.profileId,
              startTime: props.startTime
                ? props.startTime.toISOString()
                : undefined,
              endTime: props.endTime ? props.endTime.toISOString() : undefined,
              serviceIds: props.serviceIds?.map((id: ObjectID) => {
                return id.toString();
              }),
              profileType: props.profileType,
              profileTypes: queryProfileTypes,
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

        setData({
          totalValue: Number(response.data["totalValue"]) || 0,
          selfValue: Number(response.data["selfValue"]) || 0,
          sampleCount: Number(response.data["sampleCount"]) || 0,
          windowTotal: Number(response.data["windowTotal"]) || 0,
          callers: (response.data["callers"] ||
            null) as ServerFlamegraphNode | null,
          callees: (response.data["callees"] ||
            null) as ServerFlamegraphNode | null,
          truncated: Boolean(response.data["truncated"]),
        });
      } catch (err) {
        if (!cancelled) {
          setData(null);
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
    props.functionName,
    props.fileName,
    props.profileId,
    // Dates compared by epoch millis — never by object identity.
    props.startTime?.getTime(),
    props.endTime?.getTime(),
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
   * Escape closes the panel. This is a window-level listener so it
   * works no matter what inside the panel has focus. The embedded
   * flame graphs consume Escape first (preventDefault) when they have
   * an active zoom or search — zooming out must not also dismiss the
   * panel on the same keystroke.
   */
  useEffect(() => {
    const handler: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [props.onClose]);

  const callersRoot: FlamegraphNode = useMemo(() => {
    return normaliseServerFlamegraphNode(data?.callers || null);
  }, [data]);

  const calleesRoot: FlamegraphNode = useMemo(() => {
    return normaliseServerFlamegraphNode(data?.callees || null);
  }, [data]);

  const windowSharePct: number =
    data && data.windowTotal > 0
      ? (data.totalValue / data.windowTotal) * 100
      : 0;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Callers and callees"
    >
      {/* Backdrop — clicking it dismisses the panel. */}
      <div
        className="absolute inset-0 bg-gray-500/60 transition-opacity"
        onClick={() => {
          props.onClose();
        }}
      />

      <div className="pointer-events-none absolute inset-y-0 right-0 flex max-w-full pl-6 sm:pl-10">
        <div className="pointer-events-auto w-screen max-w-4xl">
          <div className="flex h-full flex-col bg-white shadow-xl">
            {/* Header */}
            <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-400">
                    Callers &amp; callees
                  </div>
                  <h2 className="break-all font-mono text-base font-semibold text-gray-900">
                    {props.functionName || "(anonymous)"}
                  </h2>
                  {props.fileName && (
                    <p className="mt-0.5 break-all font-mono text-[11px] text-gray-500">
                      {ProfileUtil.formatFileName(props.fileName, 96)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="flex-shrink-0 text-gray-400 hover:text-gray-500"
                  onClick={() => {
                    props.onClose();
                  }}
                >
                  <span className="sr-only">Close panel</span>
                  <Icon className="h-5 w-5" icon={IconProp.Close} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {isLoading && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[0, 1, 2, 3].map((i: number) => {
                      return (
                        <div
                          key={i}
                          className="h-14 animate-pulse rounded-lg border border-gray-100 bg-gray-50"
                        />
                      );
                    })}
                  </div>
                  <div className="h-40 animate-pulse rounded-lg border border-gray-100 bg-gray-50" />
                  <div className="h-40 animate-pulse rounded-lg border border-gray-100 bg-gray-50" />
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

              {!isLoading && !error && data && (
                <>
                  {/* Stat row */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <FocusStat
                      label="Total"
                      value={ProfileUtil.formatProfileValue(
                        data.totalValue,
                        props.unit,
                      )}
                    />
                    <FocusStat
                      label="Self"
                      value={ProfileUtil.formatProfileValue(
                        data.selfValue,
                        props.unit,
                      )}
                    />
                    <FocusStat
                      label="Samples"
                      value={data.sampleCount.toLocaleString()}
                    />
                    <FocusStat
                      label="% of window"
                      value={
                        data.windowTotal > 0
                          ? ProfileUtil.formatPercent(windowSharePct)
                          : "—"
                      }
                    />
                  </div>

                  {/* Callers */}
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Called by
                    </h3>
                    <p className="mb-2 mt-0.5 text-xs text-gray-500">
                      Direct callers first — read downward as &quot;who calls
                      this&quot;
                    </p>
                    <FlamegraphView
                      root={callersRoot}
                      unit={props.unit}
                      compact={true}
                      truncated={data.truncated}
                    />
                  </div>

                  {/* Callees */}
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Calls into
                    </h3>
                    <p className="mb-2 mt-0.5 text-xs text-gray-500">
                      What this function spends its time calling
                    </p>
                    <FlamegraphView
                      root={calleesRoot}
                      unit={props.unit}
                      compact={true}
                      truncated={data.truncated}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface FocusStatProps {
  label: string;
  value: string;
}

/**
 * One tile in the stat row. Kept as a tiny component so the four
 * stats stay visually identical without repeating markup.
 */
const FocusStat: FunctionComponent<FocusStatProps> = (
  props: FocusStatProps,
): ReactElement => {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">
        {props.label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-gray-900">
        {props.value}
      </div>
    </div>
  );
};

export default FunctionFocusPanel;
