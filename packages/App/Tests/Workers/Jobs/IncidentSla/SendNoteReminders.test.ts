import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSla from "Common/Models/DatabaseModels/IncidentSla";
import IncidentSlaRule from "Common/Models/DatabaseModels/IncidentSlaRule";
import ObjectID from "Common/Types/ObjectID";

/*
 * The SLA note reminders fill {{incidentTitle}} into a rule's note template
 * and post the note - a public one to the status page too - with nobody
 * reading it first. The title is plain text, which anyone holding an
 * incident form's link may have typed, so it is escaped where it is placed,
 * as MarkdownEscape says a title must be (and as the note composer's own
 * {{incidentTitle}} is): it cannot become an image fetched when the note is
 * shown, raw HTML, or a link whose text hides where it goes, and it reads
 * exactly as typed - "$&" in it included, which is text, not a replacement
 * pattern.
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to CAPTURE the handler (the same recorder the
 * other App/Tests/Workers/Jobs suites use) and each test drives one tick.
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the job
 * import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentSlaService", () => {
  return {
    __esModule: true,
    default: {
      getIncidentsNeedingInternalNoteReminder: jest.fn(),
      getIncidentsNeedingPublicNoteReminder: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentInternalNoteService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentPublicNoteService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
    },
  };
});

import IncidentInternalNoteService from "Common/Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentSlaService from "Common/Server/Services/IncidentSlaService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import "../../../../FeatureSet/Workers/Jobs/IncidentSla/SendNoteReminders";

const HOSTILE_TITLE: string =
  "![](https://tracker.example/p.png) [Reset your password](https://evil.example/login) costs $& more";

const TEMPLATE: string =
  "**SLA Reminder** for {{incidentNumber}}: {{incidentTitle}}";

function slaWithTemplates(): IncidentSla {
  const rule: IncidentSlaRule = new IncidentSlaRule();
  rule.internalNoteReminderTemplate = TEMPLATE;
  rule.publicNoteReminderTemplate = TEMPLATE;

  const sla: IncidentSla = new IncidentSla();
  sla._id = ObjectID.generate().toString();
  sla.incidentId = ObjectID.generate();
  sla.projectId = ObjectID.generate();
  sla.incidentSlaRule = rule;
  return sla;
}

function incidentTitled(title: string): Incident {
  const incident: Incident = new Incident();
  incident._id = ObjectID.generate().toString();
  incident.title = title;
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";
  return incident;
}

async function runTick(title: string): Promise<Array<string>> {
  const sla: IncidentSla = slaWithTemplates();

  (
    IncidentSlaService.getIncidentsNeedingInternalNoteReminder as jest.Mock
  ).mockResolvedValue([sla]);
  (
    IncidentSlaService.getIncidentsNeedingPublicNoteReminder as jest.Mock
  ).mockResolvedValue([sla]);
  (IncidentSlaService.updateOneById as jest.Mock).mockResolvedValue(1);
  (IncidentService.findOneById as jest.Mock).mockResolvedValue(
    incidentTitled(title),
  );
  (IncidentInternalNoteService.create as jest.Mock).mockResolvedValue({});
  (IncidentPublicNoteService.create as jest.Mock).mockResolvedValue({});

  await mockCapturedJobs["IncidentSla:SendNoteReminders"]!();

  const internal: IncidentInternalNote = (
    IncidentInternalNoteService.create as jest.Mock
  ).mock.calls[0][0].data;
  const published: IncidentPublicNote = (
    IncidentPublicNoteService.create as jest.Mock
  ).mock.calls[0][0].data;

  return [internal.note!, published.note!];
}

// The text a reader sees once the note is rendered, as the emails render it.
function readText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("IncidentSla:SendNoteReminders - {{incidentTitle}}", () => {
  test("is registered as a cron job", () => {
    expect(mockCapturedJobs["IncidentSla:SendNoteReminders"]).toBeDefined();
  });

  test("a hostile title is no image and no disguised link in either note, and reads as typed", async () => {
    const notes: Array<string> = await runTick(HOSTILE_TITLE);

    expect(notes).toHaveLength(2);

    for (const note of notes) {
      const html: string = await Markdown.convertToHTML(
        note,
        MarkdownContentType.Email,
      );

      expect(html).not.toContain("<img");

      // A link to the title's address shows that address, if any is made.
      for (const match of html.matchAll(
        /<a [^>]*href="([^"]*evil\.example[^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
      )) {
        expect(readText(match[2]!)).toBe(readText(match[1]!));
      }

      expect(readText(html)).toContain(
        `SLA Reminder for INC-42: ${HOSTILE_TITLE}`,
      );
    }
  });

  test("an ordinary title is placed exactly as typed", async () => {
    const notes: Array<string> = await runTick("Site 03 - payments (EU)");

    for (const note of notes) {
      expect(note).toBe("**SLA Reminder** for INC-42: Site 03 - payments (EU)");
    }
  });
});
