import { describe, expect, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import ResponseUtil, {
  CALENDAR_RESPONSE_FILE_NAME,
  CalendarResponseDisposition,
} from "../../../Server/Utils/Response";

/*
 * The scheduled maintenance calendars go out through the same
 * sendCalendarResponse as the on-call feeds, with two things of their own:
 * their file name (maintenance.ics, not the on-call feeds' name) and, for one
 * event a reader's browser downloads from a status page, an attachment
 * rather than an inline body. The name is written into a header as it is,
 * so only a plain file name is ever taken; anything else falls back to the
 * on-call name rather than reaching the header.
 */

const BODY: string =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//OneUptime//Scheduled Maintenance//EN\r\nEND:VCALENDAR\r\n";

function send(data: {
  fileName?: string | undefined;
  disposition?: CalendarResponseDisposition | undefined;
}): Record<string, string> {
  const headers: Record<string, string> = {};

  const response: Record<string, unknown> = {
    set: (key: string, value: string): void => {
      headers[key] = value;
    },
    setHeader: (key: string, value: string): void => {
      headers[key] = value;
    },
    removeHeader: (key: string): void => {
      delete headers[key];
    },
    status: (): unknown => {
      return response;
    },
    send: (): void => {
      // The body is not what these tests read.
    },
  };

  ResponseUtil.sendCalendarResponse(
    {} as ExpressRequest,
    response as unknown as ExpressResponse,
    {
      body: BODY,
      etag: ResponseUtil.getCalendarETag(BODY),
      lastModified: new Date("2026-10-15T10:20:00.000Z"),
      ...data,
    },
  );

  return headers;
}

describe("Response.sendCalendarResponse file name and disposition", () => {
  test("a feed that names no file keeps the on-call feeds' inline name", () => {
    expect(send({})["Content-Disposition"]).toBe(
      `inline; filename="${CALENDAR_RESPONSE_FILE_NAME}"`,
    );
  });

  test("a feed's own file name is the one an app saves it under", () => {
    expect(send({ fileName: "maintenance.ics" })["Content-Disposition"]).toBe(
      'inline; filename="maintenance.ics"',
    );
  });

  test("one event a browser downloads is an attachment", () => {
    expect(
      send({
        fileName: "maintenance.ics",
        disposition: CalendarResponseDisposition.Attachment,
      })["Content-Disposition"],
    ).toBe('attachment; filename="maintenance.ics"');
  });

  test.each([
    'evil".ics',
    "a b.ics",
    "../maintenance.ics",
    "maintenance.ics\r\nSet-Cookie: x=1",
    "kalender-ä.ics",
    "",
    `${"a".repeat(101)}.ics`,
  ])(
    "a name a header cannot carry as it is (%j) falls back to the on-call name",
    (fileName: string) => {
      expect(send({ fileName })["Content-Disposition"]).toBe(
        `inline; filename="${CALENDAR_RESPONSE_FILE_NAME}"`,
      );
    },
  );

  test("the rest of the header set is the on-call feeds' own", () => {
    const headers: Record<string, string> = send({
      fileName: "maintenance.ics",
      disposition: CalendarResponseDisposition.Attachment,
    });

    expect(headers["Content-Type"]).toBe("text/calendar; charset=utf-8");
    expect(headers["Cache-Control"]).toBe("private, max-age=300");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Robots-Tag"]).toBe("noindex");
    expect(headers["ETag"]).toBe(ResponseUtil.getCalendarETag(BODY));
  });
});
