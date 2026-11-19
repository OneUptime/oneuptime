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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import {
  buildSavedViewScope,
  SavedViewScopeKind,
} from "Common/Utils/Telemetry/SavedViewScope";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";
import HostOperatingSystem from "Common/Utils/Host/HostOperatingSystem";
import HostLogSession from "Common/Models/DatabaseModels/HostLogSession";
import { HOST_LOG_SESSION_ATTRIBUTE } from "Common/Types/Host/HostLogSession";
import OneUptimeDate from "Common/Types/Date";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import HostLogSessions from "../../../Components/Host/HostLogSessions";

const HostLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const translator: Translator = useTranslator();
  const [host, setHost] = useState<Host | null>(null);
  /*
   * The log session whose lines the logs show, picked from Log Sessions
   * (#9806): the logs below narrow to the lines it sent.
   */
  const [shownSession, setShownSession] = useState<HostLogSession | null>(null);
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
          osType: true,
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

  const logQuery: Query<Log> = useMemo(() => {
    /*
     * `any` sidesteps a TS2589 deep-instantiation on Query<Log> with
     * inline attribute maps — same workaround the Docker logs page uses.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: {
        "resource.host.name": host?.hostIdentifier || "",
        ...(shownSession?._id
          ? { [HOST_LOG_SESSION_ATTRIBUTE]: shownSession._id.toString() }
          : {}),
      },
    };
    return q as Query<Log>;
  }, [host?.hostIdentifier, shownSession?._id?.toString()]);

  if (isLoading) {
    return <PageSkeleton shape="table" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  const isAndroid: boolean = HostOperatingSystem.isAndroid(host.osType);

  return (
    <Fragment>
      {isAndroid ? (
        <div className="mb-5">
          <HostLogSessions
            hostId={modelId}
            shownSessionId={shownSession?._id?.toString()}
            onShowLines={(session: HostLogSession) => {
              setShownSession(session);
            }}
          />
        </div>
      ) : null}
      {shownSession ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">
            {translator.translateTemplate(
              "Showing the lines of the log session requested {{time}}.",
              {
                time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  shownSession.createdAt!,
                ),
              },
            )}
          </p>
          <Button
            title="Show All Logs"
            icon={IconProp.Close}
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={() => {
              setShownSession(null);
            }}
          />
        </div>
      ) : null}
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `logQuery.attributes` stays for the histogram / facet scoping —
       * display behavior is unchanged. Drop the attribute fallback (here and
       * in the logQuery merge) once deploy-date + max retention has passed.
       *
       * The attribute value is the machine's host.name (hostIdentifier), which
       * is what the filter must match — but the locked chip would read
       * "resource.host.name: ip-10-0-0-12". The display overrides label it
       * "Host: <name>" without touching the filter.
       */}
      <DashboardLogsViewer
        id={`host-logs-${modelId.toString()}`}
        savedViewScope={buildSavedViewScope(SavedViewScopeKind.Host, modelId)}
        logQuery={logQuery}
        attributeFilterDisplayKeys={{
          "resource.host.name": "Host",
          ...(shownSession
            ? { [HOST_LOG_SESSION_ATTRIBUTE]: "Log Session" }
            : {}),
        }}
        attributeFilterDisplayValues={{
          "resource.host.name": host.name || host.hostIdentifier!,
          ...(shownSession?.createdAt
            ? {
                [HOST_LOG_SESSION_ATTRIBUTE]:
                  OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    shownSession.createdAt,
                  ),
              }
            : {}),
        }}
        entityScope={{
          entityKeys: [
            keyForHost(
              ProjectUtil.getCurrentProjectId()!.toString(),
              host.hostIdentifier!,
            ),
          ],
          attributeKey: "resource.host.name",
          attributeValue: host.hostIdentifier!,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage={
          shownSession
            ? "No lines from this log session yet. They arrive within a minute of someone at the device allowing it."
            : isAndroid
              ? "The OneUptime Android agent sends this device's logs within a few minutes of starting."
              : "Make sure your OTel collector forwards logs with the host.name resource attribute."
        }
      />
    </Fragment>
  );
};

export default HostLogs;
