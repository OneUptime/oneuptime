import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Color from "../../../Types/Color";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * toJSONObject reads table-column metadata off a cached, frozen, per-class
 * vanilla instance instead of constructing one per row. These tests pin the
 * contract that makes the cache safe: output is identical to a fresh
 * construction, no state bleeds between rows or tenants, the cache is keyed
 * on the declared modelType (not the instance's runtime class), and fromJSON
 * still hands out a fresh mutable instance every call.
 */

describe("DatabaseBaseModel.toJSONObject with cached vanilla model", () => {
  it("serializes a populated model with nested Entity and EntityArray columns", () => {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = "severity-id";
    severity.name = "Critical";

    const monitorOne: Monitor = new Monitor();
    monitorOne._id = "monitor-one-id";
    monitorOne.name = "Monitor One";

    const monitorTwo: Monitor = new Monitor();
    monitorTwo._id = "monitor-two-id";
    monitorTwo.name = "Monitor Two";

    const incident: Incident = new Incident();
    incident._id = "incident-id";
    incident.title = "Database is down";
    incident.projectId = new ObjectID("project-one");
    incident.incidentSeverity = severity;
    incident.monitors = [monitorOne, monitorTwo];

    const json: JSONObject = BaseModel.toJSONObject(incident, Incident);

    expect(json["_id"]).toBe("incident-id");
    expect(json["title"]).toBe("Database is down");
    expect(json["projectId"]).toBe(incident.projectId);

    // Nested Entity column is recursively serialized to a plain object.
    const severityJson: JSONObject = json["incidentSeverity"] as JSONObject;
    expect(severityJson).not.toBeInstanceOf(BaseModel);
    expect(severityJson["_id"]).toBe("severity-id");
    expect(severityJson["name"]).toBe("Critical");

    // Nested EntityArray column is serialized item by item, order preserved.
    const monitorsJson: JSONArray = json["monitors"] as JSONArray;
    expect(Array.isArray(monitorsJson)).toBe(true);
    expect(
      monitorsJson.map((monitor: JSONObject | unknown) => {
        expect(monitor).not.toBeInstanceOf(BaseModel);
        return (monitor as JSONObject)["name"];
      }),
    ).toEqual(["Monitor One", "Monitor Two"]);

    // Unset columns are skipped entirely.
    expect("description" in json).toBe(false);
  });

  it("keeps each row's JSON isolated across repeated calls for the same class", () => {
    const tenantOneProjectId: ObjectID = ObjectID.generate();
    const tenantTwoProjectId: ObjectID = ObjectID.generate();

    const tenantOneLabel: Label = new Label();
    tenantOneLabel._id = "label-tenant-one";
    tenantOneLabel.name = "Tenant One Label";
    tenantOneLabel.projectId = tenantOneProjectId;

    const tenantTwoLabel: Label = new Label();
    tenantTwoLabel._id = "label-tenant-two";
    tenantTwoLabel.name = "Tenant Two Label";
    tenantTwoLabel.projectId = tenantTwoProjectId;

    const jsonOne: JSONObject = BaseModel.toJSONObject(tenantOneLabel, Label);
    const jsonTwo: JSONObject = BaseModel.toJSONObject(tenantTwoLabel, Label);

    // Second serialization must not disturb the first result.
    expect(jsonOne["_id"]).toBe("label-tenant-one");
    expect(jsonOne["name"]).toBe("Tenant One Label");
    expect(jsonOne["projectId"]).toBe(tenantOneProjectId);

    expect(jsonTwo["_id"]).toBe("label-tenant-two");
    expect(jsonTwo["name"]).toBe("Tenant Two Label");
    expect(jsonTwo["projectId"]).toBe(tenantTwoProjectId);
  });

  it("does not leak a key set on an earlier row into a later row without it", () => {
    const labelWithColor: Label = new Label();
    labelWithColor.name = "Colored";
    labelWithColor.color = new Color("#112233");

    const labelWithoutColor: Label = new Label();
    labelWithoutColor.name = "Plain";

    const jsonWithColor: JSONObject = BaseModel.toJSONObject(
      labelWithColor,
      Label,
    );
    const jsonWithoutColor: JSONObject = BaseModel.toJSONObject(
      labelWithoutColor,
      Label,
    );

    expect(jsonWithColor["color"]).toBe(labelWithColor.color);
    expect("color" in jsonWithoutColor).toBe(false);
  });

  it("serializes by the declared modelType, not the instance's runtime class", () => {
    const label: Label = new Label();
    label._id = "declared-type-label";
    label.name = "Declared Type";
    label.color = new Color("#445566");
    label.projectId = ObjectID.generate();

    /*
     * Warm the subclass cache first so a cache wrongly keyed on
     * model.constructor would surface Label columns below.
     */
    BaseModel.toJSONObject(label, Label);

    const baseJson: JSONObject = BaseModel.toJSONObject(label, BaseModel);

    const baseColumns: Array<string> = new BaseModel().getTableColumns()
      .columns;
    for (const key of Object.keys(baseJson)) {
      expect(baseColumns).toContain(key);
    }

    expect(baseJson["_id"]).toBe("declared-type-label");
    expect("color" in baseJson).toBe(false);
    expect("projectId" in baseJson).toBe(false);
  });

  it("toJSONObject on a fresh base model returns an empty object", () => {
    const json: JSONObject = BaseModel.toJSONObject(new BaseModel(), BaseModel);
    expect(json).toEqual({});
  });

  it("fromJSON returns a fresh mutable instance on every call", () => {
    const json: JSONObject = {
      name: "oneuptime",
      description: "a label",
    };

    const first: Label = BaseModel.fromJSON(json, Label) as Label;
    const second: Label = BaseModel.fromJSON(json, Label) as Label;

    expect(first).toBeInstanceOf(Label);
    expect(second).toBeInstanceOf(Label);
    expect(first).not.toBe(second);

    first.name = "mutated";
    expect(second.name).toBe("oneuptime");
    expect(second.description).toBe("a label");
  });

  it("toJSONObjectArray serializes every item correctly on the cache-hit path", () => {
    const labels: Array<Label> = [1, 2, 3, 4].map((index: number) => {
      const label: Label = new Label();
      label._id = `label-${index}`;
      label.name = `Label ${index}`;
      return label;
    });

    const jsonArray: JSONArray = BaseModel.toJSONObjectArray(labels, Label);

    expect(jsonArray).toHaveLength(4);
    jsonArray.forEach((item: JSONObject | unknown, index: number) => {
      expect((item as JSONObject)["_id"]).toBe(`label-${index + 1}`);
      expect((item as JSONObject)["name"]).toBe(`Label ${index + 1}`);
    });
  });
});
