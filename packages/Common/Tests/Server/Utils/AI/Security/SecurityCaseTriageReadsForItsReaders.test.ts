import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import IncidentService from "../../../../../Server/Services/IncidentService";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseNoteService from "../../../../../Server/Services/SecurityCaseNoteService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../../Server/Services/SecurityDetectionService";
import SecurityPlaybookService from "../../../../../Server/Services/SecurityPlaybookService";
import SecurityProtectedEntityService from "../../../../../Server/Services/SecurityProtectedEntityService";
import McpInvestigationTools from "../../../../../Server/Utils/AI/Mcp/McpInvestigationTools";
import SecurityCaseTriageRunner from "../../../../../Server/Utils/AI/Security/SecurityCaseTriageRunner";
import logger from "../../../../../Server/Utils/Logger";
import SecurityConnections from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import SecurityTelemetryMentions from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityTelemetryMentions";
import SecurityPlaybookLauncher from "../../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookLauncher";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../../../../Types/BaseDatabase/ReadAudience";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  readAudienceOf,
  readAudienceProps,
} from "../../../../Helpers/ReadAudienceFixtures";
import {
  ModelReadingMonitors,
  modelReadsMonitors,
  OPEN_MONITOR_NAME,
  readersOfAProject,
  SET_APART_MONITOR_NAME,
} from "../../../../Helpers/RunReadersHarness";
import { stubSecurityCaseValues } from "../../../../Helpers/SecurityCaseValuesStub";

/*
 * A SECURITY CASE'S TRIAGE READS ONLY WHAT EVERYONE WHO MAY SEE THE CASE MAY
 * READ (#9612).
 *
 * OneUptime AI's triage of a case goes on the case's page and its timeline,
 * and everyone who may see the case reads it. Its runner works out the
 * case's readers (ReadAudienceReader, subject: the case), so its starting
 * context - what the case's entities connect to, where its values appear in
 * the logs and traces, the incident it declared - and every tool read
 * through the permission layer for them. The case names itself and the
 * incident it declared, unless that incident is private.
 *
 * The engine runs for real, and its model reads the project's monitors
 * through the props it is handed (RunReadersHarness): payroll-db, set apart
 * by a label where a team reads every kind only for some labels, never
 * reaches the triage; checkout-api does. Before #9612 a triage read the
 * whole project as OneUptime, and these fail.
 *
 * The triage is posted on the case and its timeline alone, so the team's
 * labels narrow it only while somebody on the team may read security cases
 * (#9632) - as the harness's member does, through the Security team. A team
 * none of whose members may read cases sets nothing apart from it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
const RUN_ID: ObjectID = new ObjectID("13131313-1313-4131-8131-131313131313");
const CASE_ID: ObjectID = new ObjectID("14141414-1414-4141-8141-141414141414");
const DECLARED_INCIDENT_ID: ObjectID = new ObjectID(
  "15151515-1515-4151-8151-151515151515",
);

// What the triage writes: on the case, and on its timeline.
let written: Array<unknown>;
// The props each read of the starting context was made with.
let contextReads: Dictionary<Array<DatabaseCommonInteractionProps>>;

function narrowedReaders(named: Dictionary<Array<string>>): ReadAudience {
  return readAudienceOf({
    projectId: PROJECT_ID,
    labelledPermissions: [Permission.ProjectMember],
    named: { SecurityCase: [CASE_ID.toString()], ...named },
  });
}

function recordsRead(
  what: string,
  props: DatabaseCommonInteractionProps,
): void {
  contextReads[what] = [...(contextReads[what] || []), props];
}

// The case, as its readers' lookup and the context builder read it.
function theCase(data: {
  declaredIncident?: { isPrivate: boolean } | undefined;
}): void {
  jest
    .spyOn(SecurityCaseService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      props: DatabaseCommonInteractionProps;
    }): Promise<SecurityCase> => {
      recordsRead("case", findOneBy.props);
      const row: SecurityCase = new SecurityCase(CASE_ID);
      row.title = "Brute force against admin";
      row.caseNumberWithPrefix = "SC-7";
      row.entities = [];
      if (data.declaredIncident) {
        row.incidentId = DECLARED_INCIDENT_ID;
      }
      return row;
    }) as never);
  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation((async (): Promise<Incident> => {
      const row: Incident = new Incident(DECLARED_INCIDENT_ID);
      row.isPrivate = data.declaredIncident?.isPrivate === true;
      return row;
    }) as never);
  jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation((async (findOneById: {
      props: DatabaseCommonInteractionProps;
    }): Promise<Incident> => {
      recordsRead("declared incident", findOneById.props);
      const row: Incident = new Incident(DECLARED_INCIDENT_ID);
      row.title = "SC-7: Brute force against admin";
      return row;
    }) as never);
}

beforeEach(() => {
  written = [];
  contextReads = {};

  for (const level of ["debug", "warn", "error", "info"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  stubSecurityCaseValues();
  jest
    .spyOn(McpInvestigationTools, "forSecurityCase")
    .mockResolvedValue(null as never);
  jest
    .spyOn(SecurityDetectionService, "findBy")
    .mockImplementation((async (findBy: {
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<never>> => {
      recordsRead("detections", findBy.props);
      return [];
    }) as never);
  jest
    .spyOn(SecurityConnections, "forCase")
    .mockImplementation((async (forCase: {
      props: DatabaseCommonInteractionProps;
    }): Promise<null> => {
      recordsRead("connections", forCase.props);
      return null;
    }) as never);
  jest
    .spyOn(SecurityTelemetryMentions, "forCase")
    .mockImplementation((async (forCase: {
      props: DatabaseCommonInteractionProps;
    }): Promise<null> => {
      recordsRead("logs and traces", forCase.props);
      return null;
    }) as never);
  jest
    .spyOn(SecurityProtectedEntityService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(SecurityPlaybookService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(SecurityCaseNoteService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(SecurityCaseService, "updateOneById")
    .mockImplementation((async (update: { data: unknown }): Promise<void> => {
      written.push(update.data);
    }) as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (item: unknown): Promise<void> => {
      written.push(item);
    }) as never);
  jest
    .spyOn(SecurityPlaybookLauncher, "launchForCase")
    .mockResolvedValue(0 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function triage(): Promise<void> {
  await SecurityCaseTriageRunner.executeTriage({
    aiRunId: RUN_ID,
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
    attemptCount: 1,
  });
}

const ANSWER_TAIL: string = "Verdict: benign\nPriority: low\nPlaybook: none";

describe("a security case's triage, read for everyone who may see the case", () => {
  test("its tools read for the case's readers, with the case and the incident it declared named", async () => {
    readersOfAProject({ narrowedByLabels: true });
    theCase({ declaredIncident: { isPrivate: false } });
    const model: ModelReadingMonitors = modelReadsMonitors({
      answerTail: ANSWER_TAIL,
    });

    await triage();

    expect(model.toolProps).toEqual([
      readAudienceProps(
        narrowedReaders({ Incident: [DECLARED_INCIDENT_ID.toString()] }),
      ),
    ]);
  });

  test("its starting context reads for them too: the case, what its entities connect to, its logs and traces, its declared incident", async () => {
    readersOfAProject({ narrowedByLabels: true });
    theCase({ declaredIncident: { isPrivate: false } });
    modelReadsMonitors({ answerTail: ANSWER_TAIL });

    await triage();

    const props: DatabaseCommonInteractionProps = readAudienceProps(
      narrowedReaders({ Incident: [DECLARED_INCIDENT_ID.toString()] }),
    );

    for (const what of [
      "detections",
      "connections",
      "logs and traces",
      "declared incident",
    ]) {
      expect({ what, reads: contextReads[what] }).toEqual({
        what,
        reads: [props],
      });
    }
    // The readers' lookup reads the case as OneUptime; the context, for them.
    expect(contextReads["case"]).toEqual([{ isRoot: true }, props]);
  });

  test("a monitor set apart never reaches the triage on the case or its timeline; one nobody set apart does", async () => {
    readersOfAProject({ narrowedByLabels: true });
    theCase({});
    modelReadsMonitors({ answerTail: ANSWER_TAIL });

    await triage();

    expect(JSON.stringify(written)).toContain(OPEN_MONITOR_NAME);
    expect(JSON.stringify(written)).not.toContain(SET_APART_MONITOR_NAME);
  });

  test("a private declared incident is not named: its owners alone read it, whoever may see the case", async () => {
    readersOfAProject({ narrowedByLabels: true });
    theCase({ declaredIncident: { isPrivate: true } });
    const model: ModelReadingMonitors = modelReadsMonitors({
      answerTail: ANSWER_TAIL,
    });

    await triage();

    expect(model.toolProps).toEqual([readAudienceProps(narrowedReaders({}))]);
  });

  test("a project whose roles narrow nobody reads every monitor, as before", async () => {
    readersOfAProject({ narrowedByLabels: false });
    theCase({});
    modelReadsMonitors({ answerTail: ANSWER_TAIL });

    await triage();

    expect(JSON.stringify(written)).toContain(SET_APART_MONITOR_NAME);
    expect(JSON.stringify(written)).toContain(OPEN_MONITOR_NAME);
  });
});

describe("a security case's triage, narrowed only by what reaches somebody who may read the case (#9632)", () => {
  test("a team that reads every kind only for some labels, none of whose members may read security cases, sets no monitor apart from the triage", async () => {
    readersOfAProject({
      narrowedByLabels: true,
      narrowedTeamReadsSecurityCases: false,
    });
    theCase({});
    const model: ModelReadingMonitors = modelReadsMonitors({
      answerTail: ANSWER_TAIL,
    });

    await triage();

    // Nobody who may read the case reads any kind only by label.
    expect(model.toolProps).toEqual([
      readAudienceProps(
        readAudienceOf({
          projectId: PROJECT_ID,
          named: { SecurityCase: [CASE_ID.toString()] },
        }),
      ),
    ]);
    expect(JSON.stringify(written)).toContain(SET_APART_MONITOR_NAME);
    expect(JSON.stringify(written)).toContain(OPEN_MONITOR_NAME);
  });

  test("the same team narrows the triage again once somebody on it may read security cases: the monitor set apart never reaches the case or its timeline", async () => {
    readersOfAProject({
      narrowedByLabels: true,
      narrowedTeamReadsSecurityCases: true,
    });
    theCase({});
    modelReadsMonitors({ answerTail: ANSWER_TAIL });

    await triage();

    expect(JSON.stringify(written)).not.toContain(SET_APART_MONITOR_NAME);
    expect(JSON.stringify(written)).toContain(OPEN_MONITOR_NAME);
  });
});
