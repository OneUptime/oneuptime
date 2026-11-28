import DataTypeDetailServiceHandler from "../../../FeatureSet/APIReference/Service/DataTypeDetail";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import BadDataException from "Common/Types/Exception/BadDataException";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import WeeklyWindowDays from "Common/Types/OnCallDutyPolicy/WeeklyWindowDays";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT THE API REFERENCE SAYS OF A WEEKLY WINDOW'S DAYS IS WHAT THE SERVER
 * DOES (#11455, #11456).
 *
 * Every docs language's API reference page quotes the refusal of a window
 * dated on other days than it names, word for word as the server writes it
 * (WeeklyWindowDays.checkWrittenWindows), and says that restictionType in
 * answers is deprecated. The RestrictionTimes data type's page says the
 * same, in English, as the API reference's pages are.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function readApiReference(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, "api-reference", "api-reference.md"),
    "utf8",
  );
}

// The server's refusal of the example the page gives: Monday, dated on a Wednesday, in Warsaw.
function serverRefusal(): string {
  const restriction: RestrictionTimes = new RestrictionTimes();
  restriction.restrictionType = RestrictionType.Weekly;
  restriction.weeklyRestrictionTimes = [
    {
      startDay: "Monday",
      endDay: "Monday",
      startTime: new Date("2026-01-07T08:00:00.000Z"),
      endTime: new Date("2026-01-05T16:00:00.000Z"),
    } as WeeklyResctriction,
  ];

  try {
    WeeklyWindowDays.checkWrittenWindows(restriction, {
      timezone: "Europe/Warsaw",
    });
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("The server took the example the page says it refuses.");
}

// The refusal a page quotes: the text block that opens with the window's key.
function quotedRefusal(page: string): string | null {
  const match: RegExpMatchArray | null = page.match(
    /```text\n(restrictionTimes\.value\.weeklyRestrictionTimes\[0\][^\n]*)\n```/,
  );

  return match ? match[1]! : null;
}

interface DataTypePage {
  description: string;
  properties: Array<{ name: string; description: string }>;
}

async function restrictionTimesPage(): Promise<DataTypePage> {
  let locals: Record<string, unknown> = {};

  const req: ExpressRequest = {
    params: { lang: "en", page: "restriction-times" },
    originalUrl: "/reference/en/restriction-times",
    headers: {},
  } as unknown as ExpressRequest;

  const res: unknown = {
    status: (): unknown => {
      return res;
    },
    render: (_view: string, renderLocals: Record<string, unknown>): void => {
      locals = renderLocals;
    },
  };

  await DataTypeDetailServiceHandler.executeResponse(
    req,
    res as ExpressResponse,
  );

  return locals["pageData"] as DataTypePage;
}

function propertyOf(page: DataTypePage, name: string): string {
  const property: { name: string; description: string } | undefined =
    page.properties.find((candidate: { name: string }): boolean => {
      return candidate.name === name;
    });

  if (!property) {
    throw new Error(`RestrictionTimes has no ${name}`);
  }

  return property.description;
}

describe("the API reference page's weekly window refusal", () => {
  it("is quoted in English word for word as the server writes it", () => {
    expect(quotedRefusal(readApiReference("en"))).toBe(serverRefusal());
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s quotes the same refusal, as the server writes it in every language",
    (lang: string) => {
      const page: string = readApiReference(lang);

      expect({ lang, quoted: quotedRefusal(page) }).toEqual({
        lang,
        quoted: serverRefusal(),
      });

      for (const fact of [
        "`startTime`",
        "`endTime`",
        "`startDay`",
        "`endDay`",
        "`400`",
        "`restictionType`",
        "2027",
      ]) {
        expect({ lang, fact, found: page.includes(fact) }).toEqual({
          lang,
          fact,
          found: true,
        });
      }
    },
  );
});

describe("the RestrictionTimes data type's page", () => {
  it("says a weekly window's times must fall on its days, and what a write is refused with", async () => {
    const page: DataTypePage = await restrictionTimesPage();
    const weekly: string = propertyOf(page, "weeklyRestrictionTimes");

    expect(weekly).toContain("A window is on call on the days it names");
    expect(weekly).toContain(
      "each must fall on the day startDay or endDay names there, or the write is refused with a 400 that names the window",
    );
    expect(weekly).toContain("A day left out is the day its time falls on");
    expect(weekly).toContain(
      "a window sent back as the layer holds it is not judged again",
    );
    expect(page.description).toContain(
      "A layer's write is also refused for a weekly window whose startTime or endTime falls on another day than its startDay or endDay names.",
    );
  });

  it("REGRESSION #11456: says restictionType in responses is deprecated, until when, and that writes always read it", async () => {
    const page: DataTypePage = await restrictionTimesPage();

    expect(propertyOf(page, "restrictionType")).toContain(
      "restictionType in responses is deprecated: they carry it until the first major version released on or after 1 June 2027, and writes always read it.",
    );
  });
});
