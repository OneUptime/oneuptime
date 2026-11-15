import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import OneUptimeDate from "Common/Types/Date";
import { INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS } from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * What an Incoming Request monitor's pages say about its project's incoming
 * request secrets: whether the project requires one
 * (Project.requireIncomingRequestSecret), and when this monitor last got a
 * request without a valid one, while that is recent
 * (Monitor.incomingRequestWithoutSecretAt, issue #8498) - so its heartbeat
 * URL can say its requests are refused, or would be. Read once per page,
 * fresh: the switch may have been turned a moment ago on another tab.
 * Everyone who can read the monitor may read both.
 *
 * Nothing to say until it is read, and when it cannot be: the lines it drives
 * are help, and a page without them is the page as it was.
 */

export interface IncomingRequestSecretStatus {
  isRequired: boolean;
  /*
   * When this monitor last got a request without a valid secret, if within
   * INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS; null otherwise.
   */
  withoutSecretAt: Date | null;
}

export const NOTHING_TO_SAY: IncomingRequestSecretStatus = {
  isRequired: false,
  withoutSecretAt: null,
};

// A request without a valid secret, while it is recent enough to mention.
export const getRecentWithoutSecretAt: (
  value: Date | string | null | undefined,
  now?: Date,
) => Date | null = (
  value: Date | string | null | undefined,
  now: Date = OneUptimeDate.getCurrentDate(),
): Date | null => {
  if (!value) {
    return null;
  }

  const at: Date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(at.getTime())) {
    return null;
  }

  const windowInMs: number =
    INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS * 60 * 60 * 1000;

  return now.getTime() - at.getTime() <= windowInMs ? at : null;
};

const useIncomingRequestSecretStatus: (
  monitorId?: ObjectID | undefined,
) => IncomingRequestSecretStatus = (
  monitorId?: ObjectID | undefined,
): IncomingRequestSecretStatus => {
  const [status, setStatus] =
    useState<IncomingRequestSecretStatus>(NOTHING_TO_SAY);

  const monitorIdString: string = monitorId?.toString() || "";

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    let isCurrent: boolean = true;

    const readProject: Promise<Project | null> = ModelAPI.getItem<Project>({
      modelType: Project,
      id: projectId,
      select: {
        requireIncomingRequestSecret: true,
      },
    }).catch(() => {
      return null;
    });

    const readMonitor: Promise<Monitor | null> = monitorIdString
      ? ModelAPI.getItem<Monitor>({
          modelType: Monitor,
          id: new ObjectID(monitorIdString),
          select: {
            incomingRequestWithoutSecretAt: true,
          },
        }).catch(() => {
          return null;
        })
      : Promise.resolve(null);

    Promise.all([readProject, readMonitor])
      .then(([project, monitor]: [Project | null, Monitor | null]) => {
        if (!isCurrent) {
          return;
        }

        setStatus({
          isRequired: Boolean(project?.requireIncomingRequestSecret),
          withoutSecretAt: getRecentWithoutSecretAt(
            monitor?.incomingRequestWithoutSecretAt,
          ),
        });
      })
      .catch(() => {
        // Help only: without the reads, the page reads as it did.
      });

    return () => {
      isCurrent = false;
    };
  }, [monitorIdString]);

  return status;
};

export default useIncomingRequestSecretStatus;
