import {
  SetupChecklist,
  hasEssentialStepsLeft,
} from "../../Components/UserSettings/SetupChecklist/ChecklistModel";
import {
  RememberedLanding,
  getUserSettingsLandingPage,
  isLandingDueForRecheck,
  readRememberedLanding,
} from "../../Components/UserSettings/SetupChecklist/UserSettingsLanding";
import { loadSetupChecklist } from "../../Components/UserSettings/SetupChecklist/useSetupChecklist";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Navigate } from "react-router-dom";

/*
 * USER SETTINGS' OWN ADDRESS (…/user-settings), where the nav bar's User
 * Settings goes (#7039): it forwards to the setup checklist while essential
 * steps are left, and to Notification Methods - where User Settings always
 * opened - once none are. Every other page of User Settings keeps its own
 * address, and a link to it opens it as before.
 *
 * With an answer remembered from the last checklist read in this browser
 * (UserSettingsLanding), it forwards at once, and reads the checklist again
 * behind when that answer is old. With none, it reads the checklist first,
 * drawing the page's skeleton meanwhile, and hands what it read to the
 * checklist page, so that page draws it without a second read. A read that
 * fails forwards to Notification Methods, as User Settings always opened.
 * The forward replaces this address in the history, so Back does not bounce
 * through it.
 */

// What the forward hands the checklist page (react-router's location state).
export interface LandingHandOver {
  setupChecklist: SetupChecklist;
  userId: string;
  projectId: string;
  // When it was read (Date.now()).
  readAt: number;
}

/*
 * A hand-over this young is drawn as it is; an older one - the page opened
 * again from the history with Back - is read afresh.
 */
export const LANDING_HAND_OVER_FRESH_FOR_IN_MS: number = 30 * 1000;

// The checklist handed over for this person and project, while it is fresh.
export const readLandingHandOver: (data: {
  state: unknown;
  userId: string;
  projectId: string;
  now?: number | undefined;
}) => SetupChecklist | null = (data: {
  state: unknown;
  userId: string;
  projectId: string;
  now?: number | undefined;
}): SetupChecklist | null => {
  const handOver: Partial<LandingHandOver> | null =
    data.state && typeof data.state === "object"
      ? (data.state as { userSettingsLanding?: Partial<LandingHandOver> })
          .userSettingsLanding ?? null
      : null;

  if (
    !handOver ||
    !handOver.setupChecklist ||
    !data.userId ||
    !data.projectId ||
    handOver.userId !== data.userId ||
    handOver.projectId !== data.projectId ||
    typeof handOver.readAt !== "number" ||
    (data.now ?? Date.now()) - handOver.readAt >
      LANDING_HAND_OVER_FRESH_FOR_IN_MS
  ) {
    return null;
  }

  return handOver.setupChecklist;
};

interface Forward {
  page: PageMap;
  handOver?: LandingHandOver | undefined;
}

const UserSettingsLanding: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const userId: string = User.getUserId()?.toString() || "";
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  // Decided once, as the page opens: by the answer remembered, if any.
  const [remembered] = useState<RememberedLanding | null>(() => {
    return userId && projectId
      ? readRememberedLanding({ userId, projectId })
      : null;
  });

  const [forward, setForward] = useState<Forward | null>(() => {
    if (!userId || !projectId) {
      return { page: getUserSettingsLandingPage(false) };
    }

    return remembered
      ? { page: getUserSettingsLandingPage(remembered.hasEssentialStepsLeft) }
      : null;
  });

  useEffect(() => {
    if (!userId || !projectId) {
      return;
    }

    if (remembered) {
      /*
       * Forwarded by it already. Old, it is read again behind - unless the
       * checklist itself opens, which reads it as it draws.
       */
      if (
        !remembered.hasEssentialStepsLeft &&
        isLandingDueForRecheck(remembered, Date.now())
      ) {
        loadSetupChecklist({ userId, projectId }).catch(() => {
          // The next visit reads it again.
        });
      }

      return;
    }

    let isCancelled: boolean = false;

    loadSetupChecklist({ userId, projectId })
      .then((checklist: SetupChecklist) => {
        if (isCancelled) {
          return;
        }

        const isLeft: boolean = hasEssentialStepsLeft(checklist);

        setForward({
          page: getUserSettingsLandingPage(isLeft),
          handOver: isLeft
            ? {
                setupChecklist: checklist,
                userId: userId,
                projectId: projectId,
                readAt: Date.now(),
              }
            : undefined,
        });
      })
      .catch(() => {
        if (!isCancelled) {
          setForward({ page: getUserSettingsLandingPage(false) });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  if (!forward) {
    return <PageSkeleton />;
  }

  return (
    <Navigate
      replace={true}
      to={RouteUtil.populateRouteParams(
        RouteMap[forward.page] as Route,
      ).toString()}
      state={
        forward.handOver ? { userSettingsLanding: forward.handOver } : undefined
      }
    />
  );
};

export default UserSettingsLanding;
