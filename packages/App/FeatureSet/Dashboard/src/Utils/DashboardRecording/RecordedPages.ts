import PageMap from "../PageMap";
import RouteMap from "../RouteMap";
import { getFeedbackPageFor } from "../../Components/Feedback/FeedbackPage";
import Route from "Common/Types/API/Route";
import { toFeedbackPage } from "Common/Types/ProductFeedback/ProductFeedback";

/*
 * THE PAGES A RECORDING MAY SEE (issue #6834): the first run, and nothing
 * else. Not the explorers, not an incident, not a monitor's page - those
 * show what customers' systems say, and are never recorded at all.
 *
 * Named by their PageMap keys, never by address, so a page that is renamed
 * or moved (#6817, #6820) stays on the list. Leaving these pages pauses the
 * recording, and coming back resumes it.
 *
 * Adding a page here means it is recorded: only a page where people set
 * things up, whose own words are its interface, and whose customer data
 * (names, typed values, keys) is masked or blocked. The tests hold the list.
 */
export const RECORDED_PAGES: ReadonlyArray<PageMap> = [
  // Where a new account lands, and the project's first page.
  PageMap.WELCOME,
  PageMap.HOME,

  // Making the first monitor.
  PageMap.MONITOR_CREATE,

  // The guided setups (#6804, #6805, #6806).
  PageMap.MONITOR_GUIDED_SETUP,
  PageMap.ON_CALL_DUTY_GUIDED_SETUP,
  PageMap.STATUS_PAGES_GUIDED_SETUP,
  PageMap.SERVICES_GUIDED_SETUP,

  // How to Reach Me: a person's own ways to be paged (#6820).
  PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
  PageMap.USER_SETTINGS_ON_CALL_RULES,

  // Project Settings' first page - not its keys, members or billing.
  PageMap.SETTINGS,
];

let recordedPatterns: Set<string> | null = null;

// The recorded pages as the route patterns a path resolves to.
export const getRecordedPagePatterns: () => Set<string> = (): Set<string> => {
  if (!recordedPatterns) {
    recordedPatterns = new Set<string>();

    for (const page of RECORDED_PAGES) {
      const route: Route | undefined = RouteMap[page];

      if (route) {
        recordedPatterns.add(toFeedbackPage(route.toString()));
      }
    }
  }

  return recordedPatterns;
};

/*
 * Whether a path is one of the recorded pages: the route pattern it
 * resolves to (FeedbackPage, the same resolution an answer to "How easy
 * was that?" carries) is one of theirs. A record's page under a recorded
 * one (`/monitors/:id`) resolves to its own pattern, and is not recorded.
 */
export const isRecordedPath: (pathname: string) => boolean = (
  pathname: string,
): boolean => {
  try {
    return getRecordedPagePatterns().has(getFeedbackPageFor(pathname));
  } catch {
    return false;
  }
};
