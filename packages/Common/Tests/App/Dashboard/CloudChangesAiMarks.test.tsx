import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ONEUPTIME AI'S CHANGES, MARKED ON A CLOUD ACCOUNT'S CHANGES (#5367's
 * follow-up).
 *
 * The cloud records a change OneUptime AI made under the Cloud AI agent's
 * role, so the account's Changes page read "oneuptime-ai-scale-out-..." in
 * its By column, like anyone's change. Its change event now says
 * OneUptime AI made it, and names its fix; the list:
 *
 *   - says OneUptime AI in the By column, with the role's session under it
 *     as the cloud's audit log names it;
 *   - under what changed, links the incident or alert it fixed (by its
 *     number when the reader may read the fix), says who approved it or
 *     that it ran on its own, and links its entry in the account's AI Logs
 *     (#fix-<id>, the entry the AI Logs page opens on);
 *   - on a phone, where the By column folds away, starts that line with
 *     OneUptime AI;
 *   - reads the fixes it names once, as the reader, so a fix the reader may
 *     not read names no number and no approver - and still marks the
 *     change, and links its AI Logs;
 *   - leaves a person's change exactly as it was.
 *
 * The real table is mounted (AnalyticsModelTable over BaseModelTable);
 * only the analytics and model APIs, the project, the viewer and the
 * words are stubbed.
 */

const analyticsGetListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
// The reader's words: English by default, a locale's when a test sets one.
let words: Record<string, string> = {};

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectMember"];
      },
      getProjectPermissions: (): {
        permissions: Array<{ permission: string }>;
      } => {
        return { permissions: [{ permission: "ProjectMember" }] };
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value === undefined ? value : words[value] || value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import CloudChangesTable from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudChangesTable";
import {
  CLOUD_CHANGE_AI_ACTOR_TEST_ID,
  CLOUD_CHANGE_AI_LINE_TEST_ID,
  CloudChangeAiActor,
  CloudChangeAiLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudChangeAi";
import {
  CLOUD_AI_CHANGE_SUBJECTS,
  CloudAiChangeFix,
  CloudAiChangeSubject,
  describeCloudAiChangeApproval,
  describeCloudAiChangeSubject,
  getCloudAiChangeLogsRoute,
  readCloudAiChangeFix,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiChangeWords";
import {
  CloudAiChange,
  getCloudAiChangeSuggestionIds,
  readCloudAiChange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudChangesScope";
import {
  getResourceAiLogsFixAnchor,
  readResourceAiLogsFixAnchor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiLogs";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ChangeEvent from "../../../Models/AnalyticsModels/ChangeEvent";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Email from "../../../Types/Email";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  CloudAiChangeStep,
} from "../../../Utils/Telemetry/ChangeEventFields";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ROW_ID: string = "22222222-2222-4222-8222-222222222222";
const SUGGESTION_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_SUGGESTION_ID: string = "33333333-3333-4333-8333-444444444444";
const JOB_ID: string = "55555555-5555-4555-8555-555555555555";
const INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";
const ALERT_ID: string = "77777777-7777-4777-8777-777777777777";
const SESSION: string = "oneuptime-ai-scale-out-1a2b3c4d";

const INCIDENT_ROUTE: string = `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`;
const AI_LOGS_ROUTE: string = `/dashboard/${PROJECT_ID}/cloud/accounts/${ACCOUNT_ROW_ID}/ai/logs`;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// The attributes of a change OneUptime AI made, as the recorder writes them.
function aiAttributes(overrides: JSONObject = {}): JSONObject {
  return {
    [ChangeEventAttribute.Source]: ChangeEventSource.Cloud,
    [ChangeEventAttribute.CloudActor]: SESSION,
    [ChangeEventAttribute.CloudAccountRecordId]: ACCOUNT_ROW_ID,
    [ChangeEventAttribute.MadeBy]: ChangeEventSource.OneUptimeAi,
    [ChangeEventAttribute.RunnerJobId]: JOB_ID,
    [ChangeEventAttribute.AutoRemediationSuggestionId]: SUGGESTION_ID,
    [ChangeEventAttribute.IncidentId]: INCIDENT_ID,
    [ChangeEventAttribute.AiStep]: CloudAiChangeStep.Fix,
    ...overrides,
  };
}

function aiChange(overrides: Partial<CloudAiChange> = {}): CloudAiChange {
  return {
    runnerJobId: JOB_ID,
    suggestionId: SUGGESTION_ID,
    incidentId: INCIDENT_ID,
    alertId: null,
    isRollback: false,
    cloudAccountId: ACCOUNT_ROW_ID,
    ...overrides,
  };
}

function fixOf(overrides: Partial<CloudAiChangeFix> = {}): CloudAiChangeFix {
  return {
    id: SUGGESTION_ID,
    status: AutoRemediationSuggestionStatus.Approved,
    approvedByName: "Maya Chen",
    incidentId: INCIDENT_ID,
    incidentNumber: "INC-42",
    alertId: null,
    alertNumber: null,
    ...overrides,
  };
}

function suggestionRow(overrides: {
  id?: string;
  status?: AutoRemediationSuggestionStatus;
  approver?: { name?: string; email?: string } | null;
  incident?: { number?: number; withPrefix?: string } | null;
  alert?: { number?: number; withPrefix?: string } | null;
}): AutoRemediationSuggestion {
  const row: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  row._id = overrides.id || SUGGESTION_ID;
  row.status = overrides.status || AutoRemediationSuggestionStatus.Approved;

  if (overrides.approver !== null) {
    const user: User = new User();
    if (overrides.approver?.name !== undefined || !overrides.approver) {
      user.name = new Name(overrides.approver?.name ?? "Maya Chen");
    }
    if (overrides.approver?.email) {
      user.email = new Email(overrides.approver.email);
    }
    row.approvedByUser = user;
  }

  if (overrides.incident !== null) {
    row.incidentId = new ObjectID(INCIDENT_ID);
    const incident: Incident = new Incident();
    if (overrides.incident?.number !== undefined) {
      incident.incidentNumber = overrides.incident.number;
    }
    incident.incidentNumberWithPrefix =
      overrides.incident?.withPrefix ??
      (overrides.incident?.number !== undefined ? undefined : "INC-42");
    row.incident = incident;
  }

  if (overrides.alert) {
    row.alertId = new ObjectID(ALERT_ID);
    const alert: Alert = new Alert();
    if (overrides.alert.number !== undefined) {
      alert.alertNumber = overrides.alert.number;
    }
    if (overrides.alert.withPrefix) {
      alert.alertNumberWithPrefix = overrides.alert.withPrefix;
    }
    row.alert = alert;
  }

  return row;
}

beforeEach(() => {
  words = {};
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which changes OneUptime AI made, as their events say", () => {
  test("a change it made: its job, its fix, the incident it fixed and its account", () => {
    expect(readCloudAiChange({ attributes: aiAttributes() })).toEqual({
      runnerJobId: JOB_ID,
      suggestionId: SUGGESTION_ID,
      incidentId: INCIDENT_ID,
      alertId: null,
      isRollback: false,
      cloudAccountId: ACCOUNT_ROW_ID,
    });
  });

  test("a rollback says so; an alert's fix names the alert", () => {
    expect(
      readCloudAiChange({
        attributes: aiAttributes({
          [ChangeEventAttribute.AiStep]: CloudAiChangeStep.Rollback,
          [ChangeEventAttribute.IncidentId]: undefined as never,
          [ChangeEventAttribute.AlertId]: ALERT_ID,
        }),
      }),
    ).toMatchObject({ isRollback: true, incidentId: null, alertId: ALERT_ID });
  });

  test("a change no job explained is still OneUptime AI's, naming nothing", () => {
    expect(
      readCloudAiChange({
        attributes: {
          [ChangeEventAttribute.MadeBy]: ChangeEventSource.OneUptimeAi,
        },
      }),
    ).toEqual({
      runnerJobId: null,
      suggestionId: null,
      incidentId: null,
      alertId: null,
      isRollback: false,
      cloudAccountId: null,
    });
  });

  test("a person's change, a health event and no attributes at all are nobody's but the cloud's", () => {
    expect(
      readCloudAiChange({
        attributes: {
          [ChangeEventAttribute.Source]: ChangeEventSource.Cloud,
          [ChangeEventAttribute.CloudActor]: "maya.lopez",
        },
      }),
    ).toBeNull();
    expect(
      readCloudAiChange({
        attributes: {
          [ChangeEventAttribute.Source]: ChangeEventSource.CloudHealth,
        },
      }),
    ).toBeNull();
    expect(readCloudAiChange({})).toBeNull();
    // Only OneUptime AI's own mark counts.
    expect(
      readCloudAiChange({
        attributes: { [ChangeEventAttribute.MadeBy]: "someone-else" },
      }),
    ).toBeNull();
  });

  test("ids that are not ids name nothing, and are read lowercased", () => {
    expect(
      readCloudAiChange({
        attributes: aiAttributes({
          [ChangeEventAttribute.AutoRemediationSuggestionId]: "not-an-id",
          [ChangeEventAttribute.IncidentId]: INCIDENT_ID.toUpperCase(),
        }),
      }),
    ).toMatchObject({ suggestionId: null, incidentId: INCIDENT_ID });
  });

  test("a page's fixes, each once, of OneUptime AI's changes only", () => {
    expect(
      getCloudAiChangeSuggestionIds([
        { attributes: aiAttributes() },
        { attributes: aiAttributes() },
        {
          attributes: aiAttributes({
            [ChangeEventAttribute.AutoRemediationSuggestionId]:
              OTHER_SUGGESTION_ID,
          }),
        },
        // A person's change naming a fix id is still a person's.
        {
          attributes: {
            [ChangeEventAttribute.AutoRemediationSuggestionId]: SUGGESTION_ID,
          },
        },
        { attributes: undefined },
      ]),
    ).toEqual([SUGGESTION_ID, OTHER_SUGGESTION_ID]);
  });
});

describe("a fix, as the reader read it", () => {
  test("its approver, by name or by email, and the number of what it fixed, with its prefix or plain", () => {
    expect(readCloudAiChangeFix(suggestionRow({}))).toEqual({
      id: SUGGESTION_ID,
      status: AutoRemediationSuggestionStatus.Approved,
      approvedByName: "Maya Chen",
      incidentId: INCIDENT_ID,
      incidentNumber: "INC-42",
      alertId: null,
      alertNumber: null,
    });
    expect(
      readCloudAiChangeFix(
        suggestionRow({
          approver: { email: "maya@example.com" },
          incident: { number: 42 },
        }),
      ),
    ).toMatchObject({
      approvedByName: "maya@example.com",
      incidentNumber: "#42",
    });
    expect(
      readCloudAiChangeFix(
        suggestionRow({
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          approver: null,
          incident: null,
          alert: { withPrefix: "ALT-7" },
        }),
      ),
    ).toMatchObject({
      approvedByName: null,
      incidentId: null,
      incidentNumber: null,
      alertId: ALERT_ID,
      alertNumber: "ALT-7",
    });
  });

  test("a row without an id is no fix", () => {
    const row: AutoRemediationSuggestion = new AutoRemediationSuggestion();
    expect(readCloudAiChangeFix(row)).toBeNull();
  });
});

describe("the words of a change OneUptime AI made", () => {
  test("the incident it fixed, by its number once the reader read the fix", () => {
    const subject: CloudAiChangeSubject | null = describeCloudAiChangeSubject({
      change: aiChange(),
      fix: fixOf(),
    });

    expect(subject).toEqual({
      kind: "incident",
      recordId: INCIDENT_ID,
      template: CLOUD_AI_CHANGE_SUBJECTS.fix.incident,
      values: { number: "INC-42" },
    });
  });

  test("without the fix read (or not readable), the incident still, without its number", () => {
    expect(
      describeCloudAiChangeSubject({ change: aiChange(), fix: null }),
    ).toEqual({
      kind: "incident",
      recordId: INCIDENT_ID,
      template: CLOUD_AI_CHANGE_SUBJECTS.fix.anIncident,
      values: {},
    });
  });

  test("a fix that names another incident never lends its number", () => {
    expect(
      describeCloudAiChangeSubject({
        change: aiChange(),
        fix: fixOf({ incidentId: "99999999-9999-4999-8999-999999999999" }),
      })?.template,
    ).toBe(CLOUD_AI_CHANGE_SUBJECTS.fix.anIncident);
  });

  test("an alert, and a rollback, by their own phrases", () => {
    expect(
      describeCloudAiChangeSubject({
        change: aiChange({ incidentId: null, alertId: ALERT_ID }),
        fix: fixOf({
          incidentId: null,
          alertId: ALERT_ID,
          alertNumber: "ALT-7",
        }),
      }),
    ).toEqual({
      kind: "alert",
      recordId: ALERT_ID,
      template: CLOUD_AI_CHANGE_SUBJECTS.fix.alert,
      values: { number: "ALT-7" },
    });
    expect(
      describeCloudAiChangeSubject({
        change: aiChange({ isRollback: true }),
        fix: fixOf(),
      })?.template,
    ).toBe(CLOUD_AI_CHANGE_SUBJECTS.rollback.incident);
    expect(
      describeCloudAiChangeSubject({
        change: aiChange({
          isRollback: true,
          incidentId: null,
          alertId: ALERT_ID,
        }),
        fix: null,
      })?.template,
    ).toBe(CLOUD_AI_CHANGE_SUBJECTS.rollback.anAlert);
  });

  test("the record from the fix when the change names none; nothing when neither does", () => {
    expect(
      describeCloudAiChangeSubject({
        change: aiChange({ incidentId: null }),
        fix: fixOf(),
      })?.recordId,
    ).toBe(INCIDENT_ID);
    expect(
      describeCloudAiChangeSubject({
        change: aiChange({ incidentId: null, suggestionId: null }),
        fix: null,
      }),
    ).toBeNull();
  });

  test("who approved it, or that it ran on its own; nothing for any other fix", () => {
    expect(describeCloudAiChangeApproval(fixOf())).toEqual({
      template: "Approved by {{name}}",
      name: "Maya Chen",
    });
    expect(
      describeCloudAiChangeApproval(
        fixOf({
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          approvedByName: null,
        }),
      ),
    ).toEqual({ template: "Applied automatically", name: null });
    expect(
      describeCloudAiChangeApproval(
        fixOf({ status: AutoRemediationSuggestionStatus.Suggested }),
      ),
    ).toBeNull();
    expect(
      describeCloudAiChangeApproval(fixOf({ approvedByName: null })),
    ).toBeNull();
    expect(describeCloudAiChangeApproval(null)).toBeNull();
  });

  test("its AI Logs entry: the account's AI Logs, at the fix's own anchor", () => {
    const logs: Route = new Route(AI_LOGS_ROUTE);

    expect(
      getCloudAiChangeLogsRoute({
        aiLogsRoute: logs,
        suggestionId: SUGGESTION_ID,
      })?.toString(),
    ).toBe(`${AI_LOGS_ROUTE}#fix-${SUGGESTION_ID}`);
    expect(
      getCloudAiChangeLogsRoute({
        aiLogsRoute: logs,
        suggestionId: null,
      })?.toString(),
    ).toBe(AI_LOGS_ROUTE);
    expect(
      getCloudAiChangeLogsRoute({
        aiLogsRoute: logs,
        suggestionId: "not-an-id",
      })?.toString(),
    ).toBe(AI_LOGS_ROUTE);
    expect(
      getCloudAiChangeLogsRoute({
        aiLogsRoute: null,
        suggestionId: SUGGESTION_ID,
      }),
    ).toBeNull();
  });

  test("the anchor the AI Logs page reads back is the one the list writes", () => {
    expect(getResourceAiLogsFixAnchor(SUGGESTION_ID.toUpperCase())).toBe(
      `fix-${SUGGESTION_ID}`,
    );
    expect(readResourceAiLogsFixAnchor(`#fix-${SUGGESTION_ID}`)).toBe(
      SUGGESTION_ID,
    );
    expect(
      readResourceAiLogsFixAnchor(`fix-${SUGGESTION_ID.toUpperCase()}`),
    ).toBe(SUGGESTION_ID);
    expect(readResourceAiLogsFixAnchor("#commands")).toBeNull();
    expect(readResourceAiLogsFixAnchor("#fix-")).toBeNull();
    expect(readResourceAiLogsFixAnchor("")).toBeNull();
  });
});

describe("the line under a change OneUptime AI made", () => {
  function renderLine(props: {
    change?: CloudAiChange;
    fix?: CloudAiChangeFix | null;
    cloudAccountId?: string | null;
  }): HTMLElement {
    render(
      <MemoryRouter>
        <CloudChangeAiLine
          change={props.change || aiChange()}
          fix={props.fix === undefined ? fixOf() : props.fix}
          cloudAccountId={
            props.cloudAccountId === undefined
              ? ACCOUNT_ROW_ID
              : props.cloudAccountId
          }
        />
      </MemoryRouter>,
    );

    return screen.getByTestId(CLOUD_CHANGE_AI_LINE_TEST_ID);
  }

  test("links the incident it fixed by its number, says who approved it, and links its AI Logs entry", () => {
    const line: HTMLElement = renderLine({});

    const subject: HTMLElement = within(line).getByTestId(
      `${CLOUD_CHANGE_AI_LINE_TEST_ID}-incident`,
    );
    expect(subject).toHaveTextContent("Fix for incident INC-42");
    expect(subject.closest("a")).toHaveAttribute("href", INCIDENT_ROUTE);

    const approval: HTMLElement = within(line).getByTestId(
      `${CLOUD_CHANGE_AI_LINE_TEST_ID}-approval`,
    );
    expect(approval).toHaveTextContent("Approved by Maya Chen");
    // The approver stands out of the sentence.
    expect(within(approval).getByText("Maya Chen")).toHaveClass("font-medium");

    const logs: HTMLElement = within(line).getByTestId(
      `${CLOUD_CHANGE_AI_LINE_TEST_ID}-logs`,
    );
    expect(logs).toHaveTextContent("AI Logs");
    expect(logs.closest("a")).toHaveAttribute(
      "href",
      `${AI_LOGS_ROUTE}#fix-${SUGGESTION_ID}`,
    );
  });

  test("on a phone it starts with OneUptime AI, hidden once the By column shows it", () => {
    const line: HTMLElement = renderLine({});
    const mark: HTMLElement = within(line).getByTestId(
      `${CLOUD_CHANGE_AI_LINE_TEST_ID}-mark`,
    );

    expect(mark).toHaveTextContent("OneUptime AI");
    expect(mark).toHaveClass("md:hidden");
    // Its sparkles are decoration, its separators too.
    expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    for (const dot of within(line).getAllByText("·")) {
      expect(dot).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("the facts read in order, a dot between each", () => {
    const line: HTMLElement = renderLine({});

    expect(line.textContent).toBe(
      "OneUptime AI·Fix for incident INC-42·Approved by Maya Chen·AI Logs",
    );
  });

  test("a fix that ran on its own says so", () => {
    const line: HTMLElement = renderLine({
      fix: fixOf({
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        approvedByName: null,
      }),
    });

    expect(
      within(line).getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-approval`),
    ).toHaveTextContent("Applied automatically");
  });

  test("a fix the reader may not read: still the incident, unnumbered, and the AI Logs; no approver", () => {
    const line: HTMLElement = renderLine({ fix: null });

    expect(
      within(line).getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-incident`),
    ).toHaveTextContent("Fix for an incident");
    expect(
      within(line).queryByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-approval`),
    ).toBeNull();
    expect(
      within(line).getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-logs`),
    ).toBeInTheDocument();
  });

  test("an alert's rollback links the alert", () => {
    const line: HTMLElement = renderLine({
      change: aiChange({
        isRollback: true,
        incidentId: null,
        alertId: ALERT_ID,
      }),
      fix: fixOf({ incidentId: null, alertId: ALERT_ID, alertNumber: "ALT-7" }),
    });
    const subject: HTMLElement = within(line).getByTestId(
      `${CLOUD_CHANGE_AI_LINE_TEST_ID}-alert`,
    );

    expect(subject).toHaveTextContent("Rollback of the fix for alert ALT-7");
    expect(subject.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`,
    );
  });

  test("a change no job explained: OneUptime AI, and its account's AI Logs", () => {
    const line: HTMLElement = renderLine({
      change: aiChange({
        runnerJobId: null,
        suggestionId: null,
        incidentId: null,
      }),
      fix: null,
    });

    expect(line.textContent).toBe("OneUptime AI·AI Logs");
    expect(
      within(line)
        .getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-logs`)
        .closest("a"),
    ).toHaveAttribute("href", AI_LOGS_ROUTE);
  });

  test("a resource's Changes links the AI Logs of the account each change was made in", () => {
    const line: HTMLElement = renderLine({ cloudAccountId: null });

    expect(
      within(line)
        .getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-logs`)
        .closest("a"),
    ).toHaveAttribute("href", `${AI_LOGS_ROUTE}#fix-${SUGGESTION_ID}`);
  });

  test("with no account to name, no AI Logs link", () => {
    const line: HTMLElement = renderLine({
      change: aiChange({ cloudAccountId: null }),
      cloudAccountId: null,
    });

    expect(
      within(line).queryByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-logs`),
    ).toBeNull();
  });

  test.each(["de", "fa"])(
    "in %s, every phrase is the locale's own",
    (language: string) => {
      words = locale(language);

      const line: HTMLElement = renderLine({});
      const own: Record<string, string> = locale(language);

      expect(line).toHaveTextContent(
        own["Fix for incident {{number}}"]!.replace("{{number}}", "INC-42"),
      );
      expect(line).toHaveTextContent(own["AI Logs"]!);
      expect(line).not.toHaveTextContent("Fix for incident");
      expect(line).not.toHaveTextContent("Approved by");

      // The approver's sentence is the locale's, with the name as written.
      const approval: HTMLElement = within(line).getByTestId(
        `${CLOUD_CHANGE_AI_LINE_TEST_ID}-approval`,
      );
      expect(approval).toHaveTextContent("Maya Chen");
      for (const part of own["Approved by {{name}}"]!.split("{{name}}")) {
        if (part.trim()) {
          expect(approval).toHaveTextContent(part.trim());
        }
      }
    },
  );

  test.each(["de", "fa"])(
    "in %s, a rollback and a fix that ran on its own say so in the locale's words",
    (language: string) => {
      words = locale(language);
      const own: Record<string, string> = locale(language);

      const line: HTMLElement = renderLine({
        change: aiChange({
          incidentId: null,
          alertId: ALERT_ID,
          isRollback: true,
        }),
        fix: fixOf({
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          approvedByName: null,
          incidentId: null,
          incidentNumber: null,
          alertId: ALERT_ID,
          alertNumber: "ALT-7",
        }),
      });

      expect(
        within(line).getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-alert`),
      ).toHaveTextContent(
        own["Rollback of the fix for alert {{number}}"]!.replace(
          "{{number}}",
          "ALT-7",
        ),
      );
      expect(
        within(line).getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-approval`),
      ).toHaveTextContent(own["Applied automatically"]!);
      expect(line).not.toHaveTextContent("Rollback of");
      expect(line).not.toHaveTextContent("Applied automatically");
    },
  );
});

describe("the By column of a change OneUptime AI made", () => {
  test("OneUptime AI, with the session the cloud's audit log names under it, whole on hover", () => {
    render(<CloudChangeAiActor actor={SESSION} />);

    const actor: HTMLElement = screen.getByTestId(
      CLOUD_CHANGE_AI_ACTOR_TEST_ID,
    );

    expect(actor).toHaveTextContent("OneUptime AI");
    const session: HTMLElement = within(actor).getByTestId(
      `${CLOUD_CHANGE_AI_ACTOR_TEST_ID}-session`,
    );
    expect(session).toHaveTextContent(SESSION);
    expect(session).toHaveAttribute("title", SESSION);
    expect(session).toHaveClass("truncate");
  });

  test("with no session named, OneUptime AI alone", () => {
    render(<CloudChangeAiActor actor="" />);

    expect(
      screen.queryByTestId(`${CLOUD_CHANGE_AI_ACTOR_TEST_ID}-session`),
    ).toBeNull();
  });
});

describe("an account's Changes, with OneUptime AI's change beside a person's", () => {
  const AI_ROW: JSONObject = {
    _id: "70000000-0000-4000-8000-000000000001",
    time: "2026-11-03T10:00:00.000Z",
    eventType: "deployment",
    title: "ecs:UpdateService on checkout-api",
    description: `${SESSION} ran ecs:UpdateService in account 123456789012 (us-east-1).`,
    attributes: {
      ...aiAttributes(),
      [ChangeEventAttribute.Status]: "succeeded",
      [ChangeEventAttribute.CloudRegion]: "us-east-1",
    } as JSONValue,
  };
  const PERSON_ROW: JSONObject = {
    _id: "70000000-0000-4000-8000-000000000002",
    time: "2026-11-03T10:01:00.000Z",
    eventType: "config-change",
    title: "ecs:UpdateService on checkout-api (by hand)",
    description:
      "maya.lopez ran ecs:UpdateService in account 123456789012 (us-east-1).",
    attributes: {
      [ChangeEventAttribute.Source]: ChangeEventSource.Cloud,
      [ChangeEventAttribute.Status]: "succeeded",
      [ChangeEventAttribute.CloudActor]: "maya.lopez",
      [ChangeEventAttribute.CloudRegion]: "us-east-1",
      [ChangeEventAttribute.CloudAccountRecordId]: ACCOUNT_ROW_ID,
    } as JSONValue,
  };

  let suggestionReads: Array<JSONObject>;
  let suggestionAnswer: () => Promise<ListResult<AutoRemediationSuggestion>>;

  beforeEach(() => {
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    analyticsGetListMock.mockImplementation(
      async (): Promise<ListResult<ChangeEvent>> => {
        const data: Array<ChangeEvent> =
          AnalyticsBaseModel.fromJSONArray<ChangeEvent>(
            [AI_ROW, PERSON_ROW],
            ChangeEvent,
          );
        return { data, count: data.length, skip: 0, limit: data.length };
      },
    );

    suggestionReads = [];
    suggestionAnswer = async (): Promise<
      ListResult<AutoRemediationSuggestion>
    > => {
      return { data: [suggestionRow({})], count: 1, skip: 0, limit: 1 };
    };
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      request: JSONObject,
    ) => {
      if (request["modelType"] === AutoRemediationSuggestion) {
        suggestionReads.push(request);
        return await suggestionAnswer();
      }
      return { data: [], count: 0, skip: 0, limit: 0 };
    }) as never);
  });

  async function mountChanges(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <CloudChangesTable
            id="cloud-account-changes-table"
            scope={{ cloudAccountId: new ObjectID(ACCOUNT_ROW_ID) }}
            showRegion={true}
            description="What changed in this account."
            noItemsMessage="No changes recorded for this account yet."
          />
        </MemoryRouter>,
      );
    });
    await screen.findByText(
      "ecs:UpdateService on checkout-api (by hand)",
      {},
      { timeout: 10000 },
    );
  }

  function rowOf(text: string): HTMLElement {
    return screen.getByText(text).closest("tr") as HTMLElement;
  }

  test("OneUptime AI's change says so and links its fix; the person's is as it was", async () => {
    await mountChanges();

    await waitFor(() => {
      expect(
        screen.getByTestId(CLOUD_CHANGE_AI_LINE_TEST_ID),
      ).toHaveTextContent("Approved by Maya Chen");
    });

    const ai: HTMLElement = rowOf("ecs:UpdateService on checkout-api");
    expect(
      within(ai).getByTestId(CLOUD_CHANGE_AI_ACTOR_TEST_ID),
    ).toHaveTextContent("OneUptime AI");
    expect(
      within(ai).getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-incident`),
    ).toHaveTextContent("Fix for incident INC-42");
    expect(within(ai).queryByTestId("cloud-change-actor")).toBeNull();

    const person: HTMLElement = rowOf(
      "ecs:UpdateService on checkout-api (by hand)",
    );
    expect(within(person).getByTestId("cloud-change-actor")).toHaveTextContent(
      "maya.lopez",
    );
    expect(
      within(person).queryByTestId(CLOUD_CHANGE_AI_LINE_TEST_ID),
    ).toBeNull();
    expect(
      within(person).queryByTestId(CLOUD_CHANGE_AI_ACTOR_TEST_ID),
    ).toBeNull();
    expect(within(person).queryByText("OneUptime AI")).toBeNull();
  });

  test("reads the fixes the page names once, as the reader, with who approved them and what they fixed", async () => {
    await mountChanges();

    await waitFor(() => {
      expect(suggestionReads).toHaveLength(1);
    });

    const request: JSONObject = suggestionReads[0]!;
    const query: { _id: Includes } = request["query"] as never;

    expect(query._id).toBeInstanceOf(Includes);
    expect(query._id.values.map(String)).toEqual([SUGGESTION_ID]);
    expect(request["select"]).toMatchObject({
      status: true,
      incidentId: true,
      alertId: true,
      approvedByUser: { name: true, email: true },
      incident: { incidentNumber: true, incidentNumberWithPrefix: true },
      alert: { alertNumber: true, alertNumberWithPrefix: true },
    });
  });

  test("a reader who may not read the fixes still sees which change OneUptime AI made, and where its AI Logs are", async () => {
    suggestionAnswer = async (): Promise<
      ListResult<AutoRemediationSuggestion>
    > => {
      throw new Error("You do not have permission to read this.");
    };

    await mountChanges();
    await waitFor(() => {
      expect(suggestionReads).toHaveLength(1);
    });

    const line: HTMLElement = screen.getByTestId(CLOUD_CHANGE_AI_LINE_TEST_ID);
    expect(line).toHaveTextContent("Fix for an incident");
    expect(line).not.toHaveTextContent("Approved by");
    expect(
      within(line)
        .getByTestId(`${CLOUD_CHANGE_AI_LINE_TEST_ID}-logs`)
        .closest("a"),
    ).toHaveAttribute("href", `${AI_LOGS_ROUTE}#fix-${SUGGESTION_ID}`);
  });

  test("a page with no change of OneUptime AI's reads no fix", async () => {
    analyticsGetListMock.mockImplementation(
      async (): Promise<ListResult<ChangeEvent>> => {
        const data: Array<ChangeEvent> =
          AnalyticsBaseModel.fromJSONArray<ChangeEvent>(
            [PERSON_ROW],
            ChangeEvent,
          );
        return { data, count: 1, skip: 0, limit: 1 };
      },
    );

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudChangesTable
            id="cloud-account-changes-table"
            scope={{ cloudAccountId: new ObjectID(ACCOUNT_ROW_ID) }}
            description="What changed in this account."
            noItemsMessage="No changes recorded for this account yet."
          />
        </MemoryRouter>,
      );
    });
    await screen.findByText(
      "ecs:UpdateService on checkout-api (by hand)",
      {},
      { timeout: 10000 },
    );

    expect(suggestionReads).toHaveLength(0);
    expect(screen.queryByTestId(CLOUD_CHANGE_AI_LINE_TEST_ID)).toBeNull();
  });
});
