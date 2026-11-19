import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  translatableSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import { createTranslator, Translator } from "../../../Types/Translator";
import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import MonitorRootCauseWording from "../../../Utils/Monitor/MonitorRootCauseWording";
import { readMonitorStatusReason } from "../../../Utils/Monitor/MonitorStatusReason";
import StatusChangeCauseWording, {
  ALERT_AUTO_RESOLVED,
  getChangeLogFindings,
  INCIDENT_AUTO_RESOLVED,
} from "../../../Utils/Monitor/StatusChangeCauseWording";
import {
  MONITORING_TURNED_OFF,
  MONITORING_TURNED_OFF_BY_USER,
  MONITORING_TURNED_ON,
  MONITORING_TURNED_ON_BY_USER,
  OPENSTACK_PROJECT_USES_BACK,
  OPENSTACK_PROJECT_USES_INCIDENT,
  STATUS_CHANGED_TO_DEFAULT,
  STATUS_CHANGED_WITH_MONITOR,
  STATUS_CREATED_WITH_MONITOR,
  wordStatusChangeNote,
} from "../../../Utils/Monitor/StatusChangeNotes";
import { Service as MonitorStatusTimelineServiceClass } from "../../../Server/Services/MonitorStatusTimelineService";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import { FIRST_STRONG_ISOLATE } from "../../../Types/ReadingDirection";

// The service logs through @CaptureSpan; nothing here is about logging.
jest.mock("../../../Server/Utils/Logger");

/*
 * VIEW CAUSE READS IN THE READER'S LANGUAGE (#9752).
 *
 * A monitor's Status Timeline drew each status event's root cause as
 * stored: "Criteria Name", "Filter Conditions Met", "Response Snapshot",
 * the probe's yes or no and its figures read in English on a German or a
 * Persian page, laid out from the left on a page read from the right, while
 * an incident's Root Cause page worded the same Markdown. An incident's and
 * an alert's State Timeline drew theirs the same way.
 *
 * StatusChangeCauseWording words every View Cause one way: OneUptime's own
 * status-change notes (StatusChangeNotes), an auto-resolve's sentence, and
 * a criteria's Markdown, its findings worded from the sentences the
 * change's own check kept (statusChangeLog, stateChangeLog).
 *
 * Each root cause here is written as the server writes one - the engine's
 * Markdown with mdText, the monitoring switch by the service itself - so a
 * writer that changes its words fails here first.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const ENGLISH: Translator = createTranslator((): string | undefined => {
  return undefined;
}, "en");

function translatorWith(
  words: Record<string, string>,
  language: string = "de",
): Translator {
  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

const GERMAN_WORDS: Record<string, string> = {
  "Created because the following criteria was met":
    "Erstellt, weil das folgende Kriterium erfüllt wurde",
  "Criteria Name": "Name des Kriteriums",
  "Filter Conditions Met": "Erfüllte Filterbedingungen",
  "Response Snapshot": "Antwort-Momentaufnahme",
  "Response Status Code": "Antwortstatuscode",
  "Timed Out": "Zeitüberschreitung",
  Cause: "Ursache",
  No: "Nein",
  Yes: "Ja",
  "Response Status Code was {{code}}, at or above the 500 threshold.":
    "Der Antwortstatuscode war {{code}}, auf oder über der Schwelle von 500.",
  "Changed by {{user}}": "Geändert von {{user}}",
  "Changed because incident {{incident}} was created.":
    "Geändert, weil Vorfall {{incident}} erstellt wurde.",
  "Changed because incident {{incident}} was updated.":
    "Geändert, weil Vorfall {{incident}} aktualisiert wurde.",
  "Changed by a maintenance event.": "Durch eine Wartung geändert.",
  [STATUS_CHANGED_TO_DEFAULT]:
    "Kein Kriterium traf zu, daher wechselte der Monitor zu seinem Standardstatus.",
  [STATUS_CREATED_WITH_MONITOR]:
    "Dieser Status wurde beim Erstellen des Monitors angelegt.",
  [STATUS_CHANGED_WITH_MONITOR]:
    "Dieser Status wurde beim Aktualisieren des Monitors geändert.",
  [MONITORING_TURNED_OFF_BY_USER]:
    "{{user}} hat die Überwachung ausgeschaltet. Nichts prüft den Monitor, bis sie wieder eingeschaltet ist.",
  [MONITORING_TURNED_OFF]:
    "Die Überwachung ist aus. Nichts prüft den Monitor, bis sie wieder eingeschaltet ist.",
  [MONITORING_TURNED_ON_BY_USER]:
    "{{user}} hat die Überwachung wieder eingeschaltet.",
  [MONITORING_TURNED_ON]: "Die Überwachung wurde wieder eingeschaltet.",
  [OPENSTACK_PROJECT_USES_INCIDENT]:
    "Etwas, das dieses Projekt nutzt, hat einen Vorfall.",
  [OPENSTACK_PROJECT_USES_BACK]: "Was dieses Projekt nutzt, ist wieder da.",
  [INCIDENT_AUTO_RESOLVED]:
    "Vorfall automatisch behoben, weil die automatische Behebung im Kriterium des Monitors eingeschaltet ist.",
  [ALERT_AUTO_RESOLVED]:
    "Alarm automatisch behoben, weil die automatische Behebung im Kriterium des Monitors eingeschaltet ist.",
};

const GERMAN: Translator = translatorWith(GERMAN_WORDS);

// A text as a reader reads it: no isolate marks, a plain space for a held one.
function plain(text: string | null | undefined): string {
  return withoutIsolateMarks(text || "")
    .split(NO_BREAK_SPACE)
    .join(" ");
}

// A finding as the evaluation stores it: its English and its sentence.
function statusCodeSentence(code: number): EvaluationSentence {
  return {
    template:
      "Response Status Code was {{code}}, at or above the 500 threshold.",
    values: { code: String(code) },
  };
}

// A root cause as the engine renders one for a criteria that matched.
function engineRootCause(data: {
  criteriaName: string;
  finding: string;
}): string {
  return mdText`
**Created because the following criteria was met**:

**Criteria Name**: ${data.criteriaName}

**Filter Conditions Met**: ${data.finding}

**Response Snapshot**
- Response Status Code: ${503}
- Response Time: ${MonitorCriteriaEvaluator.formatMilliseconds(411) as string}
- Timed Out: ${"No"}

**Cause**: ${"Server returned 503"}
`.toString();
}

const ROOT_CAUSE: string = engineRootCause({
  criteriaName: "Website is down",
  finding: englishOfEvaluationSentence(statusCodeSentence(503)),
});

/*
 * The check a status event keeps (MonitorStoredCheck): the probe's response,
 * and the evaluation summary the engine attached to it, its filters'
 * findings with the sentences they were filled from.
 */
function storedCheck(
  sentence: EvaluationSentence | undefined,
  // The finding's English when the change kept no sentence for it.
  message: string = englishOfEvaluationSentence(statusCodeSentence(503)),
): unknown {
  return {
    responseCode: 503,
    evaluationSummary: {
      evaluatedAt: "2026-11-01T10:00:00.000Z",
      criteriaResults: [
        {
          criteriaName: "Website is up",
          met: false,
          filters: [
            {
              checkOn: "Response Status Code",
              met: false,
              message: "Response Status Code was 503, not 200.",
            },
          ],
        },
        {
          criteriaName: "Website is down",
          met: true,
          filters: [
            {
              checkOn: "Response Status Code",
              met: true,
              message: sentence
                ? englishOfEvaluationSentence(sentence)
                : message,
              ...(sentence ? { messageSentence: sentence } : {}),
            },
          ],
        },
      ],
      events: [],
    },
  };
}

function word(data: {
  rootCause: string;
  translator: Translator;
  changeLog?: unknown;
}): string {
  return StatusChangeCauseWording.wordCause({
    rootCause: data.rootCause,
    translator: data.translator,
    changeLog: data.changeLog,
    setsValuesApart: true,
  });
}

describe("a criteria's root cause, as View Cause shows it", () => {
  test("reads OneUptime's labels, its yes or no and its finding in the reader's language", () => {
    const worded: string = plain(
      word({
        rootCause: ROOT_CAUSE,
        translator: GERMAN,
        changeLog: storedCheck(statusCodeSentence(503)),
      }),
    );

    expect(worded).toContain(
      "**Erstellt, weil das folgende Kriterium erfüllt wurde**:",
    );
    expect(worded).toContain("**Name des Kriteriums**: Website is down");
    expect(worded).toContain(
      "**Erfüllte Filterbedingungen**: Der Antwortstatuscode war 503, auf oder über der Schwelle von 500.",
    );
    expect(worded).toContain("**Antwort-Momentaufnahme**");
    expect(worded).toContain("- Antwortstatuscode: 503");
    expect(worded).toContain("- Zeitüberschreitung: Nein");
    // What the check found, and the criteria's name, read as written.
    expect(worded).toContain("**Ursache**: Server returned 503");
    // Nothing of OneUptime's is left in English.
    for (const english of [
      "Created because",
      "Criteria Name",
      "Filter Conditions Met",
      "Response Snapshot",
      "at or above",
    ]) {
      expect(worded).not.toContain(english);
    }
  });

  /*
   * Regression (#9752): the Status Timeline drew the stored Markdown as it
   * is, so a German page read every label of it in English.
   */
  test("regression: the cause as View Cause drew it read in English on a German page", () => {
    expect(ROOT_CAUSE).toContain("**Criteria Name**: Website is down");
    expect(
      plain(
        word({
          rootCause: ROOT_CAUSE,
          translator: GERMAN,
          changeLog: storedCheck(statusCodeSentence(503)),
        }),
      ),
    ).not.toContain("**Criteria Name**");
  });

  test("words the finding of a change of last month too: the sentence is the change's own, not the newest check's", () => {
    // Only the change's own check holds the 504: no newer evaluation does.
    const cause: string = engineRootCause({
      criteriaName: "Website is down",
      finding: englishOfEvaluationSentence(statusCodeSentence(504)),
    });

    expect(
      plain(
        word({
          rootCause: cause,
          translator: GERMAN,
          changeLog: storedCheck(statusCodeSentence(504)),
        }),
      ),
    ).toContain(
      "Der Antwortstatuscode war 504, auf oder über der Schwelle von 500.",
    );
  });

  test("keeps a finding as stored when the change kept no sentence for it", () => {
    for (const changeLog of [
      undefined,
      null,
      storedCheck(undefined),
      { responseCode: 503 },
    ]) {
      const worded: string = plain(
        word({
          rootCause: ROOT_CAUSE,
          translator: GERMAN,
          changeLog: changeLog,
        }),
      );

      expect(worded).toContain(
        "**Erfüllte Filterbedingungen**: Response Status Code was 503, at or above the 500 threshold.",
      );
      // The labels read in German all the same.
      expect(worded).toContain("**Name des Kriteriums**: Website is down");
    }
  });

  test("reads in English exactly as stored", () => {
    expect(
      word({
        rootCause: ROOT_CAUSE,
        translator: ENGLISH,
        changeLog: storedCheck(statusCodeSentence(503)),
      }),
    ).toBe(ROOT_CAUSE);
  });

  test("is the incident Root Cause page's wording, with the change's findings", () => {
    const changeLog: unknown = storedCheck(statusCodeSentence(503));

    expect(
      word({ rootCause: ROOT_CAUSE, translator: GERMAN, changeLog: changeLog }),
    ).toBe(
      MonitorRootCauseWording.wordRootCause({
        rootCause: ROOT_CAUSE,
        translator: GERMAN,
        findings: getChangeLogFindings(changeLog),
        setsValuesApart: true,
      }),
    );
  });

  test("sets a stored value apart from the reader's words, so a Persian line reads from the right", () => {
    const persian: Translator = translatorWith(
      { "Criteria Name": "نام معیار" },
      "fa",
    );

    const worded: string = word({
      rootCause: ROOT_CAUSE,
      translator: persian,
    });

    expect(worded).toContain(
      `**نام معیار**: ${FIRST_STRONG_ISOLATE}Website is down`,
    );
  });

  test("a cause somebody typed reads as they wrote it", () => {
    const typed: string =
      "The **payments** database ran out of connections.\n\nSee the runbook.";

    expect(word({ rootCause: typed, translator: GERMAN })).toBe(typed);
  });

  test("an empty cause stays empty", () => {
    for (const rootCause of ["", "   \n  "]) {
      expect(word({ rootCause: rootCause, translator: GERMAN })).toBe(
        rootCause,
      );
    }
  });
});

describe("an incident's or an alert's auto-resolve", () => {
  test.each([
    ["Incident", INCIDENT_AUTO_RESOLVED, "Vorfall automatisch behoben"],
    ["Alert", ALERT_AUTO_RESOLVED, "Alarm automatisch behoben"],
  ])(
    "%s: its sentence and the criteria that resolved it read in the reader's language",
    (_kind: string, sentence: string, german: string) => {
      // As MonitorIncident and MonitorAlert write it.
      const stored: string = `${sentence} ` + ROOT_CAUSE;

      const worded: string = plain(
        word({
          rootCause: stored,
          translator: GERMAN,
          changeLog: storedCheck(statusCodeSentence(503)),
        }),
      );

      expect(worded.startsWith(german)).toBe(true);
      expect(worded).toContain("**Name des Kriteriums**: Website is down");
      expect(worded).not.toContain("autoresolve is set to true");
    },
  );

  test("reads in English as stored, but for the space at the end of its line", () => {
    const stored: string = `${INCIDENT_AUTO_RESOLVED} ` + ROOT_CAUSE;

    expect(word({ rootCause: stored, translator: ENGLISH })).toBe(
      `${INCIDENT_AUTO_RESOLVED}\n${ROOT_CAUSE.slice(1)}`,
    );
  });

  test("an auto-resolve with no criteria under it is its sentence alone", () => {
    expect(
      word({ rootCause: INCIDENT_AUTO_RESOLVED, translator: GERMAN }),
    ).toBe(GERMAN_WORDS[INCIDENT_AUTO_RESOLVED]);
  });
});

describe("OneUptime's own status-change notes", () => {
  const userLink: string =
    mdText`[${"Jane Doe"}](${"https://oneuptime.example/dashboard/p/users/u"})`.toString();

  test("a person's change names them, their link kept", () => {
    const stored: string =
      mdText`Monitor status created by ${FeedMarkdown.asMarkdown(userLink)}`.toString();

    expect(plain(word({ rootCause: stored, translator: GERMAN }))).toBe(
      `Geändert von ${userLink}`,
    );
  });

  test("an incident's change names the incident", () => {
    // As IncidentService writes them.
    expect(
      plain(
        word({
          rootCause:
            "Status was changed because Incident " + "#42" + " was created.",
          translator: GERMAN,
        }),
      ),
    ).toBe("Geändert, weil Vorfall #42 erstellt wurde.");
    expect(
      plain(
        word({
          rootCause:
            "Status was changed because Incident " + "INC-7" + " was updated.",
          translator: GERMAN,
        }),
      ),
    ).toBe("Geändert, weil Vorfall INC-7 aktualisiert wurde.");
  });

  test("a maintenance event's change says so, without its id", () => {
    expect(
      word({
        rootCause:
          "Changed because of maintenance event: " +
          "5c0a1b2c-1111-4111-8111-111111111111",
        translator: GERMAN,
      }),
    ).toBe("Durch eine Wartung geändert.");
  });

  test("no criteria matched: said plainly, in English too", () => {
    // As MonitorResource writes it, with its space at the end.
    const stored: string =
      "No monitoring criteria met. Change to default status. ";

    expect(word({ rootCause: stored, translator: GERMAN })).toBe(
      GERMAN_WORDS[STATUS_CHANGED_TO_DEFAULT],
    );
    expect(word({ rootCause: stored, translator: ENGLISH })).toBe(
      STATUS_CHANGED_TO_DEFAULT,
    );
  });

  test("a monitor's first status, and a status set on its page", () => {
    expect(
      word({
        rootCause: "This status was created when the monitor was created.",
        translator: GERMAN,
      }),
    ).toBe(GERMAN_WORDS[STATUS_CREATED_WITH_MONITOR]);
    expect(
      word({
        rootCause: "This status was changed when the monitor was updated.",
        translator: GERMAN,
      }),
    ).toBe(GERMAN_WORDS[STATUS_CHANGED_WITH_MONITOR]);
  });

  test.each([
    [true, false, MONITORING_TURNED_OFF],
    [true, true, MONITORING_TURNED_OFF_BY_USER],
    [false, false, MONITORING_TURNED_ON],
    [false, true, MONITORING_TURNED_ON_BY_USER],
  ])(
    "monitoring switched (off: %s, by a person: %s), as the service writes it",
    (isMonitoringOff: boolean, isByAPerson: boolean, key: string) => {
      const stored: string =
        MonitorStatusTimelineServiceClass.getMonitoringSwitchRootCause({
          isMonitoringOff: isMonitoringOff,
          switchedBy: isByAPerson
            ? FeedMarkdown.asMarkdown(userLink)
            : FeedMarkdown.empty(),
        });

      const expected: string = (GERMAN_WORDS[key] as string)
        .split("{{user}}")
        .join(userLink);

      expect(plain(word({ rootCause: stored, translator: GERMAN }))).toBe(
        expected,
      );
      // In English, the service's own words, but for the person's link.
      expect(plain(word({ rootCause: stored, translator: ENGLISH }))).toBe(
        stored,
      );
    },
  );

  test("what an OpenStack project uses: both sentences", () => {
    expect(
      word({
        rootCause: OPENSTACK_PROJECT_USES_INCIDENT,
        translator: GERMAN,
      }),
    ).toBe(GERMAN_WORDS[OPENSTACK_PROJECT_USES_INCIDENT]);
    expect(
      word({ rootCause: OPENSTACK_PROJECT_USES_BACK, translator: GERMAN }),
    ).toBe(GERMAN_WORDS[OPENSTACK_PROJECT_USES_BACK]);
  });

  test("only a whole note is read: a note inside other words reads as written", () => {
    for (const text of [
      "Monitoring is off. Nothing checks the monitor until it is turned back on.",
      "Note: This status was created when the monitor was created.",
      "This status was created when the monitor was created. And then some.",
      "Monitor status created by",
    ]) {
      expect(wordStatusChangeNote(text, GERMAN)).toBeNull();
    }
  });

  test("the monitor's hero says each note the same way", () => {
    for (const note of [
      "No monitoring criteria met. Change to default status. ",
      "This status was created when the monitor was created.",
      OPENSTACK_PROJECT_USES_BACK,
    ]) {
      expect(
        readMonitorStatusReason({ rootCause: note, translator: GERMAN })?.note,
      ).toBe(word({ rootCause: note, translator: GERMAN }));
    }
  });
});

describe("the findings a change kept", () => {
  test("are its evaluation summary's filters, each once, with their sentences", () => {
    expect(getChangeLogFindings(storedCheck(statusCodeSentence(503)))).toEqual([
      {
        message: "Response Status Code was 503, not 200.",
        messageSentence: undefined,
      },
      {
        message: englishOfEvaluationSentence(statusCodeSentence(503)),
        messageSentence: statusCodeSentence(503),
      },
    ]);
    // A finding two criteria share is read once.
    const twice: unknown = storedCheck(statusCodeSentence(503));
    const summary: { criteriaResults: Array<unknown> } = (
      twice as { evaluationSummary: { criteriaResults: Array<unknown> } }
    ).evaluationSummary;
    summary.criteriaResults.push(summary.criteriaResults[1]);
    expect(getChangeLogFindings(twice)).toHaveLength(2);
  });

  test("are none in a check that holds none, however it is shaped", () => {
    for (const changeLog of [
      undefined,
      null,
      "text",
      42,
      [],
      {},
      { evaluationSummary: null },
      { evaluationSummary: { criteriaResults: "none" } },
      { evaluationSummary: { criteriaResults: [null, { filters: {} }] } },
      {
        evaluationSummary: {
          criteriaResults: [
            { filters: [null, { message: 7 }, { message: "" }] },
          ],
        },
      },
    ]) {
      expect(getChangeLogFindings(changeLog)).toEqual([]);
    }
  });
});

describe("Persian, from the Dashboard's own locale", () => {
  const PERSIAN: Translator = dashboardTranslator("fa");

  test("every status-change note and auto-resolve sentence is worded", () => {
    for (const key of [
      STATUS_CHANGED_TO_DEFAULT,
      STATUS_CREATED_WITH_MONITOR,
      STATUS_CHANGED_WITH_MONITOR,
      MONITORING_TURNED_OFF_BY_USER,
      MONITORING_TURNED_OFF,
      MONITORING_TURNED_ON_BY_USER,
      MONITORING_TURNED_ON,
      OPENSTACK_PROJECT_USES_INCIDENT,
      OPENSTACK_PROJECT_USES_BACK,
      INCIDENT_AUTO_RESOLVED,
      ALERT_AUTO_RESOLVED,
    ]) {
      expect(PERSIAN.hasTranslation(key)).toBe(true);
    }
  });

  test("a criteria's root cause has no English of OneUptime's left", () => {
    // A finding the engine really writes, from its sentence (APIRequestCriteria).
    const finding: EvaluationSentence = translatableSentence(
      "Response body contains {{text}}.",
      { text: "maintenance" },
    );
    const cause: string = engineRootCause({
      criteriaName: "Website is down",
      finding: englishOfEvaluationSentence(finding),
    });

    const worded: string = plain(
      word({
        rootCause: cause,
        translator: PERSIAN,
        changeLog: storedCheck(finding),
      }),
    );

    for (const english of [
      "Created because",
      "Criteria Name",
      "Filter Conditions Met",
      "Response Snapshot",
      "Response Status Code",
      "Timed Out",
      "Response body contains",
    ]) {
      expect(worded).not.toContain(english);
    }
    expect(worded).toContain("بدنه پاسخ شامل maintenance است.");
    // The criteria's name reads as the project wrote it.
    expect(worded).toContain("Website is down");
  });
});

/*
 * The notes are read by their English, as the server writes them: a writer
 * that changes its words without this reader would leave the note in
 * English on every page. Each writer still writes it so.
 */
describe("the server still writes each note as it is read", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
  };

  test.each([
    [
      "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
      '"No monitoring criteria met. Change to default status. "',
    ],
    [
      "packages/Common/Server/Services/MonitorService.ts",
      '"This status was created when the monitor was created."',
    ],
    [
      "packages/Common/Server/Services/MonitorService.ts",
      '"This status was changed when the monitor was updated."',
    ],
    [
      "packages/Common/Server/Services/IncidentService.ts",
      '"Status was changed because Incident " +',
    ],
    ["packages/Common/Server/Services/IncidentService.ts", '" was created."'],
    ["packages/Common/Server/Services/IncidentService.ts", '" was updated."'],
    [
      "packages/Common/Server/Services/ScheduledMaintenanceService.ts",
      '"Changed because of maintenance event: "',
    ],
    [
      "packages/Common/Server/Services/MonitorStatusTimelineService.ts",
      "mdText`Monitor status created by ${",
    ],
    [
      "packages/Common/Server/Utils/Monitor/MonitorIncident.ts",
      '"Incident autoresolved because autoresolve is set to true in monitor criteria. "',
    ],
    [
      "packages/Common/Server/Utils/Monitor/MonitorAlert.ts",
      '"Alert autoresolved because autoresolve is set to true in monitor criteria. "',
    ],
    [
      "packages/Common/Server/Utils/OpenStack/OpenStackProjectPages.ts",
      "OPENSTACK_PROJECT_USES_INCIDENT",
    ],
  ])("%s writes %s", (file: string, written: string) => {
    expect(read(file)).toContain(written);
  });
});
