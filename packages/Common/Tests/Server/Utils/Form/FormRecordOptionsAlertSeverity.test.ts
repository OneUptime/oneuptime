jest.mock("isolated-vm", () => {
  return {};
});

import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import FormRecordOptions from "../../../../Server/Utils/Form/FormRecordOptions";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Color from "../../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { FormRecordOption } from "../../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../../Types/Form/FormTargetCatalog";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The alert severities an alert form's severity question offers on its
 * public page (#10760): the project's own, never an archived one, in the
 * project's order, read as root because the page is anonymous - and only
 * their names and colours leave the server.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const HIGH: string = "a0000000-0000-4000-8000-000000000001";
const LOW: string = "a0000000-0000-4000-8000-000000000002";

function severities(): Array<AlertSeverity> {
  return [
    Object.assign(new AlertSeverity(), {
      _id: HIGH,
      name: "High",
      color: new Color("#ff0000"),
      order: 1,
    }),
    Object.assign(new AlertSeverity(), {
      _id: LOW,
      name: "Low",
      color: new Color("#00ff00"),
      order: 2,
    }),
  ];
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FormRecordOptions.load: alert severities", () => {
  test("reads the project's alert severities that are not archived, in their order, as root", async () => {
    const findBy: SpyInstance<typeof AlertSeverityService.findBy> = jest
      .spyOn(AlertSeverityService, "findBy")
      .mockResolvedValue(severities());
    const incidentFindBy: SpyInstance<typeof IncidentSeverityService.findBy> =
      jest.spyOn(IncidentSeverityService, "findBy");

    const options: Array<FormRecordOption> = await FormRecordOptions.load({
      projectId: PROJECT_ID,
      source: FormTargetOptionsSource.AlertSeverity,
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, isArchived: false },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
    // An alert form never lists the incident severities.
    expect(incidentFindBy).not.toHaveBeenCalled();

    expect(
      options.map((option: FormRecordOption): string => {
        return `${option.id}:${option.name}`;
      }),
    ).toEqual([`${HIGH}:High`, `${LOW}:Low`]);
  });

  test("with ids, reads only those", async () => {
    const findBy: SpyInstance<typeof AlertSeverityService.findBy> = jest
      .spyOn(AlertSeverityService, "findBy")
      .mockResolvedValue([severities()[0]!]);

    await FormRecordOptions.load({
      projectId: PROJECT_ID,
      source: FormTargetOptionsSource.AlertSeverity,
      ids: [HIGH],
    });

    expect(
      JSON.stringify(
        (findBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
          "_id"
        ],
      ),
    ).toContain(HIGH);
  });

  test("ids that are none read nothing at all", async () => {
    const findBy: SpyInstance<typeof AlertSeverityService.findBy> = jest.spyOn(
      AlertSeverityService,
      "findBy",
    );

    expect(
      await FormRecordOptions.load({
        projectId: PROJECT_ID,
        source: FormTargetOptionsSource.AlertSeverity,
        ids: ["not-an-id"],
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });
});
