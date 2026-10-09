import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import AlertCustomFieldService from "../../../Server/Services/AlertCustomFieldService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import InventoryItemCustomFieldService from "../../../Server/Services/InventoryItemCustomFieldService";
import MonitorCustomFieldService from "../../../Server/Services/MonitorCustomFieldService";
import OnCallDutyPolicyCustomFieldService from "../../../Server/Services/OnCallDutyPolicyCustomFieldService";
import ScheduledMaintenanceCustomFieldService from "../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import StatusPageCustomFieldService from "../../../Server/Services/StatusPageCustomFieldService";
import TeamCustomFieldService from "../../../Server/Services/TeamCustomFieldService";
import TeamMemberCustomFieldService from "../../../Server/Services/TeamMemberCustomFieldService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import * as MappingValidator from "../../../Server/Utils/CustomField/CustomFieldMappingValidator";
import * as OptionEditHooks from "../../../Server/Utils/CustomField/CustomFieldOptionEditHooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Renaming a dropdown field's options (#4564) works for every resource's
 * custom fields, not only incidents: each of the nine definition services
 * hands every update to prepareCustomFieldOptionEdit before the write, and
 * what it prepared to applyCustomFieldOptionEdit after it - as itself, for
 * its own model. The two halves are tested in CustomFieldOptionEditHooks;
 * this pins that every service calls them.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const fieldId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: new ObjectID("33333333-3333-4333-8333-333333333333"),
};

interface HookedService {
  onBeforeUpdate: (updateBy: UpdateBy<any>) => Promise<OnUpdate<any>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<any>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<any>>;
}

const SERVICES: Array<{
  name: string;
  modelType: { new (): BaseModel };
  service: DatabaseService<any>;
}> = [
  {
    name: "IncidentCustomFieldService",
    modelType: IncidentCustomField,
    service: IncidentCustomFieldService,
  },
  {
    name: "AlertCustomFieldService",
    modelType: AlertCustomField,
    service: AlertCustomFieldService,
  },
  {
    name: "ScheduledMaintenanceCustomFieldService",
    modelType: ScheduledMaintenanceCustomField,
    service: ScheduledMaintenanceCustomFieldService,
  },
  {
    name: "MonitorCustomFieldService",
    modelType: MonitorCustomField,
    service: MonitorCustomFieldService,
  },
  {
    name: "StatusPageCustomFieldService",
    modelType: StatusPageCustomField,
    service: StatusPageCustomFieldService,
  },
  {
    name: "OnCallDutyPolicyCustomFieldService",
    modelType: OnCallDutyPolicyCustomField,
    service: OnCallDutyPolicyCustomFieldService,
  },
  {
    name: "TeamCustomFieldService",
    modelType: TeamCustomField,
    service: TeamCustomFieldService,
  },
  {
    name: "TeamMemberCustomFieldService",
    modelType: TeamMemberCustomField,
    service: TeamMemberCustomFieldService,
  },
  {
    name: "InventoryItemCustomFieldService",
    modelType: InventoryItemCustomField,
    service: InventoryItemCustomFieldService,
  },
];

const PREPARED: OptionEditHooks.CustomFieldOptionEditCarryForward = {
  fields: [
    {
      id: fieldId,
      projectId: projectId,
      name: "Facility",
      dropdownOptions: "Facility A\nFacility B",
    },
  ],
  renames: [{ from: "Facility A", to: "Facility Alpha" }],
};

let prepare: MockFunction;
let apply: MockFunction;

beforeEach(() => {
  prepare = getJestMockFunction();
  prepare.mockResolvedValue(PREPARED as never);
  jest
    .spyOn(OptionEditHooks, "prepareCustomFieldOptionEdit")
    .mockImplementation(prepare as never);

  apply = getJestMockFunction();
  apply.mockResolvedValue(undefined as never);
  jest
    .spyOn(OptionEditHooks, "applyCustomFieldOptionEdit")
    .mockImplementation(apply as never);

  // The services' other update work, which has nothing to do here.
  jest
    .spyOn(MappingValidator, "validateCustomFieldMappingOnUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "backfillProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function update(): UpdateBy<any> {
  return {
    query: { _id: fieldId.toString() } as never,
    data: { dropdownOptions: "Facility Alpha\nFacility B" } as never,
    miscDataProps: {
      renamedDropdownOptions: [{ from: "Facility A", to: "Facility Alpha" }],
    },
    props: ADMIN_PROPS,
    limit: 1,
    skip: 0,
  };
}

describe.each(SERVICES)("$name", ({ modelType, service }) => {
  const hooked: HookedService = service as unknown as HookedService;

  test("prepares the option edit before the write, as itself", async () => {
    const updateBy: UpdateBy<any> = update();

    await hooked.onBeforeUpdate(updateBy);

    expect(prepare).toHaveBeenCalledTimes(1);

    const input: JSONObject = prepare.mock.calls[0]![0] as JSONObject;

    expect(input["definitionModelType"]).toBe(modelType);
    expect(input["definitionService"]).toBe(service);
    expect(input["updateBy"]).toBe(updateBy);
  });

  test("hands what it prepared to the step after the write, with the rows written", async () => {
    const onUpdate: OnUpdate<any> = await hooked.onBeforeUpdate(update());

    await hooked.onUpdateSuccess(onUpdate, [fieldId]);

    expect(apply).toHaveBeenCalledTimes(1);

    const input: JSONObject = apply.mock.calls[0]![0] as JSONObject;

    expect(input["definitionModelType"]).toBe(modelType);
    expect(input["definitionService"]).toBe(service);
    expect(input["carryForward"]).toEqual(PREPARED);
    expect(input["updatedItemIds"]).toEqual([fieldId]);
  });

  test("a write with nothing to prepare carries nothing to the step after", async () => {
    prepare.mockResolvedValue(null as never);

    const onUpdate: OnUpdate<any> = await hooked.onBeforeUpdate(update());

    await hooked.onUpdateSuccess(onUpdate, [fieldId]);

    expect((apply.mock.calls[0]![0] as JSONObject)["carryForward"]).toBeNull();
  });

  test("a refused rename refuses the write", async () => {
    prepare.mockRejectedValue(
      new Error("Only a dropdown field has options to rename.") as never,
    );

    await expect(hooked.onBeforeUpdate(update())).rejects.toThrow(
      "Only a dropdown field has options to rename.",
    );
  });

  test("values that could not be moved fail the save", async () => {
    apply.mockRejectedValue(new Error("connection lost") as never);

    const onUpdate: OnUpdate<any> = await hooked.onBeforeUpdate(update());

    await expect(hooked.onUpdateSuccess(onUpdate, [fieldId])).rejects.toThrow(
      "connection lost",
    );
  });
});
