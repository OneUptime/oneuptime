import UserElement, {
  ComponentProps as UserElementProps,
  getUserElementUserId,
} from "./User";
import useProjectMembership from "../../Utils/UseProjectMembership";
import ObjectID from "Common/Types/ObjectID";
import {
  ProjectMembershipAnswer,
  ProjectMembershipStatus,
} from "../../Utils/ProjectMembershipLoader";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A UserElement for a person a setup names on the project's behalf - the
 * user an incoming call rule rings, either side of an on-call override -
 * that says "No longer a member" when they have left the project, or
 * "Invitation not accepted yet" when they have not joined it yet. Nothing of
 * the project reaches them either way, so the setup needs somebody else, or
 * them to accept. Says nothing while membership is unknown
 * (ProjectMembershipLoader).
 */
const ProjectUserElement: FunctionComponent<UserElementProps> = (
  props: UserElementProps,
): ReactElement => {
  const userId: ObjectID | null = getUserElementUserId(props.user);
  const membership: ProjectMembershipAnswer = useProjectMembership(userId);

  return (
    <UserElement
      {...props}
      isNotProjectMember={membership === ProjectMembershipStatus.NotMember}
      hasPendingProjectInvitation={
        membership === ProjectMembershipStatus.Invited
      }
    />
  );
};

export default ProjectUserElement;
