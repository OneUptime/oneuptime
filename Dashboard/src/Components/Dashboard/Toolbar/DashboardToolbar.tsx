import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement } from "react";
import DashboardMode from "Common/Types/Dashboard/DashboardMode";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";

export interface ComponentProps {
  onEditClick: () => void;
  onSaveClick: () => void;
  onCancelEditClick: () => void;
  dashboardMode: DashboardMode;
}

const DashboardToolbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultWidthInDashbordUnits: number =
    DefaultDashboardSize.widthInDashboardUnits;
  const totalWidth: number = defaultWidthInDashbordUnits * 5.94; // 5 rem is the dashboard unit width, and 0.94 is margin between those units.

  const isEditMode = props.dashboardMode === DashboardMode.Edit;

  return (
    <div
      className={`m-1.5  p-1 h-20 pt-5 pb-5 pl-4 pr-4 rounded bg-white border-2 border-gray-100`}
      style={{
        width: `${totalWidth}rem`,
      }}
    >
      <div className="w-full flex justify-between">
        <div className="text-md">
          {/* Name Component */}
          Dashboard Name
        </div>
        <div className="flex">
          {isEditMode ? (
            <MoreMenu menuIcon={IconProp.Add} text="Add Component">
              <MoreMenuItem text={"Add Chart"} onClick={() => {}} />
              <MoreMenuItem text={"Add Value"} onClick={() => {}} />
              <MoreMenuItem text={"Add Text"} onClick={() => {}} />
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
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={props.onSaveClick}
            />
          )}
          {isEditMode && (
            <Button
              icon={IconProp.Close}
              title="Cancel"
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={props.onCancelEditClick}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardToolbar;
