import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Host from "Common/Models/DatabaseModels/Host";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

/*
 * The last step of adding a host: waiting for it. Every few seconds it asks
 * for a host whose collector registered since the guide opened - a new
 * host, or one installed again (Host.collectorRegisteredAt) - and says so
 * when one does, with a link to it. The command itself prints when
 * OneUptime has answered; this is the same moment, seen from OneUptime.
 *
 * Registered, not merely reporting: every managed host reports, and one
 * already running would read as the host just added.
 */

export const HOST_CONNECTION_POLL_INTERVAL_MS: number = 5000;

/*
 * The browser's clock and the server's can differ a little: a host that
 * registered this long before the guide opened still counts.
 */
export const HOST_CONNECTION_CLOCK_MARGIN_MS: number = 2 * 60 * 1000;

/*
 * What the step says while it waits: for any new host, or - on a host's own
 * page, handing its collector over - for that host's new collector.
 */
export const HOST_CONNECTION_WAITING_TEXT: string = translationKey(
  "Waiting for the host to connect. This step updates by itself.",
);
export const HOST_HAND_OVER_WAITING_TEXT: string = translationKey(
  "Waiting for the new collector to connect. This step updates by itself.",
);

// The earliest registration this guide counts as the host it added.
export function getHostConnectionWatchStart(since: Date): Date {
  return OneUptimeDate.addRemoveSeconds(
    since,
    -HOST_CONNECTION_CLOCK_MARGIN_MS / 1000,
  );
}

export interface ComponentProps {
  // When the guide opened: a host that registered since then just connected.
  since: Date;
  /*
   * Only this host: on a host's own page, which waits for that host's
   * collector to be handed over, not for any host of the project.
   */
  hostId?: ObjectID | undefined;
  onHostConnected?: ((host: Host) => void) | undefined;
}

const HostConnectionWatch: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [host, setHost] = useState<Host | null>(null);

  useEffect(() => {
    if (host) {
      return;
    }

    let isMounted: boolean = true;

    const check: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<Host> = await ModelAPI.getList<Host>({
          modelType: Host,
          query: {
            ...(props.hostId ? { _id: props.hostId } : {}),
            collectorRegisteredAt: new GreaterThanOrEqual<Date>(
              getHostConnectionWatchStart(props.since),
            ),
          },
          select: {
            _id: true,
            name: true,
            collectorRegisteredAt: true,
          },
          sort: {
            collectorRegisteredAt: SortOrder.Descending,
          },
          limit: 1,
          skip: 0,
        });

        const connected: Host | undefined = result.data[0];

        if (isMounted && connected) {
          setHost(connected);
          props.onHostConnected?.(connected);
        }
      } catch {
        // A failed check waits for the next one; the step keeps waiting.
      }
    };

    void check();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void check();
    }, HOST_CONNECTION_POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [host, props.since, props.hostId?.toString()]);

  if (!host) {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
        role="status"
        aria-live="polite"
        data-testid="host-connection-waiting"
      >
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
        </span>
        {translator.translateTemplate(
          props.hostId
            ? HOST_HAND_OVER_WAITING_TEXT
            : HOST_CONNECTION_WAITING_TEXT,
        )}
      </div>
    );
  }

  const hostRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.HOST_VIEW] as Route,
    { modelId: new ObjectID(host._id as string) },
  );

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      role="status"
      aria-live="polite"
      data-testid="host-connection-connected"
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
            template="{{host}} is connected. Its metrics and logs arrive within a minute."
            slots={{
              host: (
                <span
                  className="font-semibold"
                  data-testid="connected-host-name"
                >
                  {host.name || ""}
                </span>
              ),
            }}
          />
        </span>
        <AppLink
          to={hostRoute}
          className="font-medium text-emerald-700 underline hover:text-emerald-900"
        >
          {translator.translateTemplate("View host")}
        </AppLink>
      </div>
    </div>
  );
};

export default HostConnectionWatch;
