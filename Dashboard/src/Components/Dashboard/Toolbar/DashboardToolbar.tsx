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
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Loader from "Common/UI/Components/Loader/Loader";

export interface ComponentProps {
  onEditClick: () => void;
  onSaveClick: () => void;
  onCancelEditClick: () => void;
  onFullScreenClick: () => void;
  dashboardMode: DashboardMode;
  onAddComponentClick: (type: DashboardComponentType) => void;
  isSaving: boolean;
  dashboardName: string;
  startAndEndDate: DashboardStartAndEndDate;
  onStartAndEndDateChange: (startAndEndDate: DashboardStartAndEndDate) => void;
  dashboardViewConfig: DashboardViewConfig;
}

const DashboardToolbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isEditMode: boolean = props.dashboardMode === DashboardMode.Edit;

  const [tempStartAndEndDate, setTempStartAndEndDate] =
    useState<DashboardStartAndEndDate | null>(null);
  const [showTimeSelectModal, setShowTimeSelectModal] =
    useState<boolean>(false);

  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);

  const isSaving: boolean = props.isSaving;

  return (
    <div
      className={`mt-1.5 mb-1.5 ml-1 mr-1 p-1 h-20 pt-5 pb-5 pl-4 pr-4 rounded bg-white border-2 border-gray-100`}
    >
      <div className="w-full flex justify-between">
        <div className="text-md font-medium mt-2">
          {/* Name Component */}
          {props.dashboardName}
        </div>
        {!isSaving && (
          <div className="flex">
            {props.dashboardViewConfig &&
              props.dashboardViewConfig.components &&
              props.dashboardViewConfig.components.length > 0 && (
                <div className="mt-1.5">
                  <DashboardStartAndEndDateView
                    dashboardStartAndEndDate={props.startAndEndDate}
                    onClick={() => {
                      setTempStartAndEndDate(props.startAndEndDate);
                      setShowTimeSelectModal(true);
                    }}
                  />
                </div>
              )}

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

            {!isEditMode && (
              <Button
                icon={IconProp.Expand}
                buttonStyle={ButtonStyleType.ICON}
                onClick={props.onFullScreenClick}
                tooltip="Full Screen"
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
                onClick={() => {
                  setShowCancelModal(true);
                }}
              />
            )}
          </div>
        )}
        {isSaving && (
          <div className="flex items-center">
            <Loader />
            <div className="ml-2 text-sm text-gray-400">Saving...</div>
          </div>
        )}
      </div>

      {showCancelModal ? (
        <ConfirmModal
          title={`Are you sure?`}
          description={
            "You have unsaved changes. Are you sure you want to cancel?"
          }
          submitButtonType={ButtonStyleType.DANGER}
          submitButtonText={"Discard Changes"}
          closeButtonText={"Keep Editing"}
          onSubmit={() => {
            props.onCancelEditClick();
            setShowCancelModal(false);
          }}
          onClose={() => {
            setShowCancelModal(false);
          }}
        />
      ) : (
        <></>
      )}

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
