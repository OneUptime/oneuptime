import {
  getDashboardAccessSelect,
  getDashboardAccessState,
} from "../Sharing/DashboardSharingCopy";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import {
  DashboardAccess,
  getDashboardAccess,
} from "Common/Types/Dashboard/DashboardAccess";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * Who can view a dashboard (Types/Dashboard/DashboardAccess), read once for
 * a page whose settings only some choices read - Private Users and Single
 * Sign-On, which only Only people who sign in reads (#10250). Read as the
 * Sharing card reads it (DashboardSharingCopy), so the two never disagree.
 *
 * undefined until it is read, and stays so when it cannot be: the page then
 * draws its settings as they are, and says nothing it cannot be sure of.
 */
const useDashboardAccess: (
  dashboardId: ObjectID,
) => DashboardAccess | undefined = (
  dashboardId: ObjectID,
): DashboardAccess | undefined => {
  const [access, setAccess] = useState<DashboardAccess | undefined>(undefined);

  useEffect(() => {
    let isCurrent: boolean = true;

    const fetchAccess: () => Promise<void> = async (): Promise<void> => {
      try {
        const dashboard: Dashboard | null = await ModelAPI.getItem({
          modelType: Dashboard,
          id: dashboardId,
          select: getDashboardAccessSelect(),
        });

        if (isCurrent && dashboard) {
          setAccess(getDashboardAccess(getDashboardAccessState(dashboard)));
        }
      } catch {
        // The settings below say what went wrong, if anything did.
      }
    };

    void fetchAccess();

    return () => {
      isCurrent = false;
    };
  }, [dashboardId.toString()]);

  return access;
};

export default useDashboardAccess;
