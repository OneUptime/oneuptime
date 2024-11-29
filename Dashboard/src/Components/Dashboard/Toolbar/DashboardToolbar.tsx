import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement, useState } from "react";
import DashboardMode from "Common/Types/Dashboard/DashboardMode";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import Modal from "Common/UI/Components/Modal/Modal";
import DashboardStartAndEndDate from "../Types/DashboardStartAndEndDate";
import DashboardStartAndEndDateElement from "./DashboardStartAndEndDateEdit";
import DashboardStartAndEndDateView from "./DashboardStartAndEndDateView";

export interface ComponentProps {
  onEditClick: () => void;
  onSaveClick: () => void;
  onCancelEditClick: () => void;
  onFullScreenClick: () => void;
  onCollapseScreenClick: () => void;
  dashboardMode: DashboardMode;
  onAddComponentClick: (type: DashboardComponentType) => void;
  isFullScreen: boolean;
  isSaving: boolean;
  dashboardName: string;
  startAndEndDate: DashboardStartAndEndDate;
  onStartAndEndDateChange: (startAndEndDate: DashboardStartAndEndDate) => void;
}

const DashboardToolbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isEditMode: boolean = props.dashboardMode === DashboardMode.Edit;

  const [tempStartAndEndDate, setTempStartAndEndDate] =
    useState<DashboardStartAndEndDate | null>(null);
  const [showTimeSelectModal, setShowTimeSelectModal] =
    useState<boolean>(false);

  return (
    <div
      className={`mt-1.5 mb-1.5 ml-1 mr-1 p-1 h-20 pt-5 pb-5 pl-4 pr-4 rounded bg-white border-2 border-gray-100`}
    >
      <div className="w-full flex justify-between">
        <div className="text-md font-medium mt-2">
          {/* Name Component */}
          {props.dashboardName}
        </div>
        {!props.isSaving && (
          <div className="flex">
            <div className="mt-2">
              <DashboardStartAndEndDateView
                dashboardStartAndEndDate={props.startAndEndDate}
                onClick={() => {
                  setTempStartAndEndDate(props.startAndEndDate);
                  setShowTimeSelectModal(true);
                }}
              />
            </div>

            {isEditMode ? (
              <MoreMenu menuIcon={IconProp.Add} text="Add Component">
                <MoreMenuItem
                  text={"Add Chart"}
                  key={"add-chart"}
                  onClick={() => {
                    props.onAddComponentClick(DashboardComponentType.Chart);
                  }}
                />
                <MoreMenuItem
                  text={"Add Value"}
                  key={"add-value"}
                  onClick={() => {
                    props.onAddComponentClick(DashboardComponentType.Value);
                  }}
                />
                <MoreMenuItem
                  text={"Add Text"}
                  key={"add-text"}
                  onClick={() => {
                    props.onAddComponentClick(DashboardComponentType.Text);
                  }}
                />
              </MoreMenu>
            ) : (
              <></>
            )}

            {!isEditMode && !props.isFullScreen && (
              <Button
                icon={IconProp.Expand}
                buttonStyle={ButtonStyleType.ICON}
                onClick={props.onFullScreenClick}
                tooltip="Full Screen"
              />
            )}

            {!isEditMode && props.isFullScreen && (
              <Button
                icon={IconProp.Collapse}
                buttonStyle={ButtonStyleType.ICON}
                onClick={props.onCollapseScreenClick}
                tooltip="Collapse Screen"
              />
            )}

            {!isEditMode && (
              <Button
                icon={IconProp.Pencil}
                title="Edit"
                buttonStyle={ButtonStyleType.ICON}
                onClick={props.onEditClick}
                tooltip="Edit"
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
        )}
        {props.isSaving && (
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-900"></div>
            <div className="ml-2">Saving...</div>
          </div>
        )}
      </div>

      {showTimeSelectModal && (
        <Modal
          title="Select Start and End Time"
          onClose={() => {
            setTempStartAndEndDate(null);
            setShowTimeSelectModal(false);
          }}
          onSubmit={() => {
            if (tempStartAndEndDate) {
              props.onStartAndEndDateChange(tempStartAndEndDate);
            }
            setShowTimeSelectModal(false);
            setTempStartAndEndDate(null);
          }}
        >
          <div className="mt-5">
            <DashboardStartAndEndDateElement
              value={tempStartAndEndDate || undefined}
              onChange={(startAndEndDate: DashboardStartAndEndDate) => {
                setTempStartAndEndDate(startAndEndDate);
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default DashboardToolbar;
