import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * Whether the status page picker has anything to offer the person using it.
 *
 * Picking the status pages an incident is limited to needs status page read
 * access, the way picking its monitors needs monitor read access: incident
 * roles do not read status pages, and status page access can be limited to
 * pages with some labels. Such a person opens the picker to an empty list
 * with no idea why, so the page asks up front and shows a hint instead
 * (IncidentStatusPageScopeCopy.pickerNoAccessHint).
 *
 * "None" covers both a refused read and a project with no status page the
 * person can see: either way there is nothing to pick. A read that fails for
 * another reason is treated the same way - the hint only explains an empty
 * list, it never blocks the form.
 */

export enum StatusPagePickerAccess {
  Loading = "Loading",
  Available = "Available",
  None = "None",
}

const useStatusPagePickerAccess: () => StatusPagePickerAccess =
  (): StatusPagePickerAccess => {
    const [access, setAccess] = useState<StatusPagePickerAccess>(
      StatusPagePickerAccess.Loading,
    );

    useEffect(() => {
      let isCancelled: boolean = false;

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      /*
       * Started inside a promise, so a failure that happens before the
       * request is even made reads as "nothing to pick" like any other,
       * rather than taking down the page the picker sits on.
       */
      Promise.resolve()
        .then((): Promise<number> => {
          return ModelAPI.count<StatusPage>({
            modelType: StatusPage,
            query: projectId ? { projectId: projectId } : {},
          });
        })
        .then((count: number) => {
          if (!isCancelled) {
            setAccess(
              count > 0
                ? StatusPagePickerAccess.Available
                : StatusPagePickerAccess.None,
            );
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setAccess(StatusPagePickerAccess.None);
          }
        });

      return () => {
        isCancelled = true;
      };
    }, []);

    return access;
  };

export default useStatusPagePickerAccess;
