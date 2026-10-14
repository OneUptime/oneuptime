/*
 * Running a workflow with a record a person can name: INC-8, 8, part of a
 * title, or an ID (Types/Workflow/RunRecord). "Instead of UUID can I enter
 * the user-facing incident ID, for convenience? Can you please make this
 * generic" - so these hold the rules for every model at once: what a typed
 * reference means, which columns hold a record's number and name, and which
 * triggers run with a record.
 */

import Entities from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import Permission from "../../../Types/Permission";
import BuiltInComponents from "../../../Types/Workflow/Components";
import BaseModelComponent from "../../../Types/Workflow/Components/BaseModel";
import ComponentMetadata, {
  ComponentType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  MAX_RUN_RECORD_NUMBER,
  RUN_RECORD_ARGUMENT_ID,
  RUN_RECORD_NAME_MAX_LENGTH,
  RUN_RECORD_SEARCH_MAX_WORDS,
  RecordNumberColumns,
  RunRecordColumns,
  RunRecordEvent,
  RunRecordMatch,
  RunRecordMessages,
  RunRecordOption,
  RunRecordReference,
  RunRecordReferenceKind,
  RunRecordTriggerInfo,
  formatRunRecordNumber,
  getRecordNumberColumns,
  getRunRecordArgument,
  getRunRecordColumns,
  getRunRecordSearchWords,
  getRunRecordTriggerInfo,
  isRunRecordId,
  isRunRecordNumberMatch,
  nameInSentence,
  parseRunRecordReference,
  parseRunRecordSearchResponse,
  readRunRecordText,
} from "../../../Types/Workflow/RunRecord";
import { describe, expect, test } from "@jest/globals";

const ID: string = "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a";

type TriggerOfFunction = (
  model: BaseModel,
  suffix: string,
) => ComponentMetadata;

const triggerOf: TriggerOfFunction = (
  model: BaseModel,
  suffix: string,
): ComponentMetadata => {
  const found: ComponentMetadata | undefined = BaseModelComponent.getComponents(
    model,
  ).find((component: ComponentMetadata): boolean => {
    return component.id.endsWith(suffix);
  });

  if (!found) {
    throw new Error(`No ${suffix} step for ${model.tableName}`);
  }

  return found;
};

describe("what a typed reference means", () => {
  test.each([
    ["", RunRecordReferenceKind.Empty],
    ["   ", RunRecordReferenceKind.Empty],
    [ID, RunRecordReferenceKind.Id],
    [ID.toUpperCase(), RunRecordReferenceKind.Id],
    [`  ${ID}  `, RunRecordReferenceKind.Id],
    ["INC-8", RunRecordReferenceKind.Number],
    ["8", RunRecordReferenceKind.Number],
    ["#8", RunRecordReferenceKind.Number],
    ["inc-8", RunRecordReferenceKind.Number],
    ["Error 500", RunRecordReferenceKind.Number],
    ["Database is down", RunRecordReferenceKind.Text],
    ["INC-", RunRecordReferenceKind.Text],
    ["8 nodes down", RunRecordReferenceKind.Text],
  ])("%p is a reference of kind %s", (typed: string, kind: string) => {
    expect(parseRunRecordReference(typed).kind).toBe(kind);
  });

  test("anything but text is no reference at all", () => {
    for (const value of [undefined, null, 8, {}, [], true]) {
      expect(parseRunRecordReference(value)).toEqual({
        kind: RunRecordReferenceKind.Empty,
        text: "",
      });
    }
  });

  test("a number keeps what was typed before it as its prefix", () => {
    expect(parseRunRecordReference(" INC-42 ")).toEqual({
      kind: RunRecordReferenceKind.Number,
      text: "INC-42",
      number: 42,
      prefix: "INC-",
    });
    expect(parseRunRecordReference("42")).toEqual({
      kind: RunRecordReferenceKind.Number,
      text: "42",
      number: 42,
      prefix: "",
    });
    expect(parseRunRecordReference("SEV1-7").prefix).toBe("SEV1-");
  });

  test("an ID is read in lower case, as IDs are stored", () => {
    const reference: RunRecordReference = parseRunRecordReference(
      ID.toUpperCase(),
    );

    expect(reference.id).toBe(ID);
  });

  test("wide digits and letters typed on a CJK keyboard read as plain ones", () => {
    expect(parseRunRecordReference("ＩＮＣ－８")).toEqual({
      kind: RunRecordReferenceKind.Number,
      text: "INC-8",
      number: 8,
      prefix: "INC-",
    });
  });

  test("a number no record can have is read as text, never sent to the database", () => {
    expect(parseRunRecordReference(String(MAX_RUN_RECORD_NUMBER)).kind).toBe(
      RunRecordReferenceKind.Number,
    );
    expect(
      parseRunRecordReference(String(MAX_RUN_RECORD_NUMBER + 1)).kind,
    ).toBe(RunRecordReferenceKind.Text);
    expect(parseRunRecordReference("1234567890123456789").kind).toBe(
      RunRecordReferenceKind.Text,
    );
  });
});

describe("the words of what was typed, each of which a name has to hold", () => {
  test("split where there is space, however much of it", () => {
    expect(getRunRecordSearchWords("database down")).toEqual([
      "database",
      "down",
    ]);
    expect(getRunRecordSearchWords("  database \t  is\n down  ")).toEqual([
      "database",
      "is",
      "down",
    ]);
  });

  test("one word is one word, and nothing typed is none", () => {
    expect(getRunRecordSearchWords("INC-8")).toEqual(["INC-8"]);
    expect(getRunRecordSearchWords("")).toEqual([]);
    expect(getRunRecordSearchWords("   ")).toEqual([]);
  });

  test("kept as typed: a % or an _ is not taken out here, and case is the database's to ignore", () => {
    expect(getRunRecordSearchWords("100% db_1 Down")).toEqual([
      "100%",
      "db_1",
      "Down",
    ]);
  });

  test("wide letters and a wide space typed on a CJK keyboard read as plain ones", () => {
    expect(getRunRecordSearchWords("ｄａｔａｂａｓｅ\u3000ｄｏｗｎ")).toEqual([
      "database",
      "down",
    ]);
  });

  test("no more than twelve are asked for", () => {
    const typed: string = Array.from(
      { length: 40 },
      (_value: unknown, index: number): string => {
        return `w${index}`;
      },
    ).join(" ");

    expect(RUN_RECORD_SEARCH_MAX_WORDS).toBe(12);
    expect(getRunRecordSearchWords(typed)).toEqual(
      typed.split(" ").slice(0, 12),
    );
  });
});

describe("whether a record with the number is the one meant", () => {
  test.each([
    ["8", "INC-8", true],
    ["#8", "INC-8", true],
    ["# 8", "INC-8", true],
    ["INC-8", "INC-8", true],
    ["inc-8", "INC-8", true],
    ["INC - 8", "INC-8", true],
    ["ALT-8", "INC-8", false],
    ["IE-8", "INC-8", false],
    // A record keeps the prefix it was numbered with.
    ["INC-8", "#8", false],
    ["#8", "#8", true],
    ["8", null, true],
    ["INC-8", null, false],
    ["SM-3", "SM-3", true],
  ])(
    "%p names a record numbered %p: %p",
    (typed: string, stored: string | null, expected: boolean) => {
      expect(
        isRunRecordNumberMatch({
          reference: parseRunRecordReference(typed),
          numberWithPrefix: stored,
        }),
      ).toBe(expected);
    },
  );

  test("a reference that is not a number names nothing by number", () => {
    expect(
      isRunRecordNumberMatch({
        reference: parseRunRecordReference("Database"),
        numberWithPrefix: "INC-8",
      }),
    ).toBe(false);
    expect(
      isRunRecordNumberMatch({
        reference: parseRunRecordReference(ID),
        numberWithPrefix: "INC-8",
      }),
    ).toBe(false);
  });
});

describe("the columns a record is looked up in, for every model", () => {
  const NUMBERED: Array<[BaseModel, RecordNumberColumns]> = [
    [
      new Incident(),
      {
        numberColumn: "incidentNumber",
        numberWithPrefixColumn: "incidentNumberWithPrefix",
      },
    ],
    [
      new Alert(),
      {
        numberColumn: "alertNumber",
        numberWithPrefixColumn: "alertNumberWithPrefix",
      },
    ],
    [
      new ScheduledMaintenance(),
      {
        numberColumn: "scheduledMaintenanceNumber",
        numberWithPrefixColumn: "scheduledMaintenanceNumberWithPrefix",
      },
    ],
    [
      new IncidentEpisode(),
      {
        numberColumn: "episodeNumber",
        numberWithPrefixColumn: "episodeNumberWithPrefix",
      },
    ],
    [
      new AlertEpisode(),
      {
        numberColumn: "episodeNumber",
        numberWithPrefixColumn: "episodeNumberWithPrefix",
      },
    ],
    [
      new SecurityCase(),
      {
        numberColumn: "caseNumber",
        numberWithPrefixColumn: "caseNumberWithPrefix",
      },
    ],
  ];

  test.each(
    NUMBERED.map(
      ([model, columns]: [BaseModel, RecordNumberColumns]): [
        string,
        BaseModel,
        RecordNumberColumns,
      ] => {
        return [model.tableName || "", model, columns];
      },
    ),
  )(
    "%s numbers its records",
    (_tableName: string, model: BaseModel, columns: RecordNumberColumns) => {
      expect(getRecordNumberColumns(model)).toEqual(columns);
    },
  );

  test("a model without numbers has none", () => {
    expect(getRecordNumberColumns(new Monitor())).toBeNull();
  });

  test("names come from the column that names a record", () => {
    expect(getRunRecordColumns(new Incident()).nameColumn).toBe("title");
    expect(getRunRecordColumns(new Incident()).nameTitle).toBe("Title");
    expect(getRunRecordColumns(new Monitor()).nameColumn).toBe("name");
    expect(getRunRecordColumns(new Monitor()).number).toBeNull();
  });

  /*
   * Generic, so it holds for a model added later: a numeric column called
   * "...Number" on a model a workflow can watch has its "...WithPrefix"
   * beside it, so its records can be named by number. A numbered model
   * without one fails here, and gets the column or a decision.
   */
  test("every model a workflow can watch that numbers its records can be run by number", () => {
    const numbered: Array<string> = [];

    for (const ModelType of Entities) {
      const model: BaseModel = new ModelType();

      if (!model.enableWorkflowOn) {
        continue;
      }

      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

      const hasNumberColumn: boolean = Object.keys(columns).some(
        (columnId: string): boolean => {
          return (
            columnId.endsWith("Number") &&
            columns[columnId]?.type === TableColumnType.Number
          );
        },
      );

      if (!hasNumberColumn) {
        continue;
      }

      numbered.push(model.tableName || "");
      expect([model.tableName, getRecordNumberColumns(model)]).not.toEqual([
        model.tableName,
        null,
      ]);
    }

    expect(numbered.sort()).toEqual(
      [
        "Alert",
        "AlertEpisode",
        "Incident",
        "IncidentEpisode",
        "ScheduledMaintenance",
        "SecurityCase",
      ].sort(),
    );
  });

  /*
   * The search reads as the person asking, and a read is refused when it
   * asks for a column they may not read - even one of a record they may. So
   * for every model a workflow can run with a record, whoever may read the
   * record may read what it is looked up by and listed with: its ID, when it
   * was made, its number and its name. A model that guards one of those more
   * closely than the record itself would refuse its own readers here.
   */
  test("whoever may read a record may read every column it is looked up by, for every model a workflow can watch", () => {
    const refused: Array<string> = [];
    let models: number = 0;
    let numbered: number = 0;
    let named: number = 0;

    for (const ModelType of Entities) {
      const model: BaseModel = new ModelType();
      const watched: boolean = Boolean(
        model.enableWorkflowOn &&
          (model.enableWorkflowOn.create ||
            model.enableWorkflowOn.update ||
            model.enableWorkflowOn.delete),
      );

      if (!watched) {
        continue;
      }

      models++;

      const columns: RunRecordColumns = getRunRecordColumns(model);
      const asked: Array<string> = ["_id", "createdAt"];

      if (columns.number) {
        numbered++;
        asked.push(columns.number.numberColumn);
        asked.push(columns.number.numberWithPrefixColumn);
      }

      if (columns.nameColumn) {
        named++;
        asked.push(columns.nameColumn);
      }

      for (const column of asked) {
        const mayRead: Array<Permission> =
          model.getColumnAccessControlFor(column)?.read || [];

        for (const permission of model.readRecordPermissions || []) {
          if (!mayRead.includes(permission)) {
            refused.push(`${model.tableName}.${column}: ${permission}`);
          }
        }
      }
    }

    // Not vacuous: hundreds of models, the six numbered ones among them.
    expect(models).toBeGreaterThan(100);
    expect(numbered).toBe(6);
    expect(named).toBeGreaterThan(50);
    expect(refused).toEqual([]);
  });
});

describe("the triggers that run with a record", () => {
  test.each([
    ["-on-create", RunRecordEvent.Created],
    ["-on-update", RunRecordEvent.Updated],
    ["-on-delete", RunRecordEvent.Deleted],
  ])(
    "an incident's %s trigger runs with an incident, as if it was %s",
    (suffix: string, event: RunRecordEvent) => {
      const info: RunRecordTriggerInfo | null = getRunRecordTriggerInfo(
        triggerOf(new Incident(), suffix),
      );

      expect(info?.event).toBe(event);
      expect(info?.argument.id).toBe(RUN_RECORD_ARGUMENT_ID);
      expect(info?.singularName).toBe("Incident");
      expect(info?.pluralName).toBe("Incidents");
      expect(info?.hasNumber).toBe(true);
      expect(info?.hasName).toBe(true);
    },
  );

  test("a model without numbers is still looked up by name", () => {
    const info: RunRecordTriggerInfo | null = getRunRecordTriggerInfo(
      triggerOf(new Monitor(), "-on-create"),
    );

    expect(info?.hasNumber).toBe(false);
    expect(info?.hasName).toBe(true);
  });

  test("every record trigger of every model runs with a record", () => {
    let triggers: number = 0;

    for (const ModelType of Entities) {
      for (const component of BaseModelComponent.getComponents(
        new ModelType(),
      )) {
        if (component.componentType !== ComponentType.Trigger) {
          continue;
        }

        triggers++;
        expect([
          component.id,
          Boolean(getRunRecordTriggerInfo(component)),
        ]).toEqual([component.id, true]);
      }
    }

    // The scan reached the models, so this is not vacuous.
    expect(triggers).toBeGreaterThan(100);
  });

  test("no other step runs with a record", () => {
    for (const id of [
      ComponentID.Webhook,
      ComponentID.Manual,
      ComponentID.Schedule,
      ComponentID.IncomingEmail,
      ComponentID.Log,
    ]) {
      const metadata: ComponentMetadata | undefined = BuiltInComponents.find(
        (component: ComponentMetadata): boolean => {
          return component.id === id;
        },
      );

      expect(metadata).toBeDefined();
      expect(getRunRecordArgument(metadata)).toBeNull();
      expect(getRunRecordTriggerInfo(metadata)).toBeNull();
    }

    expect(
      getRunRecordArgument(triggerOf(new Incident(), "-find-one")),
    ).toBeNull();
    expect(getRunRecordArgument(undefined)).toBeNull();
  });
});

describe("how a record is named in the list", () => {
  test("its number as stored, else # and the number", () => {
    expect(
      formatRunRecordNumber({ number: 8, numberWithPrefix: "INC-8" }),
    ).toBe("INC-8");
    expect(formatRunRecordNumber({ number: 8, numberWithPrefix: " " })).toBe(
      "#8",
    );
    expect(formatRunRecordNumber({ number: 8, numberWithPrefix: null })).toBe(
      "#8",
    );
    expect(
      formatRunRecordNumber({ number: null, numberWithPrefix: null }),
    ).toBeUndefined();
    expect(
      formatRunRecordNumber({
        number: Number.NaN,
        numberWithPrefix: undefined,
      }),
    ).toBeUndefined();
  });

  test("its name on one line, cut short at a whole character", () => {
    expect(readRunRecordText("  Database\n is   down ")).toBe(
      "Database is down",
    );
    expect(readRunRecordText({ _type: "Name", value: "Ada Lovelace" })).toBe(
      "Ada Lovelace",
    );
    expect(readRunRecordText("")).toBeUndefined();
    expect(readRunRecordText(null)).toBeUndefined();
    expect(readRunRecordText(42)).toBeUndefined();
    expect(readRunRecordText({})).toBeUndefined();

    const long: string = `${"😀".repeat(RUN_RECORD_NAME_MAX_LENGTH)}tail`;
    const cut: string = readRunRecordText(long) as string;

    expect(Array.from(cut)).toHaveLength(RUN_RECORD_NAME_MAX_LENGTH);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toContain("�");
  });

  test("a model's name reads as part of a sentence", () => {
    expect(nameInSentence("Incident")).toBe("incident");
    expect(nameInSentence("Scheduled Maintenance Event")).toBe(
      "scheduled maintenance event",
    );
    expect(nameInSentence("IoT Fleet")).toBe("IoT fleet");
    expect(nameInSentence("On-Call Duty Policy")).toBe("On-Call duty policy");
  });

  test("the server's messages say what happened in plain words", () => {
    expect(RunRecordMessages.cannotRead("Incidents")).toBe(
      "You don't have permission to read incidents, so you can't look one up here.",
    );
    expect(
      RunRecordMessages.noRecordWithNumber({
        singularName: "Incident",
        text: "INC-80",
      }),
    ).toBe("No incident in this project has the number INC-80.");
    expect(RunRecordMessages.pickFromList("Alert")).toBe(
      "Pick the alert to run with from the list, or type its number or ID.",
    );
  });
});

describe("reading an answer from /run-records", () => {
  test("keeps each record with the shape of one", () => {
    const records: Array<RunRecordOption> = parseRunRecordSearchResponse({
      records: [
        {
          id: ID,
          number: "INC-8",
          name: "Database is down",
          createdAt: "2026-10-13T10:00:00.000Z",
          matchedBy: RunRecordMatch.Number,
        },
        { id: "other", matchedBy: "Something else" },
        { number: "INC-9" },
        null,
        "INC-10",
        { id: "", matchedBy: RunRecordMatch.Name },
        { id: "third", name: 5, number: "" },
      ],
    });

    expect(records).toEqual([
      {
        id: ID,
        number: "INC-8",
        name: "Database is down",
        createdAt: "2026-10-13T10:00:00.000Z",
        matchedBy: RunRecordMatch.Number,
      },
      { id: "other", matchedBy: RunRecordMatch.Name },
      { id: "third", matchedBy: RunRecordMatch.Name },
    ]);
  });

  test("anything else lists nothing", () => {
    for (const data of [undefined, null, "records", { records: "x" }, []]) {
      expect(parseRunRecordSearchResponse(data)).toEqual([]);
    }
  });
});

describe("what counts as an ID sent to the run", () => {
  test("a UUID, with or without spaces around it", () => {
    expect(isRunRecordId(ID)).toBe(true);
    expect(isRunRecordId(` ${ID} `)).toBe(true);
    expect(isRunRecordId("INC-8")).toBe(false);
    expect(isRunRecordId("")).toBe(false);
    expect(isRunRecordId(undefined)).toBe(false);
    expect(isRunRecordId(8)).toBe(false);
  });
});
