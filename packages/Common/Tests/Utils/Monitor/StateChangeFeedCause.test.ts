import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  createTranslator,
  translatableTerm,
  Translator,
} from "../../../Types/Translator";
import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  readStateChangeFeedCause,
  wordStateChangeFeedDetails,
} from "../../../Utils/Monitor/StateChangeFeedCause";
import StatusChangeCauseWording, {
  INCIDENT_AUTO_RESOLVED,
} from "../../../Utils/Monitor/StatusChangeCauseWording";
import {
  EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED,
  STATE_CHANGED_BY_EPISODE,
  STATE_CHANGED_WITH_ITS_EPISODE,
  STATUS_CHANGED_BY_USER,
} from "../../../Utils/Monitor/StatusChangeNotes";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";

/*
 * A STATE CHANGE'S CAUSE IN A FEED READS IN THE READER'S LANGUAGE (#10126).
 *
 * The timeline services post each state change to the record's feed with
 * why it changed as the entry's details, written once in English Markdown -
 * "**Cause:**" and the change's root cause under it. An incident's, an
 * alert's, an episode's and a monitor's feed drew it as stored on every
 * page: "Cause: State changed by episode state cascade." under a change
 * whose View Cause said it in the reader's words. The feed keeps that
 * English (Slack and the emails read it); the page words it as View Cause
 * does (StatusChangeCauseWording). Each writer's shape is written here as
 * the service writes it, and held to the service's source below.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const ENGLISH: Translator = createTranslator((): string | undefined => {
  return undefined;
}, "en");

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "ja",
  "zh-CN",
  "fa",
  "ar",
];

const USER_LINK: string =
  mdText`[${"Jane Doe"}](${"https://oneuptime.example/dashboard/p/users/u"})`.toString();

// A text as a reader reads it: no isolate marks, a plain space for a held one.
function plain(text: string): string {
  return withoutIsolateMarks(text).split(NO_BREAK_SPACE).join(" ");
}

interface FeedCauseWriter {
  // The timeline service that posts the change, and how it writes its details.
  writer: string;
  file: string;
  source: string;
  write: (rootCause: string) => string;
}

const WRITERS: ReadonlyArray<FeedCauseWriter> = [
  {
    writer: "IncidentStateTimelineService",
    file: "packages/Common/Server/Services/IncidentStateTimelineService.ts",
    source:
      "mdText`**Cause:**\n${FeedMarkdown.asMarkdown(createdItem.rootCause)}`",
    write: (rootCause: string): string => {
      return mdText`**Cause:**
${FeedMarkdown.asMarkdown(rootCause)}`.toString();
    },
  },
  {
    writer: "AlertStateTimelineService",
    file: "packages/Common/Server/Services/AlertStateTimelineService.ts",
    source:
      "mdText`**Cause:**\n${FeedMarkdown.asMarkdown(createdItem.rootCause)}`",
    write: (rootCause: string): string => {
      return mdText`**Cause:**
${FeedMarkdown.asMarkdown(rootCause)}`.toString();
    },
  },
  {
    writer: "IncidentEpisodeStateTimelineService",
    file: "packages/Common/Server/Services/IncidentEpisodeStateTimelineService.ts",
    source:
      "mdText`**Cause:** \\n${FeedMarkdown.asMarkdown(createdItem.rootCause)}`",
    write: (rootCause: string): string => {
      return mdText`**Cause:** \n${FeedMarkdown.asMarkdown(rootCause)}`.toString();
    },
  },
  {
    writer: "AlertEpisodeStateTimelineService",
    file: "packages/Common/Server/Services/AlertEpisodeStateTimelineService.ts",
    source:
      "mdText`**Cause:** \\n${FeedMarkdown.asMarkdown(createdItem.rootCause)}`",
    write: (rootCause: string): string => {
      return mdText`**Cause:** \n${FeedMarkdown.asMarkdown(rootCause)}`.toString();
    },
  },
  {
    writer: "MonitorStatusTimelineService",
    file: "packages/Common/Server/Services/MonitorStatusTimelineService.ts",
    source:
      "mdText`**Cause:**\n    ${FeedMarkdown.asMarkdown(createdItem.rootCause)}`",
    write: (rootCause: string): string => {
      return mdText`**Cause:**
    ${FeedMarkdown.asMarkdown(rootCause)}`.toString();
    },
  },
];

// Causes a feed entry holds: OneUptime's notes, older ones, and others.
const NOTES: ReadonlyArray<{ name: string; cause: string; keeps?: string }> = [
  { name: "an episode's cascade, as stored", cause: STATE_CHANGED_BY_EPISODE },
  {
    name: "an episode resolved by its rule",
    cause: EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED,
  },
  {
    name: "a person's change",
    cause:
      mdText`Incident state created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
    keeps: "Jane Doe",
  },
  {
    name: "a linked incident that resolved",
    cause:
      mdText`Resolved because linked ${"Incident INC-7"} was resolved.`.toString(),
    keeps: "INC-7",
  },
  {
    name: "an older episode's resolve, before #9959",
    cause: "Resolved via API.",
  },
  {
    name: "an older chat's Change State",
    cause: "State changed via Slack.",
  },
  {
    name: "a monitor's status a person set",
    cause: `Monitor status created by ${USER_LINK}`,
    keeps: "Jane Doe",
  },
  {
    name: "a record's own root cause, copied to its first state (#10125)",
    cause:
      mdText`Sigma detection rule "${"Sudo to root"}" matched security events.`.toString(),
    keeps: "Sudo to root",
  },
];

function byName<T extends { name: string }>(
  list: ReadonlyArray<T>,
): Array<[string, T]> {
  return list.map((entry: T): [string, T] => {
    return [entry.name, entry];
  });
}

describe("what each timeline service writes into a state change's feed entry", () => {
  test.each(
    WRITERS.map((writer: FeedCauseWriter): [string, FeedCauseWriter] => {
      return [writer.writer, writer];
    }),
  )(
    "%s: its details hold the change's cause, read back as stored",
    (_name: string, writer: FeedCauseWriter) => {
      for (const note of NOTES) {
        expect(readStateChangeFeedCause(writer.write(note.cause))).toBe(
          note.cause,
        );
      }

      // A cause of several lines: a criteria's Markdown.
      const criteria: string =
        "**Created because the following criteria was met**:\n\n**Criteria Name**: Website is down";

      expect(readStateChangeFeedCause(writer.write(criteria))).toBe(criteria);
    },
  );

  test.each(
    WRITERS.map((writer: FeedCauseWriter): [string, string, string] => {
      return [writer.writer, writer.file, writer.source];
    }),
  )(
    "%s still writes its details so (%s)",
    (_name: string, file: string, source: string) => {
      expect(
        fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      ).toContain(source);
    },
  );
});

describe.each(LANGUAGES)(
  "a state change's cause in a feed, in %s",
  (language: string) => {
    const translator: Translator = dashboardTranslator(language);
    // The label as the page words a label: the language's word, its colon.
    const label: string = translator.translateTemplate("{{label}}:", {
      label: translatableTerm("Cause"),
    });

    test.each(byName(NOTES))(
      "%s reads as View Cause says it, under the reader's label",
      (_name: string, note: { cause: string; keeps?: string }) => {
        for (const writer of WRITERS) {
          const worded: string = wordStateChangeFeedDetails({
            details: writer.write(note.cause),
            translator: translator,
          });

          expect(worded).toBe(
            `**${label}**\n${StatusChangeCauseWording.wordCause({
              rootCause: note.cause,
              translator: translator,
              setsValuesApart: true,
            })}`,
          );
          // Never the stored English.
          expect(plain(worded)).not.toContain(plain(note.cause));
          expect(plain(worded)).not.toContain("**Cause:**");

          if (note.keeps) {
            expect(plain(worded)).toContain(note.keeps);
          }
        }
      },
    );

    test("a criteria's labels and an auto-resolve's sentence are worded, the values as found", () => {
      const criteria: string = [
        "**Created because the following criteria was met**:",
        "",
        mdText`**Criteria Name**: ${"Website is down"}`.toString(),
      ].join("\n");
      const worded: string = plain(
        wordStateChangeFeedDetails({
          details: WRITERS[0]!.write(criteria),
          translator: translator,
        }),
      );

      expect(worded).not.toContain("Criteria Name");
      expect(worded).toContain("Website is down");

      const autoResolved: string = plain(
        wordStateChangeFeedDetails({
          details: WRITERS[1]!.write(
            `${INCIDENT_AUTO_RESOLVED} Incoming request reported this key as resolved.`,
          ),
          translator: translator,
        }),
      );

      expect(autoResolved).not.toContain("autoresolved");
      expect(autoResolved).not.toContain("Incoming request");
    });

    test("a cause a person typed reads as typed, under the reader's label", () => {
      const typed: string = "Rolled back the pool size change.";

      expect(
        wordStateChangeFeedDetails({
          details: WRITERS[0]!.write(typed),
          translator: translator,
        }),
      ).toBe(`**${label}**\n${typed}`);
    });
  },
);

describe("the label, as each language writes it with its colon", () => {
  test.each([
    ["de", "**Ursache:**"],
    ["fr", "**Cause :**"],
    ["zh-CN", "**原因：**"],
    ["fa", "**علت:**"],
    ["ar", "**السبب:**"],
  ])("%s: %s", (language: string, expected: string) => {
    const worded: string = wordStateChangeFeedDetails({
      details: WRITERS[0]!.write(STATE_CHANGED_BY_EPISODE),
      translator: dashboardTranslator(language),
    });

    expect(plain(worded.split("\n")[0] as string)).toBe(plain(expected));
  });
});

describe("regression: an episode's cascade read in English in a Persian feed (#10126)", () => {
  test("an incident's feed entry says why its state changed in Persian", () => {
    const persian: Translator = dashboardTranslator("fa");
    const worded: string = plain(
      wordStateChangeFeedDetails({
        details: WRITERS[0]!.write(STATE_CHANGED_BY_EPISODE),
        translator: persian,
      }),
    );

    expect(worded).toBe(
      `**${readDashboardLocale("fa")["Cause"]}:**\n${readDashboardLocale("fa")[STATE_CHANGED_WITH_ITS_EPISODE]}`,
    );
    expect(worded).not.toContain("cascade");
  });
});

describe("in English, and details of any other shape", () => {
  test("in English, a feed's cause reads as stored - but for a note said better, as View Cause says it", () => {
    expect(
      wordStateChangeFeedDetails({
        details: WRITERS[0]!.write(EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED),
        translator: ENGLISH,
      }),
    ).toBe(WRITERS[0]!.write(EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED));
    expect(
      wordStateChangeFeedDetails({
        details: WRITERS[0]!.write(STATE_CHANGED_BY_EPISODE),
        translator: ENGLISH,
      }),
    ).toBe(`**Cause:**\n${STATE_CHANGED_WITH_ITS_EPISODE}`);
    expect(
      plain(
        wordStateChangeFeedDetails({
          details: WRITERS[2]!.write(
            mdText`Episode state created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
          ),
          translator: ENGLISH,
        }),
      ),
    ).toBe(
      `**Cause:**\n${STATUS_CHANGED_BY_USER.replace("{{user}}", USER_LINK)}`,
    );
  });

  test("details that are no state change's cause read as stored, in any language", () => {
    const german: Translator = dashboardTranslator("de");

    for (const details of [
      "",
      "**Cause:**",
      "**Cause:** \n   ",
      "**Cause:** inline, as nothing writes it.",
      "**Notified:** Nitin Kumar (nitin@example.com)",
      "## Summary\n\nThe pool was exhausted.",
      "Cause:\nState changed by episode state cascade.",
    ]) {
      expect(
        wordStateChangeFeedDetails({ details: details, translator: german }),
      ).toBe(details);
    }

    expect(
      wordStateChangeFeedDetails({ details: undefined, translator: german }),
    ).toBe("");
    expect(readStateChangeFeedCause("**Cause:** \n")).toBeNull();
  });
});
