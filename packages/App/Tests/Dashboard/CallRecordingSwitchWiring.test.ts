import CallRecordingSwitchCopy, {
  CALL_RECORDING_SWITCH_COLUMN,
  CALL_RECORDING_SWITCH_TEST_ID,
} from "../../FeatureSet/Dashboard/src/Components/VideoCall/CallRecordingSwitchCopy";
import Project from "Common/Models/DatabaseModels/Project";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { NEW_PROJECT_AI_DEFAULT_COLUMNS } from "Common/Server/Services/ProjectService";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import Permission from "Common/Types/Permission";
import {
  MICROSOFT_TEAMS_CALENDAR_PERMISSION,
  MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import { getFeedEventTypeLabel } from "Common/UI/Components/Feed/FeedOptions";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Record and transcribe incident calls: one switch for the whole project,
 * on Project Settings > Workspace > Video Calls, under the connections it
 * records the calls of. It records people, so it is off unless somebody
 * turns it on - for new projects too, unlike the AI switches - and only
 * those who may change the project's settings can. Every sentence it and
 * the Video Call card add is in every Dashboard language.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);
const LOCALES: string = path.join(DASHBOARD, "Locales");

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const PLACEHOLDER: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

function placeholders(text: string): Array<string> {
  return Array.from(text.matchAll(PLACEHOLDER))
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

// What this switch, the Video Call card and the feed's filter now say.
const NEW_SENTENCES: Array<string> = [
  CallRecordingSwitchCopy.cardTitle,
  CallRecordingSwitchCopy.cardDescription,
  CallRecordingSwitchCopy.switchTitle,
  CallRecordingSwitchCopy.switchDescription,
  CallRecordingSwitchCopy.switchNote,
  CallRecordingSwitchCopy.turnOnConfirmTitle,
  CallRecordingSwitchCopy.turnOnConfirmDescription,
  CallRecordingSwitchCopy.turnOnConfirmButton,
  "OneUptime gets it from {{provider}} once the call is over, and OneUptime AI reads it.",
  getFeedEventTypeLabel(IncidentFeedEventType.VideoCallSummary),
];

describe("the switch", () => {
  const metadata: TableColumnMetadata | undefined =
    new Project().getTableColumnMetadata(CALL_RECORDING_SWITCH_COLUMN);

  test("is a Project switch, off unless somebody turns it on", () => {
    expect(metadata?.type).toBe(TableColumnType.Boolean);
    expect(metadata?.required).toBe(true);
    expect(metadata?.defaultValue).toBe(false);
    expect(metadata?.title).toBe("Record and Transcribe Incident Calls");
  });

  test("is not one of the switches new projects start with on: it records people", () => {
    expect(
      NEW_PROJECT_AI_DEFAULT_COLUMNS as ReadonlyArray<string>,
    ).not.toContain(CALL_RECORDING_SWITCH_COLUMN);
    // And is no AI switch by its own description: AI follows the project's Enable AI.
    expect(`${metadata?.title} ${metadata?.description}`).not.toMatch(/\bAI\b/);
  });

  test("only those who may change the project's settings may flip it", () => {
    const access: { update?: Array<Permission> } | undefined = (
      new Project().getColumnAccessControlForAllColumns() as Record<
        string,
        { update?: Array<Permission> }
      >
    )[CALL_RECORDING_SWITCH_COLUMN];

    expect(access?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ]);
  });

  /*
   * Microsoft Teams calls are recorded too, once the connection has the
   * two Graph permissions that takes: the switch says so, by their names.
   */
  test("names Microsoft Teams among the providers it records, and the permissions Teams needs first", () => {
    expect(CallRecordingSwitchCopy.switchDescription).toContain(
      "Zoom, Google Meet and Microsoft Teams",
    );
    expect(CallRecordingSwitchCopy.turnOnConfirmDescription).toContain(
      "Zoom, Google Meet or Microsoft Teams",
    );
    expect(CallRecordingSwitchCopy.switchNote).toContain(
      MICROSOFT_TEAMS_CALENDAR_PERMISSION,
    );
    expect(CallRecordingSwitchCopy.switchNote).toContain(
      MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION,
    );
    expect(CallRecordingSwitchCopy.switchNote).toContain(
      "Slack huddles and meeting links are not recorded",
    );
    expect(CallRecordingSwitchCopy.switchNote).not.toMatch(
      /Microsoft Teams calls[^.]*not recorded/,
    );
    expect(
      new Project().getTableColumnMetadata(CALL_RECORDING_SWITCH_COLUMN)
        ?.description,
    ).toContain("Zoom, Google Meet and Microsoft Teams");
  });

  test("sits on the Video Calls page, for the current project, under the connections", () => {
    const page: string = fs.readFileSync(
      path.join(DASHBOARD, "Pages/Settings/VideoCalls.tsx"),
      "utf8",
    );
    const card: number = page.indexOf(
      "<CallRecordingSwitchCard projectId={ProjectUtil.getCurrentProjectId()!} />",
    );

    expect(card).toBeGreaterThan(-1);
    expect(page.indexOf("<VideoCallConnectionsTable")).toBeLessThan(card);
    expect(CALL_RECORDING_SWITCH_TEST_ID).toBe("project-call-recording-switch");
  });
});

describe("in every Dashboard language", () => {
  const english: Record<string, string> = readLocale("en");

  test("every new sentence is a key of the English locale", () => {
    for (const sentence of NEW_SENTENCES) {
      expect({ sentence, english: english[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }
  });

  test.each(
    LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )("%s words each one, keeping its placeholders", (code: string) => {
    const locale: Record<string, string> = readLocale(code);

    for (const sentence of NEW_SENTENCES) {
      const translated: string | undefined = locale[sentence];

      expect({ sentence, translated: Boolean(translated) }).toEqual({
        sentence,
        translated: true,
      });
      // "Turn on" was already worded; every other sentence is new and worded.
      expect({ sentence, same: translated === sentence }).toEqual({
        sentence,
        same: false,
      });
      expect(placeholders(translated!)).toEqual(placeholders(sentence));
    }
  });

  test.each(
    LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s keeps the names of the Graph permissions Teams needs, and names Teams among the providers",
    (code: string) => {
      const locale: Record<string, string> = readLocale(code);
      const note: string = locale[CallRecordingSwitchCopy.switchNote] || "";

      // A permission is entered in Entra by its name: it is never translated.
      expect(note).toContain(MICROSOFT_TEAMS_CALENDAR_PERMISSION);
      expect(note).toContain(MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION);

      // German joins it into a compound: "Microsoft-Teams-Anrufs".
      for (const sentence of [
        CallRecordingSwitchCopy.switchDescription,
        CallRecordingSwitchCopy.turnOnConfirmDescription,
      ]) {
        expect({ sentence, translated: locale[sentence] }).toEqual({
          sentence,
          translated: expect.stringMatching(/Microsoft[ -]Teams/),
        });
      }
    },
  );
});
