import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  STATUS_PAGE_RESOURCE_COPY,
  StatusPageSetupResource,
  StatusPageSetupRowFacts,
  getStatusPageSetupRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupResources";
import { StatusPageSetupStep } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import { GuidedSetupResourceRow } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupResources";
import Route from "../../../Types/API/Route";
import { GuidedSetupResourceStatus } from "../../../Types/GuidedSetup/GuidedSetupRun";

/*
 * WHAT THE STATUS PAGE SETUP'S PANEL LISTS (#10276): step 1's page and the
 * monitors it shows, each waiting, being made, made or in use with Open, or
 * failed with why and Try again - from what the page knows now and what the
 * run kept (#7253).
 */

// When the run kept each status, by the server's clock.
const AT: string = "2026-11-20T10:00:00.000Z";

const PAGE_ROUTE: Route = new Route("/dashboard/p/status-pages/page-1");
const SHOWN_ROUTE: Route = new Route(
  "/dashboard/p/status-pages/page-1/resources",
);

function facts(
  extra?: Partial<StatusPageSetupRowFacts>,
): StatusPageSetupRowFacts {
  return {
    page: null,
    newPageName: "Acme Status",
    isExistingPage: false,
    isSaving: false,
    shownNames: [],
    shownCount: 0,
    pickedNames: [],
    resources: {},
    pageRoute: PAGE_ROUTE,
    shownRoute: SHOWN_ROUTE,
    joinNames: (names: ReadonlyArray<string>): string => {
      return names.join(", ");
    },
    onRetry: () => {},
    ...extra,
  };
}

function rows(extra?: Partial<StatusPageSetupRowFacts>): {
  page: GuidedSetupResourceRow;
  shown: GuidedSetupResourceRow;
} {
  const all: Array<GuidedSetupResourceRow> = getStatusPageSetupRows(
    facts(extra),
  );
  expect(all).toHaveLength(2);
  return { page: all[0]!, shown: all[1]! };
}

describe("the status page setup's records", () => {
  test("both are step 1's, the page first, named in the panel's words", () => {
    const { page, shown } = rows();

    expect(page.key).toBe(StatusPageSetupResource.StatusPage);
    expect(shown.key).toBe(StatusPageSetupResource.ShownMonitors);
    expect(page.stepKey).toBe(StatusPageSetupStep.Pick);
    expect(shown.stepKey).toBe(StatusPageSetupStep.Pick);
    expect(page.kind).toBe(STATUS_PAGE_RESOURCE_COPY.statusPage);
    expect(shown.kind).toBe(STATUS_PAGE_RESOURCE_COPY.shownMonitors);
  });

  test("before anything is made: both waiting, the page named as typed, nothing to open", () => {
    const { page, shown } = rows({ newPageName: "  Acme Status  " });

    expect(page.status).toBe(GuidedSetupResourceStatus.Waiting);
    expect(page.name).toBe("Acme Status");
    expect(page.route).toBeUndefined();
    expect(shown.status).toBe(GuidedSetupResourceStatus.Waiting);
    expect(shown.name).toBeUndefined();
    expect(shown.route).toBeUndefined();
  });

  test("what is picked names the monitors' row before it is added", () => {
    const { shown } = rows({ pickedNames: ["Acme website", "Acme API"] });

    expect(shown.name).toBe("Acme website, Acme API");
    expect(shown.status).toBe(GuidedSetupResourceStatus.Waiting);
  });

  test("while step 1 runs: the page being made, then its monitors being added", () => {
    const making: {
      page: GuidedSetupResourceRow;
      shown: GuidedSetupResourceRow;
    } = rows({ isSaving: true });

    expect(making.page.status).toBe(GuidedSetupResourceStatus.Creating);
    // Monitors go on the page once it exists.
    expect(making.shown.status).toBe(GuidedSetupResourceStatus.Waiting);

    const adding: {
      page: GuidedSetupResourceRow;
      shown: GuidedSetupResourceRow;
    } = rows({
      isSaving: true,
      page: { id: "page-1", name: "Acme Status" },
      resources: {
        [StatusPageSetupResource.StatusPage]: {
          at: AT,
          status: GuidedSetupResourceStatus.Created,
          recordId: "page-1",
        },
      },
    });

    expect(adding.page.status).toBe(GuidedSetupResourceStatus.Created);
    expect(adding.shown.status).toBe(GuidedSetupResourceStatus.Creating);
    expect(adding.shown.statusText).toBe(STATUS_PAGE_RESOURCE_COPY.adding);
  });

  test("done: the page made and its monitors added, each opening its page", () => {
    const { page, shown } = rows({
      page: { id: "page-1", name: "Acme Status" },
      shownNames: ["Acme website"],
      shownCount: 1,
      resources: {
        [StatusPageSetupResource.StatusPage]: {
          at: AT,
          status: GuidedSetupResourceStatus.Created,
          recordId: "page-1",
        },
        [StatusPageSetupResource.ShownMonitors]: {
          at: AT,
          status: GuidedSetupResourceStatus.Created,
        },
      },
    });

    expect(page.status).toBe(GuidedSetupResourceStatus.Created);
    expect(page.name).toBe("Acme Status");
    expect(page.route).toBe(PAGE_ROUTE);
    expect(shown.status).toBe(GuidedSetupResourceStatus.Created);
    expect(shown.statusText).toBe(STATUS_PAGE_RESOURCE_COPY.added);
    expect(shown.name).toBe("Acme website");
    expect(shown.route).toBe(SHOWN_ROUTE);
  });

  test("a page of the project's is in use, never made; monitors it showed already are in use too", () => {
    const { page, shown } = rows({
      page: { id: "page-2", name: "Acme Partner Status" },
      isExistingPage: true,
      isSaving: true,
      shownNames: ["Acme website"],
      shownCount: 1,
    });

    // Its request is out, but nothing makes a page that is there.
    expect(page.status).toBe(GuidedSetupResourceStatus.Existing);
    expect(page.name).toBe("Acme Partner Status");
    expect(shown.status).toBe(GuidedSetupResourceStatus.Creating);

    const settled: {
      page: GuidedSetupResourceRow;
      shown: GuidedSetupResourceRow;
    } = rows({
      page: { id: "page-2", name: "Acme Partner Status" },
      isExistingPage: true,
      shownNames: ["Acme website"],
      shownCount: 1,
    });

    expect(settled.shown.status).toBe(GuidedSetupResourceStatus.Existing);
    expect(settled.shown.statusText).toBeUndefined();
  });

  test("monitors this run added to a page of the project's read as added", () => {
    const { shown } = rows({
      page: { id: "page-2", name: "Acme Partner Status" },
      isExistingPage: true,
      shownNames: ["Acme website", "Acme API"],
      shownCount: 2,
      resources: {
        [StatusPageSetupResource.ShownMonitors]: {
          at: AT,
          status: GuidedSetupResourceStatus.Created,
        },
      },
    });

    expect(shown.status).toBe(GuidedSetupResourceStatus.Created);
    expect(shown.statusText).toBe(STATUS_PAGE_RESOURCE_COPY.added);
  });

  test("a failure says why, with Try again, which runs step 1 again", () => {
    const onRetry: MockFunction = getJestMockFunction();
    const { page, shown } = rows({
      onRetry: onRetry,
      resources: {
        [StatusPageSetupResource.StatusPage]: {
          at: AT,
          status: GuidedSetupResourceStatus.Failed,
          error: "OneUptime is busy and could not save this.",
        },
      },
    });

    expect(page.status).toBe(GuidedSetupResourceStatus.Failed);
    expect(page.error).toBe("OneUptime is busy and could not save this.");
    expect(shown.status).toBe(GuidedSetupResourceStatus.Waiting);

    page.onRetry!();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("monitors that could not be added say why, under a page that was made", () => {
    const { page, shown } = rows({
      page: { id: "page-1", name: "Acme Status" },
      pickedNames: ["Acme website"],
      resources: {
        [StatusPageSetupResource.StatusPage]: {
          at: AT,
          status: GuidedSetupResourceStatus.Created,
        },
        [StatusPageSetupResource.ShownMonitors]: {
          at: AT,
          status: GuidedSetupResourceStatus.Failed,
          error: "Plan limit reached",
        },
      },
    });

    expect(page.status).toBe(GuidedSetupResourceStatus.Created);
    expect(shown.status).toBe(GuidedSetupResourceStatus.Failed);
    expect(shown.error).toBe("Plan limit reached");
    expect(shown.name).toBe("Acme website");
    // Nothing on the page yet: nothing to open.
    expect(shown.route).toBeUndefined();
  });

  test("a page the run kept that is gone is waiting again: its step is to do again", () => {
    const { page } = rows({
      resources: {
        [StatusPageSetupResource.StatusPage]: {
          at: AT,
          status: GuidedSetupResourceStatus.Created,
          recordId: "page-1",
        },
      },
    });

    expect(page.status).toBe(GuidedSetupResourceStatus.Waiting);
    expect(page.route).toBeUndefined();
  });
});
