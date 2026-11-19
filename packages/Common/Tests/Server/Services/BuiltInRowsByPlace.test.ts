import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import CloudBudgetEvaluator from "../../../Server/Utils/CloudConnection/CloudBudgetEvaluator";
import DataProductSync from "../../../Server/Utils/DataObservability/DataProductSync";
import OpenStackBudgetEvaluator from "../../../Server/Utils/OpenStack/OpenStackBudgetEvaluator";
import Query from "../../../Server/Types/Database/Query";
import ObjectID from "../../../Types/ObjectID";
import {
  STATE_LISTS,
  StateListBuiltIn,
  StateListDefinition,
} from "../../../Utils/StateOrder";
import { getJestSpyOn } from "../../Spy";
import {
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { PROJECT_ID } from "./ContiguousOrderCases";
import {
  LIST_ORDER_CASES,
  ListOrderCase,
  createdAtOf,
  listRow,
} from "./ListOrderCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A PROJECT'S BUILT-IN ROWS ARE THE TOPMOST OF THEIR KIND (issue #9654).
 *
 * "The project's created state" - where a new incident, alert or episode
 * starts - and its scheduled state, its operational and offline statuses
 * and every other built-in row are looked up by their flag alone. Such a
 * lookup asked for no order, and a read in no order came back newest
 * first: a project with two created states started every new incident in
 * the newer one, wherever it stood in the list, while the state rules and
 * the Dashboard took the topmost (Common/Utils/StateOrder). And "the least
 * severe severity" - read from the bottom up by its number - took the
 * lower id of two severities sharing the bottom number, where the list
 * shows the newer of them last.
 *
 * A drag-ordered list's rows are now read the way the list shows them
 * (DatabaseService.getReadSort): these lookups are the topmost row
 * carrying the flag, and the last row shown.
 */

// Ids that sort the other way from the age of the rows that carry them.
const ROW: (n: number) => string = (n: number): string => {
  return `9e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

function caseOf(table: string): ListOrderCase {
  const listCase: ListOrderCase | undefined = LIST_ORDER_CASES.find(
    (candidate: ListOrderCase): boolean => {
      return candidate.label === table;
    },
  );

  if (!listCase) {
    throw new Error(`No list case for ${table}.`);
  }

  return listCase;
}

// A row of the list under test, carrying `flags`.
function row(data: {
  listCase: ListOrderCase;
  id: string;
  order: number;
  n: number;
  flags?: Array<string> | undefined;
}): StoredRow {
  const stored: StoredRow = listRow({
    listCase: data.listCase,
    id: data.id,
    order: data.order,
    n: data.n,
  });

  for (const flag of data.flags || []) {
    stored[flag] = true;
  }

  return stored;
}

async function findByFlag(
  listCase: ListOrderCase,
  flag: string,
): Promise<string | undefined> {
  // A list's service, as a lookup by its built-in flag asks it.
  const found: BaseModel | null = await listCase.service.findOneBy({
    query: { projectId: PROJECT_ID, [flag]: true } as Query<BaseModel>,
    select: { _id: true },
    props: { isRoot: true },
  });

  return found?._id?.toString();
}

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const BUILT_INS: Array<[string, StateListDefinition, StateListBuiltIn]> =
  Object.values(STATE_LISTS).flatMap(
    (
      definition: StateListDefinition,
    ): Array<[string, StateListDefinition, StateListBuiltIn]> => {
      return definition.builtIns.map(
        (
          builtIn: StateListBuiltIn,
        ): [string, StateListDefinition, StateListBuiltIn] => {
          return [`${definition.type}'s ${builtIn.role}`, definition, builtIn];
        },
      );
    },
  );

describe.each(BUILT_INS)(
  "%s, looked up by its flag alone",
  (
    _name: string,
    definition: StateListDefinition,
    builtIn: StateListBuiltIn,
  ) => {
    const listCase: ListOrderCase = caseOf(definition.type);

    beforeEach(() => {
      listCase.stubCollaborators?.();
    });

    test("is the topmost row carrying the flag, not the newest", async () => {
      useInMemoryTable(listCase.service, [
        row({ listCase, id: ROW(9), order: 1, n: 2 }),
        // The topmost carrying the flag: the oldest row of the list.
        row({ listCase, id: ROW(8), order: 2, n: 1, flags: [builtIn.flag] }),
        // Lower in the list, and the newest row of all.
        row({ listCase, id: ROW(1), order: 3, n: 9, flags: [builtIn.flag] }),
        row({ listCase, id: ROW(5), order: 4, n: 4 }),
      ]);

      expect(await findByFlag(listCase, builtIn.flag)).toBe(ROW(8));
    });

    test("of two rows carrying it at one number, is the older, as the list shows them", async () => {
      useInMemoryTable(listCase.service, [
        row({ listCase, id: ROW(7), order: 1, n: 5 }),
        row({ listCase, id: ROW(2), order: 2, n: 9, flags: [builtIn.flag] }),
        row({ listCase, id: ROW(6), order: 2, n: 3, flags: [builtIn.flag] }),
      ]);

      expect(await findByFlag(listCase, builtIn.flag)).toBe(ROW(6));
    });
  },
);

describe("the project's created state", () => {
  test("a new incident or episode starts in the topmost created state, not the newest", async () => {
    const listCase: ListOrderCase = caseOf("IncidentState");
    listCase.stubCollaborators?.();
    useInMemoryTable(IncidentStateService, [
      row({ listCase, id: ROW(4), order: 1, n: 1, flags: ["isCreatedState"] }),
      row({ listCase, id: ROW(3), order: 2, n: 2 }),
      row({ listCase, id: ROW(1), order: 3, n: 8, flags: ["isCreatedState"] }),
      row({ listCase, id: ROW(2), order: 4, n: 3, flags: ["isResolvedState"] }),
    ]);

    expect(
      (
        await IncidentStateService.getCreatedIncidentStateId(PROJECT_ID)
      ).toString(),
    ).toBe(ROW(4));
  });

  test("a new alert or episode starts in the topmost created state, not the newest", async () => {
    const listCase: ListOrderCase = caseOf("AlertState");
    listCase.stubCollaborators?.();
    useInMemoryTable(AlertStateService, [
      row({ listCase, id: ROW(4), order: 1, n: 1, flags: ["isCreatedState"] }),
      row({ listCase, id: ROW(1), order: 3, n: 8, flags: ["isCreatedState"] }),
      row({ listCase, id: ROW(2), order: 4, n: 3, flags: ["isResolvedState"] }),
    ]);

    expect(
      (await AlertStateService.getCreatedAlertStateId(PROJECT_ID)).toString(),
    ).toBe(ROW(4));
  });

  /*
   * A reopened episode goes back to the created state. Each episode service
   * looked it up again by its flag; they ask the state services now, so
   * there is one lookup of "the project's created state" for each list.
   */
  test.each([
    {
      name: "an incident episode",
      service: IncidentEpisodeService as unknown as Record<string, unknown>,
      states: IncidentStateService as unknown as Record<string, unknown>,
      lookup: "getCreatedIncidentStateId",
      stateColumn: "incidentStateId",
    },
    {
      name: "an alert episode",
      service: AlertEpisodeService as unknown as Record<string, unknown>,
      states: AlertStateService as unknown as Record<string, unknown>,
      lookup: "getCreatedAlertStateId",
      stateColumn: "alertStateId",
    },
  ])(
    "$name reopens in the created state the state service gives",
    async (data: {
      service: Record<string, unknown>;
      states: Record<string, unknown>;
      lookup: string;
      stateColumn: string;
    }) => {
      const episodeId: ObjectID = new ObjectID(ROW(10));
      const createdStateId: ObjectID = new ObjectID(ROW(11));

      getJestSpyOn(data.service, "findOneById").mockResolvedValue({
        projectId: PROJECT_ID,
      } as never);
      const lookup: jest.SpyInstance = getJestSpyOn(
        data.states,
        data.lookup,
      ).mockResolvedValue(createdStateId as never);
      const change: jest.SpyInstance = getJestSpyOn(
        data.service,
        "changeEpisodeState",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(data.service, "updateOneById").mockResolvedValue(
        undefined as never,
      );

      await (
        data.service["reopenEpisode"] as (id: ObjectID) => Promise<void>
      ).call(data.service, episodeId);

      expect(lookup).toHaveBeenCalledWith(PROJECT_ID);
      expect(
        (change.mock.calls[0]![0] as Record<string, unknown>)[data.stateColumn],
      ).toBe(createdStateId);
    },
  );
});

/*
 * A budget's alerts, and a data product's late data, are raised at the
 * project's least severe severity when nothing else is named: the last one
 * the list shows. Of two severities sharing the bottom number that is the
 * newer; the read took the one with the lower id.
 */
describe("the project's least severe severity", () => {
  function severities(table: string): Array<StoredRow> {
    const listCase: ListOrderCase = caseOf(table);

    return [
      row({ listCase, id: ROW(30), order: 1, n: 1 }),
      // The bottom twins: the newer has the higher id, so the read by id took the older.
      row({ listCase, id: ROW(31), order: 3, n: 2 }),
      row({ listCase, id: ROW(32), order: 3, n: 6 }),
      row({ listCase, id: ROW(33), order: 2, n: 9 }),
    ];
  }

  test("is the last severity the list shows, for a cloud budget's alerts", async () => {
    useInMemoryTable(AlertSeverityService, severities("AlertSeverity"));

    const severityId: ObjectID | null = await (
      CloudBudgetEvaluator as unknown as {
        getSeverityId: (budget: unknown) => Promise<ObjectID | null>;
      }
    ).getSeverityId({ projectId: PROJECT_ID });

    expect(severityId?.toString()).toBe(ROW(32));
  });

  test("is the last severity the list shows, for an OpenStack budget's alerts", async () => {
    useInMemoryTable(AlertSeverityService, severities("AlertSeverity"));

    const severityId: ObjectID | null = await (
      OpenStackBudgetEvaluator as unknown as {
        getSeverityId: (budget: unknown) => Promise<ObjectID | null>;
      }
    ).getSeverityId({ projectId: PROJECT_ID });

    expect(severityId?.toString()).toBe(ROW(32));
  });

  test("a budget's own severity still wins", async () => {
    useInMemoryTable(AlertSeverityService, severities("AlertSeverity"));
    const own: ObjectID = new ObjectID(ROW(30));

    expect(
      await (
        CloudBudgetEvaluator as unknown as {
          getSeverityId: (budget: unknown) => Promise<ObjectID | null>;
        }
      ).getSeverityId({ projectId: PROJECT_ID, alertSeverityId: own }),
    ).toBe(own);
  });

  test("is the severity a data product's late data is raised at, with the topmost operational status", async () => {
    const statuses: ListOrderCase = caseOf("MonitorStatus");
    useInMemoryTable(MonitorStatusService, [
      row({
        listCase: statuses,
        id: ROW(41),
        order: 1,
        n: 1,
        flags: ["isOperationalState"],
      }),
      row({
        listCase: statuses,
        id: ROW(40),
        order: 2,
        n: 7,
        flags: ["isOperationalState"],
      }),
      {
        // Degraded: neither operational nor offline, as Postgres stores it.
        ...row({ listCase: statuses, id: ROW(42), order: 3, n: 2 }),
        isOperationalState: false,
        isOfflineState: false,
      },
      row({
        listCase: statuses,
        id: ROW(43),
        order: 4,
        n: 3,
        flags: ["isOfflineState"],
      }),
    ]);
    useInMemoryTable(IncidentSeverityService, severities("IncidentSeverity"));
    useInMemoryTable(AlertSeverityService, severities("AlertSeverity"));

    const seed: Record<string, ObjectID> = await (
      DataProductSync as unknown as {
        readSeed: (projectId: ObjectID) => Promise<Record<string, ObjectID>>;
      }
    ).readSeed(PROJECT_ID);

    expect(seed["onlineMonitorStatusId"]?.toString()).toBe(ROW(41));
    expect(seed["degradedMonitorStatusId"]?.toString()).toBe(ROW(42));
    expect(seed["incidentSeverityId"]?.toString()).toBe(ROW(32));
    expect(seed["alertSeverityId"]?.toString()).toBe(ROW(32));
  });
});

// Rows created at the times the cases above say, for reading the failures.
test("the rows' ages are the order the cases above describe", () => {
  expect(createdAtOf(1).getTime()).toBeLessThan(createdAtOf(9).getTime());
});
