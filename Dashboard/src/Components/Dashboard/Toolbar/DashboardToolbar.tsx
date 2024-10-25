import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement } from "react";
import DashboardMode from "Common/Types/Dashboard/DashboardMode";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";

export interface ComponentProps {
  onEditClick: () => void;
  onSaveClick: () => void;
  onCancelEditClick: () => void;
  dashboardMode: DashboardMode;
  onAddComponentClick: (type: DashboardComponentType) => void;
}

const DashboardToolbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isEditMode: boolean = props.dashboardMode === DashboardMode.Edit;

  return (
    <div
      className={`m-1.5  p-1 h-20 pt-5 pb-5 pl-4 pr-4 rounded bg-white border-2 border-gray-100`}
    >
      <div className="w-full flex justify-between">
        <div className="text-md">
          {/* Name Component */}
          Dashboard Name
        </div>
        <div className="flex">
          {isEditMode ? (
            <MoreMenu menuIcon={IconProp.Add} text="Add Component">
              <MoreMenuItem
                text={"Add Chart"}
                onClick={() => {
                  props.onAddComponentClick(DashboardComponentType.Chart);
                }}
              />
              <MoreMenuItem
                text={"Add Value"}
                onClick={() => {
                  props.onAddComponentClick(DashboardComponentType.Value);
                }}
              />
              <MoreMenuItem
                text={"Add Text"}
                onClick={() => {
                  props.onAddComponentClick(DashboardComponentType.Text);
                }}
              />
            </MoreMenu>
          ) : (
            <></>
          )}

          {!isEditMode && (
            <Button
              icon={IconProp.Pencil}
              title="Edit"
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={props.onEditClick}
            />
          )}
          {isEditMode && (
            <Button
              icon={IconProp.Check}
              title="Save"
              buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
              onClick={props.onSaveClick}
            />
          )}
          {isEditMode && (
            <Button
              icon={IconProp.Close}
              title="Cancel"
              buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
              onClick={props.onCancelEditClick}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardToolbar;
