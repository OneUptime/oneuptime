import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageIncidentCategory from "../../../../Models/DatabaseModels/StatusPageIncidentCategory";
import StatusPageIncidentCategoryService from "../../../../Server/Services/StatusPageIncidentCategoryService";
import getIncidentNotificationCategoryIds from "../../../../Server/Utils/StatusPage/IncidentNotificationCategoryIds";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("incident subscriber category IDs", () => {
  test("loads mapped categories once for the page and incident labels", async () => {
    const page: StatusPage = new StatusPage();
    page.id = ObjectID.generate();
    page.allowSubscribersToChooseIncidentCategories = true;

    const label: Label = new Label();
    label.id = ObjectID.generate();
    const incident: Incident = new Incident();
    incident.labels = [label];

    const category: StatusPageIncidentCategory =
      new StatusPageIncidentCategory();
    category.id = ObjectID.generate();
    jest
      .spyOn(
        StatusPageIncidentCategoryService,
        "getCategoriesForIncidentLabels",
      )
      .mockResolvedValue([category]);

    await expect(
      getIncidentNotificationCategoryIds(incident, page),
    ).resolves.toEqual([category.id]);
    expect(
      StatusPageIncidentCategoryService.getCategoriesForIncidentLabels,
    ).toHaveBeenCalledWith({ statusPageId: page.id, labelIds: [label.id] });
  });

  test("a disabled category choice or unlabeled incident requires no query", async () => {
    const page: StatusPage = new StatusPage();
    page.id = ObjectID.generate();

    const incident: Incident = new Incident();
    jest.spyOn(
      StatusPageIncidentCategoryService,
      "getCategoriesForIncidentLabels",
    );

    await expect(
      getIncidentNotificationCategoryIds(incident, page),
    ).resolves.toEqual([]);
    page.allowSubscribersToChooseIncidentCategories = true;
    await expect(
      getIncidentNotificationCategoryIds(incident, page),
    ).resolves.toEqual([]);
    expect(
      StatusPageIncidentCategoryService.getCategoriesForIncidentLabels,
    ).not.toHaveBeenCalled();
  });
});
