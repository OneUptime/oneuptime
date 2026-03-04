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
import Label from "Common/Models/DatabaseModels/Label";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

const MonitorGroupView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
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

  const getUptimePercent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <></>;
    }

    const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
      statusTimelines,
      UptimePrecision.THREE_DECIMAL,
      downTimeMonitorStatues,
    );

    return (
      <div
        className="font-medium mt-5"
        style={{
          color: currentGroupStatus?.color?.toString() || Green.toString(),
        }}
      >
        {uptimePercent}% uptime
      </div>
    );
  };

  const getCurrentStatusBubble: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <></>;
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

      const currentStatus: MonitorStatus | null =
        await ModelAPI.post<MonitorStatus>({
          modelType: MonitorStatus,
          apiUrl: URL.fromString(APP_API_URL.toString())
            .addRoute(new MonitorGroup().getCrudApiPath()!)
            .addRoute("/current-status/")
            .addRoute(`/${modelId.toString()}`),
        });

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

  return (
    <Fragment>
      {/* MonitorGroup View  */}
      <CardModelDetail<MonitorGroup>
        name="MonitorGroup Details"
        formSteps={[
          {
            title: "Monitor Group Info",
            id: "monitor-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        cardProps={{
          title: "Monitor Group Details",
          description: "Here are more details for this monitor group.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            stepId: "monitor-info",
            title: "Group Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Monitor Group Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "monitor-info",
            title: "Group Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              labels: true,
            },
            stepId: "labels",
            title: "Labels ",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
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
              title: "Monitor Group Name",
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

      <Card
        title="Uptime Graph"
        description="Here the 90 day uptime history of this monitor group."
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
    </Fragment>
  );
};

export default MonitorGroupView;
