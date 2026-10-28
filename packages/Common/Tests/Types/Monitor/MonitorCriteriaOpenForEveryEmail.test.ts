import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { getMonitorCriteriaInstanceSchema } from "../../../Utils/Schema/MonitorSchemas";

/*
 * MonitorCriteriaInstance.openForEveryEmail: an Incoming Email criteria that
 * opens an incident (and alert) for every email that matches it, instead of
 * one at a time.
 *
 * It is saved in the monitor's steps (jsonb), sent by the API and Terraform,
 * and read by the evaluator, so what this pins is that it survives every
 * trip a criteria makes - and that a criteria without it, every one saved
 * before it existed, reads and writes exactly as it did.
 */

function emailCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "0d4f6d3e-79a1-4c1e-8f31-7a5c2b9e4d10",
    monitorStatusId: new ObjectID("9e3a4c2b-1f0d-4e5a-8b6c-7d8e9f0a1b2c"),
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.EmailFrom,
        filterType: FilterType.EndsWith,
        value: "@acme.example",
      },
    ],
    incidents: [],
    alerts: [],
    createIncidents: false,
    createAlerts: false,
    changeMonitorStatus: true,
    isEnabled: true,
    name: "Reported by email",
    description: "",
  };
  return instance;
}

function valueOf(json: JSONObject): JSONObject {
  return json["value"] as JSONObject;
}

describe("openForEveryEmail on a criteria", () => {
  test("is off on a new criteria, and a criteria without it writes no such key", () => {
    const criteria: MonitorCriteriaInstance = emailCriteria();

    expect(criteria.data?.openForEveryEmail).toBeUndefined();
    expect(Object.keys(valueOf(criteria.toJSON()))).not.toContain(
      "openForEveryEmail",
    );
  });

  test("turned on, it survives the JSON round trip and clone", () => {
    const criteria: MonitorCriteriaInstance = emailCriteria();
    criteria.setOpenForEveryEmail(true);

    expect(valueOf(criteria.toJSON())["openForEveryEmail"]).toBe(true);
    expect(
      MonitorCriteriaInstance.fromJSON(criteria.toJSON()).data
        ?.openForEveryEmail,
    ).toBe(true);
    expect(
      MonitorCriteriaInstance.clone(criteria).data?.openForEveryEmail,
    ).toBe(true);
  });

  test("turned off again by the form, it is written as if it had never been on", () => {
    const criteria: MonitorCriteriaInstance = emailCriteria();
    const before: JSONObject = criteria.toJSON();

    criteria.setOpenForEveryEmail(true);
    criteria.setOpenForEveryEmail(undefined);

    expect(criteria.toJSON()).toEqual(before);
  });

  test("a false the API was sent is kept, off, so Terraform reads back what it wrote", () => {
    const json: JSONObject = emailCriteria().toJSON();
    valueOf(json)["openForEveryEmail"] = false;

    const read: MonitorCriteriaInstance =
      MonitorCriteriaInstance.fromJSON(json);

    expect(read.data?.openForEveryEmail).toBe(false);
    expect(valueOf(read.toJSON())["openForEveryEmail"]).toBe(false);
    expect(
      MonitorCriteriaInstance.isOpenForEveryEmail({
        monitorType: MonitorType.IncomingEmail,
        criteriaInstance: read,
      }),
    ).toBe(false);
  });

  test.each([
    ["the text 'true'", "true"],
    ["1", 1],
    ["null", null],
    ["an object", { on: true }],
  ])(
    "only a boolean is read: %s leaves it unset, which is off",
    (_name: string, sent: unknown) => {
      const json: JSONObject = emailCriteria().toJSON();
      valueOf(json)["openForEveryEmail"] = sent as never;

      const read: MonitorCriteriaInstance =
        MonitorCriteriaInstance.fromJSON(json);

      expect(read.data?.openForEveryEmail).toBeUndefined();
      expect(Object.keys(valueOf(read.toJSON()))).not.toContain(
        "openForEveryEmail",
      );
    },
  );

  test("survives a monitor's whole steps, as they are saved and read back", () => {
    const criteria: MonitorCriteriaInstance = emailCriteria();
    criteria.setOpenForEveryEmail(true);

    const step: MonitorStep = new MonitorStep();
    const monitorCriteria: MonitorCriteria = new MonitorCriteria();
    monitorCriteria.data = { monitorCriteriaInstanceArray: [criteria] };
    step.data!.monitorCriteria = monitorCriteria;

    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: ObjectID.generate(),
    };

    const readBack: MonitorSteps = MonitorSteps.fromJSON(
      JSON.parse(JSON.stringify(steps.toJSON())) as JSONObject,
    );

    expect(
      readBack.data?.monitorStepsInstanceArray[0]?.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray[0]?.data?.openForEveryEmail,
    ).toBe(true);
  });

  test("the API schema takes it as an optional boolean", () => {
    const schema: {
      safeParse: (value: unknown) => { success: boolean };
    } = getMonitorCriteriaInstanceSchema() as unknown as {
      safeParse: (value: unknown) => { success: boolean };
    };

    const on: MonitorCriteriaInstance = emailCriteria();
    on.setOpenForEveryEmail(true);

    expect(schema.safeParse(emailCriteria().toJSON()).success).toBe(true);
    expect(schema.safeParse(on.toJSON()).success).toBe(true);

    const notABoolean: JSONObject = on.toJSON();
    valueOf(notABoolean)["openForEveryEmail"] = "yes";

    expect(schema.safeParse(notABoolean).success).toBe(false);
  });

  test("asks nothing more of a criteria to be saved", () => {
    const criteria: MonitorCriteriaInstance = emailCriteria();
    criteria.setOpenForEveryEmail(true);

    expect(
      MonitorCriteriaInstance.getValidationError(
        criteria,
        MonitorType.IncomingEmail,
      ),
    ).toBeNull();
  });
});

describe("MonitorCriteriaInstance.isOpenForEveryEmail", () => {
  test("only an Incoming Email monitor's criteria with the switch on", () => {
    const on: MonitorCriteriaInstance = emailCriteria();
    on.setOpenForEveryEmail(true);

    expect(
      MonitorCriteriaInstance.isOpenForEveryEmail({
        monitorType: MonitorType.IncomingEmail,
        criteriaInstance: on,
      }),
    ).toBe(true);

    expect(
      MonitorCriteriaInstance.isOpenForEveryEmail({
        monitorType: MonitorType.IncomingEmail,
        criteriaInstance: emailCriteria(),
      }),
    ).toBe(false);
  });

  test("means nothing on any other monitor type, whatever the criteria says", () => {
    const on: MonitorCriteriaInstance = emailCriteria();
    on.setOpenForEveryEmail(true);

    for (const monitorType of Object.values(MonitorType)) {
      if (monitorType === MonitorType.IncomingEmail) {
        continue;
      }

      expect({
        monitorType,
        isOn: MonitorCriteriaInstance.isOpenForEveryEmail({
          monitorType,
          criteriaInstance: on,
        }),
      }).toEqual({ monitorType, isOn: false });
    }
  });

  test("no criteria, or no monitor type, is off", () => {
    expect(
      MonitorCriteriaInstance.isOpenForEveryEmail({
        monitorType: MonitorType.IncomingEmail,
        criteriaInstance: null,
      }),
    ).toBe(false);
    expect(
      MonitorCriteriaInstance.isOpenForEveryEmail({
        monitorType: undefined,
        criteriaInstance: emailCriteria(),
      }),
    ).toBe(false);
  });
});
