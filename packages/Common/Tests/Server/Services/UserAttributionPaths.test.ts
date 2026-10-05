import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import UserService from "../../../Server/Services/UserService";
import {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import UpdateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The paths that write who did something to a record, through the real
 * services: a workflow cannot name anybody, and OneUptime's own server code
 * - which acts for a person it names in code - still records that person.
 * Each write stops at its first hook, after DatabaseService has decided who
 * the record is by (UserAttribution), so nothing reaches the database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000001",
);
const PERSON_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-0000000000e1",
);
const OTHER_USER_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000f2";
const RECORD_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a1";

class AtTheHooks extends Error {}

/*
 * Stops the service's writes at their first hook and records what they
 * carried there.
 */
function stopAtTheHooks(service: unknown): () => Record<string, unknown> {
  let reached: Record<string, unknown> = {};

  getJestSpyOn(service, "_onBeforeCreate").mockImplementation(
    async (createBy: { data: unknown }): Promise<never> => {
      reached = { ...(createBy.data as Record<string, unknown>) };
      throw new AtTheHooks();
    },
  );
  getJestSpyOn(service, "onBeforeUpdate").mockImplementation(
    async (updateBy: { data: unknown }): Promise<never> => {
      reached = { ...(updateBy.data as Record<string, unknown>) };
      throw new AtTheHooks();
    },
  );

  return (): Record<string, unknown> => {
    return reached;
  };
}

function runOptions(): RunOptions {
  return {
    log: (): void => {},
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: PROJECT_ID,
    onError: (exception: Exception): Exception => {
      return exception;
    },
    executeWorkflow: async (): Promise<void> => {},
  };
}

beforeEach(() => {
  stubProjectDirectory({});
  // A workflow component logs the stop at the hooks as its error.
  getJestSpyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a workflow cannot name who did something to a record", () => {
  test("Create One: a creator the workflow sends, under either name, never reaches the record", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const reached: () => Record<string, unknown> = stopAtTheHooks(service);

    const result: RunReturnType = await new CreateOneBaseModel<Monitor>(
      service,
    ).run(
      {
        json: {
          name: "Checkout API",
          createdByUserId: OTHER_USER_ID,
          createdByUser: { _id: OTHER_USER_ID },
          archivedByUserId: OTHER_USER_ID,
        },
      },
      runOptions(),
    );

    // The write stopped at the hooks, so the component took its error port.
    expect(result.executePort?.id).toBe("error");
    expect(reached()["name"]).toBe("Checkout API");
    expect(reached()["createdByUserId"]).toBeUndefined();
    expect(reached()["createdByUser"]).toBeUndefined();
    expect(reached()["archivedByUserId"]).toBeUndefined();
  });

  test("Update One: a creator the workflow sends never changes the record", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const reached: () => Record<string, unknown> = stopAtTheHooks(service);

    await new UpdateOneBaseModel<Monitor>(service).run(
      {
        query: { _id: RECORD_ID },
        data: {
          description: "Owned by payments",
          createdByUserId: OTHER_USER_ID,
          createdByUser: { _id: OTHER_USER_ID },
        },
      },
      runOptions(),
    );

    expect(reached()["description"]).toBe("Owned by payments");
    expect(reached()["createdByUserId"]).toBeUndefined();
    expect(reached()["createdByUser"]).toBeUndefined();
  });
});

describe("OneUptime's own server code records the person it acts for", () => {
  test("a note posted from Slack or Microsoft Teams is by the person who posted it", async () => {
    const reached: () => Record<string, unknown> = stopAtTheHooks(
      IncidentPublicNoteService,
    );

    await expect(
      IncidentPublicNoteService.addNote({
        userId: PERSON_ID,
        incidentId: new ObjectID(RECORD_ID),
        projectId: PROJECT_ID,
        note: "Customers are seeing timeouts.",
      }),
    ).rejects.toBeInstanceOf(AtTheHooks);

    expect(String(reached()["createdByUserId"])).toBe(PERSON_ID.toString());
  });

  test("an account made by an invitation is by the person who invited", async () => {
    const reached: () => Record<string, unknown> = stopAtTheHooks(UserService);

    await expect(
      UserService.createByEmail({
        email: new Email("new.member@example.com"),
        name: new Name("New Member"),
        createdByUserId: PERSON_ID,
        props: { isRoot: true },
      }),
    ).rejects.toBeInstanceOf(AtTheHooks);

    expect(String(reached()["createdByUserId"])).toBe(PERSON_ID.toString());
  });

  test("an incident added to an episode by hand is added by that person", async () => {
    const reached: () => Record<string, unknown> = stopAtTheHooks(
      IncidentEpisodeMemberService,
    );

    const incident: Incident = new Incident();
    incident._id = RECORD_ID;
    incident.projectId = PROJECT_ID;

    await expect(
      IncidentGroupingEngineService.addIncidentToEpisodeManually(
        incident,
        ObjectID.generate(),
        PERSON_ID,
      ),
    ).rejects.toBeInstanceOf(AtTheHooks);

    expect(String(reached()["addedByUserId"])).toBe(PERSON_ID.toString());
  });
});
