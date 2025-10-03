import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { type ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import PageComponentProps from "../../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallDutyScheduleSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const duplicateScheduleLayers: (
    newSchedule: OnCallDutySchedule,
  ) => Promise<void> = async (
    newSchedule: OnCallDutySchedule,
  ): Promise<void> => {
    const projectId: ObjectID | null =
      newSchedule.projectId || ProjectUtil.getCurrentProjectId();

    if (!newSchedule.id) {
      throw new Error(
        "Failed to duplicate schedule layers: new schedule ID is missing.",
      );
    }

    if (!projectId) {
      throw new Error(
        "Failed to duplicate schedule layers: project ID is missing.",
      );
    }

    try {
      const existingLayers: ListResult<OnCallDutyPolicyScheduleLayer> =
        await ModelAPI.getList<OnCallDutyPolicyScheduleLayer>({
          modelType: OnCallDutyPolicyScheduleLayer,
          query: {
            onCallDutyPolicyScheduleId: modelId,
            projectId: projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            order: true,
            name: true,
            description: true,
            startsAt: true,
            restrictionTimes: true,
            rotation: true,
            handOffTime: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      if (existingLayers.data.length === 0) {
        return;
      }

      for (const layer of existingLayers.data) {
        if (!layer.id) {
          continue;
        }

        const newLayer: OnCallDutyPolicyScheduleLayer =
          new OnCallDutyPolicyScheduleLayer();
        newLayer.projectId = projectId;
        newLayer.onCallDutyPolicyScheduleId = newSchedule.id;
        if (!layer.name) {
          throw new Error(
            "Failed to duplicate schedule layers: layer name is missing.",
          );
        }
        newLayer.name = layer.name;

        if (layer.description !== undefined) {
          newLayer.description = layer.description;
        }

        if (typeof layer.order === "number") {
          newLayer.order = layer.order;
        }

        if (!layer.startsAt) {
          throw new Error(
            "Failed to duplicate schedule layers: layer start time is missing.",
          );
        }
        newLayer.startsAt = new Date(layer.startsAt);

        if (!layer.handOffTime) {
          throw new Error(
            "Failed to duplicate schedule layers: layer hand off time is missing.",
          );
        }
        newLayer.handOffTime = new Date(layer.handOffTime);
        if (layer.rotation) {
          newLayer.rotation = layer.rotation;
        }

        if (layer.restrictionTimes) {
          newLayer.restrictionTimes = layer.restrictionTimes;
        }

        const createdLayer: OnCallDutyPolicyScheduleLayer = (
          await ModelAPI.create<OnCallDutyPolicyScheduleLayer>({
            model: newLayer,
            modelType: OnCallDutyPolicyScheduleLayer,
          })
        ).data as OnCallDutyPolicyScheduleLayer;

        if (!createdLayer.id) {
          continue;
        }

        const existingLayerUsers: ListResult<OnCallDutyPolicyScheduleLayerUser> =
          await ModelAPI.getList<OnCallDutyPolicyScheduleLayerUser>({
            modelType: OnCallDutyPolicyScheduleLayerUser,
            query: {
              onCallDutyPolicyScheduleId: modelId,
              onCallDutyPolicyScheduleLayerId: layer.id,
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              order: true,
              userId: true,
            },
            sort: {
              order: SortOrder.Ascending,
            },
          });

        for (const existingLayerUser of existingLayerUsers.data) {
          if (!existingLayerUser.userId) {
            continue;
          }

          const newLayerUser: OnCallDutyPolicyScheduleLayerUser =
            new OnCallDutyPolicyScheduleLayerUser();
          newLayerUser.projectId = projectId;
          newLayerUser.onCallDutyPolicyScheduleId = newSchedule.id;
          newLayerUser.onCallDutyPolicyScheduleLayerId = createdLayer.id;
          newLayerUser.userId = existingLayerUser.userId;
          if (typeof existingLayerUser.order === "number") {
            newLayerUser.order = existingLayerUser.order;
          }

          await ModelAPI.create<OnCallDutyPolicyScheduleLayerUser>({
            model: newLayerUser,
            modelType: OnCallDutyPolicyScheduleLayerUser,
          });
        }
      }
    } catch (err) {
      throw new Error(
        `Failed to duplicate schedule layers: ${API.getFriendlyMessage(err)}`,
      );
    }
  };

  return (
    <Fragment>
      <div className="mt-5">
        <DuplicateModel
          modelId={modelId}
          modelType={OnCallDutySchedule}
          fieldsToDuplicate={{
            description: true,
            labels: true,
            projectId: true,
          }}
          onDuplicateSuccess={duplicateScheduleLayers}
          navigateToOnSuccess={RouteUtil.populateRouteParams(
            RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
          )}
          fieldsToChange={[
            {
              field: {
                name: true,
              },
              title: "New Schedule Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "New Schedule Name",
              validation: {
                minLength: 2,
              },
            },
          ]}
        />
      </div>
    </Fragment>
  );
};

export default OnCallDutyScheduleSettings;
