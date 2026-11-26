import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getAuditLogFieldTitle } from "../../../Utils/AuditLog/AuditLogFieldTitles";
import { getApiSingularName } from "../../../Utils/ModelApiName";
import { describe, expect, test } from "@jest/globals";

/*
 * AN AUDIT ENTRY'S FIELD READS AS ITS MODEL NAMES IT (#10290).
 *
 * The audit log drew each changed field as its key split into English words
 * ("Vmware V Centers", "Network Device Tie Source"). It reads now as the
 * title the model gives the column - what its forms and API reference say -
 * found from the type the entry is stored under, or the name it is shown by.
 */

describe("a field an entry recorded", () => {
  test.each([
    ["Monitor", "name", "Name"],
    ["Monitor", "databaseServers", "Databases"],
    ["Monitor", "vmwareVCenters", "vCenters"],
    ["Monitor", "networkDeviceTieSource", "Network Device Set By"],
    ["Monitor", "isArchived", "Is Archived"],
  ])(
    "%s.%s reads as %p",
    (resourceType: string, field: string, title: string) => {
      expect(getAuditLogFieldTitle(resourceType, field)).toBe(title);
    },
  );

  test("the base model's columns read as they are titled on every model", () => {
    expect(getAuditLogFieldTitle("Monitor", "lastModifiedByActorType")).toBe(
      "Last Modified By Actor Type",
    );
  });

  test("a renamed model is found under the name its entries are stored by and the one it is shown by", () => {
    const renamed: BaseModel | undefined = (
      AllModelTypes as Array<{ new (): BaseModel }>
    )
      .map((modelType: { new (): BaseModel }): BaseModel => {
        return new modelType();
      })
      .find((model: BaseModel): boolean => {
        return Boolean(
          model.apiSingularName &&
            model.singularName &&
            model.apiSingularName !== model.singularName,
        );
      });

    expect(renamed).toBeDefined();

    const stored: string = getApiSingularName(renamed!);
    const shown: string = renamed!.singularName!;

    expect(getAuditLogFieldTitle(stored, "createdAt")).toBe("Created At");
    expect(getAuditLogFieldTitle(shown, "createdAt")).toBe("Created At");
  });

  test.each([
    ["a field its model does not have", "Monitor", "noSuchColumn"],
    ["a type no model is stored under", "Not A Model", "name"],
    ["no type", undefined, "name"],
    ["no field", "Monitor", undefined],
    ["an empty type", "", "name"],
  ])(
    "%s reads as nothing, and the log draws its key",
    (
      _name: string,
      resourceType: string | undefined,
      field: string | undefined,
    ) => {
      expect(getAuditLogFieldTitle(resourceType, field)).toBeNull();
    },
  );
});
