import ProjectMembershipLoader, {
  ProjectMembershipAnswer,
} from "./ProjectMembershipLoader";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * Whether this person is a member of the current project, has only been
 * invited, or is not a member at all - or null while that is not known (see
 * ProjectMembershipLoader: null means "say nothing"). Every row of a page
 * asks on its own; the loader answers them all with one read. Asks again
 * when the person or the project changes.
 */
const useProjectMembership: (
  userId: ObjectID | string | null | undefined,
) => ProjectMembershipAnswer = (
  userId: ObjectID | string | null | undefined,
): ProjectMembershipAnswer => {
  const userIdString: string = userId?.toString() || "";
  const projectIdString: string =
    ProjectUtil.getCurrentProjectId()?.toString() || "";
  const [answer, setAnswer] = useState<ProjectMembershipAnswer>(null);

  useEffect(() => {
    let isActive: boolean = true;

    setAnswer(null);

    ProjectMembershipLoader.getMembership({
      projectId: projectIdString,
      userId: userIdString,
    })
      .then((membership: ProjectMembershipAnswer): void => {
        if (isActive) {
          setAnswer(membership);
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
  }, [userIdString, projectIdString]);

  return answer;
};

export default useProjectMembership;
