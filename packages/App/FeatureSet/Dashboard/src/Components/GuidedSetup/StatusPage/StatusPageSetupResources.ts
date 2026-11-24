import { StatusPageSetupStep } from "./StatusPageSetup";
import {
  GuidedSetupResourceRow,
  GuidedSetupResourceState,
  getGuidedSetupResourceStatus,
} from "../GuidedSetupResources";
import Route from "Common/Types/API/Route";
import {
  GuidedSetupResourceProgress,
  GuidedSetupResourceStatus,
  GuidedSetupRunResources,
} from "Common/Types/GuidedSetup/GuidedSetupRun";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE STATUS PAGE SETUP MAKES, AS IT MAKES IT (#10276). Step 1 makes
 * the page, or goes on with one of the project's, and puts the monitors
 * picked on it: the setup's panel lists both under the step, as the website
 * and on-call setups list theirs - waiting, being made, made or in use with
 * Open, or failed with why and Try again. Step 2 only shows the page as the
 * customers see it, and makes nothing.
 *
 * React-free, so the tests read it without a page.
 */

// A word the code chooses for each record (the run's resource keys).
export enum StatusPageSetupResource {
  StatusPage = "status_page",
  ShownMonitors = "shown_monitors",
}

export const STATUS_PAGE_RESOURCE_COPY: {
  statusPage: string;
  shownMonitors: string;
  adding: string;
  added: string;
} = {
  statusPage: translationKey("Status page"),
  shownMonitors: translationKey("Monitors shown"),
  // What the monitors' row says while they are put on the page, then once.
  adding: translationKey("Adding..."),
  added: translationKey("Added"),
};

export interface StatusPageSetupRowFacts {
  /*
   * The page step 1 goes on with: the run's, or the project's page picked
   * in the step while it is open.
   */
  page: { id: string; name: string } | null;
  // The name a new page is made with, while there is none yet.
  newPageName: string;
  // The page was there already: picked, or found by its name (#7252).
  isExistingPage: boolean;
  // Step 1's request is out.
  isSaving: boolean;
  // What the page shows, named as the project named it.
  shownNames: ReadonlyArray<string>;
  shownCount: number;
  // What is picked to go on the page, while it shows nothing yet.
  pickedNames: ReadonlyArray<string>;
  // How each record is getting on, as the run kept it.
  resources: GuidedSetupRunResources;
  // Where the page and the list of what it shows are, once it exists.
  pageRoute?: Route | undefined;
  shownRoute?: Route | undefined;
  // Joins names in the reader's script's way: ", ", "، " or "、".
  joinNames: (names: ReadonlyArray<string>) => string;
  // Step 1 again, after a failure: it makes nothing that is there already.
  onRetry: () => void;
}

// The rows step 1 lists: the page, then what it shows.
export const getStatusPageSetupRows: (
  facts: StatusPageSetupRowFacts,
) => Array<GuidedSetupResourceRow> = (
  facts: StatusPageSetupRowFacts,
): Array<GuidedSetupResourceRow> => {
  const pageState: GuidedSetupResourceState = getGuidedSetupResourceStatus({
    // A page of the project's is never made: only a new one is.
    isWorking: facts.isSaving && !facts.page,
    exists: Boolean(facts.page),
    isExisting: facts.isExistingPage,
    progress: facts.resources[StatusPageSetupResource.StatusPage],
  });

  const shownProgress: GuidedSetupResourceProgress | undefined =
    facts.resources[StatusPageSetupResource.ShownMonitors];

  const shownState: GuidedSetupResourceState = getGuidedSetupResourceStatus({
    // Monitors go on the page once it exists.
    isWorking: facts.isSaving && Boolean(facts.page),
    exists: facts.shownCount > 0,
    // A page that showed them already, and this run added none.
    isExisting:
      facts.isExistingPage &&
      shownProgress?.status !== GuidedSetupResourceStatus.Created,
    progress: shownProgress,
  });

  const shownNames: ReadonlyArray<string> =
    facts.shownCount > 0 ? facts.shownNames : facts.pickedNames;

  return [
    {
      key: StatusPageSetupResource.StatusPage,
      stepKey: StatusPageSetupStep.Pick,
      kind: STATUS_PAGE_RESOURCE_COPY.statusPage,
      name: facts.page?.name || facts.newPageName.trim() || undefined,
      status: pageState.status,
      error: pageState.error,
      route: facts.page ? facts.pageRoute : undefined,
      onRetry: facts.onRetry,
    },
    {
      key: StatusPageSetupResource.ShownMonitors,
      stepKey: StatusPageSetupStep.Pick,
      kind: STATUS_PAGE_RESOURCE_COPY.shownMonitors,
      name: shownNames.length > 0 ? facts.joinNames(shownNames) : undefined,
      status: shownState.status,
      statusText:
        shownState.status === GuidedSetupResourceStatus.Creating
          ? STATUS_PAGE_RESOURCE_COPY.adding
          : shownState.status === GuidedSetupResourceStatus.Created
            ? STATUS_PAGE_RESOURCE_COPY.added
            : undefined,
      error: shownState.error,
      route: facts.page && facts.shownCount > 0 ? facts.shownRoute : undefined,
      onRetry: facts.onRetry,
    },
  ];
};
