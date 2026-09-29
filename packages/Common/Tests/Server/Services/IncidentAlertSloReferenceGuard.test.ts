import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import SloRecordReferenceValidator from "../../../Server/Utils/Slo/SloRecordReferenceValidator";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Incident.serviceLevelObjectives and Alert.serviceLevelObjectives are
 * writable by API callers: ProjectMember, IncidentMember / AlertMember and
 * Create/EditProjectIncident / Create/EditAlert. Before this guard an
 * IncidentMember of project A could POST an incident linked to project B's
 * SLO. The created feed item, which reads the incident as root, then
 * published "Resources Affected: SLO <project B's SLO name>" to project A.
 *
 * These tests drive the real create and update hooks against a fake SLO
 * table in which SLO_ID belongs to PROJECT_ID and FOREIGN_SLO_ID to
 * OTHER_PROJECT_ID. They pin three things:
 *
 * - both hooks refuse the foreign link, and the create refuses before an
 *   incident or alert number is spent;
 * - the burn-rate worker's own write still passes: it runs as root with no
 *   tenant, the project on the row, and an id-stub of its own SLO;
 * - an update with no tenant is checked against the projects of the rows it
 *   matches.
 *
 * The state / severity / monitor status checks and custom field mapping are
 * stubbed. They are covered elsewhere and would otherwise need a database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000002",
);
const SLO_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000a1";
const FOREIGN_SLO_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b1";
const CREATED_STATE_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000d1";

const REJECTION: string = "do not exist in this project";

type HookName = "onBeforeCreate" | "onBeforeUpdate";

function callHook(
  service: unknown,
  hook: HookName,
  payload: unknown,
): Promise<unknown> {
  return (service as Record<string, (input: unknown) => Promise<unknown>>)[
    hook
  ]!(payload);
}

interface RecordCase {
  name: string;
  subject: string;
  service: unknown;
  counterMethod:
    | "incrementAndGetIncidentCounter"
    | "incrementAndGetAlertCounter";
  mockCreatedState: () => void;
  // A row as the update fallback's findBy returns it.
  buildMatchedRow: (projectId: ObjectID) => Incident | Alert;
  // The row the burn-rate worker hands to create.
  buildWorkerRow: (sloStub: ServiceLevelObjective) => Incident | Alert;
  mockFindBy: (rows: Array<Incident | Alert>) => void;
}

const CASES: Array<RecordCase> = [
  {
    name: "IncidentService",
    subject: "incident",
    service: IncidentService,
    counterMethod: "incrementAndGetIncidentCounter",
    mockCreatedState: (): void => {
      const state: IncidentState = new IncidentState();
      state._id = CREATED_STATE_ID;
      jest
        .spyOn(IncidentStateService, "findOneBy")
        .mockResolvedValue(state as never);
    },
    buildMatchedRow: (projectId: ObjectID): Incident => {
      const incident: Incident = new Incident();
      incident.projectId = projectId;
      return incident;
    },
    buildWorkerRow: (sloStub: ServiceLevelObjective): Incident => {
      const incident: Incident = new Incident();
      incident.projectId = PROJECT_ID;
      incident.title = "Checkout availability is burning its error budget";
      incident.serviceLevelObjectives = [sloStub];
      return incident;
    },
    mockFindBy: (rows: Array<Incident | Alert>): void => {
      jest.spyOn(IncidentService, "findBy").mockResolvedValue(rows as never);
    },
  },
  {
    name: "AlertService",
    subject: "alert",
    service: AlertService,
    counterMethod: "incrementAndGetAlertCounter",
    mockCreatedState: (): void => {
      const state: AlertState = new AlertState();
      state._id = CREATED_STATE_ID;
      jest
        .spyOn(AlertStateService, "findOneBy")
        .mockResolvedValue(state as never);
    },
    buildMatchedRow: (projectId: ObjectID): Alert => {
      const alert: Alert = new Alert();
      alert.projectId = projectId;
      return alert;
    },
    buildWorkerRow: (sloStub: ServiceLevelObjective): Alert => {
      const alert: Alert = new Alert();
      alert.projectId = PROJECT_ID;
      alert.title = "Checkout availability is burning its error budget";
      alert.serviceLevelObjectives = [sloStub];
      return alert;
    },
    mockFindBy: (rows: Array<Incident | Alert>): void => {
      jest.spyOn(AlertService, "findBy").mockResolvedValue(rows as never);
    },
  },
];

let sloLookup: jest.SpyInstance;
let counter: jest.SpyInstance;
let otherReferenceValidator: jest.SpyInstance;

// The project each SLO read was pinned to, in order ("" when unpinned).
function lookupProjectIds(): Array<string> {
  return sloLookup.mock.calls.map((call: Array<unknown>): string => {
    return (
      (
        (call[0] as { query: JSONObject }).query["projectId"] as unknown as
          | ObjectID
          | undefined
      )?.toString() || ""
    );
  });
}

function mockSloTable(): void {
  sloLookup = jest
    .spyOn(SloRecordReferenceValidator.getLookupService(), "findBy")
    .mockImplementation((async (args: {
      query: JSONObject;
    }): Promise<Array<ServiceLevelObjective>> => {
      const pinnedProjectId: string =
        (
          args.query["projectId"] as unknown as ObjectID | undefined
        )?.toString() || "";

      const table: Array<{ id: string; projectId: ObjectID }> = [
        { id: SLO_ID, projectId: PROJECT_ID },
        { id: FOREIGN_SLO_ID, projectId: OTHER_PROJECT_ID },
      ];

      // An unpinned read would see every project's SLOs.
      return table
        .filter((row: { id: string; projectId: ObjectID }): boolean => {
          return (
            !pinnedProjectId || row.projectId.toString() === pinnedProjectId
          );
        })
        .map(
          (row: { id: string; projectId: ObjectID }): ServiceLevelObjective => {
            const slo: ServiceLevelObjective = new ServiceLevelObjective();
            slo._id = row.id;
            return slo;
          },
        );
    }) as never);
}

beforeEach(() => {
  mockSloTable();

  otherReferenceValidator = jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * forEach rather than a for...of loop: the describe callbacks read the
 * module-level spies above, which are reassigned per test, and no-loop-func
 * flags a closure over them declared inside a loop.
 */
CASES.forEach((recordCase: RecordCase) => {
  describe(`${recordCase.name} serviceLevelObjectives guard`, () => {
    beforeEach(() => {
      recordCase.mockCreatedState();
      counter = jest
        .spyOn(ProjectService, recordCase.counterMethod)
        .mockResolvedValue({ counter: 1, prefix: undefined } as never);
    });

    test("create refuses another project's SLO, and spends no number", async () => {
      await expect(
        callHook(recordCase.service, "onBeforeCreate", {
          data: {
            title: "Linked to someone else's SLO",
            serviceLevelObjectives: [{ _id: FOREIGN_SLO_ID }],
          },
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(REJECTION);

      expect(lookupProjectIds()).toEqual([PROJECT_ID.toString()]);
      expect(counter).not.toHaveBeenCalled();
    });

    test("create accepts the burn-rate worker's write: root, project on the row, its own SLO as an id-stub", async () => {
      const sloStub: ServiceLevelObjective = new ServiceLevelObjective();
      sloStub._id = SLO_ID;

      await expect(
        callHook(recordCase.service, "onBeforeCreate", {
          data: recordCase.buildWorkerRow(sloStub),
          props: { isRoot: true },
        }),
      ).resolves.toBeDefined();

      // No tenant on the props: the row's own project is the one checked.
      expect(lookupProjectIds()).toEqual([PROJECT_ID.toString()]);
      expect(counter).toHaveBeenCalledTimes(1);
    });

    test("create with no SLOs reads no SLO", async () => {
      await expect(
        callHook(recordCase.service, "onBeforeCreate", {
          data: { title: "Plain" },
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toBeDefined();

      expect(sloLookup).not.toHaveBeenCalled();
    });

    test("update refuses another project's SLO in the bare-string shape the API accepts", async () => {
      await expect(
        callHook(recordCase.service, "onBeforeUpdate", {
          data: { serviceLevelObjectives: [FOREIGN_SLO_ID] },
          query: {},
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(REJECTION);

      expect(lookupProjectIds()).toEqual([PROJECT_ID.toString()]);
    });

    test("update accepts this project's SLO in the relation-object shape", async () => {
      await expect(
        callHook(recordCase.service, "onBeforeUpdate", {
          data: { serviceLevelObjectives: [{ _id: SLO_ID }] },
          query: {},
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toBeDefined();

      expect(lookupProjectIds()).toEqual([PROJECT_ID.toString()]);
    });

    test("update with no tenant checks against the projects of the rows it matches", async () => {
      /*
       * A root update of a row in OTHER_PROJECT_ID linking PROJECT_ID's SLO
       * is just as foreign, seen from that row.
       */
      recordCase.mockFindBy([recordCase.buildMatchedRow(OTHER_PROJECT_ID)]);

      await expect(
        callHook(recordCase.service, "onBeforeUpdate", {
          data: { serviceLevelObjectives: [SLO_ID] },
          query: {},
          props: { isRoot: true },
        }),
      ).rejects.toThrow(REJECTION);

      expect(lookupProjectIds()).toEqual([OTHER_PROJECT_ID.toString()]);
    });

    test.each([
      ["does not write serviceLevelObjectives", { title: "renamed" }],
      ["clears serviceLevelObjectives", { serviceLevelObjectives: [] }],
    ])(
      "an update that %s reads no SLO",
      async (_label: string, data: JSONObject) => {
        await expect(
          callHook(recordCase.service, "onBeforeUpdate", {
            data: data,
            query: {},
            props: { tenantId: PROJECT_ID },
          }),
        ).resolves.toBeDefined();

        expect(sloLookup).not.toHaveBeenCalled();
      },
    );

    test("an SLO-only update asks the state / severity check nothing", async () => {
      await callHook(recordCase.service, "onBeforeUpdate", {
        data: { serviceLevelObjectives: [SLO_ID] },
        query: {},
        props: { tenantId: PROJECT_ID },
      });

      expect(otherReferenceValidator).not.toHaveBeenCalled();
    });
  });
});

/*
 * The guard must not bring back the import cycle that keeps
 * ServiceLevelObjectiveService out of these two services (it reaches them
 * through ServiceLevelObjectiveBurnRateRuleService).
 */
describe("the guard keeps IncidentService and AlertService clear of the SLO service", () => {
  test.each([["IncidentService.ts"], ["AlertService.ts"]])(
    "%s does not import ServiceLevelObjectiveService",
    (fileName: string) => {
      const source: string = fs.readFileSync(
        path.join(__dirname, "../../../Server/Services", fileName),
        "utf8",
      );

      expect(source).not.toMatch(/from "\.\/ServiceLevelObjectiveService"/);
      expect(source).toContain(
        'import SloRecordReferenceValidator from "../Utils/Slo/SloRecordReferenceValidator";',
      );
    },
  );
});
