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
import PageLoader from "Common/UI/Components/Loader/PageLoader";
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
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
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
import { fetchMonitorGroupMonitoringSummary } from "../../../Components/MonitorGroup/MonitorGroupMonitoringAPI";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringState,
  MonitorGroupMonitoringSummary,
} from "Common/Utils/Monitor/MonitorGroupMonitoring";
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

  const [statusTimelines, setStatusTimelines] = useState<
    Array<MonitorStatusTimeline>
  >([]);
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
     * this page reports the last 90 days (same range the uptime graph below is drawn over), so
     * measure over that window. Otherwise an open (endsAt = null) row that started before the
     * window contributes its whole duration and the denominator becomes "first event -> now"
     * instead of the 90 days shown.
     *
     * Only the time a monitor was monitored counts (issues #6480 and #6987): the group's
     * timeline keeps each monitor's rows up to when its monitoring was turned off, and the rows
     * from then on mark it (isMonitoringOff), so uptime leaves that time out. A group none of
     * whose monitors was monitored in the 90 days has no percentage, rather than the 100% that
     * no time at all reads as.
     */
    const uptimePercent: number | null =
      UptimeUtil.calculateUptimePercentageOfMonitoredTime(
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
   * Monitoring was turned off or on from the Monitoring card: its counts,
   * and the group's status - turning monitoring off resolves incidents,
   * which gives monitors back their operational status. And its timeline:
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

    getStatusTimelines()
      .then((timelines: ListResult<MonitorStatusTimeline>) => {
        setStatusTimelines(timelines.data);
      })
      .catch(() => {
        // The timeline read before stays, as the status does.
      });
  };

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const statusTimelines: ListResult<MonitorStatusTimeline> =
        await getStatusTimelines();

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
      setStatusTimelines(statusTimelines.data);
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
    return <PageLoader isVisible={true} />;
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
            paddingClassName="py-8"
            footer={
              /*
               * Only for whoever may put a monitor in a group: the page Add
               * Monitors opens would refuse anyone else. Button keeps a
               * dialog footer's left margin (md:ml-3), which would push it
               * off the centre here, so its wrapper clears it.
               */
              canAddMonitors ? (
                <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
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
          {/*
           * The group's rows of every monitor, merged into one timeline in
           * the worst status at each instant (WorstStatusTimeline), so a day
           * adds up to at most the day. A monitor's time with monitoring off
           * is no part of it (UptimeUtil.getMonitorEventsForId): a day none
           * of them was monitored reads as no data. Drawn on the days of the
           * zone every other time on the Dashboard is shown in - the user's -
           * so a bar's label and the incidents its tooltip lists are the
           * bar's day.
           */}
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
        </Card>
      )}
    </Fragment>
  );
};

export default MonitorGroupView;
