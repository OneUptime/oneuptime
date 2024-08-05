import BaseModel, { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  item: BaseModel;
  modelType: DatabaseBaseModelType;
}

const NotificationMethodView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const item: BaseModel = BaseModel.fromJSONObject(props.item, props.modelType);

  return (
    <div>
      {item.getColumnValue("userEmail") &&
        (item.getColumnValue("userEmail") as JSONObject)["email"] && (
          <p>
            Email:{" "}
            {(item.getColumnValue("userEmail") as JSONObject)[
              "email"
            ]?.toString()}
          </p>
        )}
      {item.getColumnValue("userCall") &&
        (item.getColumnValue("userCall") as JSONObject)["phone"] && (
          <p>
            Call:{" "}
            {(item.getColumnValue("userCall") as JSONObject)[
              "phone"
            ]?.toString()}
          </p>
        )}
      {item.getColumnValue("userSms") &&
        (item.getColumnValue("userSms") as JSONObject)["phone"] && (
          <p>
            SMS:{" "}
            {(item.getColumnValue("userSms") as JSONObject)[
              "phone"
            ]?.toString()}
          </p>
        )}
    </div>
  );
};

export default NotificationMethodView;
