import MonitorStepsProjectValidator from "../../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import MonitorStepsReferenceExtractor from "../../../../Server/Utils/Monitor/MonitorStepsReferenceExtractor";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import SecurityWatchlists, {
  SecurityWatchlistMissingException,
} from "../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepSecurityEventsMonitorUtil } from "../../../../Types/Monitor/MonitorStepSecurityEventsMonitor";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";
import { getMissingSecurityWatchlistsMessage } from "../../../../Types/SecurityEvent/SecurityWatchlist";
import { SecurityWatchlistFilter } from "../../../../Types/SecurityEvent/SecurityWatchlistFilter";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { MockInstance } from "jest-mock";

/*
 * A SECURITY EVENTS MONITOR'S WATCHLIST FILTERS (#5391) name the project's
 * lists by name, as a rule's YAML does: a list a save starts reading must
 * be the project's, refused in the words a rule's save uses; a list the
 * monitor read already is its inheritance - a list is neither renamed nor
 * deleted while a monitor reads it, so it is never re-asked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

function stepsReading(
  ...filterLists: Array<Array<SecurityWatchlistFilter>>
): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: filterLists.map(
      (filters: Array<SecurityWatchlistFilter>): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.setSecurityEventsMonitor({
          ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
          watchlistFilters: filters,
        });
        return step;
      },
    ),
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

let assertProjectHas: MockInstance<typeof SecurityWatchlists.assertProjectHas>;

beforeEach(() => {
  assertProjectHas = jest
    .spyOn(SecurityWatchlists, "assertProjectHas")
    .mockResolvedValue(undefined);

  // The other references in the steps are another test's subject.
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorStepsReferenceExtractor.extractWatchlistNames", () => {
  it("names each list a step's filters read, each once whatever the case, in order", () => {
    expect(
      MonitorStepsReferenceExtractor.extractWatchlistNames(
        stepsReading(
          [
            { field: "principalUser", watchlist: "vip_users" },
            {
              field: "principalIp",
              watchlist: "admin_addresses",
              isNotOnList: true,
            },
          ],
          [{ field: "targetUser", watchlist: "VIP_USERS" }],
        ),
      ),
    ).toEqual(["vip_users", "admin_addresses"]);
  });

  it("reads the steps as stored JSON too", () => {
    const json: JSONObject = stepsReading([
      { field: "principalHost", watchlist: "critical_hosts" },
    ]).toJSON();

    expect(MonitorStepsReferenceExtractor.extractWatchlistNames(json)).toEqual([
      "critical_hosts",
    ]);
  });

  it("an unfinished row, a step of another kind, or no steps name no list", () => {
    expect(
      MonitorStepsReferenceExtractor.extractWatchlistNames(
        stepsReading([
          { field: "principalUser", watchlist: "" },
          { field: "principalUser", watchlist: "not a name" },
        ]),
      ),
    ).toEqual([]);

    const probeSteps: MonitorSteps = new MonitorSteps();
    const step: MonitorStep = new MonitorStep();
    step.setProbeStatusMonitor({ probeIds: [] });
    probeSteps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: undefined,
    };

    expect(
      MonitorStepsReferenceExtractor.extractWatchlistNames(probeSteps),
    ).toEqual([]);
    expect(MonitorStepsReferenceExtractor.extractWatchlistNames(null)).toEqual(
      [],
    );
    expect(
      MonitorStepsReferenceExtractor.extractWatchlistNames(undefined),
    ).toEqual([]);
  });
});

describe("MonitorStepsProjectValidator.validateWatchlistsExist", () => {
  it("a new monitor asks the project for every list it reads", async () => {
    await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
      monitorSteps: stepsReading([
        { field: "principalUser", watchlist: "vip_users" },
        { field: "principalIp", watchlist: "admin_addresses" },
      ]),
      projectId: PROJECT_ID,
    });

    expect(assertProjectHas).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      names: ["vip_users", "admin_addresses"],
    });
  });

  it("an edit asks only for the lists it starts reading, whatever case the stored step wrote", async () => {
    await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
      monitorSteps: stepsReading([
        { field: "principalUser", watchlist: "vip_users" },
        { field: "principalIp", watchlist: "admin_addresses" },
      ]),
      alreadyStoredMonitorSteps: stepsReading([
        { field: "principalUser", watchlist: "VIP_Users" },
      ]),
      projectId: PROJECT_ID,
    });

    expect(assertProjectHas).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      names: ["admin_addresses"],
    });
  });

  it("a list the project lacks refuses the save in a rule's words", async () => {
    assertProjectHas.mockRejectedValue(
      new SecurityWatchlistMissingException(["crown_jewels"]),
    );

    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsReading([
          { field: "principalHost", watchlist: "crown_jewels" },
        ]),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(getMissingSecurityWatchlistsMessage(["crown_jewels"]));
  });

  it("a monitor that reads no list asks for none", async () => {
    await MonitorStepsProjectValidator.validateWatchlistsExist({
      monitorSteps: stepsReading([]),
      projectId: PROJECT_ID,
    });

    expect(assertProjectHas).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      names: [],
    });
  });
});
