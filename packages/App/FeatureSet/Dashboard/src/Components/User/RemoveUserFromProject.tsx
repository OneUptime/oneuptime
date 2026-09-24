import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ProjectUsersModelAPI from "Common/UI/Utils/ModelAPI/ProjectUsersModelAPI";
import TeamMembershipRemoval, {
  RemovalConfirmation,
} from "../../Utils/TeamMembershipRemoval";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps {
  projectId: ObjectID;
  userId: ObjectID;
  onActionComplete: () => void;
  onError: (error: string) => void;
}

const CARD_TITLE: string = "Remove User from Project";

const RemoveUserFromProject: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  /*
   * Read on arrival rather than trusted from the layout: the layout loads once,
   * so after the user's last team was removed on the Teams tab this page still
   * opened with a live Remove button for someone who was no longer here, and
   * clicking it did nothing visible.
   */
  const [memberships, setMemberships] = useState<Array<TeamMember> | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string>("");

  const loadMemberships: PromiseVoidFunction = async (): Promise<void> => {
    setLoadError("");
    setMemberships(null);

    try {
      setMemberships(
        await TeamMembershipRemoval.fetchUserMemberships({
          userId: props.userId,
          projectId: props.projectId,
        }),
      );
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    loadMemberships().catch((err: Error) => {
      setLoadError(API.getFriendlyMessage(err));
    });
  }, [props.userId.toString(), props.projectId.toString()]);

  const removeUserFromProject: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);
      try {
        /*
         * One all-or-nothing request for every team, the same one the Users
         * table uses. This used to read ONE membership (limit: 1) and delete
         * it, so a user on several teams lost one of them and stayed in the
         * project - while the page navigated away as though it had worked.
         */
        await ProjectUsersModelAPI.removeUserFromProject({
          userId: props.userId,
        });

        setShowModal(false);
        props.onActionComplete?.();
      } catch (err) {
        setShowModal(false);
        setError(API.getFriendlyMessage(err));
        setShowErrorModal(true);
        props.onError?.(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  if (loadError) {
    return (
      <Card title={CARD_TITLE}>
        <ErrorMessage
          message={loadError}
          onRefreshClick={() => {
            loadMemberships().catch(() => {
              // loadMemberships reports its own failures.
            });
          }}
        />
      </Card>
    );
  }

  if (!memberships) {
    return (
      <Card title={CARD_TITLE}>
        <ComponentLoader />
      </Card>
    );
  }

  if (memberships.length === 0) {
    return (
      <Card
        title={CARD_TITLE}
        description="This user is no longer a member of this project - they are not on any of its teams - so there is nothing left to remove."
      />
    );
  }

  const user: User | undefined = memberships.find((membership: TeamMember) => {
    return Boolean(membership.user);
  })?.user;

  const teamNames: Array<string> =
    TeamMembershipRemoval.getTeamNames(memberships);

  const confirmation: RemovalConfirmation =
    TeamMembershipRemoval.buildProjectRemovalConfirmation({
      user: user,
      teamNames: teamNames,
      hasJoined: memberships.some((membership: TeamMember) => {
        return Boolean(membership.hasAcceptedInvitation);
      }),
    });

  const teamList: string = TeamMembershipRemoval.formatNames(teamNames);

  return (
    <>
      <Card
        title={CARD_TITLE}
        description={`Remove ${TeamMembershipRemoval.getUserLabel(user)} from this project, and from every team they belong to in it${
          teamList ? `: ${teamList}` : ""
        }. They will lose access to the project immediately.`}
        buttons={[
          {
            title: `Remove from Project`,
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
          title={confirmation.title}
          description={confirmation.description}
          onSubmit={async () => {
            await removeUserFromProject();
          }}
          isLoading={isLoading}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={confirmation.submitButtonText}
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

export default RemoveUserFromProject;
