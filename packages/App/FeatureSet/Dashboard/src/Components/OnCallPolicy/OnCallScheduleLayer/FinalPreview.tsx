import LayersPreview from "./LayersPreview";
import {
  SCHEDULE_FINAL_SCHEDULE_DESCRIPTION,
  SCHEDULE_FINAL_SCHEDULE_TITLE,
  SCHEDULE_NO_LAYERS_TEST_ID,
  ScheduleNoLayersCopy,
} from "./ScheduleOverviewCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  onCallDutyPolicyScheduleId: ObjectID;
  projectId: ObjectID;
  /*
   * Told how many layers the schedule has, once they are read: the Overview
   * leaves out what only a schedule with shifts can use until it has some.
   */
  onLayersLoaded?: ((count: number) => void) | undefined;
}

const Layers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  const [layers, setLayers] = React.useState<
    Array<OnCallDutyPolicyScheduleLayer>
  >([]);

  const [layerUsers, setLayerUsers] = React.useState<
    Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>
  >({});

  const [scheduleTimezone, setScheduleTimezone] = React.useState<
    string | undefined
  >(undefined);

  const [error, setError] = React.useState<string>("");

  useEffect(() => {
    //fetch layers.
    fetchLayers().catch((err: Error) => {
      setError(err.message);
    });
  }, []);

  const fetchLayers: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      /*
       * Load the schedule's timezone so the preview resolves restriction windows
       * in the same zone the server uses to page people.
       */
      const schedule: OnCallDutyPolicySchedule | null =
        await ModelAPI.getItem<OnCallDutyPolicySchedule>({
          modelType: OnCallDutyPolicySchedule,
          id: props.onCallDutyPolicyScheduleId,
          select: {
            timezone: true,
          },
        });

      setScheduleTimezone(schedule?.timezone?.toString() || undefined);

      const layers: ListResult<OnCallDutyPolicyScheduleLayer> =
        await ModelAPI.getList<OnCallDutyPolicyScheduleLayer>({
          modelType: OnCallDutyPolicyScheduleLayer,
          query: {
            onCallDutyPolicyScheduleId: props.onCallDutyPolicyScheduleId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            order: true,
            name: true,
            description: true,
            startsAt: true,
            restrictionTimes: true,
            rotation: true,
            onCallDutyPolicyScheduleId: true,
            projectId: true,
            handOffTime: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      setLayers(layers.data);
      props.onLayersLoaded?.(layers.data.length);

      // get layer users.
      const layerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>> =
        {};

      const onCallDutyPolicyScheduleLayerUser: ListResult<OnCallDutyPolicyScheduleLayerUser> =
        await ModelAPI.getList<OnCallDutyPolicyScheduleLayerUser>({
          modelType: OnCallDutyPolicyScheduleLayerUser,
          query: {
            onCallDutyPolicyScheduleId: props.onCallDutyPolicyScheduleId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            onCallDutyPolicyScheduleLayerId: true,
            userId: true,
            user: {
              name: true,
              email: true,
            },
            onCallDutyPolicyScheduleId: true,
            projectId: true,
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      // map layer users to layer id.
      onCallDutyPolicyScheduleLayerUser.data.forEach(
        (layerUser: OnCallDutyPolicyScheduleLayerUser) => {
          const layerId: string =
            layerUser.onCallDutyPolicyScheduleLayerId?.toString() || "";
          if (!layerUsers[layerId]) {
            layerUsers[layerId] = [];
          }

          layerUsers[layerId]!.push(layerUser);
        },
      );

      setLayerUsers(layerUsers);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div>
      {/*
       * Nobody takes turns yet: the one thing to do is on the Layers page,
       * so the button goes there. In the Final Schedule's own card, where
       * who is on call shows once somebody is: the step sat under the
       * details card on the bare page, 13rem down, like a page of its own.
       */}
      {layers.length === 0 && (
        <Card title={SCHEDULE_FINAL_SCHEDULE_TITLE}>
          <div data-testid={SCHEDULE_NO_LAYERS_TEST_ID}>
            <EmptyState
              id="no-layers"
              title={ScheduleNoLayersCopy.title}
              description={ScheduleNoLayersCopy.description}
              icon={IconProp.SquareStack}
              paddingClassName="py-8"
              footer={
                /*
                 * Button keeps a dialog footer's left margin (md:ml-3), which
                 * would push it off the centre here, so its wrapper clears it.
                 */
                <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
                  <Button
                    title={ScheduleNoLayersCopy.button}
                    icon={IconProp.SquareStack}
                    buttonStyle={ButtonStyleType.PRIMARY}
                    dataTestId="schedule-no-layers-go-to-layers"
                    onClick={() => {
                      Navigation.navigate(
                        RouteUtil.populateRouteParams(
                          RouteMap[
                            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS
                          ] as Route,
                          { modelId: props.onCallDutyPolicyScheduleId },
                        ),
                      );
                    }}
                  />
                </div>
              }
            />
          </div>
        </Card>
      )}

      {layers.length > 0 && (
        <Card
          title={SCHEDULE_FINAL_SCHEDULE_TITLE}
          description={SCHEDULE_FINAL_SCHEDULE_DESCRIPTION}
        >
          <LayersPreview
            layers={layers}
            allLayerUsers={layerUsers}
            timezone={scheduleTimezone}
            onCallDutyPolicyScheduleId={props.onCallDutyPolicyScheduleId}
          />
        </Card>
      )}
    </div>
  );
};

export default Layers;
