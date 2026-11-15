import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * Whether the current project requires an incoming request secret
 * (Project.requireIncomingRequestSecret), for an Incoming Request monitor's
 * pages to say its senders must send one. Read once per page, fresh - the
 * switch may have been turned a moment ago on another tab. Everyone in the
 * project may read the column.
 *
 * False until it is read, and when it cannot be: the note it drives is help,
 * and a page without it is the page as it was.
 */
const useIncomingRequestSecretRequirement: () => boolean = (): boolean => {
  const [isRequired, setIsRequired] = useState<boolean>(false);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getItem<Project>({
      modelType: Project,
      id: projectId,
      select: {
        requireIncomingRequestSecret: true,
      },
    })
      .then((project: Project | null) => {
        if (isCurrent) {
          setIsRequired(Boolean(project?.requireIncomingRequestSecret));
        }
      })
      .catch(() => {
        // The note is help: without the read, the page reads as it did.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  return isRequired;
};

export default useIncomingRequestSecretRequirement;
