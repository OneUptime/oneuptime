import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import MonitorGroupMonitorsCopy from "./MonitorGroupMonitorsCopy";

/*
 * The decisions behind a monitor group's Add Monitors, kept free of React so
 * App/Tests can hold them: which monitors the dialog offers, and what it says
 * when some of the picked ones could not be added.
 */

/*
 * One monitor the dialog offers. A plain shape, not Dropdown's option type:
 * App/Tests load this file, and the Dropdown component imports React, which
 * App does not install.
 */
export interface MonitorToOffer {
  value: string;
  label: string;
}

/*
 * The project's monitors the group does not hold yet, by name. Offering a
 * monitor the group already has would add it twice: nothing stops a second
 * row pairing the same monitor with the same group.
 */
export const getMonitorsToOffer: (data: {
  projectMonitors: Array<Monitor>;
  monitorIdsInGroup: Array<ObjectID | string>;
}) => Array<MonitorToOffer> = (data: {
  projectMonitors: Array<Monitor>;
  monitorIdsInGroup: Array<ObjectID | string>;
}): Array<MonitorToOffer> => {
  const inGroup: Set<string> = new Set<string>(
    data.monitorIdsInGroup.map((id: ObjectID | string): string => {
      return id.toString().toLowerCase();
    }),
  );

  const options: Array<MonitorToOffer> = [];

  for (const monitor of data.projectMonitors) {
    const id: string | undefined = monitor._id?.toString();

    if (!id || inGroup.has(id.toLowerCase())) {
      continue;
    }

    options.push({
      value: id,
      label: monitor.name?.toString() || id,
    });
  }

  return options;
};

export interface MonitorGroupAddResult {
  // How many of the picked monitors were added.
  added: number;
  // How many were picked.
  total: number;
  // Why the first one that failed was refused.
  firstError: string | undefined;
}

/*
 * What the dialog says after adding: nothing when every pick was added, the
 * reason when none was, and how many made it plus the reason otherwise.
 */
export const getAddMonitorsErrorMessage: (
  result: MonitorGroupAddResult,
  translator: Translator,
) => string | null = (
  result: MonitorGroupAddResult,
  translator: Translator,
): string | null => {
  if (result.added === result.total || !result.firstError) {
    return null;
  }

  if (result.added === 0) {
    return translator.translateTemplate(
      MonitorGroupMonitorsCopy.noneAddedError,
      {
        reason: result.firstError,
      },
    );
  }

  return translator.translateTemplate(
    MonitorGroupMonitorsCopy.someNotAddedError,
    {
      added: String(result.added),
      total: String(result.total),
      reason: result.firstError,
    },
  );
};
