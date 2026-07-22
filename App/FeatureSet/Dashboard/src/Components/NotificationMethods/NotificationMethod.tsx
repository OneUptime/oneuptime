import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NotificationMethodUtil, {
  NotificationMethodDisplayItem,
} from "Common/UI/Utils/NotificationMethodUtil";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  item: BaseModel;
  modelType: DatabaseBaseModelType;
}

const NotificationMethodView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const item: BaseModel = BaseModel.fromJSONObject(props.item, props.modelType);

  const displayItems: Array<NotificationMethodDisplayItem> =
    NotificationMethodUtil.getDisplayItems(item);

  return (
    <div>
      {displayItems.map((displayItem: NotificationMethodDisplayItem) => {
        return (
          <p key={displayItem.title}>
            {displayItem.title}: {displayItem.value}
          </p>
        );
      })}
    </div>
  );
};

export default NotificationMethodView;
