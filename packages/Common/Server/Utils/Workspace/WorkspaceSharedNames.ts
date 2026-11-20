import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../Models/DatabaseModels/User";
import {
  SharedNameDates,
  SharedNameMark,
  SharedNameOption,
  getSharedNameFacts,
  getSharedNameMarksFor,
  getSharedNameOptionKey,
  hasSharedNameTwins,
} from "../../../Types/Database/SharedNameMarks";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import Timezone from "../../../Types/Timezone";
import { Translator, getInlineSeparator } from "../../../Types/Translator";
import { getUserWritingLanguage } from "../../../Types/UserLanguage";
import { fitTextToLength } from "../../../Utils/MessageFit";
import UserService from "../../Services/UserService";
import logger from "../Logger";
import { writeInLanguage } from "../ServerTranslation";
import moment from "moment-timezone";

/*
 * RECORDS THAT SHARE A NAME, TOLD APART IN A CHAT'S PICKERS (#10314).
 *
 * Teams, labels, on-call policies and on-call schedules named alike before
 * names were held to one record each keep their names, and the Dashboard's
 * pickers tell such twins apart (#10064). The chats' did not: Slack's Page
 * someone form listed two "Primary" schedules, Microsoft Teams' New
 * Incident card two "Production" labels, Mattermost's Execute On-Call
 * Policy dialog two "Payments" policies - each alike, with nothing to pick
 * the right one by.
 *
 * They follow the Dashboard's rule now (Types/Database/SharedNameMarks):
 * options of one kind whose names read as one name are twins, and each is
 * told apart by its own description when no twin has the same one, else
 * the day it was made, else the moment. A chat's option is one line of
 * plain text - no pill beside it, no line under it - so what sets a twin
 * apart goes in its label, after its name and the reader's separator:
 *
 *   Primary · Created Nov 5, 2026
 *   Primary · Created Nov 5, 2026, 9:30 AM PST
 *   Production · EU customers' checkout
 *
 * in the words and the time zone on the reader's account - the member the
 * chat account is connected to: "Created {{date}}" is the Dashboard's own
 * sentence (the server's locales copy its wordings), and the date is
 * written in that language and zone, else in English and UTC. Only a twin
 * is relabelled, so an option with no twin reads exactly as before, and
 * nothing is read of the reader unless the list holds twins.
 *
 * A label is cut to what its chat shows of an option (75 characters in
 * Slack and Mattermost, 80 on a Microsoft Teams card), and the name is cut
 * before what sets the twin apart is, so two twins never read alike. A
 * description is cut to about half a label, and when the parts of two
 * twins' descriptions a label can show read alike, they are told apart by
 * when they were made instead.
 */

// Who reads a chat's picker: the words and the zone of their dates.
export interface WorkspaceSharedNameReader {
  // The language OneUptime writes to them in ("de"): English for none.
  language: string;
  // The zone on their account, else UTC.
  timezone: string;
}

// What sets each twin of a picker apart, for its reader.
export interface WorkspaceTwinDetails {
  // By the option's value (getSharedNameOptionKey); none for an option with no twin.
  details: Map<string, string>;
  // What stands between a name and its detail, as the reader's language sets them apart.
  separator: string;
}

// One option of a chat's picker.
export interface WorkspaceNamedOption {
  label: string;
  value: string;
}

// The reader nothing is known of: English, and UTC.
export const UNKNOWN_WORKSPACE_READER: WorkspaceSharedNameReader = {
  language: DEFAULT_READER_LANGUAGE,
  timezone: Timezone.UTC,
};

/*
 * The fewest characters a name is cut to before the end of the label is
 * cut instead: less would leave nothing to know the record by.
 */
export const WORKSPACE_SHARED_NAME_SHORTEST_NAME: number = 8;

// The fewest characters of a description a chat's label shows.
const WORKSPACE_SHORTEST_DESCRIPTION_LENGTH: number = 16;

const ELLIPSIS: string = "…";

const WHITE_SPACE_RUN: RegExp = /\s+/g;

const toOneLine: (text: string) => string = (text: string): string => {
  return text.replace(WHITE_SPACE_RUN, " ").trim();
};

export default class WorkspaceSharedNames {
  /*
   * How much of a description a label of `maxLength` characters shows:
   * about half of it, so the name keeps the other half.
   */
  public static getDescriptionLength(maxLength: number): number {
    return Math.max(
      WORKSPACE_SHORTEST_DESCRIPTION_LENGTH,
      Math.floor((maxLength - getInlineSeparator(undefined).length) / 2),
    );
  }

  /*
   * The reader of a chat's picker: the language and the time zone on the
   * account of the member it is shown to. Read as OneUptime, as a page's
   * language is (Notification/UserLanguage): a picker is shown whatever the
   * read answers, and a read that fails is English and UTC.
   */
  public static async getReader(
    userId: ObjectID | null | undefined,
  ): Promise<WorkspaceSharedNameReader> {
    if (!userId) {
      return UNKNOWN_WORKSPACE_READER;
    }

    try {
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          language: true,
          timezone: true,
        },
        props: {
          isRoot: true,
        },
      });

      return {
        language: getUserWritingLanguage(user),
        timezone: WorkspaceSharedNames.toKnownZone(user?.timezone),
      };
    } catch (err) {
      logger.debug(
        `Could not read the language and time zone of user ${userId.toString()}; a picker's dates are written in English, in UTC.`,
      );
      logger.debug(err as Error);
      return UNKNOWN_WORKSPACE_READER;
    }
  }

  /*
   * What sets each twin among `options` apart, in its reader's words and
   * zone, cut so that a label of `maxLength` characters shows it whole.
   * Nothing is read when no two options are twins.
   */
  public static async getTwinDetails(data: {
    options: ReadonlyArray<SharedNameOption>;
    // The member the picker is shown to.
    readerUserId?: ObjectID | null | undefined;
    maxLength: number;
    // Less than half a label: a schedule's label also says who is on call.
    descriptionLength?: number | undefined;
  }): Promise<WorkspaceTwinDetails> {
    if (!hasSharedNameTwins(data.options)) {
      return { details: new Map<string, string>(), separator: "" };
    }

    const reader: WorkspaceSharedNameReader =
      await WorkspaceSharedNames.getReader(data.readerUserId);

    return WorkspaceSharedNames.getTwinDetailsFor({
      options: data.options,
      reader: reader,
      descriptionLength:
        data.descriptionLength ??
        WorkspaceSharedNames.getDescriptionLength(data.maxLength),
    });
  }

  // The same, for a reader already read.
  public static getTwinDetailsFor(data: {
    options: ReadonlyArray<SharedNameOption>;
    reader: WorkspaceSharedNameReader;
    descriptionLength: number;
  }): WorkspaceTwinDetails {
    const details: Map<string, string> = new Map<string, string>();

    // Synchronous: the dates are written in the reader's language meanwhile.
    const marks: Map<string, SharedNameMark> = writeInLanguage(
      data.reader.language,
      (translator: Translator): Map<string, SharedNameMark> => {
        return getSharedNameMarksFor(data.options, {
          translator: translator,
          dates: WorkspaceSharedNames.getDates(data.reader.timezone),
          descriptionLength: data.descriptionLength,
        });
      },
    );

    for (const [key, mark] of marks) {
      if (mark.detail) {
        details.set(key, toOneLine(mark.detail));
      }
    }

    return {
      details: details,
      separator: getInlineSeparator(data.reader.language),
    };
  }

  /*
   * A twin's label: its name, the separator and what sets it apart, then
   * `after` - what the label says of every option after its name (a
   * schedule's "(Nawaz on call now)") - in at most `maxLength` characters.
   * The name is cut first, down to WORKSPACE_SHARED_NAME_SHORTEST_NAME, so
   * the detail stays whole; past that the label's end is cut. Without a
   * detail, the name and `after` alone, cut the same way.
   */
  public static toLabel(data: {
    name: string;
    detail?: string | undefined;
    separator?: string | undefined;
    after?: string | undefined;
    maxLength: number;
  }): string {
    const name: string = toOneLine(data.name);
    const tail: string = `${
      data.detail
        ? `${data.separator || getInlineSeparator(undefined)}${data.detail}`
        : ""
    }${data.after || ""}`;

    if (name.length + tail.length <= data.maxLength) {
      return name + tail;
    }

    const room: number = data.maxLength - tail.length;

    if (room >= WORKSPACE_SHARED_NAME_SHORTEST_NAME) {
      return `${fitTextToLength(name, room, ELLIPSIS)}${tail}`;
    }

    return fitTextToLength(
      `${fitTextToLength(name, WORKSPACE_SHARED_NAME_SHORTEST_NAME, ELLIPSIS)}${tail}`,
      data.maxLength,
      ELLIPSIS,
    );
  }

  /*
   * A picker's options of records of one of the four kinds - each its
   * name, by its id - with every twin told apart: what Slack's selects,
   * Microsoft Teams' choice sets and Mattermost's dialogs list. A record of
   * no twin keeps its name as it was written. Read each record with its
   * name, id and getSharedNameSelect(...).
   */
  public static async getOptions(data: {
    records: ReadonlyArray<BaseModel>;
    readerUserId?: ObjectID | null | undefined;
    maxLength: number;
  }): Promise<Array<WorkspaceNamedOption>> {
    const named: Array<{ option: SharedNameOption; name: string }> =
      data.records.map(
        (record: BaseModel): { option: SharedNameOption; name: string } => {
          const name: unknown = (record as unknown as Record<string, unknown>)[
            "name"
          ];

          return {
            name: typeof name === "string" ? name : "",
            option: {
              value: record._id?.toString() || "",
              label: typeof name === "string" ? name : "",
              sharedName: getSharedNameFacts(record),
            },
          };
        },
      );

    const twins: WorkspaceTwinDetails =
      await WorkspaceSharedNames.getTwinDetails({
        options: named.map(
          (entry: { option: SharedNameOption }): SharedNameOption => {
            return entry.option;
          },
        ),
        readerUserId: data.readerUserId,
        maxLength: data.maxLength,
      });

    return named.map(
      (entry: {
        option: SharedNameOption;
        name: string;
      }): WorkspaceNamedOption => {
        const value: string = entry.option.value as string;
        const detail: string | undefined = twins.details.get(
          getSharedNameOptionKey(value),
        );

        return {
          value: value,
          label: detail
            ? WorkspaceSharedNames.toLabel({
                name: entry.name,
                detail: detail,
                separator: twins.separator,
                maxLength: data.maxLength,
              })
            : entry.name,
        };
      },
    );
  }

  // A zone moment knows, else UTC.
  public static toKnownZone(timezone: unknown): string {
    const zone: string = typeof timezone === "string" ? timezone.trim() : "";

    return zone && moment.tz.zone(zone) ? zone : Timezone.UTC;
  }

  /*
   * A chat's dates, in the reader's zone - named for a moment, which a
   * chat's reader reads with no zone of their own to assume: "Nov 5, 2026"
   * and "Nov 5, 2026, 9:30 AM PST".
   */
  private static getDates(timezone: string): SharedNameDates {
    return {
      writeDay: (date: Date): string => {
        return OneUptimeDate.getDateAsFormattedStringInTimezone({
          date: date,
          timezone: timezone,
          onlyShowDate: true,
        });
      },
      writeMoment: (date: Date): string => {
        return OneUptimeDate.getDateAsFormattedStringInTimezone({
          date: date,
          timezone: timezone,
        });
      },
    };
  }
}
