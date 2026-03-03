import LayersPreview from "./LayersPreview";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
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
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  onCallDutyPolicyScheduleId: ObjectID;
  projectId: ObjectID;
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
      {layers.length === 0 && (
        <EmptyState
          showSolidBackground={false}
          id="no-layers"
          title={
            "No Layers in this On Call Schedule. Please go to layers tab to add one."
          }
          description={
            "No layers in this on-call schedule. Please add a layer to start on-call rotations and scheduling."
          }
          icon={IconProp.SquareStack}
        />
      )}

      {layers.length > 0 && (
        <Card
          title={`Final Schedule`}
          description={
            "Here is the final schedule of who is on call and when. This is based on your local timezone - " +
            OneUptimeDate.getCurrentTimezoneString()
          }
        >
          <LayersPreview layers={layers} allLayerUsers={layerUsers} />
        </Card>
      )}
    </div>
  );
};

export default Layers;
