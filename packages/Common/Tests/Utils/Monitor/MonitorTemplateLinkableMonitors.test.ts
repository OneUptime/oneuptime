import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../Types/BaseDatabase/NotEqualOrNull";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  getLinkableMonitorsQuery,
  LinkableMonitorsQuery,
} from "../../../Utils/Monitor/MonitorTemplateLinkableMonitors";
import { describe, expect, it } from "@jest/globals";

/*
 * THE MONITORS LINK EXISTING MONITORS OFFERS (#10399): the project's monitors
 * of the template's type, linked to another template or to none, not
 * archived. The dialog's picker sends this query with every search; the
 * server runs it (Tests/Server/API/MonitorTemplateLinkableMonitorsPostgres).
 */

const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";

describe("getLinkableMonitorsQuery", () => {
  it("asks for the template's type, any template but this one or none, and live monitors", () => {
    const query: LinkableMonitorsQuery = getLinkableMonitorsQuery({
      monitorTemplateId: new ObjectID(TEMPLATE_ID),
      monitorType: MonitorType.Ping,
    });

    expect(Object.keys(query).sort()).toEqual([
      "isArchived",
      "monitorTemplateId",
      "monitorType",
    ]);
    expect(query.monitorType).toBe(MonitorType.Ping);
    expect(query.isArchived).toBe(false);
    expect(query.monitorTemplateId).toBeInstanceOf(NotEqualOrNull);
    expect(query.monitorTemplateId.value).toBe(TEMPLATE_ID);
  });

  /*
   * NotEqual would be `<>`, which no monitor linked to no template passes:
   * exactly the monitors the dialog is opened for.
   */
  it("keeps the monitors linked to no template: never a plain NotEqual", () => {
    const query: LinkableMonitorsQuery = getLinkableMonitorsQuery({
      monitorTemplateId: TEMPLATE_ID,
      monitorType: MonitorType.API,
    });

    expect(query.monitorTemplateId).not.toBeInstanceOf(NotEqual);
  });

  it("takes the template's id as an ObjectID or as its text alike", () => {
    expect(
      getLinkableMonitorsQuery({
        monitorTemplateId: TEMPLATE_ID,
        monitorType: MonitorType.Ping,
      }),
    ).toEqual(
      getLinkableMonitorsQuery({
        monitorTemplateId: new ObjectID(TEMPLATE_ID),
        monitorType: MonitorType.Ping,
      }),
    );
  });

  it("names no project: the list is the request's project's, as every Dashboard list is", () => {
    const query: Record<string, unknown> = getLinkableMonitorsQuery({
      monitorTemplateId: TEMPLATE_ID,
      monitorType: MonitorType.Ping,
    });

    expect(query["projectId"]).toBeUndefined();
  });

  it("reaches the server as it was built", () => {
    const sent: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize(
          getLinkableMonitorsQuery({
            monitorTemplateId: TEMPLATE_ID,
            monitorType: MonitorType.Ping,
          }) as unknown as JSONObject,
        ),
      ),
    ) as JSONObject;

    expect(sent).toEqual({
      monitorType: "Ping",
      monitorTemplateId: { _type: "NotEqualOrNull", value: TEMPLATE_ID },
      isArchived: false,
    });

    const read: Record<string, unknown> = JSONFunctions.deserialize(
      sent,
    ) as Record<string, unknown>;

    expect(read["monitorTemplateId"]).toBeInstanceOf(NotEqualOrNull);
    expect((read["monitorTemplateId"] as NotEqualOrNull<string>).value).toBe(
      TEMPLATE_ID,
    );
  });
});
