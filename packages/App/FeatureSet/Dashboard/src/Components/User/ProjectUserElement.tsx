import UserElement, {
  ComponentProps as UserElementProps,
  getUserElementUserId,
} from "./User";
import useIsProjectMember from "../../Utils/UseIsProjectMember";
import ObjectID from "Common/Types/ObjectID";
import { ProjectMembershipAnswer } from "../../Utils/ProjectMembershipLoader";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A UserElement for a person a setup names on the project's behalf - the
 * user an incoming call rule rings, either side of an on-call override -
 * that says "No longer a member" when they have left the project. Nothing
 * of the project reaches them any more, so the setup needs somebody else.
 * Says nothing while membership is unknown (ProjectMembershipLoader).
 */
const ProjectUserElement: FunctionComponent<UserElementProps> = (
  props: UserElementProps,
): ReactElement => {
  const userId: ObjectID | null = getUserElementUserId(props.user);
  const isMember: ProjectMembershipAnswer = useIsProjectMember(userId);

  return <UserElement {...props} isNotProjectMember={isMember === false} />;
};

export default ProjectUserElement;
