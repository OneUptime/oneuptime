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
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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

  const duplicateScheduleLayers = async (
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
      const existingLayers =
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

      for (const existingLayer of existingLayers.data) {
        if (!existingLayer.id) {
          continue;
        }

        const newLayer = new OnCallDutyPolicyScheduleLayer();
        newLayer.projectId = projectId;
        newLayer.onCallDutyPolicyScheduleId = newSchedule.id;
        if (!existingLayer.name) {
          throw new Error(
            "Failed to duplicate schedule layers: layer name is missing.",
          );
        }
        newLayer.name = existingLayer.name;

        if (existingLayer.description !== undefined) {
          newLayer.description = existingLayer.description;
        }

        if (typeof existingLayer.order === "number") {
          newLayer.order = existingLayer.order;
        }

        if (!existingLayer.startsAt) {
          throw new Error(
            "Failed to duplicate schedule layers: layer start time is missing.",
          );
        }
        newLayer.startsAt = new Date(existingLayer.startsAt);

        if (!existingLayer.handOffTime) {
          throw new Error(
            "Failed to duplicate schedule layers: layer hand off time is missing.",
          );
        }
        newLayer.handOffTime = new Date(existingLayer.handOffTime);
        if (existingLayer.rotation) {
          newLayer.rotation = existingLayer.rotation;
        }

        if (existingLayer.restrictionTimes) {
          newLayer.restrictionTimes = existingLayer.restrictionTimes;
        }

        const createdLayerResponse =
          await ModelAPI.create<OnCallDutyPolicyScheduleLayer>({
            model: newLayer,
            modelType: OnCallDutyPolicyScheduleLayer,
          });

        const createdLayer =
          createdLayerResponse.data as OnCallDutyPolicyScheduleLayer;

        if (!createdLayer.id) {
          continue;
        }

        const existingLayerUsers =
          await ModelAPI.getList<OnCallDutyPolicyScheduleLayerUser>({
            modelType: OnCallDutyPolicyScheduleLayerUser,
            query: {
              onCallDutyPolicyScheduleId: modelId,
              onCallDutyPolicyScheduleLayerId: existingLayer.id,
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

        for (const layerUser of existingLayerUsers.data) {
          if (!layerUser.userId) {
            continue;
          }

          const newLayerUser = new OnCallDutyPolicyScheduleLayerUser();
          newLayerUser.projectId = projectId;
          newLayerUser.onCallDutyPolicyScheduleId = newSchedule.id;
          newLayerUser.onCallDutyPolicyScheduleLayerId = createdLayer.id;
          newLayerUser.userId = layerUser.userId;
          if (typeof layerUser.order === "number") {
            newLayerUser.order = layerUser.order;
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
