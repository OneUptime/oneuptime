import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import MonitorUptimeGraph from "Common/UI/Components/MonitorGraphs/Uptime";
import UptimeUtil from "Common/UI/Components/MonitorGraphs/UptimeUtil";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import MonitorGroupMonitorsCopy, {
  ADD_MONITORS_QUERY_PARAM,
} from "../../../Components/MonitorGroup/MonitorGroupMonitorsCopy";
import NoMonitorsStatus from "../../../Components/MonitorGroup/NoMonitorsStatus";
import MonitorGroupDisabledStatus from "../../../Components/MonitorGroup/MonitorGroupDisabledStatus";
import MonitorGroupMonitoringCard from "../../../Components/MonitorGroup/MonitorGroupMonitoringCard";
import UsedByCard from "../../../Components/UsedBy/UsedByCard";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import { fetchMonitorGroupMonitoringSummary } from "../../../Components/MonitorGroup/MonitorGroupMonitoringAPI";
import { fetchMonitorGroupUptimeSummary } from "../../../Components/MonitorGroup/MonitorGroupUptimeSummaryAPI";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringState,
  MonitorGroupMonitoringSummary,
} from "Common/Utils/Monitor/MonitorGroupMonitoring";
import { MonitorGroupUptimeSummary } from "Common/Types/Monitor/MonitorGroupUptimeSummary";
import MonitorGroupUptimeSummaryUtil from "Common/Utils/Monitor/MonitorGroupUptimeSummaryUtil";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const MonitorGroupView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [currentGroupStatus, setCurrentGroupStatus] =
    React.useState<MonitorStatus | null>(null);

  /*
   * The group's uptime history as the server measures it, from every row
   * (issue #6886): what the Uptime Graph and the percentage are drawn from.
   * Null when the server could not answer it - one that predates the route
   * - and the page then draws from the group's timeline rows, as it did.
   */
  const [uptimeSummary, setUptimeSummary] =
    useState<MonitorGroupUptimeSummary | null>(null);
  const [statusTimelines, setStatusTimelines] = useState<
    Array<MonitorStatusTimeline>
  >([]);
  // Every status of the project, to name and colour the server's days.
  const [monitorStatuses, setMonitorStatuses] = useState<Array<MonitorStatus>>(
    [],
  );
  const [downTimeMonitorStatues, setDowntimeMonitorStatues] = useState<
    Array<MonitorStatus>
  >([]);

  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * How many monitors the group holds. A new group holds none, and its
   * Overview then says so, with Add Monitors, instead of an uptime bar for a
   * group with nothing in it.
   */
  const [monitorCount, setMonitorCount] = useState<number | null>(null);

  /*
   * How many of the group's monitors are checked (issue #6401): the
   * Monitoring card says so and turns them off or on, and a group whose
   * monitors all have monitoring off reads Disabled. Null when it could not
   * be read: the card is then left out and the status shown as it is.
   */
  const [monitoringSummary, setMonitoringSummary] =
    useState<MonitorGroupMonitoringSummary | null>(null);

  const getUptimePercent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <></>;
    }

    /*
     * Over the same days the Uptime Graph below is drawn from: the server's
     * (issue #6886), summed from every row, so a group with more status
     * changes than the 10,000 rows the timeline route returns is measured
     * over all 90 days. Only the time a monitor was monitored counts
     * (issues #6480 and #6987), and a monitor counts from its first check
     * (issue #8960): a group with nothing measured in them has no
     * percentage, rather than the 100% that no time at all reads as.
     *
     * From the rows, when the server could not answer: measured over the
     * last 90 days, so an open (endsAt = null) row that started before them
     * does not stretch the denominator to "first event -> now".
     */
    const uptimePercent: number | null = uptimeSummary
      ? MonitorGroupUptimeSummaryUtil.getUptimePercent({
          summary: uptimeSummary,
          precision: UptimePrecision.THREE_DECIMAL,
        })
      : UptimeUtil.calculateUptimePercentageOfMonitoredTime(
          statusTimelines,
          UptimePrecision.THREE_DECIMAL,
          downTimeMonitorStatues,
          {
            startDate: OneUptimeDate.getSomeDaysAgo(90),
            endDate: OneUptimeDate.getCurrentDate(),
          },
        );

    if (uptimePercent === null) {
      return <></>;
    }

    /*
     * Every monitor with monitoring off: the group reads Disabled, in grey,
     * and so does its uptime, which ends when monitoring was turned off - not
     * in the colour of the worst status their last checks saw.
     */
    const percentColor: Color =
      MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(monitoringSummary)
        ? Gray500
        : currentGroupStatus?.color || Green;

    return (
      <div
        className="font-medium mt-5"
        data-testid="monitor-group-uptime-percent"
        style={{
          color: percentColor.toString(),
        }}
      >
        {translator.translateTemplate("{{percent}}% uptime", {
          percent: uptimePercent,
        })}
      </div>
    );
  };

  const getCurrentStatusBubble: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <></>;
    }

    /*
     * A group with no monitors has no status to show: it used to read
     * Operational, in green, beside the card that asks for its monitors.
     */
    if (monitorCount === 0) {
      return <NoMonitorsStatus />;
    }

    /*
     * Nothing checks any of its monitors: their worst status is only what
     * their last checks saw, so the group says it is off instead.
     */
    if (
      MonitorGroupMonitoring.isMonitoringOffForEveryMonitor(monitoringSummary)
    ) {
      return <MonitorGroupDisabledStatus />;
    }

    return (
      <Statusbubble
        text={currentGroupStatus?.name || "Operational"}
        isUserContent={isRecordNameAsWritten(
          StateListType.MonitorStatus,
          currentGroupStatus?.name,
        )}
        color={currentGroupStatus?.color || Green}
        shouldAnimate={true}
      />
    );
  };

  useAsyncEffect(async () => {
    await fetchItem();
  }, []);

  const getCurrentStatus: () => Promise<MonitorStatus | null> =
    async (): Promise<MonitorStatus | null> => {
      return await ModelAPI.post<MonitorStatus>({
        modelType: MonitorStatus,
        apiUrl: URL.fromString(APP_API_URL.toString())
          .addRoute(new MonitorGroup().getCrudApiPath()!)
          .addRoute("/current-status/")
          .addRoute(`/${modelId.toString()}`),
      });
    };

  /*
   * The group's status timeline: every monitor's rows, those that mark its
   * monitoring off included.
   */
  const getStatusTimelines: () => Promise<
    ListResult<MonitorStatusTimeline>
  > = async (): Promise<ListResult<MonitorStatusTimeline>> => {
    return await ModelAPI.getList({
      modelType: MonitorStatusTimeline,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {},
      sort: {},
      requestOptions: {
        overrideRequestUrl: URL.fromString(APP_API_URL.toString())
          .addRoute(new MonitorGroup().getCrudApiPath()!)
          .addRoute("/timeline/")
          .addRoute(`/${modelId.toString()}`),
      },
    });
  };

  /*
   * What the Uptime Graph and the percentage are drawn from: the server's
   * days when it answers them (issue #6886), and the group's timeline rows
   * - capped at 10,000, oldest first - only when it does not.
   */
  const getUptime: () => Promise<{
    summary: MonitorGroupUptimeSummary | null;
    timelines: Array<MonitorStatusTimeline>;
  }> = async (): Promise<{
    summary: MonitorGroupUptimeSummary | null;
    timelines: Array<MonitorStatusTimeline>;
  }> => {
    const summary: MonitorGroupUptimeSummary | null =
      await fetchMonitorGroupUptimeSummary({
        monitorGroupId: modelId,
        /*
         * The zone every other time on the Dashboard is shown in, so a
         * bar's label and its day are the user's.
         */
        timezone: OneUptimeDate.getCurrentTimezone(),
      });

    if (summary) {
      return { summary: summary, timelines: [] };
    }

    return { summary: null, timelines: (await getStatusTimelines()).data };
  };

  /*
   * Monitoring was turned off or on from the Monitoring card: its counts,
   * and the group's status - turning monitoring off resolves incidents,
   * which gives monitors back their operational status. And its uptime:
   * the switch starts a status event on each monitor's timeline, from which
   * its time no longer counts, or counts again (issue #6480), so the graph
   * and the percentage follow it.
   */
  const onMonitoringChanged: (
    summary: MonitorGroupMonitoringSummary,
  ) => void = (summary: MonitorGroupMonitoringSummary): void => {
    setMonitoringSummary(summary);

    getCurrentStatus()
      .then((currentStatus: MonitorStatus | null) => {
        setCurrentGroupStatus(currentStatus);
      })
      .catch(() => {
        // The status read before stays: the page reports its own errors on load.
      });

    getUptime()
      .then(
        (uptime: {
          summary: MonitorGroupUptimeSummary | null;
          timelines: Array<MonitorStatusTimeline>;
        }) => {
          setUptimeSummary(uptime.summary);
          setStatusTimelines(uptime.timelines);
        },
      )
      .catch(() => {
        // The uptime read before stays, as the status does.
      });
  };

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const uptime: {
        summary: MonitorGroupUptimeSummary | null;
        timelines: Array<MonitorStatusTimeline>;
      } = await getUptime();

      const monitorStatuses: ListResult<MonitorStatus> = await ModelAPI.getList(
        {
          modelType: MonitorStatus,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            priority: true,
            isOperationalState: true,
            name: true,
            color: true,
          },
          sort: {
            priority: SortOrder.Ascending,
          },
        },
      );

      const groupMonitorCount: number = await ModelAPI.count({
        modelType: MonitorGroupResource,
        query: {
          monitorGroupId: modelId,
        },
      });

      const currentStatus: MonitorStatus | null = await getCurrentStatus();

      // Not worth failing the page over: the card is left out without it.
      const summary: MonitorGroupMonitoringSummary | null =
        await fetchMonitorGroupMonitoringSummary(modelId).catch((): null => {
          return null;
        });

      setMonitorCount(groupMonitorCount);
      setMonitoringSummary(summary);
      setCurrentGroupStatus(currentStatus);
      setUptimeSummary(uptime.summary);
      setStatusTimelines(uptime.timelines);
      setMonitorStatuses(monitorStatuses.data);
      setDowntimeMonitorStatues(
        monitorStatuses.data.filter((status: MonitorStatus) => {
          return !status.isOperationalState;
        }),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  // Whether the reader may put monitors in the group (Add Monitors).
  const canAddMonitors: boolean = PermissionGate.check(
    new MonitorGroupResource(),
    ModelAction.Create,
  ).isAllowed;

  /*
   * A monitor counts in the group's timeline only while its monitoring is
   * on: its history stays up to when it was turned off, and the time after
   * is left out (issues #6480 and #6987), as its status is (issue #6478). So
   * the Uptime Graph's description says so while some monitors are off, and
   * that the graph ends when monitoring was turned off once every one of
   * them is. Null when the group's monitoring could not be read: the
   * description is then as before.
   */
  const uptimeGraphMonitoringState: MonitorGroupMonitoringState | null =
    monitoringSummary
      ? MonitorGroupMonitoring.getState(monitoringSummary)
      : null;

  return (
    <Fragment>
      {/* MonitorGroup View  */}
      <CardModelDetail<MonitorGroup>
        name="MonitorGroup Details"
        cardProps={{
          title: "Monitor Group Details",
        }}
        isEditable={true}
        formFields={[
          /*
           * Named as the create form names them: Name and Description.
           * They were "Group Name" and "Group Description" here, and
           * "Monitor Group Name" on the card.
           */
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Monitor Group Name",
            hideColumnDescription: true,
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
            hideColumnDescription: true,
          },
          getLabelsFormField<MonitorGroup>(),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: MonitorGroup,
          id: "model-detail-monitors",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Monitor Group ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: MonitorGroup): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                _id: true,
              },
              fieldType: FieldType.Element,
              title: "Current Status",
              getElement: () => {
                return getCurrentStatusBubble();
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {monitorCount !== 0 &&
      monitoringSummary &&
      monitoringSummary.monitorCount > 0 ? (
        <MonitorGroupMonitoringCard
          monitorGroupId={modelId}
          summary={monitoringSummary}
          onChange={onMonitoringChanged}
        />
      ) : (
        <></>
      )}

      {monitorCount === 0 ? (
        /*
         * The one thing to do with a new group: put its monitors in it.
         * Add Monitors opens the group's Monitors page with its picker open.
         */
        <Card title={MonitorGroupMonitorsCopy.emptyGroupCardTitle}>
          <EmptyState
            id="monitor-group-no-monitors"
            icon={IconProp.AltGlobe}
            title={MonitorGroupMonitorsCopy.emptyTitle}
            description={MonitorGroupMonitorsCopy.emptyDescription}
            size={EmptyStateSize.Inline}
            footer={
              /*
               * Only for whoever may put a monitor in a group: the page Add
               * Monitors opens would refuse anyone else.
               */
              canAddMonitors ? (
                <div>
                  <Button
                    title={MonitorGroupMonitorsCopy.addButton}
                    icon={IconProp.Add}
                    buttonStyle={ButtonStyleType.PRIMARY}
                    dataTestId="monitor-group-add-monitors"
                    onClick={() => {
                      Navigation.navigate(
                        RouteUtil.populateRouteParams(
                          RouteMap[
                            PageMap.MONITOR_GROUP_VIEW_MONITORS
                          ] as Route,
                          { modelId: modelId },
                        ).addQueryParams({
                          [ADD_MONITORS_QUERY_PARAM]: "true",
                        }),
                      );
                    }}
                  />
                </div>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card
          title="Uptime Graph"
          description={
            uptimeGraphMonitoringState === MonitorGroupMonitoringState.Off
              ? "This group's status over the last 90 days, one bar per day, up to when monitoring was turned off for all of its monitors."
              : uptimeGraphMonitoringState === MonitorGroupMonitoringState.Mixed
                ? "This group's status over the last 90 days, one bar per day. Each monitor counts only while its monitoring is on."
                : "This group's status over the last 90 days, one bar per day."
          }
          rightElement={getUptimePercent()}
        >
          {uptimeSummary ? (
            /*
             * The group's days as the server measures them from every row
             * (issue #6886): at each instant the worst status among its
             * monitors, a monitor's time with monitoring off and before its
             * first check left out - the days a status page draws the group
             * with. Cut in the zone every other time on the Dashboard is
             * shown in - the user's - so a bar's label is the bar's day.
             */
            <MonitorUptimeGraph
              error={error}
              items={[]}
              uptimeBuckets={uptimeSummary.buckets}
              monitorStatuses={monitorStatuses}
              startDate={uptimeSummary.startDate}
              endDate={uptimeSummary.endDate}
              uptimeTimezone={uptimeSummary.timezone}
              isLoading={isLoading}
              defaultBarColor={Green}
              downtimeMonitorStatuses={downTimeMonitorStatues}
            />
          ) : (
            /*
             * A server that predates the summary: the group's rows of every
             * monitor, merged into one timeline in the worst status at each
             * instant (WorstStatusTimeline), so a day adds up to at most the
             * day. A monitor's time with monitoring off is no part of it
             * (UptimeUtil.getMonitorEventsForId): a day none of them was
             * monitored reads as no data.
             */
            <MonitorUptimeGraph
              error={error}
              items={statusTimelines}
              startDate={OneUptimeDate.getSomeDaysAgo(90)}
              endDate={OneUptimeDate.getCurrentDate()}
              uptimeTimezone={OneUptimeDate.getCurrentTimezone()}
              isLoading={isLoading}
              defaultBarColor={Green}
              downtimeMonitorStatuses={downTimeMonitorStatues}
            />
          )}
        </Card>
      )}

      {/*
       * What uses the group (#7437): the status pages that show it, and the
       * SLOs that measure its monitors.
       */}
      <UsedByCard
        recordKind={UsedByRecordKind.MonitorGroup}
        recordId={modelId}
      />
    </Fragment>
  );
};

export default MonitorGroupView;
