/*
 * Index MUST be imported before anything that reaches a tool module (see
 * InvestigationEvidence.test.ts): it is the production import order.
 */
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import InvestigationThread from "../../../../Server/Utils/AI/SRE/InvestigationThread";
import InvestigationGrader from "../../../../Server/Utils/AI/SRE/InvestigationGrader";
import AIMemory from "../../../../Server/Utils/AI/SRE/AIMemory";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import RemediationPlanRunner, {
  redactAndCap,
} from "../../../../Server/Utils/AI/Remediation/RemediationPlanRunner";
import IncidentAIContextBuilder, {
  AIGenerationContext,
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import IncidentEpisodeAIContextBuilder, {
  IncidentEpisodeContextData,
} from "../../../../Server/Utils/AI/IncidentEpisodeAIContextBuilder";
import ScheduledMaintenanceAIContextBuilder, {
  ScheduledMaintenanceContextData,
} from "../../../../Server/Utils/AI/ScheduledMaintenanceAIContextBuilder";
import ToolResultSerializer, {
  MAX_FIELD_LENGTH,
  SerializedResult,
} from "../../../../Server/Utils/AI/Toolbox/Serializer";
import WorkspaceUtil, {
  WorkspaceChannelMessage,
} from "../../../../Server/Utils/Workspace/Workspace";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIRunService from "../../../../Server/Services/AIRunService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../../Models/DatabaseModels/Project";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import PromptText, {
  MAX_DRAFT_PROMPT_FIELD_LENGTH,
  MAX_PROMPT_FIELD_LENGTH,
} from "../../../../Utils/AI/PromptText";
import { AIPromptOmissions } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * EVERY PROMPT BUILDER LEAVES A SCREENSHOT OUT (issue #4587).
 *
 * A synthetic monitor's screenshot sits in a description as a data: URL of
 * hundreds of kilobytes of base64 - and a responder may paste one into a
 * note or a root cause too. Each place OneUptime builds text for a model
 * from a record is fed one here, and must give the model the words around
 * it and a short note where it was, never the base64: the investigation
 * runners, the shared thread, the postmortem and note drafts of incidents,
 * alerts, episodes and scheduled maintenance, the channel messages they
 * read, past incidents, grading, remediation, and tool results.
 */

// A 128 KB JPEG screenshot, as a probe reports one (base64, noisy like a photo).
function jpegScreenshot(kilobytes: number): string {
  const bytes: Buffer = Buffer.alloc(kilobytes * 1024);
  let seed: number = 5;

  for (let index: number = 0; index < bytes.length; index++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[index] = (seed >> 8) & 0xff;
  }

  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;

  return bytes.toString("base64");
}

const SCREENSHOT: string = jpegScreenshot(128);
const NOTE: string = "[image omitted: JPEG, 128 KB]";

// Text with a screenshot in it, as the docs' template writes one.
function withScreenshot(words: string): string {
  return `${words}\n\n![Page](data:image/jpeg;base64,${SCREENSHOT})\n\nAfter the screenshot.`;
}

function expectScreenshotLeftOut(text: string, notes: number = 1): void {
  // A line of the base64 from deep inside the image never makes it.
  expect(text).not.toContain(SCREENSHOT.slice(40_000, 40_080));
  expect(text).not.toContain("data:image/jpeg;base64,");
  expect(text.split(NOTE).length - 1).toBe(notes);
  expect(text).toContain("After the screenshot.");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the investigation seed", () => {
  function incidentContext(): IncidentContextData {
    const incident: Incident = new Incident(ObjectID.generate());
    incident.title = "Checkout fails";
    incident.description = withScreenshot("Synthetic check failed.");
    incident.rootCause = withScreenshot("Bad deploy, see:");

    const notes: Array<IncidentInternalNote> = [
      "first",
      withScreenshot("second"),
    ].map((text: string): IncidentInternalNote => {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.note = text;
      return note;
    });

    return {
      incident,
      stateTimeline: [],
      internalNotes: notes,
      publicNotes: [],
      workspaceMessages: [],
    };
  }

  test("an incident's description, root cause and notes", () => {
    const omissions: AIPromptOmissions = PromptText.noOmissions();
    const summary: string = AIIncidentInvestigationRunner.buildIncidentSummary(
      incidentContext(),
      omissions,
    );

    expectScreenshotLeftOut(summary, 3);
    expect(summary).toContain("Description: Synthetic check failed.");
    expect(summary).toContain(
      "Root cause (as recorded so far): Bad deploy, see:",
    );
    expect(summary).toContain("- first\n- second");
    expect(omissions.imageCount).toBe(3);
    expect(omissions.imageBytes).toBe(3 * 128 * 1024);
  });

  test("an alert's description, root cause and notes", () => {
    const alert: Alert = new Alert(ObjectID.generate());
    alert.title = "Checkout fails";
    alert.description = withScreenshot("Synthetic check failed.");
    alert.rootCause = withScreenshot("Bad deploy, see:");

    const note: AlertInternalNote = new AlertInternalNote();
    note.note = withScreenshot("from the laptop");

    const omissions: AIPromptOmissions = PromptText.noOmissions();
    const summary: string = AIAlertInvestigationRunner.buildAlertSummary(
      { alert, stateTimeline: [], internalNotes: [note] },
      omissions,
    );

    expectScreenshotLeftOut(summary, 3);
    expect(omissions.imageCount).toBe(3);
  });

  test(`each field is held to ${MAX_PROMPT_FIELD_LENGTH} characters`, () => {
    const context: IncidentContextData = incidentContext();
    context.incident.description = "Upstream timed out. ".repeat(1000);

    const omissions: AIPromptOmissions = PromptText.noOmissions();
    const summary: string = AIIncidentInvestigationRunner.buildIncidentSummary(
      context,
      omissions,
    );
    const description: string = summary
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("Description: ");
      })!;

    expect(description.length).toBeLessThan(MAX_PROMPT_FIELD_LENGTH + 64);
    expect(description).toMatch(/more characters omitted\]$/);
    expect(omissions.shortenedTextCount).toBe(1);
  });
});

describe("the investigation thread", () => {
  test("an incident's description and root cause", () => {
    const incident: Incident = new Incident(ObjectID.generate());
    incident.title = "Checkout fails";
    incident.description = withScreenshot("Synthetic check failed.");
    incident.rootCause = withScreenshot("Bad deploy, see:");

    const summary: string = InvestigationThread.describeIncident(
      incident,
      incident.id!,
    ).summary;

    expectScreenshotLeftOut(summary, 2);
    expect(summary).toContain("Description: Synthetic check failed.");
  });

  test("an alert's description and root cause", () => {
    const alert: Alert = new Alert(ObjectID.generate());
    alert.title = "Checkout fails";
    alert.description = withScreenshot("Synthetic check failed.");
    alert.rootCause = withScreenshot("Bad deploy, see:");

    expectScreenshotLeftOut(
      InvestigationThread.describeAlert(alert, alert.id!).summary,
      2,
    );
  });
});

describe("postmortem and note drafts", () => {
  function fullIncidentContext(): IncidentContextData {
    const incident: Incident = new Incident(ObjectID.generate());
    incident.title = "Checkout fails";
    incident.description = withScreenshot("Synthetic check failed.");
    incident.rootCause = withScreenshot("Root cause:");
    incident.remediationNotes = withScreenshot("Remediation:");

    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.startsAt = new Date("2026-10-09T10:00:00Z");
    timeline.rootCause = withScreenshot("Timeline root cause:");

    const internal: IncidentInternalNote = new IncidentInternalNote();
    internal.note = withScreenshot("Internal:");

    const publicNote: IncidentPublicNote = new IncidentPublicNote();
    publicNote.note = withScreenshot("Public:");

    return {
      incident,
      stateTimeline: [timeline],
      internalNotes: [internal],
      publicNotes: [publicNote],
      workspaceMessages: [
        {
          messageId: "1",
          text: withScreenshot("From Slack:"),
          username: "priya",
          timestamp: new Date("2026-10-09T10:05:00Z"),
          isBot: false,
        },
      ],
    };
  }

  test("an incident postmortem: every field, and the channel's messages", () => {
    const generated: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        fullIncidentContext(),
      );

    // Description, root cause, remediation, timeline, two notes, one message.
    expectScreenshotLeftOut(generated.contextText, 7);
    expectScreenshotLeftOut(generated.messages[1]!.content, 7);
  });

  test("an incident note, public or internal", () => {
    for (const noteType of ["public", "internal"] as const) {
      const generated: AIGenerationContext =
        IncidentAIContextBuilder.formatIncidentContextForNote(
          fullIncidentContext(),
          noteType,
        );

      // Description, root cause, timeline, two notes, one message.
      expectScreenshotLeftOut(generated.contextText, 6);
    }
  });

  test(`a draft reads up to ${MAX_DRAFT_PROMPT_FIELD_LENGTH} characters of a field`, () => {
    const context: IncidentContextData = fullIncidentContext();
    const longNote: string = "We restarted the pods one by one. ".repeat(400);
    context.internalNotes[0]!.note = longNote;

    const contextText: string =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        context,
      ).contextText;

    // 13,600 characters: all of it, where a seed would have kept 4,000.
    expect(longNote.length).toBeGreaterThan(MAX_PROMPT_FIELD_LENGTH);
    expect(contextText).toContain(longNote.trimEnd());

    context.internalNotes[0]!.note = longNote.repeat(2);

    expect(
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(context)
        .contextText,
    ).toMatch(/more characters omitted\]/);
  });

  test("an alert note", () => {
    const alert: Alert = new Alert(ObjectID.generate());
    alert.title = "Checkout fails";
    alert.description = withScreenshot("Synthetic check failed.");
    alert.rootCause = withScreenshot("Root cause:");
    alert.remediationNotes = withScreenshot("Remediation:");

    const timeline: AlertStateTimeline = new AlertStateTimeline();
    timeline.startsAt = new Date("2026-10-09T10:00:00Z");
    timeline.rootCause = withScreenshot("Timeline:");

    const note: AlertInternalNote = new AlertInternalNote();
    note.note = withScreenshot("Internal:");

    const context: AlertContextData = {
      alert,
      stateTimeline: [timeline],
      internalNotes: [note],
    };

    expectScreenshotLeftOut(
      AlertAIContextBuilder.formatAlertContextForNote(context).contextText,
      5,
    );
  });

  test("an episode postmortem, with its member incidents", () => {
    const episode: IncidentEpisode = new IncidentEpisode(ObjectID.generate());
    episode.title = "Checkout outage";
    episode.description = withScreenshot("Episode:");
    episode.rootCause = withScreenshot("Root cause:");
    episode.remediationNotes = withScreenshot("Remediation:");

    const incident: Incident = new Incident(ObjectID.generate());
    incident.title = "Checkout fails";
    incident.description = withScreenshot("Member:");
    incident.rootCause = withScreenshot("Member root cause:");
    incident.remediationNotes = withScreenshot("Member remediation:");

    const member: IncidentEpisodeMember = new IncidentEpisodeMember();
    member.incident = incident;

    const note: IncidentEpisodeInternalNote = new IncidentEpisodeInternalNote();
    note.note = withScreenshot("Internal:");

    const context: IncidentEpisodeContextData = {
      episode,
      stateTimeline: [],
      internalNotes: [note],
      memberIncidents: [member],
      workspaceMessages: [],
    };

    expectScreenshotLeftOut(
      IncidentEpisodeAIContextBuilder.formatEpisodeContextForPostmortem(context)
        .contextText,
      7,
    );
  });

  test("a scheduled maintenance note", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance(
      ObjectID.generate(),
    );
    event.title = "Database upgrade";
    event.description = withScreenshot("Plan:");

    const internal: ScheduledMaintenanceInternalNote =
      new ScheduledMaintenanceInternalNote();
    internal.note = withScreenshot("Internal:");

    const publicNote: ScheduledMaintenancePublicNote =
      new ScheduledMaintenancePublicNote();
    publicNote.note = withScreenshot("Public:");

    const context: ScheduledMaintenanceContextData = {
      scheduledMaintenance: event,
      stateTimeline: [],
      internalNotes: [internal],
      publicNotes: [publicNote],
    };

    expectScreenshotLeftOut(
      ScheduledMaintenanceAIContextBuilder.formatScheduledMaintenanceContextForNote(
        context,
        "public",
      ).contextText,
      3,
    );
  });
});

describe("a channel's messages", () => {
  test("a screenshot is a note, and the messages after it are still read", () => {
    const messages: Array<WorkspaceChannelMessage> = [
      {
        messageId: "1",
        text: withScreenshot("Look at this:"),
        username: "priya",
        timestamp: new Date("2026-10-09T10:00:00Z"),
        isBot: false,
      },
      {
        messageId: "2",
        text: "Rolling back now.",
        username: "sam",
        timestamp: new Date("2026-10-09T10:01:00Z"),
        isBot: false,
      },
    ];

    const context: string = WorkspaceUtil.formatMessagesAsContext(messages, {
      maxLength: 30_000,
    });

    expectScreenshotLeftOut(context);
    // Before, the 175,000-character first message ended the context there.
    expect(context).toContain("sam: Rolling back now.");
    expect(context).not.toContain("messages truncated");
  });
});

describe("past incidents (recurrence memory)", () => {
  test("a past incident's root cause is read without its screenshot", async () => {
    const past: Incident = new Incident(ObjectID.generate());
    past.incidentNumber = 12;
    past.title = "Checkout fails";
    past.rootCause = `![Before](data:image/jpeg;base64,${SCREENSHOT}) The CDN purge failed.`;

    jest
      .spyOn(IncidentStateService, "getResolvedIncidentStateIds")
      .mockResolvedValue([ObjectID.generate()]);
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([past]);

    const context: string = await AIMemory.getPriorSimilarIncidentsContext({
      projectId: ObjectID.generate(),
      currentIncidentId: ObjectID.generate(),
      monitorNames: [],
      labelNames: [],
    });

    expect(context).toContain(
      `Root cause: ![Before](${NOTE}) The CDN purge failed.`,
    );
    expect(context).not.toContain(SCREENSHOT.slice(1000, 1064));
  });
});

describe("grading an investigation against the recorded root cause", () => {
  test("the root cause is read without its screenshot", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
    } as unknown as Project);
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
      id: ObjectID.generate(),
      completedAt: new Date(),
    } as unknown as AIRun);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: incidentId,
      rootCause: withScreenshot("The CDN purge failed."),
    } as unknown as Incident);
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue("**Summary** The CDN purge failed.");
    jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1);

    const execute: jest.SpyInstance = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue({ content: "MATCH" } as unknown as AILogResponse);

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(execute).toHaveBeenCalledTimes(1);

    const request: AILogRequest = execute.mock.calls[0]![0] as AILogRequest;

    expectScreenshotLeftOut(request.messages[1]!.content);
  });
});

describe("remediation", () => {
  test("a signal's description: the note, the words after it, and secrets still redacted", () => {
    const description: string = `${withScreenshot("Checkout fails.")} Contact ops@example.com`;
    const text: string = redactAndCap(description, 4000);

    expectScreenshotLeftOut(text);
    expect(text).toContain("[redacted-email]");
  });

  test("a description that starts with a screenshot keeps its words after the cap", () => {
    // Before, the cap kept 4,000 characters of base64 and nothing else.
    const text: string = redactAndCap(
      `![x](data:image/jpeg;base64,${SCREENSHOT}) Disk full on db-1.`,
      4000,
    );

    expect(text).toBe(`![x](${NOTE}) Disk full on db-1.`);
  });

  test("a candidate runbook's description is read without its screenshot", async () => {
    const runbook: Runbook = new Runbook(ObjectID.generate());
    runbook.name = "Restart checkout";
    runbook.description = withScreenshot("Restarts the checkout pods.");

    const suggestion: AutoRemediationSuggestion = new AutoRemediationSuggestion(
      ObjectID.generate(),
    );

    jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null);

    const planningContext: string = await (
      RemediationPlanRunner as unknown as {
        buildPlanningContext: (data: {
          suggestion: AutoRemediationSuggestion;
          candidates: Array<Runbook>;
        }) => Promise<string>;
      }
    ).buildPlanningContext({ suggestion, candidates: [runbook] });

    expectScreenshotLeftOut(planningContext);
    expect(planningContext).toContain(
      `"Restart checkout": Restarts the checkout pods.`,
    );
  });
});

describe("tool results", () => {
  test("a description with a screenshot keeps its words after it, within the field's length", () => {
    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        title: "Checkout fails",
        description: withScreenshot("Synthetic check failed."),
      },
    ]);

    expectScreenshotLeftOut(serialized.text);
    // Before, the field was 4,000 characters of base64, cut.
    expect(serialized.isTruncated).toBe(false);
    expect(serialized.text.length).toBeLessThan(MAX_FIELD_LENGTH);
  });

  test("free text a tool returns is read without its screenshot", () => {
    expectScreenshotLeftOut(
      ToolResultSerializer.serializeText(withScreenshot("Report:"), 1).text,
    );
  });

  /*
   * A run of base64 has no edge of its own, so it is left out after the
   * secrets are redacted: a token glued to one is still recognised whole.
   */
  test("a secret glued to a long run of base64 is redacted whole, then the run is left out", () => {
    const jwt: string =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const run: string = SCREENSHOT.slice(20_000, 22_000);
    const text: string = ToolResultSerializer.serializeText(
      `blob=${run}${jwt} end`,
      1,
    ).text;

    expect(text).toBe("blob=[encoded data omitted: 2 KB][redacted-jwt] end");
  });

  /*
   * A data: URL ends where its data does, so it is left out before the
   * rules read the text: they would read a screenshot's megabytes, and some
   * read a long run without a "/" in time that grows with its square.
   */
  test("a screenshot's base64 never reaches the redaction rules", () => {
    // 2 MB of one colour: base64 with no "/" in it for two megabytes.
    const flat: string = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(2 * 1024 * 1024, 0x5a),
    ]).toString("base64");
    const startedAt: number = Date.now();

    const text: string = ToolResultSerializer.serializeText(
      `![x](data:image/png;base64,${flat}) mail ops@example.com`,
      1,
    ).text;

    expect(text).toBe("![x]([image omitted: PNG, 2 MB]) mail [redacted-email]");
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(redactAndCap(`data:image/png;base64,${flat}`, 4000)).toBe(
      "[image omitted: PNG, 2 MB]",
    );
  });

  test("an object field is read without the screenshot inside it", () => {
    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        payload: {
          screenshot: `data:image/png;base64,${SCREENSHOT}`,
          ok: false,
        },
      },
    ]);

    expect(serialized.text).toContain(
      `payload={"screenshot":"${NOTE}","ok":false}`,
    );
  });
});

test("the toolbox loaded in production order", () => {
  expect(AIToolbox).toBeDefined();
});
