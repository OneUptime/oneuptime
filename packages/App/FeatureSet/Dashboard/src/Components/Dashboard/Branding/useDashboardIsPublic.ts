import {
  getDashboardAccessSelect,
  getDashboardAccessState,
} from "../Sharing/DashboardSharingCopy";
import ObjectID from "Common/Types/ObjectID";
import {
  DashboardAccess,
  getDashboardAccess,
} from "Common/Types/Dashboard/DashboardAccess";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * Whether a dashboard is shared with a public link, read once for a page
 * whose settings only the public link reads: Branding and Custom Domains
 * (DashboardPublicOnlySettings). Who can view it is read as the Sharing card
 * reads it (DashboardSharingCopy), so the two never disagree.
 *
 * undefined until it is read, and stays so when it cannot be: the page then
 * draws its settings as they are, and says nothing it cannot be sure of.
 */
const useDashboardIsPublic: (dashboardId: ObjectID) => boolean | undefined = (
  dashboardId: ObjectID,
): boolean | undefined => {
  const [isPublic, setIsPublic] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let isCurrent: boolean = true;

    const fetchSharing: () => Promise<void> = async (): Promise<void> => {
      try {
        const dashboard: Dashboard | null = await ModelAPI.getItem({
          modelType: Dashboard,
          id: dashboardId,
          select: getDashboardAccessSelect(),
        });

        if (isCurrent && dashboard) {
          setIsPublic(
            getDashboardAccess(getDashboardAccessState(dashboard)) !==
              DashboardAccess.ProjectOnly,
          );
        }
      } catch {
        // The settings below say what went wrong, if anything did.
      }
    };

    void fetchSharing();

    return () => {
      isCurrent = false;
    };
  }, [dashboardId.toString()]);

  return isPublic;
};

export default useDashboardIsPublic;
