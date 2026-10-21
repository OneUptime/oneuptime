import { beforeAll, describe, expect, test } from "@jest/globals";
import OpenAPIUtil from "../../../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * The external calendars as the API reference - and so the Terraform
 * provider, which is generated from it - describe them (issue #5084).
 *
 * A calendar is created, listed, read, updated and deleted under
 * /scheduled-maintenance-external-calendar, its link is written but never
 * read back (it can be a secret), and what the Workers write - the last
 * read's status, the event count, the next read - is read only. Its events
 * are left out: the calendar page reads them, and there is nothing in them
 * to manage from code.
 */

const CALENDARS_PATH: string = "/scheduled-maintenance-external-calendar";
const EVENTS_PATH: string = "/scheduled-maintenance-external-calendar-event";

let spec: JSONObject;

function schemaNamed(name: string): JSONObject {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;

  const schema: JSONObject | undefined = schemas[name] as
    | JSONObject
    | undefined;

  if (!schema) {
    throw new Error(`No schema ${name} in the spec`);
  }

  return schema;
}

function propertiesOf(name: string): Array<string> {
  return Object.keys(
    (schemaNamed(name)["properties"] as JSONObject | undefined) || {},
  );
}

function pathsUnder(prefix: string): Array<string> {
  return Object.keys(spec["paths"] as JSONObject).filter((path: string) => {
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

function methodsOf(path: string): Array<string> {
  return Object.keys((spec["paths"] as JSONObject)[path] as JSONObject).sort();
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();
}, 120000);

describe("external calendars in the API reference", () => {
  test("are listed, counted, read, created, updated and deleted at their path", () => {
    const routes: Array<string> = pathsUnder(CALENDARS_PATH)
      .flatMap((path: string): Array<string> => {
        return methodsOf(path).map((method: string): string => {
          return `${method.toUpperCase()} ${path}`;
        });
      })
      .sort();

    expect(routes).toEqual(
      [
        `POST ${CALENDARS_PATH}`,
        `POST ${CALENDARS_PATH}/get-list`,
        `POST ${CALENDARS_PATH}/count`,
        `POST ${CALENDARS_PATH}/{id}/get-item`,
        `PUT ${CALENDARS_PATH}/{id}`,
        `DELETE ${CALENDARS_PATH}/{id}`,
      ].sort(),
    );
  });

  test("take a name and a link on create; the link is never in what is read back", () => {
    const createProperties: Array<string> = propertiesOf(
      "ScheduledMaintenanceExternalCalendarCreateSchema",
    );

    expect(createProperties).toEqual(
      expect.arrayContaining(["name", "calendarUrl"]),
    );

    expect(
      propertiesOf("ScheduledMaintenanceExternalCalendarReadSchema"),
    ).not.toContain("calendarUrl");
    expect(propertiesOf("ScheduledMaintenanceExternalCalendar")).not.toContain(
      "calendarUrl",
    );
  });

  test("never take what the Workers write, or the link's host, on create or update", () => {
    const createProperties: Array<string> = propertiesOf(
      "ScheduledMaintenanceExternalCalendarCreateSchema",
    );
    const updateProperties: Array<string> = propertiesOf(
      "ScheduledMaintenanceExternalCalendarUpdateSchema",
    );

    for (const computed of [
      "calendarHost",
      "lastReadAt",
      "lastReadAttemptAt",
      "lastReadError",
      "lastReadHttpStatus",
      "eventCount",
      "hasMoreEvents",
      "nextReadAt",
      "contentDigest",
    ]) {
      expect({
        computed,
        onCreate: createProperties.includes(computed),
        onUpdate: updateProperties.includes(computed),
      }).toEqual({ computed, onCreate: false, onUpdate: false });
    }
  });

  test("an update may change the name, colour, refresh, the switch and the link (Change link)", () => {
    expect(
      propertiesOf("ScheduledMaintenanceExternalCalendarUpdateSchema"),
    ).toEqual(
      expect.arrayContaining([
        "name",
        "color",
        "refreshIntervalInMinutes",
        "isEnabled",
        "calendarUrl",
      ]),
    );
  });

  test("read back how the last read went, and never the content digest", () => {
    const readProperties: Array<string> = propertiesOf(
      "ScheduledMaintenanceExternalCalendarReadSchema",
    );

    expect(readProperties).toEqual(
      expect.arrayContaining([
        "name",
        "calendarHost",
        "isEnabled",
        "lastReadAt",
        "lastReadError",
        "eventCount",
      ]),
    );
    expect(readProperties).not.toContain("contentDigest");
  });

  test("their events are not in it: read by the calendar page, nothing to manage from code", () => {
    expect(pathsUnder(EVENTS_PATH)).toEqual([]);
    expect(
      Object.keys(
        (spec["components"] as JSONObject)["schemas"] as JSONObject,
      ).filter((name: string) => {
        return name.startsWith("ScheduledMaintenanceExternalCalendarEvent");
      }),
    ).toEqual([]);
  });
});
