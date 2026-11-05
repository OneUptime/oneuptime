import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Entities, {
  getModelTypeByName,
} from "../../../Models/DatabaseModels/Index";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import User from "../../../Models/DatabaseModels/User";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import ComponentMetadata, { Argument } from "../../../Types/Workflow/Component";
import Components from "../../../Types/Workflow/Components";
import {
  LINKED_USER_TABLE_NAME,
  LinkedRecordColumn,
  getLinkedRecordColumn,
  isLinkableModel,
} from "../../../Types/Workflow/LinkedRecord";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #5943: which of a model's columns name another of the project's
 * records, and which tables can be listed for someone to pick one - read from
 * the real models, since a new model should get this with nothing else to do.
 */

describe("the column that holds a related record's ID", () => {
  test("Incident Severity ID lists the incident severities, by that name", () => {
    expect(getLinkedRecordColumn(new Incident(), "incidentSeverityId")).toEqual(
      {
        tableName: "IncidentSeverity",
        title: "Incident Severity",
      },
    );
  });

  test("Current Incident State ID lists the incident states", () => {
    const linked: LinkedRecordColumn | null = getLinkedRecordColumn(
      new Incident(),
      "currentIncidentStateId",
    );

    expect(linked?.tableName).toBe("IncidentState");
    expect(linked?.title).toBe("Current Incident State");
  });

  test("an alert's severity lists the alert severities, not the incident ones", () => {
    expect(
      getLinkedRecordColumn(new Alert(), "alertSeverityId")?.tableName,
    ).toBe("AlertSeverity");
  });

  test("who created a record lists the project's people", () => {
    expect(
      getLinkedRecordColumn(new Incident(), "createdByUserId")?.tableName,
    ).toBe(LINKED_USER_TABLE_NAME);
  });

  test("a column that holds no ID points at nothing", () => {
    expect(getLinkedRecordColumn(new Incident(), "title")).toBeNull();
    expect(getLinkedRecordColumn(new Incident(), "customFields")).toBeNull();
    expect(getLinkedRecordColumn(new Incident(), "notAColumn")).toBeNull();
  });

  test("the relation itself is offered through its ID column, not on its own", () => {
    expect(
      getLinkedRecordColumn(new Incident(), "incidentSeverity"),
    ).toBeNull();
    expect(
      getLinkedRecordColumn(new Incident(), "currentIncidentState"),
    ).toBeNull();
  });
});

describe("the record's project", () => {
  test("is never picked: the run stamps it on every record it writes", () => {
    expect(getLinkedRecordColumn(new Incident(), "projectId")).toBeNull();
    expect(getLinkedRecordColumn(new Incident(), "project")).toBeNull();
    expect(getLinkedRecordColumn(new Monitor(), "projectId")).toBeNull();
  });
});

describe("a list of related records", () => {
  test("names the records of its table, by the list's own name", () => {
    expect(getLinkedRecordColumn(new Incident(), "labels")).toEqual({
      tableName: "Label",
      title: "Labels",
    });
    expect(getLinkedRecordColumn(new Incident(), "monitors")?.tableName).toBe(
      "Monitor",
    );
  });

  test("of files has nothing to list", () => {
    expect(
      getLinkedRecordColumn(new Incident(), "postmortemAttachments"),
    ).toBeNull();
  });
});

describe("a record's own ID", () => {
  test("lists the records of the model itself, and keeps its own name", () => {
    expect(getLinkedRecordColumn(new Incident(), "_id")).toEqual({
      tableName: "Incident",
    });
  });
});

describe("which models can be listed", () => {
  test("a value a project keeps: a severity, a label", () => {
    expect(isLinkableModel(new IncidentSeverity())).toBe(true);
    expect(isLinkableModel(new Label())).toBe(true);
  });

  test("a record with a title or a name: an incident, a monitor", () => {
    expect(isLinkableModel(new Incident())).toBe(true);
    expect(isLinkableModel(new Monitor())).toBe(true);
  });

  test("people, through the project's teams, though they are no row of it", () => {
    expect(isLinkableModel(new User())).toBe(true);
  });

  test("not a project: it is its own tenant", () => {
    expect(isLinkableModel(new Project())).toBe(false);
  });

  test("not a file: the API lists none", () => {
    expect(isLinkableModel(new File())).toBe(false);
  });

  test("not a model nothing can be called by but its ID", () => {
    expect(isLinkableModel(new StatusPageResource())).toBe(false);
  });

  test("gives one answer each time it is asked", () => {
    expect(isLinkableModel(new Label())).toBe(isLinkableModel(new Label()));
  });
});

describe("every workflow model", () => {
  const models: Array<BaseModel> = (Entities as Array<{ new (): BaseModel }>)
    .map((modelType: { new (): BaseModel }): BaseModel => {
      return new modelType();
    })
    .filter((model: BaseModel): boolean => {
      return Boolean(model.enableWorkflowOn);
    });

  test("there are models to sweep", () => {
    expect(models.length).toBeGreaterThan(50);
  });

  test("names only tables that exist and can be listed, and never its project", () => {
    for (const model of models) {
      for (const columnId of Object.keys(getTableColumns(model))) {
        const linked: LinkedRecordColumn | null = getLinkedRecordColumn(
          model,
          columnId,
        );

        if (!linked) {
          continue;
        }

        const modelType: { new (): BaseModel } | null = getModelTypeByName(
          linked.tableName,
        );

        expect([model.tableName, columnId, Boolean(modelType)]).toEqual([
          model.tableName,
          columnId,
          true,
        ]);
        expect([
          model.tableName,
          columnId,
          isLinkableModel(new modelType!()),
        ]).toEqual([model.tableName, columnId, true]);
        expect(linked.tableName).not.toBe("Project");
      }
    }
  });

  test("every relation to a value a project keeps gets a list", () => {
    const linkedSeverities: Array<string> = [];

    for (const model of models) {
      for (const columnId of Object.keys(getTableColumns(model))) {
        const linked: LinkedRecordColumn | null = getLinkedRecordColumn(
          model,
          columnId,
        );

        if (linked?.tableName === "IncidentSeverity") {
          linkedSeverities.push(`${model.tableName}.${columnId}`);
        }
      }
    }

    expect(linkedSeverities).toEqual(
      expect.arrayContaining(["Incident.incidentSeverityId"]),
    );
  });
});

describe("the steps' own settings that name records", () => {
  const linkedArguments: Array<{
    component: ComponentMetadata;
    argument: Argument;
  }> = Components.flatMap((component: ComponentMetadata) => {
    return component.arguments
      .filter((argument: Argument): boolean => {
        return Boolean(argument.linkedTable);
      })
      .map((argument: Argument) => {
        return { component: component, argument: argument };
      });
  });

  test("there are some: a Page step's incident, From Another Tool's severity", () => {
    const names: Array<string> = linkedArguments.map(
      (entry: { component: ComponentMetadata; argument: Argument }): string => {
        return `${entry.component.title} / ${entry.argument.name}`;
      },
    );

    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(names.join("\n")).toContain("Incident ID");
    expect(names.join("\n")).toContain("Severity");
    expect(names.join("\n")).toContain("Labels");
  });

  test("each names a table that can be listed", () => {
    for (const entry of linkedArguments) {
      const modelType: { new (): BaseModel } | null = getModelTypeByName(
        entry.argument.linkedTable as string,
      );

      expect([entry.argument.id, Boolean(modelType)]).toEqual([
        entry.argument.id,
        true,
      ]);
      expect([entry.argument.id, isLinkableModel(new modelType!())]).toEqual([
        entry.argument.id,
        true,
      ]);
    }
  });

  test("each stays stored as text, so a value from an earlier step fits it", () => {
    for (const entry of linkedArguments) {
      expect(entry.argument.type).toBe("Text");
    }
  });
});
