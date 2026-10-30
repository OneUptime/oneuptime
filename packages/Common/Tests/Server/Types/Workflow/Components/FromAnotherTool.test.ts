/*
 * Incident From Another Tool and Alert From Another Tool, run against a
 * project held in memory (FromAnotherToolFakes): what each What Happened
 * does, which record it finds and by what, how it moves a record and never
 * back, what it writes and as whom, what it hands on, and every way it says
 * no - by Unchanged when there is nothing to do, by Error when it cannot.
 *
 * The words other tools use are pinned in readWhatHappened's own suite
 * below; the templates that use the step run end to end in the template
 * simulations.
 */

import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RecordFromAnotherTool from "../../../../../Server/Types/Workflow/Components/FromAnotherTool/RecordFromAnotherTool";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import UserType from "../../../../../Types/UserType";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  Port,
  isArgumentRequired,
} from "../../../../../Types/Workflow/Component";
import Components from "../../../../../Types/Workflow/Components";
import {
  ALERT_FROM_ANOTHER_TOOL,
  DEFAULT_OUTSIDE_ID_FIELD,
  FROM_ANOTHER_TOOL_WORDS,
  FROM_OTHER_TOOLS_COMPONENT_CATEGORY,
  FromAnotherToolAction,
  INCIDENT_FROM_ANOTHER_TOOL,
  MAX_OUTSIDE_ID_LENGTH,
  CUSTOM_FIELDS_REFUSAL,
  SEVERITY_POSITIONS,
  SeverityChoice,
  SeverityPosition,
  pickSeverityIndex,
  readCustomFields,
  readOutsideId,
  readOutsideIdField,
  readWhatHappened,
} from "../../../../../Types/Workflow/Components/FromAnotherTool";
import {
  ALERT_SPEC,
  FakeProject,
  INCIDENT_SPEC,
  PROJECT_ID,
  addRecord,
  makeFakeProject,
} from "./FromAnotherToolFakes";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

const STEP_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userType: UserType.Workflow,
};

interface Run {
  result: RunReturnType;
  logs: Array<string>;
}

let project: FakeProject;
let step: RecordFromAnotherTool;

function incidentStep(): void {
  project = makeFakeProject({ spec: INCIDENT_SPEC });
  step = new RecordFromAnotherTool({
    kind: INCIDENT_FROM_ANOTHER_TOOL,
    services: project.services,
    model: project.model,
  });
}

function alertStep(): void {
  project = makeFakeProject({ spec: ALERT_SPEC });
  step = new RecordFromAnotherTool({
    kind: ALERT_FROM_ANOTHER_TOOL,
    services: project.services,
    model: project.model,
  });
}

async function run(args: JSONObject): Promise<Run> {
  const logs: Array<string> = [];
  const options: RunOptions = {
    log: ((item: unknown): void => {
      logs.push(typeof item === "string" ? item : JSON.stringify(item));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };

  return { result: await step.run(args, options), logs };
}

const record: (result: RunReturnType) => JSONObject = (
  result: RunReturnType,
): JSONObject => {
  return result.returnValues["record"] as JSONObject;
};

beforeEach(() => {
  jest
    .spyOn(WorkflowPrincipal, "getProps")
    .mockResolvedValue(STEP_PROPS as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readWhatHappened", () => {
  test.each([
    ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Open].map(
      (word: string): [string, FromAnotherToolAction] => {
        return [word, FromAnotherToolAction.Open];
      },
    ),
    ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Acknowledge].map(
      (word: string): [string, FromAnotherToolAction] => {
        return [word, FromAnotherToolAction.Acknowledge];
      },
    ),
    ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Resolve].map(
      (word: string): [string, FromAnotherToolAction] => {
        return [word, FromAnotherToolAction.Resolve];
      },
    ),
    ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Note].map(
      (word: string): [string, FromAnotherToolAction] => {
        return [word, FromAnotherToolAction.Note];
      },
    ),
  ])("reads %p as %s", (word: string, action: FromAnotherToolAction) => {
    expect(readWhatHappened(word).action).toBe(action);
  });

  test.each([
    // Zabbix's media type, Huntress, Alertmanager and Grafana, as they send them.
    ["problem", FromAnotherToolAction.Open],
    ["recovery", FromAnotherToolAction.Resolve],
    ["update", FromAnotherToolAction.Note],
    ["created", FromAnotherToolAction.Open],
    ["comment-added", FromAnotherToolAction.Note],
    ["closed", FromAnotherToolAction.Resolve],
    ["firing", FromAnotherToolAction.Open],
    ["resolved", FromAnotherToolAction.Resolve],
    ["Alerting", FromAnotherToolAction.Open],
    ["OK", FromAnotherToolAction.Resolve],
  ])("reads the tools' own %p as %s", (word: string, action: FromAnotherToolAction) => {
    expect(readWhatHappened(word).action).toBe(action);
  });

  test("reads any case, and spaces, dashes and underscores between words as one", () => {
    for (const word of [
      "Comment Added",
      "COMMENT_ADDED",
      "comment--added",
      "  comment - added ",
    ]) {
      expect(readWhatHappened(word).action).toBe(FromAnotherToolAction.Note);
    }
  });

  test("a word that is no action's is a state's name, kept as given", () => {
    expect(readWhatHappened(" Monitoring ")).toEqual({
      action: FromAnotherToolAction.MoveToState,
      given: "Monitoring",
    });
  });

  test.each([undefined, null, "", "   ", {}, [], true])(
    "%p is nothing to do",
    (value: unknown) => {
      expect(readWhatHappened(value).action).toBe(FromAnotherToolAction.None);
    },
  );

  test("a number is read as text", () => {
    expect(readWhatHappened(1)).toEqual({
      action: FromAnotherToolAction.MoveToState,
      given: "1",
    });
  });

  test("reads at most 200 characters, however long the text", () => {
    expect(readWhatHappened("x".repeat(400000)).given).toHaveLength(200);
  });
});

describe("readOutsideIdField and readOutsideId", () => {
  test("an empty field is externalId", () => {
    expect(readOutsideIdField(undefined)).toBe(DEFAULT_OUTSIDE_ID_FIELD);
    expect(readOutsideIdField("  ")).toBe("externalId");
  });

  test.each(["zabbixEventId", "huntressReportId", "jira_issue_key", "a1"])(
    "%p is a field the step writes",
    (field: string) => {
      expect(readOutsideIdField(field)).toBe(field);
    },
  );

  test.each(["1abc", "a.b", "a b", "a-b", "a'", "x".repeat(101), "{{x}}"])(
    "%p is not",
    (field: string) => {
      expect(readOutsideIdField(field)).toBeNull();
    },
  );

  test("an outside ID can come as a number, and is trimmed", () => {
    expect(readOutsideId(40312)).toBe("40312");
    expect(readOutsideId(" OPS-12 ")).toBe("OPS-12");
    expect(readOutsideId(null)).toBe("");
  });
});

/*
 * Where a severity sits among a project's, as the templates that read
 * another tool's levels (Zabbix's six, Jira's priorities, Dynamics 365's
 * three) name it, without a step to read the severities first.
 */
describe("pickSeverityIndex", () => {
  const named: (
    names: Array<string>,
  ) => Array<{ id: string; name: string }> = (
    names: Array<string>,
  ): Array<{ id: string; name: string }> => {
    return names.map((name: string, index: number) => {
      return { id: `aaaaaaaa-0000-4000-8000-00000000000${index}`, name: name };
    });
  };

  const DEFAULT: Array<{ id: string; name: string }> = named([
    "Critical Incident",
    "Major Incident",
    "Minor Incident",
  ]);

  test("by ID, in any case", () => {
    expect(
      pickSeverityIndex({
        given: DEFAULT[2]!.id.toUpperCase(),
        severities: DEFAULT,
      }),
    ).toEqual({ index: 2, namedBy: "id" });
  });

  test("by name, in any case, trimmed", () => {
    expect(
      pickSeverityIndex({ given: "  major incident ", severities: DEFAULT }),
    ).toEqual({ index: 1, namedBy: "name" });
  });

  test.each([
    ["most severe", 0],
    ["Most Severe", 0],
    ["most-severe", 0],
    ["MOST_SEVERE", 0],
    ["middle", 1],
    ["Middle", 1],
    ["least severe", 2],
    ["least  severe", 2],
  ])("%p is by place: %p of three", (given: string, index: number) => {
    expect(pickSeverityIndex({ given, severities: DEFAULT })).toEqual({
      index: index,
      namedBy: "position",
    });
  });

  test("a severity named like a place is that severity, not the place", () => {
    const severities: Array<{ id: string; name: string }> = named([
      "Sev 1",
      "Sev 2",
      "Sev 3",
      "Middle",
    ]);

    expect(pickSeverityIndex({ given: "middle", severities })).toEqual({
      index: 3,
      namedBy: "name",
    });
  });

  /*
   * The rule every template spread three levels by: severities[Math.round(
   * (rank / 2) * (count - 1))], rank 0 the most severe and 2 the least.
   */
  test("spreads the three places over any number of severities as the templates always did", () => {
    for (let count: number = 1; count <= 12; count++) {
      const severities: Array<{ id: string; name: string }> = named(
        Array.from({ length: count }, (_value: unknown, index: number) => {
          return `Level ${index + 1}`;
        }),
      );

      SEVERITY_POSITIONS.forEach((position: SeverityPosition, rank: number) => {
        expect({
          count,
          position,
          index: pickSeverityIndex({ given: position, severities }).index,
        }).toEqual({
          count,
          position,
          index: Math.round((rank / 2) * (count - 1)),
        });
      });
    }
  });

  test("the middle of two is the less severe; of four, the third", () => {
    expect(
      pickSeverityIndex({ given: "middle", severities: named(["H", "L"]) })
        .index,
    ).toBe(1);
    expect(
      pickSeverityIndex({
        given: "middle",
        severities: named(["A", "B", "C", "D"]),
      }).index,
    ).toBe(2);
  });

  test.each(["", "   ", "Disaster", "most", "severe", "the middle one"])(
    "%p names none: the most severe",
    (given: string) => {
      const choice: SeverityChoice = pickSeverityIndex({
        given,
        severities: DEFAULT,
      });

      expect(choice).toEqual({ index: 0, namedBy: "none" });
    },
  );

  test("reads a long value in time in line with its length", () => {
    const timed: FastestRun<SeverityChoice> = fastestRun({
      run: (): SeverityChoice => {
        return pickSeverityIndex({
          given: "- ".repeat(200000),
          severities: DEFAULT,
        });
      },
      limitInMs: 2000,
    });

    expect(timed.result).toEqual({ index: 0, namedBy: "none" });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("readCustomFields", () => {
  test("an object, or the JSON text of one, is taken as it is", () => {
    expect(readCustomFields({ caseNumber: "CAS-1" })).toEqual({
      fields: { caseNumber: "CAS-1" },
    });
    expect(readCustomFields('{"caseNumber": "CAS-1", "n": 2}')).toEqual({
      fields: { caseNumber: "CAS-1", n: 2 },
    });
  });

  test.each([undefined, null, "", "   "])("%p is no fields", (value: unknown) => {
    expect(readCustomFields(value)).toEqual({ fields: {} });
  });

  test.each([["[1]"], ["7"], ["not json"], [[{ a: 1 }]], [5], [true]])(
    "%p is refused",
    (value: unknown) => {
      expect(readCustomFields(value)).toEqual({ error: CUSTOM_FIELDS_REFUSAL });
    },
  );
});

describe("the steps' metadata", () => {
  test.each([
    [ComponentID.IncidentFromAnotherTool, "Incident From Another Tool", "Opened"],
    [ComponentID.AlertFromAnotherTool, "Alert From Another Tool", "Created"],
  ])(
    "%s is %s, with its four outputs",
    (componentId: string, title: string, opened: string) => {
      const metadata: ComponentMetadata | undefined = Components.find(
        (component: ComponentMetadata) => {
          return component.id === componentId;
        },
      );

      expect(metadata?.title).toBe(title);
      expect(metadata?.category).toBe(FROM_OTHER_TOOLS_COMPONENT_CATEGORY);
      expect(
        metadata?.outPorts.map((port: Port) => {
          return `${port.id}:${port.title}`;
        }),
      ).toEqual([
        `opened:${opened}`,
        "updated:Updated",
        "unchanged:Unchanged",
        "error:Error",
      ]);
    },
  );

  test("only the incident step can show on status pages", () => {
    const ids: (componentId: string) => Array<string> = (
      componentId: string,
    ): Array<string> => {
      return (
        Components.find((component: ComponentMetadata) => {
          return component.id === componentId;
        })?.arguments || []
      ).map((argument: Argument) => {
        return argument.id;
      });
    };

    expect(ids(ComponentID.IncidentFromAnotherTool)).toContain(
      "show-on-status-pages",
    );
    expect(ids(ComponentID.AlertFromAnotherTool)).not.toContain(
      "show-on-status-pages",
    );
  });

  test("Outside ID is not needed when the record is named by its own ID", () => {
    const outsideId: Argument | undefined = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.IncidentFromAnotherTool;
      },
    )?.arguments.find((argument: Argument) => {
      return argument.id === "outside-id";
    });

    expect(isArgumentRequired(outsideId!, {})).toBe(true);
    expect(
      isArgumentRequired(outsideId!, {
        "record-id": "{{local.components.read-1.returnValues.returnValue.id}}",
      }),
    ).toBe(false);
  });

  test("every advanced setting is folded, and the common ones are not", () => {
    const metadata: ComponentMetadata | undefined = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.IncidentFromAnotherTool;
      },
    );
    const shown: Array<string> = (metadata?.arguments || [])
      .filter((argument: Argument) => {
        return !argument.isAdvanced;
      })
      .map((argument: Argument) => {
        return argument.id;
      });

    expect(shown).toEqual([
      "what-happened",
      "outside-id",
      "title",
      "description",
      "severity",
      "note",
    ]);
  });
});

describe("Incident From Another Tool", () => {
  beforeEach(() => {
    incidentStep();
  });

  describe("open", () => {
    test("opens an incident, kept off status pages, with the outside ID in its custom field", async () => {
      const { result } = await run({
        "what-happened": "problem",
        "outside-id": "40312",
        "outside-id-field": "zabbixEventId",
        title: "Zabbix: High CPU on web-01",
        description: "Opened from **Zabbix**.",
        severity: "major incident",
      });

      expect(result.executePort?.id).toBe("opened");
      expect(result.executePortReason).toBe(
        "Opened INC-1 at Major Incident for zabbixEventId 40312.",
      );

      const created: JSONObject = project.records.creates()[0] as JSONObject;

      expect(created["title"]).toBe("Zabbix: High CPU on web-01");
      expect(created["description"]).toBe("Opened from **Zabbix**.");
      expect(created["customFields"]).toEqual({ zabbixEventId: "40312" });
      expect(created["isVisibleOnStatusPage"]).toBe(false);
      expect(
        created["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
      ).toBe(false);
      expect(String(created["incidentSeverityId"])).toContain(
        project.severities.rows[1]!.id!.toString(),
      );
      expect(record(result)["incidentNumberWithPrefix"]).toBe("INC-1");
      expect(record(result)["_id"]).toBe(
        project.records.rows[0]!.id!.toString(),
      );
    });

    test("writes as the step, a Project Admin of the project, never root", async () => {
      await run({ "what-happened": "open", "outside-id": "1", title: "Down" });

      for (const table of [project.records, project.severities]) {
        for (const call of table.calls) {
          expect(call.props).toBe(STEP_PROPS);
        }
      }
    });

    test("Show On Status Pages shows it, and tells subscribers", async () => {
      await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
        "show-on-status-pages": true,
      });

      const created: JSONObject = project.records.creates()[0] as JSONObject;

      expect(created["isVisibleOnStatusPage"]).toBe(true);
      expect(
        created["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
      ).toBe(true);
    });

    test("keeps the ID in externalId when no field is named", async () => {
      await run({ "what-happened": "open", "outside-id": "a-1", title: "Down" });

      expect(project.records.creates()[0]!["customFields"]).toEqual({
        externalId: "a-1",
      });
    });

    test("never opens a second for an ID that has one, open or resolved", async () => {
      const existing: BaseModel = addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { zabbixEventId: "40312", team: "Payments" },
        stateName: "Resolved",
      });

      const { result } = await run({
        "what-happened": "problem",
        "outside-id": "40312",
        "outside-id-field": "zabbixEventId",
        title: "Again",
      });

      expect(result.executePort?.id).toBe("unchanged");
      expect(result.executePortReason).toBe(
        "INC-1 already has zabbixEventId 40312, so no other incident was opened.",
      );
      expect(project.records.creates()).toHaveLength(0);
      expect(record(result)["_id"]).toBe(existing.id!.toString());
    });

    test("finds by the ID in the project only, in that field only", async () => {
      await run({
        "what-happened": "problem",
        "outside-id": "40312",
        "outside-id-field": "zabbixEventId",
        title: "Down",
      });

      expect(project.records.calls[0]!.query).toEqual({
        projectId: PROJECT_ID,
        customFields: { zabbixEventId: "40312" },
      });
    });

    test("a failed check still opens it, and the log says so: two incidents beat none", async () => {
      project.records.failNext = new Error("connection reset");

      const { result, logs } = await run({
        "what-happened": "problem",
        "outside-id": "1",
        title: "Down",
      });

      expect(result.executePort?.id).toBe("opened");
      expect(logs).toContain(
        "Could not check whether an incident has externalId 1 already, so a new one is opened: connection reset",
      );
    });

    test("a severity that names none of the project's is the most severe, and the log says so", async () => {
      const { result, logs } = await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
        severity: "Disaster",
      });

      expect(result.executePortReason).toContain("at Critical Incident");
      expect(logs).toContain(
        'Severity "Disaster" names none of this project\'s incident severities, so it is Critical Incident, the most severe.',
      );
    });

    test("a severity named by its place is that one, and the log says nothing about it", async () => {
      const middle: Run = await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
        severity: "middle",
      });
      const least: Run = await run({
        "what-happened": "open",
        "outside-id": "2",
        title: "Down",
        severity: "Least Severe",
      });

      expect(middle.result.executePortReason).toContain("at Major Incident");
      expect(least.result.executePortReason).toContain("at Minor Incident");
      expect(
        [...middle.logs, ...least.logs].filter((line: string) => {
          return line.startsWith("Severity");
        }),
      ).toEqual([]);
    });

    test("Custom Fields go on the new incident, with the Outside ID, which no field of theirs can take the place of", async () => {
      await run({
        "what-happened": "open",
        "outside-id": "CAS-7-ID",
        "outside-id-field": "dynamicsCaseId",
        title: "Down",
        "custom-fields": {
          dynamicsCaseNumber: "CAS-01001",
          dynamicsCaseId: "forged",
        },
      });

      expect(project.records.creates()[0]!["customFields"]).toEqual({
        dynamicsCaseNumber: "CAS-01001",
        dynamicsCaseId: "CAS-7-ID",
      });
    });

    test("Custom Fields as JSON text are read the same way", async () => {
      await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
        "custom-fields": '{"tool": "zabbix"}',
      });

      expect(project.records.creates()[0]!["customFields"]).toEqual({
        tool: "zabbix",
        externalId: "1",
      });
    });

    test("Custom Fields that are not an object open nothing, and go down Error", async () => {
      const { result } = await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
        "custom-fields": "[1, 2]",
      });

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toContain(CUSTOM_FIELDS_REFUSAL);
      expect(project.records.creates()).toHaveLength(0);
    });

    test("a severity named by its ID is that one", async () => {
      const minor: string = project.severities.rows[2]!.id!.toString();

      const { result } = await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
        severity: minor,
      });

      expect(result.executePortReason).toContain("at Minor Incident");
    });

    test("labels go on as label IDs; what is not one is left out and said", async () => {
      const label: string = "bbbbbbbb-1111-4222-8333-444444444444";

      const { logs } = await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
        labels: `${label}, not-an-id,\n${label}`,
      });

      expect(project.records.creates()[0]!["labels"]).toEqual([
        expect.objectContaining({ _id: label }),
      ]);
      expect(logs).toContain(
        "Labels: 1 entry is not a label's ID and was left out.",
      );
    });

    test("an empty title opens nothing, and goes down Error", async () => {
      const { result } = await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "  ",
      });

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toContain(
        "Title is empty, so no incident was opened.",
      );
      expect(project.records.creates()).toHaveLength(0);
    });

    test("a project with no severities goes down Error", async () => {
      project.severities.rows = [];

      const { result } = await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
      });

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toContain(
        "This project has no incident severities to put the incident at.",
      );
    });

    test("a refused create goes down Error, with why", async () => {
      project.records.failNext = null;
      project.records.calls = [];

      const failing: Error = new Error("You do not have permission to create");
      const originalCreate: typeof project.records.create =
        project.records.create.bind(project.records);

      project.records.create = async (): Promise<BaseModel> => {
        throw failing;
      };

      const { result } = await run({
        "what-happened": "open",
        "outside-id": "1",
        title: "Down",
      });

      project.records.create = originalCreate;

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toContain(
        "You do not have permission to create",
      );
    });
  });

  describe("acknowledge, resolve and a state's name", () => {
    test("resolve moves it to the first resolved state, with the note as why", async () => {
      const existing: BaseModel = addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { zabbixEventId: "7" },
      });

      const { result } = await run({
        "what-happened": "recovery",
        "outside-id": "7",
        "outside-id-field": "zabbixEventId",
        note: "Synced from Zabbix: problem 7 recovered.",
      });

      expect(result.executePort?.id).toBe("updated");
      expect(result.executePortReason).toBe("Moved INC-1 to Resolved.");
      expect(project.stateOf(existing)).toBe("Resolved");
      expect(project.timeline.creates()[0]).toEqual(
        expect.objectContaining({
          rootCause: "Synced from Zabbix: problem 7 recovered.",
        }),
      );
      expect(record(result)["currentIncidentState"]).toEqual(
        expect.objectContaining({ name: "Resolved" }),
      );
    });

    test("acknowledge moves it to the first acknowledged state", async () => {
      const existing: BaseModel = addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
      });

      const { result } = await run({
        "what-happened": "acknowledged",
        "outside-id": "7",
      });

      expect(result.executePortReason).toBe("Moved INC-1 to Acknowledged.");
      expect(project.stateOf(existing)).toBe("Acknowledged");
      // No note, no reason.
      expect(project.timeline.creates()[0]!["rootCause"]).toBeUndefined();
    });

    test("a state's name moves it there, in any case", async () => {
      const existing: BaseModel = addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
      });

      const { result } = await run({
        "what-happened": "monitoring",
        "outside-id": "7",
      });

      expect(result.executePortReason).toBe("Moved INC-1 to Monitoring.");
      expect(project.stateOf(existing)).toBe("Monitoring");
    });

    test.each([
      ["acknowledge", "Acknowledged", "Acknowledged"],
      ["acknowledge", "Resolved", "Resolved"],
      ["resolve", "Resolved", "Resolved"],
      ["Monitoring", "Resolved", "Resolved"],
      ["Acknowledged", "Monitoring", "Monitoring"],
    ])(
      "%s never moves an incident at %s back",
      async (whatHappened: string, at: string, named: string) => {
        const existing: BaseModel = addRecord({
          project,
          spec: INCIDENT_SPEC,
          customFields: { externalId: "7" },
          stateName: at,
        });

        const { result } = await run({
          "what-happened": whatHappened,
          "outside-id": "7",
        });

        expect(result.executePort?.id).toBe("unchanged");
        expect(result.executePortReason).toBe(
          `INC-1 is already ${named}, so it was left as it is.`,
        );
        expect(project.stateOf(existing)).toBe(at);
        expect(project.timeline.creates()).toHaveLength(0);
      },
    );

    test("an ID no incident has changes nothing", async () => {
      const { result } = await run({
        "what-happened": "resolved",
        "outside-id": "missing",
      });

      expect(result.executePort?.id).toBe("unchanged");
      expect(result.executePortReason).toBe(
        "No incident has externalId missing, so there was nothing to resolve.",
      );
    });

    test("a word that is no action's nor any state's changes nothing, and says so", async () => {
      addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
      });

      const { result } = await run({
        "what-happened": "silenced",
        "outside-id": "7",
      });

      expect(result.executePort?.id).toBe("unchanged");
      expect(result.executePortReason).toBe(
        '"silenced" is not open, acknowledge, resolve or note, nor one of this project\'s incident states, so its state did not change.',
      );
    });

    test("a project with no resolved state goes down Error", async () => {
      project.states.rows = project.states.rows.filter((state: BaseModel) => {
        return state.getColumnValue("isResolvedState") !== true;
      });
      addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
      });

      const { result } = await run({
        "what-happened": "resolve",
        "outside-id": "7",
      });

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toContain(
        "This project has no resolved incident state.",
      );
    });

    test("with a Reason, the Note is added as a private note, then the incident moves with the Reason as why", async () => {
      const existing: BaseModel = addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { zabbixEventId: "7" },
      });

      const { result } = await run({
        "what-happened": "acknowledge",
        "outside-id": "7",
        "outside-id-field": "zabbixEventId",
        note: "Synced from Zabbix: Jane updated problem 7: Acknowledged.\n\nLooking.",
        reason: "Synced from Zabbix: Jane acknowledged problem 7.",
      });

      expect(result.executePort?.id).toBe("updated");
      expect(result.executePortReason).toBe(
        "Added the note to INC-1. Moved INC-1 to Acknowledged.",
      );
      expect(project.stateOf(existing)).toBe("Acknowledged");
      expect(project.notes.creates()).toEqual([
        expect.objectContaining({
          note: "Synced from Zabbix: Jane updated problem 7: Acknowledged.\n\nLooking.",
        }),
      ]);
      expect(project.timeline.creates()).toEqual([
        expect.objectContaining({
          rootCause: "Synced from Zabbix: Jane acknowledged problem 7.",
        }),
      ]);
      // The note first, then the move: the order the old templates kept.
      expect(project.notes.calls[0]!.sequence).toBeLessThan(
        project.timeline.calls[0]!.sequence,
      );
    });

    test("with a Reason, the Note is kept even when the incident is past the state already", async () => {
      addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
        stateName: "Resolved",
      });

      const { result } = await run({
        "what-happened": "acknowledge",
        "outside-id": "7",
        note: "Jane: on it",
        reason: "Jane acknowledged it.",
      });

      expect(result.executePort?.id).toBe("updated");
      expect(result.executePortReason).toBe(
        "Added the note to INC-1. INC-1 is already Resolved, so it was left as it is.",
      );
      expect(project.notes.creates()).toHaveLength(1);
      expect(project.timeline.creates()).toHaveLength(0);
    });

    test("with a Reason and no Note, only the move happens, with the Reason as why", async () => {
      addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
      });

      const { result } = await run({
        "what-happened": "resolve",
        "outside-id": "7",
        reason: "Recovered.",
      });

      expect(result.executePortReason).toBe("Moved INC-1 to Resolved.");
      expect(project.notes.creates()).toHaveLength(0);
      expect(project.timeline.creates()).toEqual([
        expect.objectContaining({ rootCause: "Recovered." }),
      ]);
    });

    test("a resolved incident never moves, even to a state ordered after its own", async () => {
      project = makeFakeProject({
        spec: INCIDENT_SPEC,
        states: [
          { name: "Identified", order: 1 },
          { name: "Resolved", order: 2, isResolvedState: true },
          { name: "Postmortem", order: 3 },
        ],
      });
      step = new RecordFromAnotherTool({
        kind: INCIDENT_FROM_ANOTHER_TOOL,
        services: project.services,
        model: project.model,
      });
      const existing: BaseModel = addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
        stateName: "Resolved",
      });

      const { result } = await run({
        "what-happened": "Postmortem",
        "outside-id": "7",
      });

      expect(result.executePort?.id).toBe("unchanged");
      expect(result.executePortReason).toBe(
        "INC-1 is already Resolved, so it was left as it is.",
      );
      expect(project.stateOf(existing)).toBe("Resolved");
    });

    test("Note Instead Of Resolving adds the note and leaves the incident as it is", async () => {
      const existing: BaseModel = addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
      });

      const { result } = await run({
        "what-happened": "closed",
        "outside-id": "7",
        note: "Huntress closed incident report 7.",
        "note-instead-of-resolving": true,
      });

      expect(result.executePort?.id).toBe("updated");
      expect(result.executePortReason).toBe(
        "Added the note to INC-1, and left it for people to resolve.",
      );
      expect(project.stateOf(existing)).toBe("Identified");
      expect(project.notes.creates()[0]).toEqual(
        expect.objectContaining({ note: "Huntress closed incident report 7." }),
      );
    });

    test("finds the incident by its own ID when one is given, ignoring the outside ID", async () => {
      const existing: BaseModel = addRecord({ project, spec: INCIDENT_SPEC });

      const { result } = await run({
        "what-happened": "acknowledge",
        "record-id": existing.id!.toString(),
      });

      expect(result.executePortReason).toBe("Moved INC-1 to Acknowledged.");
      expect(project.records.calls[0]!.query).toEqual({
        _id: existing.id!.toString(),
        projectId: PROJECT_ID,
      });
    });
  });

  describe("note", () => {
    test("adds the note as a private note", async () => {
      const existing: BaseModel = addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
      });

      const { result } = await run({
        "what-happened": "comment-added",
        "outside-id": "7",
        note: "Synced from Huntress: Alice commented.",
      });

      expect(result.executePort?.id).toBe("updated");
      expect(result.executePortReason).toBe("Added the note to INC-1.");
      expect(project.notes.creates()[0]).toEqual(
        expect.objectContaining({
          note: "Synced from Huntress: Alice commented.",
        }),
      );
      expect(String(project.notes.creates()[0]!["incidentId"])).toContain(
        existing.id!.toString(),
      );
    });

    test("adds it to a resolved incident too", async () => {
      addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
        stateName: "Resolved",
      });

      const { result } = await run({
        "what-happened": "note",
        "outside-id": "7",
        note: "Late comment.",
      });

      expect(result.executePort?.id).toBe("updated");
    });

    test("an empty note adds nothing", async () => {
      addRecord({
        project,
        spec: INCIDENT_SPEC,
        customFields: { externalId: "7" },
      });

      const { result } = await run({
        "what-happened": "note",
        "outside-id": "7",
        note: " ",
      });

      expect(result.executePort?.id).toBe("unchanged");
      expect(project.notes.creates()).toHaveLength(0);
    });

    test("no incident with the ID: the note is not added", async () => {
      const { result } = await run({
        "what-happened": "update",
        "outside-id": "7",
        note: "Hello",
      });

      expect(result.executePortReason).toBe(
        "No incident has externalId 7, so the note was not added.",
      );
    });
  });

  describe("what it refuses", () => {
    test("an empty What Happened changes nothing, and reads nothing", async () => {
      const { result } = await run({ "what-happened": "", "outside-id": "7" });

      expect(result.executePort?.id).toBe("unchanged");
      expect(result.executePortReason).toBe(
        "What Happened is empty, so nothing changed.",
      );
      expect(project.records.calls).toHaveLength(0);
    });

    test("no outside ID and no incident ID goes down Error", async () => {
      const { result } = await run({ "what-happened": "open", title: "x" });

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toBe(
        "Outside ID is empty, so the step cannot tell which incident the event is about.",
      );
    });

    test("an incident ID that is not an ID goes down Error, and reads nothing", async () => {
      const { result } = await run({
        "what-happened": "resolve",
        "record-id": "INC-12",
      });

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toBe(
        'Incident ID must be the ID of an incident, and "INC-12" is not one.',
      );
      expect(project.records.calls).toHaveLength(0);
    });

    test("an Outside ID Field that is not a key goes down Error", async () => {
      const { result } = await run({
        "what-happened": "open",
        "outside-id": "7",
        "outside-id-field": "a.b",
        title: "x",
      });

      expect(result.executePort?.id).toBe("error");
      expect(project.records.calls).toHaveLength(0);
    });

    test("an outside ID longer than an ID goes down Error", async () => {
      const { result } = await run({
        "what-happened": "open",
        "outside-id": "x".repeat(MAX_OUTSIDE_ID_LENGTH + 1),
        title: "x",
      });

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toContain(
        `longer than ${MAX_OUTSIDE_ID_LENGTH} characters`,
      );
    });

    test("a failed read, other than when opening, goes down Error", async () => {
      project.records.failNext = new Error("connection reset");

      const { result } = await run({
        "what-happened": "resolve",
        "outside-id": "7",
      });

      expect(result.executePort?.id).toBe("error");
      expect(result.executePortReason).toContain("connection reset");
    });

    test("a long outside ID with a line break is quoted on one line, and short", async () => {
      const { result } = await run({
        "what-happened": "resolve",
        "outside-id": "line one\nline two " + "y".repeat(200),
      });

      expect(result.executePortReason).not.toContain("\n");
      expect(String(result.executePortReason).length).toBeLessThan(200);
    });
  });
});

describe("Alert From Another Tool", () => {
  beforeEach(() => {
    alertStep();
  });

  test("creates an alert, in the alert's words, with nothing about status pages", async () => {
    const { result } = await run({
      "what-happened": "firing",
      "outside-id": "fp-1",
      title: "HighLatency",
      severity: "low",
    });

    expect(result.executePort?.id).toBe("opened");
    expect(result.executePortReason).toBe(
      "Created ALT-1 at Low for externalId fp-1.",
    );

    const created: JSONObject = project.records.creates()[0] as JSONObject;

    expect(created["isVisibleOnStatusPage"]).toBeUndefined();
    expect(created["customFields"]).toEqual({ externalId: "fp-1" });
    expect(record(result)["alertNumberWithPrefix"]).toBe("ALT-1");
  });

  test("never creates a second for an ID that has one, in the alert's words", async () => {
    addRecord({ project, spec: ALERT_SPEC, customFields: { externalId: "x" } });

    const { result } = await run({
      "what-happened": "firing",
      "outside-id": "x",
      title: "Again",
    });

    expect(result.executePortReason).toBe(
      "ALT-1 already has externalId x, so no other alert was created.",
    );
  });

  test("resolves, acknowledges and notes an alert as the incident step does", async () => {
    const existing: BaseModel = addRecord({
      project,
      spec: ALERT_SPEC,
      customFields: { externalId: "x" },
    });

    await run({ "what-happened": "ack", "outside-id": "x" });
    expect(project.stateOf(existing)).toBe("Acknowledged");

    await run({ "what-happened": "note", "outside-id": "x", note: "Looking" });
    expect(project.notes.creates()[0]).toEqual(
      expect.objectContaining({ note: "Looking" }),
    );

    await run({ "what-happened": "ok", "outside-id": "x", note: "Recovered" });
    expect(project.stateOf(existing)).toBe("Resolved");
    expect(project.timeline.creates()[1]).toEqual(
      expect.objectContaining({ rootCause: "Recovered" }),
    );
  });
});
