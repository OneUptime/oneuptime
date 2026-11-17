import { getStatusPageAccessState } from "./StatusPageAccessCopy";
import ObjectID from "Common/Types/ObjectID";
import {
  getStatusPageAccess,
  StatusPageAccess,
} from "Common/Types/StatusPage/StatusPageAccess";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * Who can see a status page, read once for a page that depends on it: the
 * Private Users, Single Sign-On and SCIM pages, whose settings do nothing
 * while the page is public (StatusPagePrivateOnlySettings), and Private
 * Users, whose people cannot sign in while visitors enter the password.
 *
 * `access` is undefined until it is read, and stays so when it cannot be:
 * the page then says what went wrong (`error`) and draws its settings as
 * they are.
 */
export interface StatusPageAccessRead {
  access: StatusPageAccess | undefined;
  error: string | null;
}

const useStatusPageAccess: (statusPageId: ObjectID) => StatusPageAccessRead = (
  statusPageId: ObjectID,
): StatusPageAccessRead => {
  const [read, setRead] = useState<StatusPageAccessRead>({
    access: undefined,
    error: null,
  });

  useEffect(() => {
    let isCurrent: boolean = true;

    const fetchAccess: () => Promise<void> = async (): Promise<void> => {
      try {
        const statusPage: StatusPage | null = await ModelAPI.getItem({
          modelType: StatusPage,
          id: statusPageId,
          select: {
            isPublicStatusPage: true,
            enableMasterPassword: true,
            masterPassword: true,
          },
        });

        if (!isCurrent) {
          return;
        }

        setRead({
          access: statusPage
            ? getStatusPageAccess(getStatusPageAccessState(statusPage))
            : undefined,
          error: null,
        });
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setRead({
          access: undefined,
          error: API.getFriendlyMessage(error),
        });
      }
    };

    void fetchAccess();

    return () => {
      isCurrent = false;
    };
  }, [statusPageId.toString()]);

  return read;
};

export default useStatusPageAccess;
