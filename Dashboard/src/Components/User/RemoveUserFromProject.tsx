import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, { ReactElement, useState } from "react";

export interface ComponentProps {
  projectId: ObjectID;
  userId: ObjectID;
  onActionComplete: () => void;
  onError: (error: string) => void;
}

const ResetObjectID: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  const removeUserFromProject: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);
      try {
        const teamMembers: ListResult<TeamMember> =
          await ModelAPI.getList<TeamMember>({
            modelType: TeamMember,
            query: {
              userId: props.userId,
              projectId: props.projectId,
            },
            select: {
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            sort: {},
            skip: 0,
            limit: 1,
          });

        for (const teamMember of teamMembers.data) {
          // remove team member from the team.
          await ModelAPI.deleteItem<TeamMember>({
            modelType: TeamMember,
            id: teamMember!.id!,
          });
        }

        setShowModal(false);
        props.onActionComplete?.();
      } catch (err) {
        setError(API.getFriendlyMessage(err));
        setShowErrorModal(true);
        props.onError?.(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  return (
    <>
      <Card
        title={`Remove User from Project`}
        description={`If you choose this option, the user will be removed from the project.`}
        buttons={[
          {
            title: `Remove`,
            buttonStyle: ButtonStyleType.DANGER,
            onClick: () => {
              setShowModal(true);
            },
            isLoading: isLoading,
            icon: IconProp.Trash,
          },
        ]}
      />

      {showModal ? (
        <ConfirmModal
          description={`Are you sure you want to reset remove this user?`}
          title={`Remove User`}
          onSubmit={async () => {
            await removeUserFromProject();
          }}
          isLoading={isLoading}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={`I understand, Please Remove User`}
          submitButtonType={ButtonStyleType.DANGER}
        />
      ) : (
        <></>
      )}

      {showErrorModal ? (
        <ConfirmModal
          description={error}
          title={`Remove User Error`}
          onSubmit={() => {
            setShowErrorModal(false);
            setError("");
          }}
          submitButtonText={`Close`}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ResetObjectID;
