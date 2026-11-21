import { jest } from "@jest/globals";
import Monitor from "../../Models/DatabaseModels/Monitor";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import AIRunEventService from "../../Server/Services/AIRunEventService";
import AIRunService from "../../Server/Services/AIRunService";
import MonitorService from "../../Server/Services/MonitorService";
import LinkedAffectedResources from "../../Server/Utils/AffectedResources/LinkedAffectedResources";
import ObservabilityAssistant, {
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
} from "../../Server/Utils/AI/Chat/ObservabilityAssistant";
import LlmProviderChoice from "../../Server/Utils/AI/LlmProviderChoice";
import AIConfidenceSignal from "../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../Server/Utils/AI/SRE/InvestigationTldr";
import { QueryMonitorsTool } from "../../Server/Utils/AI/Toolbox/MonitorTools";
import { ToolExecutionResult } from "../../Server/Utils/AI/Toolbox/ToolTypes";
import DataAlertLineageReader from "../../Server/Utils/DataObservability/DataAlertLineage";
import ReadAudienceReader from "../../Server/Utils/ReadAudience/ReadAudienceReader";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import PositiveNumber from "../../Types/PositiveNumber";
import { stubProjectPermissionRows } from "./ProjectPermissionRows";
import { keptForAudience } from "./ReadAudienceFixtures";

/*
 * A RUN OF ONEUPTIME AI, READ END TO END FOR ITS READERS (#9612), for the
 * suites of the runs whose writing everyone who may see their subject
 * reads: a fix, a security case's triage, an AI insight's triage. Not a
 * test file itself (jest only collects *.test.ts).
 *
 *   - readersOfAProject: who reads the subject, as ReadAudienceReader works
 *     them out from the project's permission rows - a project whose roles
 *     narrow nobody, or one where a team reads every kind only for some
 *     labels - and from what the subject names. No telemetry is set apart.
 *     The team's member is also on the Security team, so the narrowing
 *     reaches somebody who may read security cases too, unless the suite
 *     says none of its members may (#9632): a case's triage counts it only
 *     then; every other run, either way.
 *   - modelReadsMonitors: the real engine, with the model replaced by one
 *     that reads the project's monitors with query_monitors, through the
 *     props the engine hands every tool, and answers with what it read.
 *     The database answers as the permission layer's conditions make it
 *     answer (keptForAudience): payroll-db is set apart by a label,
 *     checkout-api by nobody.
 *
 * Call both in a beforeEach or a test: the spies are restored with
 * jest.restoreAllMocks.
 */

export const SET_APART_MONITOR_ID: string =
  "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
export const OPEN_MONITOR_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
export const SET_APART_MONITOR_NAME: string = "payroll-db (HR only)";
export const OPEN_MONITOR_NAME: string = "checkout-api";

export interface ModelReadingMonitors {
  // The props the engine handed the tools, one per model call.
  toolProps: Array<DatabaseCommonInteractionProps>;
}

function monitor(id: string, name: string): Monitor {
  const row: Monitor = new Monitor(new ObjectID(id));
  row.name = name;
  return row;
}

// The project's teams: one that reads every kind only for some labels, and Security.
const NARROWED_TEAM_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const SECURITY_TEAM_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const NARROWED_MEMBER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const ANALYST_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000004";
const LABEL_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000005";

export function readersOfAProject(data: {
  narrowedByLabels: boolean;
  /*
   * Whether somebody on the team narrowed by labels may read security cases
   * (a Security Viewer through the Security team). Default yes.
   */
  narrowedTeamReadsSecurityCases?: boolean | undefined;
}): void {
  stubProjectPermissionRows({
    teamRows: [
      { teamId: SECURITY_TEAM_ID, permission: Permission.SecurityViewer },
      ...(data.narrowedByLabels
        ? [
            {
              teamId: NARROWED_TEAM_ID,
              permission: Permission.ProjectMember,
              labelIds: [LABEL_ID],
            },
          ]
        : []),
    ],
    members: [
      { teamId: SECURITY_TEAM_ID, userId: ANALYST_ID },
      { teamId: NARROWED_TEAM_ID, userId: NARROWED_MEMBER_ID },
      ...(data.narrowedTeamReadsSecurityCases === false
        ? []
        : [{ teamId: SECURITY_TEAM_ID, userId: NARROWED_MEMBER_ID }]),
    ],
  });
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LinkedAffectedResources, "readForAlert")
    .mockResolvedValue([] as never);
  jest.spyOn(DataAlertLineageReader, "readNamed").mockResolvedValue({
    dataAssetIds: [],
    dataPipelineIds: [],
  } as never);
  jest
    .spyOn(ReadAudienceReader, "readTelemetryBlockedIds")
    .mockResolvedValue([] as never);
}

export function modelReadsMonitors(data?: {
  // What the model's answer ends with: a run's closing line.
  answerTail?: string | undefined;
}): ModelReadingMonitors {
  const reading: ModelReadingMonitors = { toolProps: [] };
  const rows: Array<Monitor> = [
    monitor(SET_APART_MONITOR_ID, SET_APART_MONITOR_NAME),
    monitor(OPEN_MONITOR_ID, OPEN_MONITOR_NAME),
  ];
  const kept: (props: DatabaseCommonInteractionProps) => Array<Monitor> = (
    props: DatabaseCommonInteractionProps,
  ): Array<Monitor> => {
    return keptForAudience({
      modelType: Monitor,
      rows,
      props,
      setApartIds: [SET_APART_MONITOR_ID],
    });
  };

  // The engine's own bookkeeping.
  jest
    .spyOn(AIRunEventService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(AIRunEventService, "create").mockImplementation((async (create: {
    data: AIRunEvent;
  }): Promise<AIRunEvent> => {
    return create.data;
  }) as never);
  jest
    .spyOn(AIRunService, "attemptStatusTransition")
    .mockResolvedValue(1 as never);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1 as never);
  jest.spyOn(AIConfidenceSignal, "computeConfidenceSignal").mockResolvedValue({
    confident: true,
    codeFixRecommended: false,
    source: "classification",
  } as never);
  jest
    .spyOn(InvestigationTldr, "generateTldr")
    .mockResolvedValue(null as never);
  jest.spyOn(LlmProviderChoice, "decideForRun").mockResolvedValue({
    provider: null,
    source: null,
    fallbackReason: null,
    pickedProviderId: "",
    activity: null,
  } as never);

  // The database, as the permission layer narrows it.
  jest.spyOn(MonitorService, "findBy").mockImplementation((async (findBy: {
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<Monitor>> => {
    return kept(findBy.props);
  }) as never);
  jest.spyOn(MonitorService, "countBy").mockImplementation((async (countBy: {
    props: DatabaseCommonInteractionProps;
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(kept(countBy.props).length);
  }) as never);

  // The model: one tool call, with the props it was handed, then its answer.
  jest
    .spyOn(ObservabilityAssistant, "answerQuestion")
    .mockImplementation((async (
      request: ObservabilityAssistantRequest,
    ): Promise<ObservabilityAssistantResult> => {
      reading.toolProps.push(request.props);

      const read: ToolExecutionResult = await QueryMonitorsTool.execute(
        {},
        { projectId: request.projectId, props: request.props },
      );

      return {
        contentInMarkdown: `**Summary** — the monitors I read: ${read.dataForLlm}${
          data?.answerTail ? `\n\n${data.answerTail}` : ""
        }`,
        citations: [],
        totalTokens: 100,
        llmCallCount: 1,
        toolCallCount: 1,
      };
    }) as never);

  return reading;
}
