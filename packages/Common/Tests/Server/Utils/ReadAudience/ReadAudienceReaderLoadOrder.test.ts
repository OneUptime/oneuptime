/*
 * Loaded first, on purpose: an AI insight's model, before any service. In
 * this order the owner table registry, imported by ReadAudienceReader when
 * it loaded, held the services of some kinds as undefined - a circular
 * import, the registry importing every kind's services while one of them
 * was still loading - and the telemetry set apart skipped those kinds.
 */
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import Service from "../../../../Models/DatabaseModels/Service";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import ApiKeyPermissionService from "../../../../Server/Services/ApiKeyPermissionService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TeamPermissionService from "../../../../Server/Services/TeamPermissionService";
import type { OwnerTablePair } from "../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import LinkedAffectedResources from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import ReadAudienceReader from "../../../../Server/Utils/ReadAudience/ReadAudienceReader";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

/*
 * THE TELEMETRY A RUN'S READERS LEAVE OUT, WHICHEVER MODULE LOADS FIRST
 * (#9612). A run reading for its readers leaves out the logs, spans and
 * metrics of every resource set apart from one of them
 * (ReadAudienceReader.readTelemetryBlockedIds), kind by kind of the owner
 * table registry. A kind whose service the registry held as undefined was
 * skipped without a word, so its resources set apart kept their telemetry
 * in the report. The reader now reads the registry when it needs it, as
 * OwnedScopePermission and ModelPermission do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SET_APART_SERVICE: string = "77777777-7777-4777-8777-777777777777";

beforeEach(() => {
  const labelled: TeamPermission = new TeamPermission();
  labelled.permission = Permission.ReadService;

  jest
    .spyOn(TeamPermissionService, "findAllBy")
    .mockImplementation((async (findAllBy: {
      query: Record<string, unknown>;
    }): Promise<Array<TeamPermission>> => {
      return findAllBy.query["scope"] === PermissionScope.Owned
        ? []
        : [labelled];
    }) as never);
  jest
    .spyOn(ApiKeyPermissionService, "findAllBy")
    .mockResolvedValue([] as Array<ApiKeyPermission>);
  jest.spyOn(LinkedAffectedResources, "readForIncident").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the telemetry set apart, with an AI insight's model loaded first", () => {
  test("every kind that owns telemetry has its own service when it is read", () => {
    const missing: Array<string> = [];

    // Read as the reader reads it: when needed, never while modules load.
    const registry: Map<string, OwnerTablePair> =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../../../Server/Types/Database/Permissions/OwnerTableRegistry").default;

    for (const [kind, entry] of registry) {
      if (entry.canOwnTelemetry && !entry.modelService?.modelType) {
        missing.push(kind);
      }
    }

    expect(missing).toEqual([]);
  });

  test("services set apart by a label leave their telemetry out of what a run reads", async () => {
    jest
      .spyOn(ServiceService, "findAllBy")
      .mockResolvedValue([new Service(new ObjectID(SET_APART_SERVICE))]);

    const audience: ReadAudience = await ReadAudienceReader.forSubject({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(audience.labelledPermissions).toEqual([Permission.ReadService]);
    expect(audience.telemetryBlockedIds).toEqual([SET_APART_SERVICE]);
  });

  test("the models loaded first are the ones a triage reads for", () => {
    // Held here so the imports above are read, and stay first.
    expect(new AIInsight().tableName).toBe("AIInsight");
    expect(new SecurityCase().tableName).toBe("SecurityCase");
  });
});
