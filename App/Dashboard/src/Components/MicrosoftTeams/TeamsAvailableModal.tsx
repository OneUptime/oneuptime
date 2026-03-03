import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";

export interface TeamItem {
  id: string;
  name: string;
}

export interface TeamsAvailableModalProps {
  isOpen: boolean;
  onClose: VoidFunction;
  onRefresh: () => Promise<void> | void;
  isRefreshing: boolean;
  teams: Array<TeamItem>;
  isLoading: boolean;
  error?: string;
  isAdminConsentCompleted: boolean;
}

const TeamsAvailableModal: FunctionComponent<TeamsAvailableModalProps> = (
  props: TeamsAvailableModalProps,
): ReactElement | null => {
  // No search; render a clean list of team names only.

  if (!props.isOpen) {
    return null;
  }

  return (
    <Modal
      title="Microsoft Teams - Available Teams"
      description="Teams that OneUptime can access in your tenant. Use Refresh if you recently added or changed teams."
      modalWidth={ModalWidth.Large}
      submitButtonStyleType={ButtonStyleType.NORMAL}
      submitButtonText="Close"
      onSubmit={props.onClose}
      rightElement={
        <Button
          title="Refresh"
          icon={IconProp.Refresh}
          isLoading={props.isRefreshing}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={async () => {
            await props.onRefresh();
          }}
        />
      }
      isBodyLoading={props.isLoading}
    >
      <>
        {props.error && (
          <div className="mb-4">
            <ErrorMessage message={<div>{props.error}</div>} />
          </div>
        )}

        {!props.error && (
          <div className="space-y-4">
            {props.teams.length === 0 && (
              <div className="text-center py-12 text-gray-500 border rounded-md">
                {props.isAdminConsentCompleted
                  ? "No teams found. Try refreshing the list or verify your Microsoft Teams permissions."
                  : "Admin consent is required to list teams."}
              </div>
            )}

            {props.teams.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-gray-600">
                  Teams ({props.teams.length})
                </div>
                <div className="max-h-[60vh] overflow-y-auto pr-1">
                  <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 overflow-hidden bg-white">
                    {props.teams.map((t: TeamItem) => {
                      return (
                        <li
                          key={t.id}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="h-9 w-9 flex items-center justify-center rounded-full bg-gray-50 text-gray-600">
                            <Icon
                              icon={IconProp.Team}
                              size={SizeProp.Large}
                              thick={ThickProp.Thick}
                              className="h-5 w-5"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                              {t.name}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </>
    </Modal>
  );
};

export default TeamsAvailableModal;
