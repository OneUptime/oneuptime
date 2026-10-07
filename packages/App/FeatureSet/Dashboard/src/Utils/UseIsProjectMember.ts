import ProjectMembershipLoader, {
  ProjectMembershipAnswer,
} from "./ProjectMembershipLoader";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * Whether this person is a member of the current project: true, false, or
 * null while it is not known (see ProjectMembershipLoader - null means "say
 * nothing"). Every row of a page asks on its own; the loader answers them all
 * with one read.
 */
const useIsProjectMember: (
  userId: ObjectID | string | null | undefined,
) => ProjectMembershipAnswer = (
  userId: ObjectID | string | null | undefined,
): ProjectMembershipAnswer => {
  const userIdString: string = userId?.toString() || "";
  const [answer, setAnswer] = useState<ProjectMembershipAnswer>(null);

  useEffect(() => {
    let isActive: boolean = true;

    setAnswer(null);

    ProjectMembershipLoader.isMember({
      projectId: ProjectUtil.getCurrentProjectId(),
      userId: userIdString,
    })
      .then((isMember: ProjectMembershipAnswer): void => {
        if (isActive) {
          setAnswer(isMember);
        }
      })
      .catch((): void => {
        if (isActive) {
          setAnswer(null);
        }
      });

    return (): void => {
      isActive = false;
    };
  }, [userIdString]);

  return answer;
};

export default useIsProjectMember;
