import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import NewIncidentSubscriberNotificationDefaultReader from "../../../../Server/Utils/StatusPage/NewIncidentSubscriberNotificationDefaultReader";
import ObjectID from "../../../../Types/ObjectID";
import { NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN } from "../../../../Types/StatusPage/NewIncidentSubscriberNotificationDefault";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

/*
 * INCIDENTS PEOPLE DECLARE WHERE NO BOX ASKS FOLLOW "NOTIFY STATUS PAGE
 * SUBSCRIBERS BY DEFAULT" (#7606).
 *
 * The switch on Incidents -> Settings -> Subscriber Notifications says how
 * the box starts on Declare New Incident. Slack's and Microsoft Teams'
 * Declare Incident forms and OneUptime AI's create_incident ask nothing
 * about subscribers, so what the box would have started at is the answer:
 *
 *   - off: the incident is declared without notifying them;
 *   - on, no value, no project: the incident is left as it is - its own
 *     default, which notifies them, as every incident always did;
 *   - a read that fails: the same, and declaring is never held up or failed
 *     by it.
 *
 * The project is read once, as OneUptime (the project's choice decides,
 * whoever declares), for that one column. Each declare path's own suite
 * pins that it asks here (SlackDeclareIncidentAffectedResourcesRoute,
 * MicrosoftTeamsDeclareIncidentAffectedResources, IncidentWriteTools); the
 * scan at the end pins that those three, and only they, do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c7606000-0000-4000-8000-000000000001",
);

type FindOneById = typeof ProjectService.findOneById;

let findSpy: SpyInstance<FindOneById>;
let warnSpy: SpyInstance<typeof logger.warn>;

function projectWith(value: boolean | null | undefined): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  if (value !== undefined) {
    project.notifyStatusPageSubscribersOfNewIncidentsByDefault =
      value as boolean;
  }

  return project;
}

function answerWith(project: Project | null): void {
  findSpy.mockImplementation((async () => {
    return project;
  }) as never);
}

beforeEach(() => {
  findSpy = jest.spyOn(ProjectService, "findOneById");
  warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault", () => {
  test("reads the project once, as OneUptime, for the one column", async () => {
    answerWith(projectWith(true));

    await NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault(
      PROJECT_ID,
    );

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy.mock.calls[0]![0]).toEqual({
      id: PROJECT_ID,
      select: { [NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN]: true },
      props: { isRoot: true },
    });
  });

  test("is false only where the project turned it off", async () => {
    answerWith(projectWith(false));

    expect(
      await NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault(
        PROJECT_ID,
      ),
    ).toBe(false);
  });

  test("is true where the project keeps it on, as every project starts", async () => {
    answerWith(projectWith(true));

    expect(
      await NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault(
        PROJECT_ID,
      ),
    ).toBe(true);
  });

  test.each([
    ["holds no value", projectWith(undefined)],
    ["holds null", projectWith(null)],
    ["is not found", null],
  ])(
    "is true where the project %s: nothing unknown silences subscribers",
    async (_label: string, project: Project | null) => {
      answerWith(project);

      expect(
        await NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault(
          PROJECT_ID,
        ),
      ).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  test("a read that fails is true, says so in the log, and never throws", async () => {
    const failure: Error = new Error("the database is not connected");
    findSpy.mockImplementation((async () => {
      throw failure;
    }) as never);

    await expect(
      NewIncidentSubscriberNotificationDefaultReader.isTickedByDefault(
        PROJECT_ID,
      ),
    ).resolves.toBe(true);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(String(warnSpy.mock.calls[0]![0])).toContain(
      "notifies status page subscribers of new incidents by default",
    );
    expect(warnSpy.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID.toString(),
    });
    expect(warnSpy.mock.calls[1]![0]).toBe(failure);
  });
});

describe("NewIncidentSubscriberNotificationDefaultReader.applyToIncidentDeclaredWithoutBox", () => {
  async function declared(
    project: Project | null,
    incident: Incident = new Incident(),
  ): Promise<Incident> {
    answerWith(project);

    await NewIncidentSubscriberNotificationDefaultReader.applyToIncidentDeclaredWithoutBox(
      {
        incident: incident,
        projectId: PROJECT_ID,
      },
    );

    return incident;
  }

  test("off: the incident is declared without notifying status page subscribers", async () => {
    const incident: Incident = await declared(projectWith(false));

    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(false);
  });

  test("on: the incident is left as it is, so it notifies them as it always did", async () => {
    const incident: Incident = await declared(projectWith(true));

    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBeUndefined();
    // Written as the incident always was: nothing else on it is touched.
    expect(Incident.toJSONObject(incident, Incident)).toEqual(
      Incident.toJSONObject(new Incident(), Incident),
    );
  });

  test.each([
    ["holds no value", projectWith(undefined)],
    ["is not found", null],
  ])(
    "a project that %s leaves the incident as it is",
    async (_label: string, project: Project | null) => {
      const incident: Incident = await declared(project);

      expect(
        incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBeUndefined();
    },
  );

  test("a read that fails leaves the incident as it is, and the declare goes on", async () => {
    findSpy.mockImplementation((async () => {
      throw new Error("timeout");
    }) as never);

    const incident: Incident = new Incident();

    await expect(
      NewIncidentSubscriberNotificationDefaultReader.applyToIncidentDeclaredWithoutBox(
        { incident: incident, projectId: PROJECT_ID },
      ),
    ).resolves.toBeUndefined();

    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBeUndefined();
  });

  test("it reads the project the incident is declared in", async () => {
    await declared(projectWith(false));

    expect(findSpy.mock.calls[0]![0].id).toBe(PROJECT_ID);
  });
});

/*
 * Which declare paths ask: the three where a person declares an incident and
 * nothing asks about subscribers. A monitor's, a workflow's, the API's or a
 * public form's incidents keep their own value, so no other server file
 * calls it - and the Dashboard's form starts its box from the same rule
 * (useNewIncidentNotifyDefault), so the server never second-guesses it.
 */
describe("who asks", () => {
  const SERVER_ROOT: string = path.resolve(__dirname, "../../../../Server");
  const CALL: string = "applyToIncidentDeclaredWithoutBox(";

  const EXPECTED: ReadonlyArray<string> = [
    "Utils/AI/Toolbox/IncidentWriteTools.ts",
    "Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
    "Utils/Workspace/Slack/Actions/Incident.ts",
  ];

  function serverFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          files.push(...serverFiles(full));
        }
      } else if (entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }

    return files;
  }

  test("Slack's and Microsoft Teams' Declare Incident forms and OneUptime AI's create_incident, and nothing else", () => {
    const callers: Array<string> = serverFiles(SERVER_ROOT)
      .filter((file: string): boolean => {
        return (
          !file.endsWith("NewIncidentSubscriberNotificationDefaultReader.ts") &&
          fs.readFileSync(file, "utf8").includes(CALL)
        );
      })
      .map((file: string): string => {
        return path.relative(SERVER_ROOT, file).split(path.sep).join("/");
      })
      .sort();

    expect(callers).toEqual([...EXPECTED]);
  });

  test.each(
    EXPECTED.map((file: string): [string] => {
      return [file];
    }),
  )("%s asks once, before it creates the incident", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(SERVER_ROOT, file),
      "utf8",
    );
    const asked: number = source.indexOf(CALL);
    const created: number = source.indexOf("IncidentService.create(", asked);

    expect(source.split(CALL)).toHaveLength(2);
    expect(asked).toBeGreaterThan(-1);
    expect(created).toBeGreaterThan(asked);
  });
});
