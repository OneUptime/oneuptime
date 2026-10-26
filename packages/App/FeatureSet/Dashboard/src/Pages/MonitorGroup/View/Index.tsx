import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green } from "Common/Types/BrandColors";
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

  const getUptimePercent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <></>;
    }

    /*
     * this page reports the last 90 days (same range the uptime graph below is drawn over), so
     * measure over that window. Otherwise an open (endsAt = null) row that started before the
     * window contributes its whole duration and the denominator becomes "first event -> now"
     * instead of the 90 days shown.
     */
    const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
      statusTimelines,
      UptimePrecision.THREE_DECIMAL,
      downTimeMonitorStatues,
      {
        startDate: OneUptimeDate.getSomeDaysAgo(90),
        endDate: OneUptimeDate.getCurrentDate(),
      },
    );

    return (
      <div
        className="font-medium mt-5"
        style={{
          color: currentGroupStatus?.color?.toString() || Green.toString(),
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

    return (
      <Statusbubble
        text={currentGroupStatus?.name || "Operational"}
        color={currentGroupStatus?.color || Green}
        shouldAnimate={true}
      />
    );
  };

  useAsyncEffect(async () => {
    await fetchItem();
  }, []);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const statusTimelines: ListResult<MonitorStatusTimeline> =
        await ModelAPI.getList({
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

      const currentStatus: MonitorStatus | null =
        await ModelAPI.post<MonitorStatus>({
          modelType: MonitorStatus,
          apiUrl: URL.fromString(APP_API_URL.toString())
            .addRoute(new MonitorGroup().getCrudApiPath()!)
            .addRoute("/current-status/")
            .addRoute(`/${modelId.toString()}`),
        });

      setMonitorCount(groupMonitorCount);
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
          description="This group's status over the last 90 days, one bar per day."
          rightElement={getUptimePercent()}
        >
          <MonitorUptimeGraph
            error={error}
            items={statusTimelines}
            startDate={OneUptimeDate.getSomeDaysAgo(90)}
            endDate={OneUptimeDate.getCurrentDate()}
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
