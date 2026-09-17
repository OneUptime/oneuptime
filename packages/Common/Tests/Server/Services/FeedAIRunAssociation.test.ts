import AlertFeed, {
  AlertFeedEventType,
} from "../../../Models/DatabaseModels/AlertFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import type { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const ALERT_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const AI_RUN_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

function expectRunAssociationMetadata(
  model: IncidentFeed | AlertFeed,
  target: typeof IncidentFeed | typeof AlertFeed,
  subjectIdColumn: "incidentId" | "alertId",
): void {
  expect(model.getTableColumns().columns).toContain("aiRunId");

  const tableColumn: TableColumnMetadata =
    model.getTableColumnMetadata("aiRunId");
  expect(tableColumn.type).toBe(TableColumnType.ObjectID);
  expect(tableColumn.required).toBe(false);
  expect(tableColumn.canReadOnRelationQuery).toBe(true);

  const databaseColumn: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
      return column.target === target && column.propertyName === "aiRunId";
    });
  expect(databaseColumn?.options.nullable).toBe(true);

  const hasExactLookupIndex: boolean = getMetadataArgsStorage().indices.some(
    (index: IndexMetadataArgs): boolean => {
      return (
        index.target === target &&
        Array.isArray(index.columns) &&
        index.columns.length === 2 &&
        index.columns[0] === subjectIdColumn &&
        index.columns[1] === "aiRunId"
      );
    },
  );
  expect(hasExactLookupIndex).toBe(true);
}

describe("feed AI run association metadata", () => {
  it("defines a nullable, exact-lookup-indexed incident feed association", () => {
    expectRunAssociationMetadata(
      new IncidentFeed(),
      IncidentFeed,
      "incidentId",
    );
  });

  it("defines a nullable, exact-lookup-indexed alert feed association", () => {
    expectRunAssociationMetadata(new AlertFeed(), AlertFeed, "alertId");
  });
});

describe("feed service AI run persistence", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("copies aiRunId into the incident RootCause row", async () => {
    jest
      .spyOn(IncidentFeedService, "create")
      .mockResolvedValue(new IncidentFeed());

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      aiRunId: AI_RUN_ID,
      incidentFeedEventType: IncidentFeedEventType.RootCause,
      feedInfoInMarkdown: "Incident analysis",
    });

    const createCall: CreateBy<IncidentFeed> = jest.mocked(
      IncidentFeedService.create,
    ).mock.calls[0]![0];
    const createData: IncidentFeed = createCall.data;
    expect(createData.aiRunId).toEqual(AI_RUN_ID);
    expect(createData.incidentId).toEqual(INCIDENT_ID);
    expect(createData.incidentFeedEventType).toBe(
      IncidentFeedEventType.RootCause,
    );
    expect(createCall.props).toEqual({ isRoot: true });
  });

  it("copies aiRunId into the alert RootCause row", async () => {
    jest.spyOn(AlertFeedService, "create").mockResolvedValue(new AlertFeed());

    await AlertFeedService.createAlertFeedItem({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
      aiRunId: AI_RUN_ID,
      alertFeedEventType: AlertFeedEventType.RootCause,
      feedInfoInMarkdown: "Alert analysis",
    });

    const createCall: CreateBy<AlertFeed> = jest.mocked(AlertFeedService.create)
      .mock.calls[0]![0];
    const createData: AlertFeed = createCall.data;
    expect(createData.aiRunId).toEqual(AI_RUN_ID);
    expect(createData.alertId).toEqual(ALERT_ID);
    expect(createData.alertFeedEventType).toBe(AlertFeedEventType.RootCause);
    expect(createCall.props).toEqual({ isRoot: true });
  });
});
