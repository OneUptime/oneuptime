import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getConnectionsMock: MockFunction = getJestMockFunction();
const getTelemetryMentionsMock: MockFunction = getJestMockFunction();
const getStoryMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getConnections: (...args: Array<unknown>) => {
          return getConnectionsMock(...args);
        },
        getTelemetryMentions: (...args: Array<unknown>) => {
          return getTelemetryMentionsMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseContextApi",
  () => {
    return {
      __esModule: true,
      default: {
        getStory: (...args: Array<unknown>) => {
          return getStoryMock(...args);
        },
      },
    };
  },
);

import ChangeEvent from "../../../Models/AnalyticsModels/ChangeEvent";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityCaseStoryItemKind,
  SecurityCaseStoryJson,
  SecurityCaseImpactJson,
} from "../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
  SecurityConnectionsJson,
} from "../../../Types/SecurityCase/SecurityConnection";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
} from "../../../Utils/Telemetry/ChangeEventFields";
import { getCloudChangeTitleText } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudChangesTable";
import {
  CHANGE_EVENT_MARKER_SUBTITLE,
  getChangeEventMarkerTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines";
import ConnectedSignals from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ConnectedSignals";
import {
  CONNECTED_SIGNALS_CASE_DESCRIPTION,
  SECURITY_CONNECTIONS_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsCopy";
import { parseSecurityConnections } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsModel";
import SecurityCaseStory from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseStory";
import {
  parseSecurityCaseImpact,
  parseSecurityCaseStory,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseContextModel";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { JSONObject } from "../../../Types/JSON";

/*
 * A cloud change's title, in the reader's language, wherever a change is
 * shown: a cloud resource's and an account's Changes (CloudChangesTable),
 * the markers on a resource's charts, the Security Connections card on a
 * case and on a resource's page, and a security case's story. Each words
 * it from the facts the change keeps - its operation, resource and outcome
 * - and a row written before the resource's name was kept from its English
 * title; a health event, a deploy or any other change keeps its own title.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6c";
const CASE_ID: string = "20000000-0000-4000-8000-000000000177";
const RESOURCE_ID: string = "30000000-0000-4000-8000-000000000071";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const [language, locale] of [
    ["en", englishLocale],
    ["de", germanLocale],
    ["fa", persianLocale],
  ] as Array<[string, Record<string, unknown>]>) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  getConnectionsMock.mockReset();
  getTelemetryMentionsMock.mockReset();
  getTelemetryMentionsMock.mockResolvedValue({
    windowStart: "2026-10-25T09:30:00.000Z",
    windowEnd: "2026-10-25T10:30:00.000Z",
    values: [],
    hasMoreValues: false,
    unreadableSignals: [],
    failedSignals: [],
  } as never);
  getStoryMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionGate, "check").mockImplementation(() => {
    return { isAllowed: true };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// A change event as the Changes list reads it.
function changeRow(data: {
  title: string;
  attributes: JSONObject;
  eventType?: string;
}): ChangeEvent {
  const row: ChangeEvent = new ChangeEvent();

  row.title = data.title;
  row.eventType = data.eventType || ChangeEventType.ConfigChange;
  row.attributes = data.attributes;

  return row;
}

const NEW_ROW: ChangeEvent = changeRow({
  title: "Failed: DeleteLoadBalancer on web-alb",
  attributes: {
    [ChangeEventAttribute.Source]: ChangeEventSource.Cloud,
    [ChangeEventAttribute.CloudOperation]: "DeleteLoadBalancer",
    [ChangeEventAttribute.Status]: ChangeEventStatus.Failed,
    [ChangeEventAttribute.CloudResourceName]: "web-alb",
  },
});

// Written before the resource's name was kept: its title is all it has.
const OLD_ROW: ChangeEvent = changeRow({
  title: "AuthorizeSecurityGroupIngress on sg-0f1e2d3c4b5a69788",
  attributes: {
    [ChangeEventAttribute.Source]: ChangeEventSource.Cloud,
    [ChangeEventAttribute.CloudOperation]: "AuthorizeSecurityGroupIngress",
    [ChangeEventAttribute.Status]: ChangeEventStatus.Succeeded,
  },
});

const HEALTH_ROW: ChangeEvent = changeRow({
  title: "AWS Health: EC2 operational issue (open)",
  eventType: ChangeEventType.ProviderEvent,
  attributes: {
    [ChangeEventAttribute.Source]: ChangeEventSource.CloudHealth,
    [ChangeEventAttribute.CloudOperation]: "AWS_EC2_OPERATIONAL_ISSUE",
  },
});

const DEPLOY_ROW: ChangeEvent = changeRow({
  title: "Deploy checkout 2.3.1",
  eventType: ChangeEventType.Deployment,
  attributes: { [ChangeEventAttribute.Source]: ChangeEventSource.Api },
});

describe("a cloud resource's and an account's Changes", () => {
  test("an operation reads in the reader's language", () => {
    expect(getCloudChangeTitleText(NEW_ROW, dashboardTranslator("de"))).toBe(
      "Fehlgeschlagen: DeleteLoadBalancer für web-alb",
    );
    expect(
      withoutIsolateMarks(
        getCloudChangeTitleText(NEW_ROW, dashboardTranslator("fa")),
      ),
    ).toBe("ناموفق: DeleteLoadBalancer روی web-alb");
    expect(getCloudChangeTitleText(NEW_ROW, dashboardTranslator("ja"))).toBe(
      "失敗: web-alb に対する DeleteLoadBalancer",
    );
  });

  test("a row written before the resource's name was kept reads in it too", () => {
    expect(getCloudChangeTitleText(OLD_ROW, dashboardTranslator("de"))).toBe(
      "AuthorizeSecurityGroupIngress für sg-0f1e2d3c4b5a69788",
    );
    expect(getCloudChangeTitleText(OLD_ROW, dashboardTranslator("fr"))).toBe(
      "AuthorizeSecurityGroupIngress sur sg-0f1e2d3c4b5a69788",
    );
  });

  test("in English it is word for word the title the change was stored with", () => {
    for (const row of [NEW_ROW, OLD_ROW]) {
      expect(getCloudChangeTitleText(row, dashboardTranslator("en"))).toBe(
        row.title,
      );
    }
  });

  test("a health event and a deploy keep their own titles", () => {
    expect(getCloudChangeTitleText(HEALTH_ROW, dashboardTranslator("de"))).toBe(
      "AWS Health: EC2 operational issue (open)",
    );
    expect(getCloudChangeTitleText(DEPLOY_ROW, dashboardTranslator("de"))).toBe(
      "Deploy checkout 2.3.1",
    );
  });
});

describe("the markers on a chart", () => {
  test("a cloud change's marker is worded from its facts", () => {
    expect(
      getChangeEventMarkerTitle(
        {
          title: NEW_ROW.title,
          attributes: NEW_ROW.attributes as JSONObject,
        },
        dashboardTranslator("de"),
      ),
    ).toBe("Fehlgeschlagen: DeleteLoadBalancer für web-alb");
  });

  test("any other change's marker keeps its title", () => {
    expect(
      getChangeEventMarkerTitle(
        {
          title: DEPLOY_ROW.title,
          attributes: DEPLOY_ROW.attributes as JSONObject,
        },
        dashboardTranslator("de"),
      ),
    ).toBe("Deploy checkout 2.3.1");
    expect(
      getChangeEventMarkerTitle({ title: undefined, attributes: undefined }),
    ).toBe("");
  });

  test("the line under a change marker reads in every language", () => {
    expect(CHANGE_EVENT_MARKER_SUBTITLE).toBe("Change event");

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        translated: words[CHANGE_EVENT_MARKER_SUBTITLE] !== "Change event",
      }).toEqual({ language, translated: true });
    }
  });
});

// A cloud resource the case names, with what changed on it.
function cloudResource(
  overrides: Partial<SecurityConnectedResourceJson> = {},
): SecurityConnectedResourceJson {
  return {
    kind: SecurityConnectionKind.CloudResource,
    id: RESOURCE_ID,
    name: "web-alb",
    certainty: SecurityConnectionCertainty.Exact,
    matches: [
      {
        entityType: "Host",
        entityValue: "web-alb-1234567890.us-east-1.elb.amazonaws.com",
        certainty: SecurityConnectionCertainty.Exact,
        reason: SecurityConnectionReason.CloudEndpoint,
        matchedValue: "web-alb-1234567890.us-east-1.elb.amazonaws.com",
      },
    ],
    activeIncidents: { count: 0, items: [] },
    activeAlerts: { count: 0, items: [] },
    monitors: null,
    recentChanges: [
      {
        id: "change-1",
        time: "2026-10-25T09:55:00.000Z",
        title: "Failed: DeleteLoadBalancer on web-alb",
        eventType: ChangeEventType.ConfigChange,
        cloudChange: {
          operation: "DeleteLoadBalancer",
          resource: "web-alb",
          failed: true,
        },
      },
      {
        id: "change-2",
        time: "2026-10-25T09:40:00.000Z",
        title: "AWS Health: EC2 operational issue (open)",
        eventType: ChangeEventType.ProviderEvent,
      },
    ],
    ...overrides,
  } as SecurityConnectedResourceJson;
}

function connections(): SecurityConnectionsJson {
  return {
    windowStart: "2026-10-25T09:30:00.000Z",
    windowEnd: "2026-10-25T10:30:00.000Z",
    resources: [cloudResource()],
    hasMoreResources: false,
    unmatched: [],
    unreadableKinds: [],
    failedKinds: [],
  };
}

describe("the Security Connections card", () => {
  test("keeps a change's facts as the server sent them", () => {
    const parsed: SecurityConnectionsJson = parseSecurityConnections(
      JSON.parse(JSON.stringify(connections())) as JSONObject,
    );

    expect(parsed.resources[0]!.recentChanges).toEqual([
      {
        id: "change-1",
        time: "2026-10-25T09:55:00.000Z",
        title: "Failed: DeleteLoadBalancer on web-alb",
        eventType: ChangeEventType.ConfigChange,
        cloudChange: {
          operation: "DeleteLoadBalancer",
          resource: "web-alb",
          failed: true,
        },
      },
      {
        id: "change-2",
        time: "2026-10-25T09:40:00.000Z",
        title: "AWS Health: EC2 operational issue (open)",
        eventType: ChangeEventType.ProviderEvent,
      },
    ]);
  });

  test("drops facts of another shape, keeping the change and its title", () => {
    const json: JSONObject = JSON.parse(
      JSON.stringify(connections()),
    ) as JSONObject;
    const resource: JSONObject = (json["resources"] as Array<JSONObject>)[0]!;
    const change: JSONObject = (
      resource["recentChanges"] as Array<JSONObject>
    )[0]!;

    change["cloudChange"] = { operation: 5, resource: "web-alb", failed: true };

    const parsed: SecurityConnectionsJson = parseSecurityConnections(json);
    const first: JSONObject = parsed.resources[0]!
      .recentChanges![0] as unknown as JSONObject;

    expect(first["cloudChange"]).toBeUndefined();
    expect(first["title"]).toBe("Failed: DeleteLoadBalancer on web-alb");
  });

  async function drawIn(language: string): Promise<void> {
    getConnectionsMock.mockResolvedValue(connections() as never);

    await act(async () => {
      render(
        <I18nextProvider i18n={instances[language]!}>
          <MemoryRouter>
            <ConnectedSignals
              request={{ caseId: new ObjectID(CASE_ID) }}
              requestKey={CASE_ID}
              description={CONNECTED_SIGNALS_CASE_DESCRIPTION}
            />
          </MemoryRouter>
        </I18nextProvider>,
      );
    });
  }

  function changeTitles(): Array<string> {
    return within(screen.getByTestId(SECURITY_CONNECTIONS_TEST_IDS.changes))
      .getAllByTestId(SECURITY_CONNECTIONS_TEST_IDS.factItem)
      .map((item: HTMLElement): string => {
        return withoutIsolateMarks(
          (item.querySelector("bdi")?.textContent || "").trim(),
        );
      });
  }

  test("a cloud change reads in German, a health event as its provider wrote it", async () => {
    await drawIn("de");

    expect(changeTitles()).toEqual([
      "Fehlgeschlagen: DeleteLoadBalancer für web-alb",
      "AWS Health: EC2 operational issue (open)",
    ]);
  });

  test("and in Persian", async () => {
    await drawIn("fa");

    expect(changeTitles()[0]).toBe("ناموفق: DeleteLoadBalancer روی web-alb");
  });

  test("and in English, as it was stored", async () => {
    await drawIn("en");

    expect(changeTitles()[0]).toBe("Failed: DeleteLoadBalancer on web-alb");
  });
});

function story(): SecurityCaseStoryJson {
  return {
    windowStart: "2026-10-25T09:30:00.000Z",
    windowEnd: "2026-10-25T10:30:00.000Z",
    items: [
      {
        key: "change:1",
        kind: SecurityCaseStoryItemKind.Change,
        time: "2026-10-25T09:55:00.000Z",
        title: "Failed: DeleteLoadBalancer on web-alb",
        stateName: ChangeEventType.ConfigChange,
        cloudChange: {
          operation: "DeleteLoadBalancer",
          resource: "web-alb",
          failed: true,
        },
        links: {
          resource: {
            kind: SecurityConnectionKind.CloudResource,
            id: RESOURCE_ID,
            name: "web-alb",
          },
        },
      },
    ],
    truncatedSources: [],
    unreadableSources: [],
    failedSources: [],
  };
}

describe("a security case's story", () => {
  test("keeps a change's facts as the server sent them", () => {
    const parsed: SecurityCaseStoryJson = parseSecurityCaseStory(
      JSON.parse(JSON.stringify(story())) as JSONObject,
    );

    expect(parsed.items[0]!.cloudChange).toEqual({
      operation: "DeleteLoadBalancer",
      resource: "web-alb",
      failed: true,
    });
  });

  test("a change without facts keeps only its title", () => {
    const json: JSONObject = JSON.parse(JSON.stringify(story())) as JSONObject;

    delete ((json["items"] as Array<JSONObject>)[0] as JSONObject)[
      "cloudChange"
    ];

    expect(parseSecurityCaseStory(json).items[0]!.cloudChange).toBeUndefined();
  });

  test("draws a cloud change in the reader's language", async () => {
    getStoryMock.mockResolvedValue(story() as never);

    await act(async () => {
      render(
        <I18nextProvider i18n={instances["de"]!}>
          <MemoryRouter>
            <SecurityCaseStory caseId={new ObjectID(CASE_ID)} />
          </MemoryRouter>
        </I18nextProvider>,
      );
    });

    expect(
      await screen.findByText("Fehlgeschlagen: DeleteLoadBalancer für web-alb"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Failed: DeleteLoadBalancer on web-alb"),
    ).not.toBeInTheDocument();
  });
});

describe("a security case's impact", () => {
  test("keeps the last change's facts as the server sent them", () => {
    const impact: SecurityCaseImpactJson = parseSecurityCaseImpact({
      records: [
        {
          kind: SecurityConnectionKind.CloudResource,
          id: RESOURCE_ID,
          name: "web-alb",
          certainty: SecurityConnectionCertainty.Exact,
          lastChange: {
            id: "change-1",
            time: "2026-10-25T09:55:00.000Z",
            title: "Failed: DeleteLoadBalancer on web-alb",
            eventType: ChangeEventType.ConfigChange,
            cloudChange: {
              operation: "DeleteLoadBalancer",
              resource: "web-alb",
              failed: true,
            },
            isBeforeFirstDetection: true,
          },
        },
      ],
    } as unknown as JSONObject);

    expect(impact.records[0]!.lastChange).toEqual({
      id: "change-1",
      time: "2026-10-25T09:55:00.000Z",
      title: "Failed: DeleteLoadBalancer on web-alb",
      eventType: ChangeEventType.ConfigChange,
      cloudChange: {
        operation: "DeleteLoadBalancer",
        resource: "web-alb",
        failed: true,
      },
      isBeforeFirstDetection: true,
    });
  });
});
