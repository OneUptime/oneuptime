import { describe, expect, test } from "@jest/globals";
import Alert from "../../../../Models/DatabaseModels/Alert";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceRelation,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import URL from "../../../../Types/API/URL";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * An OpenStack cloud linked to an incident, an alert and a scheduled maintenance event: the
 * column each form writes, and the line the record's feed, email and chat name it with. What a
 * cloud's own page lists is walked in OpenStackProductArea.spec.ts.
 */
const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const DASHBOARD: URL = URL.fromString(
  "https://oneuptime.example.com/dashboard",
);

const RECORDS: ReadonlyArray<[string, DatabaseBaseModelType]> = [
  ["Incident", Incident],
  ["Alert", Alert],
  ["ScheduledMaintenance", ScheduledMaintenance],
];

function cloud(
  name: string,
  projectId: ObjectID = PROJECT_ID,
): Record<string, unknown> {
  return { _id: CLOUD_ID.toString(), name, projectId };
}

describe.each(RECORDS)(
  "%s",
  (_name: string, modelType: DatabaseBaseModelType) => {
    const model: BaseModel = new modelType();

    test("holds the clouds it is linked to, many to many", () => {
      const column: TableColumnMetadata =
        model.getTableColumnMetadata("openStackClouds");
      expect(column.type).toBe(TableColumnType.EntityArray);
      expect(column.modelType).toBe(OpenStackCloud);
    });

    test("anyone who can create or edit the record can set them, and read them back", () => {
      const access: {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      } = model.getColumnAccessControlFor("openStackClouds") as never;
      expect(access.create.length).toBeGreaterThan(0);
      expect(access.read.length).toBeGreaterThan(0);
      expect(access.update.length).toBeGreaterThan(0);
    });

    test("is read for its clouds when the server writes about it", () => {
      const columns: Array<string> = LinkedAffectedResources.getRelations(
        model,
      ).map((relation: LinkedAffectedResourceRelation) => {
        return relation.column;
      });
      expect(columns).toContain("openStackClouds");
    });
  },
);

describe("what a record's feed says of a linked cloud", () => {
  function linesFor(name: string): Array<string> {
    const resources: Array<LinkedAffectedResource> =
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: PROJECT_ID,
            openStackClouds: [cloud(name)],
          } as never,
        ],
      });
    return LinkedAffectedResources.getMarkdownLines({
      dashboardUrl: DASHBOARD,
      projectId: PROJECT_ID,
      resources,
    }).map((line: unknown): string => {
      return String(line);
    });
  }

  test("names it, and links to its page in this project", () => {
    expect(linesFor("acme-prod")).toEqual([
      `- [OpenStack Cloud acme-prod](https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/openstack/${CLOUD_ID.toString()})`,
    ]);
  });

  test("a cloud's name comes from an agent's settings, so it can't write a link of its own", () => {
    const [line]: Array<string> = linesFor(
      "evil](https://attacker.example) [click",
    );
    expect(line).not.toContain("](https://attacker.example)");
    expect(line).toContain(`/openstack/${CLOUD_ID.toString()}`);
  });

  test("the cloud of another project, linked before the write guard, is left out", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: PROJECT_ID,
            openStackClouds: [cloud("not-yours", OTHER_PROJECT_ID)],
          } as never,
        ],
      }),
    ).toEqual([]);
  });

  test("the plain words an email and a chat message use", () => {
    expect(
      LinkedAffectedResources.getLabel({
        type: LinkedAffectedResourceType.OpenStackCloud,
        id: CLOUD_ID.toString(),
        name: "acme-prod",
      } as LinkedAffectedResource),
    ).toBe("OpenStack Cloud");
  });
});
