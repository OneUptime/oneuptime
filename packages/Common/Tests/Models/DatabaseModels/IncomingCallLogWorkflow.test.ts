/*
 * The runtime component registry reaches the native isolated-vm addon through
 * the JavaScript component's sandbox. Nothing here runs a sandbox, so stub it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import IncomingCallLog from "../../../Models/DatabaseModels/IncomingCallLog";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BaseService from "../../../Server/Services/BaseService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncomingCallLogService from "../../../Server/Services/IncomingCallLogService";
import Services from "../../../Server/Services/Index";
import RuntimeComponents from "../../../Server/Types/Workflow/Components/Index";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import ComponentMetadata, {
  ComponentType,
} from "../../../Types/Workflow/Component";
import BaseModelComponent from "../../../Types/Workflow/Components/BaseModel";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4159: "the call log to be available as a workflow trigger". A
 * workflow can react to calls and read the log, but only the call webhook
 * writes it - the same as the API, where nobody can create, change or delete
 * a call log.
 */

const TRIGGERS_AND_READS: Array<string> = [
  "incoming-call-log-find-one",
  "incoming-call-log-find-many",
  "incoming-call-log-on-create",
  "incoming-call-log-on-update",
];

const WRITES: Array<string> = [
  "incoming-call-log-create-one",
  "incoming-call-log-create-many",
  "incoming-call-log-update-one",
  "incoming-call-log-update-many",
  "incoming-call-log-delete-one",
  "incoming-call-log-delete-many",
  "incoming-call-log-on-delete",
];

function paletteIds(): Array<string> {
  return BaseModelComponent.getComponents(new IncomingCallLog()).map(
    (component: ComponentMetadata): string => {
      return component.id;
    },
  );
}

describe("Incoming Call Log in workflows", () => {
  test("offers On Create, On Update and Find, and nothing that writes", () => {
    expect(new IncomingCallLog().enableWorkflowOn).toEqual({
      create: true,
      update: true,
      read: true,
      delete: false,
      writeSteps: false,
    });
  });

  test("the builder's palette has its triggers and Find steps", () => {
    expect(paletteIds()).toEqual(TRIGGERS_AND_READS);
  });

  test("the builder's palette has no step that writes a call log", () => {
    for (const id of WRITES) {
      expect(paletteIds()).not.toContain(id);
    }
  });

  test("the triggers are named after the call log", () => {
    const titles: Array<string> = BaseModelComponent.getComponents(
      new IncomingCallLog(),
    )
      .filter((component: ComponentMetadata): boolean => {
        return component.componentType === ComponentType.Trigger;
      })
      .map((component: ComponentMetadata): string => {
        return component.title;
      });

    expect(titles).toEqual([
      "On Create Incoming Call Log",
      "On Update Incoming Call Log",
    ]);
  });

  test("the worker can run every step the builder offers, and no other", () => {
    for (const id of TRIGGERS_AND_READS) {
      expect(RuntimeComponents[id]).toBeDefined();
    }

    for (const id of WRITES) {
      expect(RuntimeComponents[id]).toBeUndefined();
    }
  });

  test("its service is registered, which is what the worker builds steps from", () => {
    const registered: Array<DatabaseService<DatabaseBaseModel>> =
      Services.filter((service: BaseService): boolean => {
        return service instanceof DatabaseService;
      }) as Array<DatabaseService<DatabaseBaseModel>>;

    expect(registered).toContain(IncomingCallLogService);
  });

  test("the API still lets nobody create, change or delete a call log", () => {
    const log: IncomingCallLog = new IncomingCallLog();

    expect(log.getCreatePermissions()).toEqual([]);
    expect(log.getUpdatePermissions()).toEqual([]);
    expect(log.getDeletePermissions()).toEqual([]);
  });

  test("the fields the docs tell workflow authors to pick are named as the docs say", () => {
    const columns: ReturnType<typeof getTableColumns> = getTableColumns(
      new IncomingCallLog(),
    );

    expect(columns["endedAt"]?.title).toBe("Ended At");
    expect(columns["status"]?.title).toBe("Status");
    expect(columns["callerPhoneNumber"]?.title).toBe("Caller Phone Number");
    expect(columns["routingPhoneNumber"]?.title).toBe("Routing Phone Number");
  });
});
