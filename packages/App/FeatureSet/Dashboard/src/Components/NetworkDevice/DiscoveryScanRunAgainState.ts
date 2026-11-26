import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  canDiscoveryScanRunAgain,
  getDiscoveryScanRunRoute,
} from "Common/Utils/NetworkDiscovery/DiscoveryScanRun";

/*
 * What a discovery scan's row says about running it again (issue #10334),
 * apart from the component that draws it (DiscoveryScanRunAgain.tsx): when
 * its last run was, who asked for the run on the row, and the request
 * itself. React-free, like DiscoveryScanProgressState, so App's tests can
 * read it.
 */

// Whether the scan has ended its run, so it may be run again now.
export const isDiscoveryScanReadyToRunAgain: (
  scan: NetworkDeviceDiscoveryScan,
) => boolean = (scan: NetworkDeviceDiscoveryScan): boolean => {
  return canDiscoveryScanRunAgain(scan);
};

/*
 * When the scan last ran, for a scan whose run has ended: when that run
 * finished or failed, else - a row from before completedAt was always
 * written - when it started. Null while a run is queued or sweeping: the
 * row's progress is the answer then, and a queued run has no time of its
 * own until its probe starts it.
 */
export const getDiscoveryScanLastRunAt: (
  scan: NetworkDeviceDiscoveryScan,
) => Date | null = (scan: NetworkDeviceDiscoveryScan): Date | null => {
  if (!canDiscoveryScanRunAgain(scan)) {
    return null;
  }

  const lastRunAt: Date | undefined = scan.completedAt || scan.startedAt;

  if (!lastRunAt) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(lastRunAt);

  return Number.isFinite(date.getTime()) ? date : null;
};

/*
 * Who asked for the run on the row with Run Again: the person's name, else
 * their email. Null when the run started by itself - created, scheduled, or
 * after a settings change, which all clear runRequestedAt - and when no
 * person is named: an API key asked, or the person has been deleted.
 */
export const getDiscoveryScanRunRequester: (
  scan: NetworkDeviceDiscoveryScan,
) => string | null = (scan: NetworkDeviceDiscoveryScan): string | null => {
  if (!scan.runRequestedAt) {
    return null;
  }

  return (
    scan.runRequestedByUser?.name?.toString().trim() ||
    scan.runRequestedByUser?.email?.toString().trim() ||
    null
  );
};

/*
 * Ask the server to run the scan again. Resolves once the run is queued;
 * throws, with the server's refusal as its message (already running, its
 * probe not connected, ...), when it is not.
 *
 * The tenantid header the common headers carry scopes the request to the
 * project: the route refuses one without it rather than guessing.
 */
export const requestDiscoveryScanRun: (
  scanId: string,
) => Promise<void> = async (scanId: string): Promise<void> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        getDiscoveryScanRunRoute(scanId),
      ),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response.isFailure()) {
    throw new Error(API.getFriendlyMessage(response));
  }
};
