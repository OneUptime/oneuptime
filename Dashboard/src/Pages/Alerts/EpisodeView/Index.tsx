import LabelsElement from "Common/UI/Components/Label/Labels";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
import AlertEpisodeFeedElement from "../../../Components/AlertEpisode/AlertEpisodeFeed";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import UserElement from "../../../Components/User/User";
import ChangeEpisodeState from "../../../Components/AlertEpisode/ChangeState";

const AlertEpisodeView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [episodeStateTimeline, setEpisodeStateTimeline] = useState<
    AlertEpisodeStateTimeline[]
  >([]);
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);

  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const episodeTimelines: ListResult<AlertEpisodeStateTimeline> =
        await ModelAPI.getList({
          modelType: AlertEpisodeStateTimeline,
          query: {
            alertEpisodeId: modelId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            startsAt: true,
            createdByUser: {
              name: true,
              email: true,
              profilePictureId: true,
            },
            alertStateId: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
        });

      const alertStates: ListResult<AlertState> = await ModelAPI.getList({
        modelType: AlertState,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
          isAcknowledgedState: true,
          isResolvedState: true,
        },
        sort: {},
      });

      setAlertStates(alertStates.data as AlertState[]);
      setEpisodeStateTimeline(
        episodeTimelines.data as AlertEpisodeStateTimeline[],
      );
      setError("");
    } catch (err) {
      setError(BaseAPI.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(BaseAPI.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  type GetAlertStateFunction = () => AlertState | undefined;

  const getAcknowledgeState: GetAlertStateFunction = ():
    | AlertState
    | undefined => {
    return alertStates.find((state: AlertState) => {
      return state.isAcknowledgedState;
    });
  };

  const getResolvedState: GetAlertStateFunction = ():
    | AlertState
    | undefined => {
    return alertStates.find((state: AlertState) => {
      return state.isResolvedState;
    });
  };

  type getTimeFunction = () => string;

  const getTimeToAcknowledge: getTimeFunction = (): string => {
    const episodeStartTime: Date =
      episodeStateTimeline[0]?.startsAt || new Date();

    const acknowledgeTime: Date | undefined = episodeStateTimeline.find(
      (timeline: AlertEpisodeStateTimeline) => {
        return (
          timeline.alertStateId?.toString() ===
          getAcknowledgeState()?._id?.toString()
        );
      },
    )?.startsAt;

    const resolveTime: Date | undefined = episodeStateTimeline.find(
      (timeline: AlertEpisodeStateTimeline) => {
        return (
          timeline.alertStateId?.toString() ===
          getResolvedState()?._id?.toString()
        );
      },
    )?.startsAt;

    if (!acknowledgeTime && !resolveTime) {
      return (
        "Not yet " +
        (getAcknowledgeState()?.name?.toLowerCase() || "acknowledged")
      );
    }

    if (!acknowledgeTime && resolveTime) {
      return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
        OneUptimeDate.getDifferenceInMinutes(resolveTime, episodeStartTime),
      );
    }

    return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
      OneUptimeDate.getDifferenceInMinutes(acknowledgeTime!, episodeStartTime),
    );
  };

  const getTimeToResolve: getTimeFunction = (): string => {
    const episodeStartTime: Date =
      episodeStateTimeline[0]?.startsAt || new Date();

    const resolveTime: Date | undefined = episodeStateTimeline.find(
      (timeline: AlertEpisodeStateTimeline) => {
        return (
          timeline.alertStateId?.toString() ===
          getResolvedState()?._id?.toString()
        );
      },
    )?.startsAt;

    if (!resolveTime) {
      return (
        "Not yet " + (getResolvedState()?.name?.toLowerCase() || "resolved")
      );
    }

    return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
      OneUptimeDate.getDifferenceInMinutes(resolveTime, episodeStartTime),
    );
  };

  type GetInfoCardFunction = (value: string) => ReactElement;

  const getInfoCardValue: GetInfoCardFunction = (
    value: string,
  ): ReactElement => {
    return <div className="font-medium text-gray-900 text-lg">{value}</div>;
  };

  return (
    <Fragment>
      <CardModelDetail<AlertEpisode>
        name="Episode Details"
        cardProps={{
          title: "Episode Details",
          description: "Here are more details for this episode.",
        }}
        isEditable={true}
        formSteps={[
          {
            title: "Episode Details",
            id: "episode-details",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              title: true,
            },
            title: "Episode Title",
            stepId: "episode-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Episode Title",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              alertSeverity: true,
            },
            title: "Episode Severity",
            description: "What is the severity of this episode?",
            fieldType: FormFieldSchemaType.Dropdown,
            stepId: "episode-details",
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Episode Severity",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "labels",
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
          selectMoreFields: {
            createdByUser: {
              _id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          showDetailsInNumberOfColumns: 2,
          modelType: AlertEpisode,
          id: "model-detail-episodes",
          fields: [
            {
              field: {
                episodeNumber: true,
              },
              title: "Episode Number",
              fieldType: FieldType.Element,
              getElement: (item: AlertEpisode): ReactElement => {
                if (!item.episodeNumber) {
                  return <>-</>;
                }

                return (
                  <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gray-100">
                      <svg
                        className="w-3.5 h-3.5 text-gray-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                        />
                      </svg>
                    </div>
                    <span className="text-lg font-semibold text-gray-700">
                      #{item.episodeNumber}
                    </span>
                  </div>
                );
              },
            },
            {
              field: {
                _id: true,
              },
              title: "Episode ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                title: true,
              },
              title: "Episode Title",
              fieldType: FieldType.Text,
            },
            {
              field: {
                currentAlertState: {
                  color: true,
                  name: true,
                },
              },
              title: "Current State",
              fieldType: FieldType.Entity,
              getElement: (item: AlertEpisode): ReactElement => {
                if (!item["currentAlertState"]) {
                  throw new BadDataException("Episode State not found");
                }

                return (
                  <Pill
                    color={item.currentAlertState.color || Black}
                    text={item.currentAlertState.name || "Unknown"}
                  />
                );
              },
            },
            {
              field: {
                alertSeverity: {
                  color: true,
                  name: true,
                },
              },
              title: "Episode Severity",
              fieldType: FieldType.Entity,
              getElement: (item: AlertEpisode): ReactElement => {
                if (!item["alertSeverity"]) {
                  throw new BadDataException("Episode Severity not found");
                }

                return (
                  <Pill
                    color={item.alertSeverity.color || Black}
                    text={item.alertSeverity.name || "Unknown"}
                  />
                );
              },
            },
            {
              field: {
                alertCount: true,
              },
              title: "Alert Count",
              fieldType: FieldType.Number,
            },
            {
              field: {
                alertGroupingRule: {
                  name: true,
                  _id: true,
                },
              },
              title: "Grouping Rule",
              fieldType: FieldType.Element,
              getElement: (item: AlertEpisode): ReactElement => {
                if (item.alertGroupingRule?.name) {
                  return <span>{item.alertGroupingRule.name}</span>;
                }
                return <span>Manual Episode</span>;
              },
            },
            {
              field: {
                onCallDutyPolicies: {
                  name: true,
                  _id: true,
                },
              },
              title: "On-Call Duty Policies",
              fieldType: FieldType.Element,
              getElement: (item: AlertEpisode): ReactElement => {
                return (
                  <OnCallDutyPoliciesView
                    onCallPolicies={item.onCallDutyPolicies || []}
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                lastAlertAddedAt: true,
              },
              title: "Last Alert Added At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                createdByUser: {
                  name: true,
                  email: true,
                  profilePictureId: true,
                },
              },
              title: "Created By",
              fieldType: FieldType.Element,
              getElement: (item: AlertEpisode): ReactElement => {
                if (item.createdByUser) {
                  return <UserElement user={item.createdByUser} />;
                }

                return <p>System</p>;
              },
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
              getElement: (item: AlertEpisode): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ChangeEpisodeState
        episodeId={modelId}
        onActionComplete={async () => {
          await fetchData();
        }}
      />

      <div className="flex space-x-5 mt-5 mb-5 w-full justify-between">
        <InfoCard
          title={`${getAcknowledgeState()?.name || "Acknowledged"} in`}
          value={getInfoCardValue(getTimeToAcknowledge())}
          className="w-1/2"
        />
        <InfoCard
          title={`${getResolvedState()?.name || "Resolved"} in`}
          value={getInfoCardValue(getTimeToResolve())}
          className="w-1/2"
        />
      </div>

      <AlertEpisodeFeedElement alertEpisodeId={modelId} />
    </Fragment>
  );
};

export default AlertEpisodeView;
