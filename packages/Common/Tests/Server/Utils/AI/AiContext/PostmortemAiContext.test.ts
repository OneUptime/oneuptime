import IncidentAIContextBuilder, {
  AIGenerationContext,
  IncidentContextData,
} from "../../../../../Server/Utils/AI/IncidentAIContextBuilder";
import IncidentEpisodeAIContextBuilder, {
  IncidentEpisodeContextData,
} from "../../../../../Server/Utils/AI/IncidentEpisodeAIContextBuilder";
import AIIncidentPostmortemRunner from "../../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import {
  AI_CONTEXT_PROMPT_HEADING,
  buildAiContextPromptSection,
} from "../../../../../Server/Utils/AI/AiContext/AiContextPrompt";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../../Server/Services/AIService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import Project from "../../../../../Models/DatabaseModels/Project";
import {
  AiContextActivity,
  composeAiContext,
} from "../../../../../Types/AI/AiContext";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * POSTMORTEM DRAFTS READ THE PROJECT'S AI CONTEXT (issue #5198: "ideally
 * also postmortem drafts"): the automatic draft on resolve and Generate
 * with AI, for an incident and for an episode. Placed first in the system
 * prompt, in front of the drafting instructions and the template - which
 * the user message still calls "the template above" - and the incident's
 * own data stays in the user message. The automatic draft says in its
 * feed item that it read it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const NOTES: string =
  "## Who owns what\n- payments-db: the payments team (#payments-oncall).";
const TEMPLATE: string = "## Summary\n\n## Root cause\n\n## Action items";

const AI_CONTEXT: AiContextActivity = composeAiContext({
  projectContext: NOTES,
})!;

function incidentContext(): IncidentContextData {
  const incident: Incident = new Incident(INCIDENT_ID);
  incident.title = "Checkout is down";
  incident.description = "502 on /checkout for 14 minutes.";

  return {
    incident,
    stateTimeline: [],
    internalNotes: [],
    publicNotes: [],
    workspaceMessages: [],
  };
}

function episodeContext(): IncidentEpisodeContextData {
  const episode: IncidentEpisode = new IncidentEpisode(ObjectID.generate());
  episode.title = "Checkout outages this week";

  return {
    episode,
    stateTimeline: [],
    internalNotes: [],
    memberIncidents: [],
    workspaceMessages: [],
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident's postmortem prompt", () => {
  test("opens with the AI context, in front of the drafting instructions", () => {
    const built: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        incidentContext(),
        undefined,
        AI_CONTEXT,
      );

    expect(
      built.systemPrompt.startsWith(buildAiContextPromptSection(AI_CONTEXT)),
    ).toBe(true);
    expect(built.systemPrompt.indexOf(NOTES)).toBeLessThan(
      built.systemPrompt.indexOf("You are an expert Site Reliability Engineer"),
    );
    expect(built.messages[0]).toEqual({
      role: "system",
      content: built.systemPrompt,
    });
  });

  test("the template stays last in the system prompt, as the user message's 'above' says", () => {
    const built: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        incidentContext(),
        TEMPLATE,
        AI_CONTEXT,
      );

    expect(built.systemPrompt.endsWith(TEMPLATE)).toBe(true);
    expect(built.systemPrompt.indexOf(NOTES)).toBeLessThan(
      built.systemPrompt.indexOf("TEMPLATE TO FILL"),
    );
    expect(built.messages[1]!.content).toContain(
      "Fill in the template above using ONLY the following incident data",
    );
  });

  test("the incident's own data is in the user message, not the AI context's place", () => {
    const built: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        incidentContext(),
        undefined,
        AI_CONTEXT,
      );

    expect(built.messages[1]!.role).toBe("user");
    expect(built.messages[1]!.content).toContain("Checkout is down");
    expect(built.messages[1]!.content).not.toContain(NOTES);
    expect(built.systemPrompt).not.toContain("502 on /checkout");
  });

  test("with no AI context - left out, or null - the prompt is the one it always was", () => {
    const plain: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        incidentContext(),
        TEMPLATE,
      );
    const withNull: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        incidentContext(),
        TEMPLATE,
        null,
      );

    expect(withNull).toEqual(plain);
    expect(plain.systemPrompt).not.toContain(AI_CONTEXT_PROMPT_HEADING);
  });
});

describe("an episode's postmortem prompt", () => {
  test("opens with the AI context too, and the template stays last", () => {
    const built: AIGenerationContext =
      IncidentEpisodeAIContextBuilder.formatEpisodeContextForPostmortem(
        episodeContext(),
        TEMPLATE,
        AI_CONTEXT,
      );

    expect(built.systemPrompt.startsWith(AI_CONTEXT_PROMPT_HEADING)).toBe(true);
    expect(built.systemPrompt.endsWith(TEMPLATE)).toBe(true);
    expect(built.messages[1]!.content).not.toContain(NOTES);
  });

  test("and without one, nothing changes", () => {
    expect(
      IncidentEpisodeAIContextBuilder.formatEpisodeContextForPostmortem(
        episodeContext(),
        undefined,
        null,
      ),
    ).toEqual(
      IncidentEpisodeAIContextBuilder.formatEpisodeContextForPostmortem(
        episodeContext(),
      ),
    );
  });
});

describe("IncidentService.generatePostmortemFromAI", () => {
  function mockDraft(): SpyInstance<typeof AIService.executeWithLogging> {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        Object.assign(new Incident(INCIDENT_ID), { projectId: PROJECT_ID }),
      );
    jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockResolvedValue(incidentContext());

    return jest.spyOn(AIService, "executeWithLogging").mockResolvedValue({
      content: "## Summary\nDrafted.",
      llmLog: {},
    } as unknown as AILogResponse);
  }

  function systemPromptOf(
    execute: SpyInstance<typeof AIService.executeWithLogging>,
  ): string {
    return (execute.mock.calls[0]![0] as AILogRequest).messages[0]!.content;
  }

  test("left to it, reads the incident's own project's AI context and writes with it", async () => {
    const project: Project = new Project(PROJECT_ID);
    project.aiContext = NOTES;
    const read: SpyInstance<typeof ProjectService.findOneById> = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project);
    const execute: SpyInstance<typeof AIService.executeWithLogging> =
      mockDraft();

    await IncidentService.generatePostmortemFromAI({ incidentId: INCIDENT_ID });

    expect(read).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: { aiContext: true },
      props: { isRoot: true },
    });
    expect(systemPromptOf(execute).startsWith(AI_CONTEXT_PROMPT_HEADING)).toBe(
      true,
    );
    expect(systemPromptOf(execute)).toContain(NOTES);
  });

  test("handed what the caller read, it reads nothing more; null is none", async () => {
    const read: SpyInstance<typeof ProjectService.findOneById> = jest.spyOn(
      ProjectService,
      "findOneById",
    );
    const execute: SpyInstance<typeof AIService.executeWithLogging> =
      mockDraft();

    await IncidentService.generatePostmortemFromAI({
      incidentId: INCIDENT_ID,
      aiContext: null,
    });

    expect(read).not.toHaveBeenCalled();
    expect(systemPromptOf(execute)).not.toContain(AI_CONTEXT_PROMPT_HEADING);
  });
});

describe("AIIncidentPostmortemRunner.describeDraftSources: what the feed item says it was written from", () => {
  test("the timeline and telemetry, as before", () => {
    expect(
      AIIncidentPostmortemRunner.describeDraftSources({
        callsRead: 0,
        readAiContext: false,
      }),
    ).toBe("the incident timeline and telemetry");
  });

  test("and what was said on its calls, as before", () => {
    expect(
      AIIncidentPostmortemRunner.describeDraftSources({
        callsRead: 2,
        readAiContext: false,
      }),
    ).toBe("the incident timeline, telemetry and what was said on its calls");
  });

  test("and the project's AI context, when it read it", () => {
    expect(
      AIIncidentPostmortemRunner.describeDraftSources({
        callsRead: 0,
        readAiContext: true,
      }),
    ).toBe("the incident timeline, telemetry and the project's AI context");
    expect(
      AIIncidentPostmortemRunner.describeDraftSources({
        callsRead: 1,
        readAiContext: true,
      }),
    ).toBe(
      "the incident timeline, telemetry, what was said on its calls and the project's AI context",
    );
  });
});
