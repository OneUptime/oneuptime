import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The rules behind the Owners field of the create forms (Dashboard
 * Components/OwnersOnCreate): the event as the preview asks about it, which
 * rules are worth a line and whom each line names, which of the creator's
 * teams are offered, what the field says to someone OneUptime makes an
 * owner and to a master admin, whom it does not, and where the preview is
 * asked - each event's route, written out so the tenant-header sweep can
 * see it, and the same route the server registers.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

import {
  addTeamsToPicked,
  getNobodyPickedText,
  getOwnerRulePreviewDraft,
  getOwnerRulePreviewRequestKey,
  getOwnerRulesToShow,
  getOwnersNewFromRule,
  getOwnersOnCreateDescription,
  getTeamsToSuggest,
  isCreatorMadeOwner,
  MyTeam,
  OWNER_RULE_ADDS_NOBODY_NEW,
  OWNERS_ON_CREATE_ADD_DESCRIPTION,
  OWNERS_ON_CREATE_DESCRIPTIONS,
  OWNERS_SUMMARY_NOBODY_ELSE_PICKED,
  OWNERS_SUMMARY_NOBODY_PICKED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OwnersOnCreate/OwnersOnCreateRules";
import { fetchOwnerRulePreview } from "../../../../App/FeatureSet/Dashboard/src/Components/OwnersOnCreate/OwnerRulePreviewApi";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OwnerRulePreview, {
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
  OwnerRulePreviewRule,
} from "../../../Types/Rules/OwnerRulePreview";

const SEVERITY: string = "a0000000-0000-4000-8000-000000000001";
const LABEL_A: string = "a0000000-0000-4000-8000-000000000002";
const LABEL_B: string = "a0000000-0000-4000-8000-000000000003";
const MONITOR_A: string = "a0000000-0000-4000-8000-000000000004";
const MONITOR_B: string = "a0000000-0000-4000-8000-000000000005";
const HOST: string = "a0000000-0000-4000-8000-000000000006";
const SERVICE: string = "a0000000-0000-4000-8000-000000000007";
const PLATFORM: string = "b0000000-0000-4000-8000-000000000001";
const SRE: string = "b0000000-0000-4000-8000-000000000002";
const PAYMENTS: string = "b0000000-0000-4000-8000-000000000003";
const CREATOR: string = "d0000000-0000-4000-8000-000000000001";
const GRACE: string = "d0000000-0000-4000-8000-000000000002";
const LINUS: string = "d0000000-0000-4000-8000-000000000003";

const EVENTS: Array<OwnerRulePreviewEvent> = [
  OwnerRulePreviewEvent.Incident,
  OwnerRulePreviewEvent.Alert,
  OwnerRulePreviewEvent.IncidentEpisode,
  OwnerRulePreviewEvent.AlertEpisode,
];

describe("the event a create form holds, as the preview asks about it", () => {
  test("an incident: its text, severity, labels, monitors and other resources, in any shape the form keeps them", () => {
    const draft: OwnerRulePreviewDraft = getOwnerRulePreviewDraft(
      OwnerRulePreviewEvent.Incident,
      {
        title: "Checkout is down",
        description: "500s on /pay",
        incidentSeverity: { _id: SEVERITY, name: "Critical" },
        labels: [LABEL_A, new ObjectID(LABEL_B)],
        monitors: [{ value: MONITOR_A, label: "API" }, { _id: MONITOR_B }],
        hosts: [HOST.toUpperCase()],
        services: [SERVICE, SERVICE],
        // Not what an incident is matched on.
        alertSeverity: SEVERITY,
        monitor: MONITOR_A,
      },
    );

    expect(draft).toEqual({
      ...OwnerRulePreview.emptyDraft(),
      title: "Checkout is down",
      description: "500s on /pay",
      severityId: SEVERITY,
      labelIds: [LABEL_A, LABEL_B],
      monitorIds: [MONITOR_A, MONITOR_B],
      hostIds: [HOST],
      serviceIds: [SERVICE],
    });
  });

  test("an alert: its severity and its one monitor", () => {
    const draft: OwnerRulePreviewDraft = getOwnerRulePreviewDraft(
      OwnerRulePreviewEvent.Alert,
      {
        title: "CPU high",
        alertSeverity: SEVERITY,
        monitor: { _id: MONITOR_A },
        monitors: [MONITOR_B],
      },
    );

    expect(draft.severityId).toBe(SEVERITY);
    expect(draft.monitorIds).toEqual([MONITOR_A]);
  });

  test("an episode: its text, severity and labels - it has no monitors", () => {
    for (const [event, severityKey] of [
      [OwnerRulePreviewEvent.IncidentEpisode, "incidentSeverity"],
      [OwnerRulePreviewEvent.AlertEpisode, "alertSeverity"],
    ] as Array<[OwnerRulePreviewEvent, string]>) {
      expect(
        getOwnerRulePreviewDraft(event, {
          title: "Payments",
          [severityKey]: SEVERITY,
          labels: [LABEL_A],
          monitors: [MONITOR_A],
          hosts: [HOST],
        }),
      ).toEqual({
        ...OwnerRulePreview.emptyDraft(),
        title: "Payments",
        severityId: SEVERITY,
        labelIds: [LABEL_A],
      });
    }
  });

  test("nothing filled in is an empty draft", () => {
    for (const event of EVENTS) {
      expect(getOwnerRulePreviewDraft(event, undefined)).toEqual(
        OwnerRulePreview.emptyDraft(),
      );
      expect(getOwnerRulePreviewDraft(event, { title: 12 })).toEqual(
        OwnerRulePreview.emptyDraft(),
      );
    }
  });

  test("is asked about once, whatever order its ids were picked in", () => {
    const one: OwnerRulePreviewDraft = {
      ...OwnerRulePreview.emptyDraft(),
      labelIds: [LABEL_A, LABEL_B],
      monitorIds: [MONITOR_B, MONITOR_A],
    };
    const other: OwnerRulePreviewDraft = {
      ...OwnerRulePreview.emptyDraft(),
      labelIds: [LABEL_B, LABEL_A],
      monitorIds: [MONITOR_A, MONITOR_B],
    };

    expect(getOwnerRulePreviewRequestKey(one)).toBe(
      getOwnerRulePreviewRequestKey(other),
    );
    expect(getOwnerRulePreviewRequestKey(one)).not.toBe(
      getOwnerRulePreviewRequestKey({ ...one, title: "Another" }),
    );
  });
});

describe("the owner rules worth a line", () => {
  function rule(fields: Partial<OwnerRulePreviewRule>): OwnerRulePreviewRule {
    return {
      ruleId: "c0000000-0000-4000-8000-000000000001",
      ruleName: "Platform owns checkout",
      userIds: [],
      teamIds: [],
      creatorTeamIds: [],
      notifiesOwners: true,
      ...fields,
    };
  }

  test("are each rule that adds someone, in the order they run", () => {
    const named: OwnerRulePreviewRule = rule({ teamIds: [PLATFORM] });
    const nobody: OwnerRulePreviewRule = rule({ ruleName: "Nobody here" });
    const people: OwnerRulePreviewRule = rule({ userIds: ["u-1"] });

    expect(getOwnerRulesToShow([named, nobody, people])).toEqual([
      named,
      people,
    ]);
    expect(getOwnerRulesToShow([])).toEqual([]);
  });
});

describe("whom a rule's line on the review names", () => {
  const RULE: OwnerRulePreviewRule = {
    ruleId: "c0000000-0000-4000-8000-000000000002",
    ruleName: "Checkout owners",
    userIds: [CREATOR, GRACE, LINUS],
    teamIds: [PLATFORM, SRE],
    creatorTeamIds: [PLATFORM],
    notifiesOwners: true,
  };

  test("with nobody picked and no creator made an owner, everyone the rule adds, in its order", () => {
    expect(
      getOwnersNewFromRule({
        rule: RULE,
        pickedUserIds: undefined,
        pickedTeamIds: undefined,
        creatorUserId: null,
      }),
    ).toEqual({
      userIds: [CREATOR, GRACE, LINUS],
      teamIds: [PLATFORM, SRE],
    });
  });

  test("leaves out the people and teams picked - they are owners already", () => {
    expect(
      getOwnersNewFromRule({
        rule: RULE,
        pickedUserIds: [GRACE],
        pickedTeamIds: [SRE],
        creatorUserId: null,
      }),
    ).toEqual({
      userIds: [CREATOR, LINUS],
      teamIds: [PLATFORM],
    });
  });

  test("leaves out the person creating it when OneUptime makes them an owner", () => {
    expect(
      getOwnersNewFromRule({
        rule: RULE,
        pickedUserIds: [],
        pickedTeamIds: [],
        creatorUserId: CREATOR,
      }).userIds,
    ).toEqual([GRACE, LINUS]);
  });

  test("matches picks whatever shape or case the form keeps them in", () => {
    expect(
      getOwnersNewFromRule({
        rule: RULE,
        pickedUserIds: [{ _id: GRACE.toUpperCase() }, new ObjectID(LINUS)],
        pickedTeamIds: [{ value: PLATFORM, label: "Platform" }],
        creatorUserId: CREATOR.toUpperCase(),
      }),
    ).toEqual({ userIds: [], teamIds: [SRE] });
  });

  test("is nobody once everyone it adds is picked - the line says so instead", () => {
    expect(
      getOwnersNewFromRule({
        rule: RULE,
        pickedUserIds: [GRACE, LINUS],
        pickedTeamIds: [PLATFORM, SRE],
        creatorUserId: CREATOR,
      }),
    ).toEqual({ userIds: [], teamIds: [] });
    expect(OWNER_RULE_ADDS_NOBODY_NEW).toBe(
      "Everyone it adds is already an owner.",
    );
  });

  test("never changes the rule it reads", () => {
    const rule: OwnerRulePreviewRule = {
      ...RULE,
      userIds: [...RULE.userIds],
      teamIds: [...RULE.teamIds],
    };

    getOwnersNewFromRule({
      rule: rule,
      pickedUserIds: [GRACE],
      pickedTeamIds: [SRE],
      creatorUserId: CREATOR,
    });

    expect(rule).toEqual(RULE);
  });
});

describe("the creator's teams offered under the picker", () => {
  const MY_TEAMS: Array<MyTeam> = [
    { id: PLATFORM, name: "Platform" },
    { id: SRE, name: "SRE" },
    { id: PAYMENTS, name: "Payments" },
  ];

  test("are their teams not picked yet, in the order they are listed", () => {
    expect(
      getTeamsToSuggest({ myTeams: MY_TEAMS, pickedTeamIds: [SRE] }),
    ).toEqual([
      { id: PLATFORM, name: "Platform" },
      { id: PAYMENTS, name: "Payments" },
    ]);
  });

  test("are none once every one is picked, whatever shape the picks are kept in", () => {
    expect(
      getTeamsToSuggest({
        myTeams: MY_TEAMS,
        pickedTeamIds: [
          PLATFORM.toUpperCase(),
          { _id: SRE },
          new ObjectID(PAYMENTS),
        ],
      }),
    ).toEqual([]);
  });

  test("offer a team listed twice once", () => {
    expect(
      getTeamsToSuggest({
        myTeams: [
          ...MY_TEAMS,
          { id: PLATFORM.toUpperCase(), name: "Platform" },
        ],
        pickedTeamIds: undefined,
      }),
    ).toHaveLength(3);
  });

  test("once added, follow the teams already picked", () => {
    expect(
      addTeamsToPicked({ pickedTeamIds: [SRE], teamIds: [PLATFORM, SRE] }),
    ).toEqual([SRE, PLATFORM]);
    expect(
      addTeamsToPicked({
        pickedTeamIds: undefined,
        teamIds: [PLATFORM.toUpperCase()],
      }),
    ).toEqual([PLATFORM]);
  });
});

describe("what the Owners field says", () => {
  test("an incident's and an alert's creator is made an owner; an episode's is not", () => {
    expect(isCreatorMadeOwner(OwnerRulePreviewEvent.Incident, false)).toBe(
      true,
    );
    expect(isCreatorMadeOwner(OwnerRulePreviewEvent.Alert, false)).toBe(true);
    expect(
      isCreatorMadeOwner(OwnerRulePreviewEvent.IncidentEpisode, false),
    ).toBe(false);
    expect(isCreatorMadeOwner(OwnerRulePreviewEvent.AlertEpisode, false)).toBe(
      false,
    );
  });

  test("a master admin is never made the owner of what they create (DatabaseService.autoOwnerOnCreate)", () => {
    for (const event of EVENTS) {
      expect(isCreatorMadeOwner(event, true)).toBe(false);
    }
  });

  test("says so on the field, in each event's words", () => {
    expect(OWNERS_ON_CREATE_DESCRIPTIONS[OwnerRulePreviewEvent.Incident]).toBe(
      "You become an owner when you declare it. Add your team, or anyone else who should own it.",
    );
    expect(OWNERS_ON_CREATE_DESCRIPTIONS[OwnerRulePreviewEvent.Alert]).toBe(
      "You become an owner when you create it. Add your team, or anyone else who should own it.",
    );

    for (const event of EVENTS) {
      expect(getOwnersOnCreateDescription(event, false)).toBe(
        OWNERS_ON_CREATE_DESCRIPTIONS[event],
      );
    }
  });

  test("tells a master admin only to add owners - they do not become one", () => {
    expect(OWNERS_ON_CREATE_ADD_DESCRIPTION).toBe(
      "Add your team, or anyone else who should own it.",
    );
    expect(
      getOwnersOnCreateDescription(OwnerRulePreviewEvent.Incident, true),
    ).toBe(OWNERS_ON_CREATE_ADD_DESCRIPTION);
    expect(
      getOwnersOnCreateDescription(OwnerRulePreviewEvent.Alert, true),
    ).toBe(OWNERS_ON_CREATE_ADD_DESCRIPTION);
    // An episode's line never said the creator owns it.
    expect(
      getOwnersOnCreateDescription(OwnerRulePreviewEvent.IncidentEpisode, true),
    ).toBe(
      OWNERS_ON_CREATE_DESCRIPTIONS[OwnerRulePreviewEvent.IncidentEpisode],
    );
    expect(
      getOwnersOnCreateDescription(OwnerRulePreviewEvent.AlertEpisode, true),
    ).toBe(OWNERS_ON_CREATE_DESCRIPTIONS[OwnerRulePreviewEvent.AlertEpisode]);
  });

  test("on the review with nobody picked, says nobody else is - or nobody, on an episode", () => {
    expect(getNobodyPickedText(OwnerRulePreviewEvent.Incident, false)).toBe(
      OWNERS_SUMMARY_NOBODY_ELSE_PICKED,
    );
    expect(getNobodyPickedText(OwnerRulePreviewEvent.Alert, false)).toBe(
      OWNERS_SUMMARY_NOBODY_ELSE_PICKED,
    );
    expect(
      getNobodyPickedText(OwnerRulePreviewEvent.IncidentEpisode, false),
    ).toBe(OWNERS_SUMMARY_NOBODY_PICKED);
    expect(getNobodyPickedText(OwnerRulePreviewEvent.AlertEpisode, false)).toBe(
      OWNERS_SUMMARY_NOBODY_PICKED,
    );
  });

  test("on a master admin's review with nobody picked, says nobody is", () => {
    for (const event of EVENTS) {
      expect(getNobodyPickedText(event, true)).toBe(
        OWNERS_SUMMARY_NOBODY_PICKED,
      );
    }
  });
});

describe("asking the server", () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const RESULT: OwnerRulePreviewResult = {
    rules: [
      {
        ruleId: "c0000000-0000-4000-8000-000000000001",
        ruleName: "Platform owns checkout",
        userIds: [],
        teamIds: [PLATFORM],
        creatorTeamIds: [PLATFORM],
        notifiesOwners: true,
      },
    ],
  };

  test.each(EVENTS)(
    "the %s preview is a POST to the route its API registers, with the tenant header",
    async (event: OwnerRulePreviewEvent) => {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          OwnerRulePreview.resultToJSON(RESULT),
          {},
        ),
      );

      const draft: OwnerRulePreviewDraft = {
        ...OwnerRulePreview.emptyDraft(),
        title: "Checkout is down",
        labelIds: [LABEL_A],
      };

      expect(await fetchOwnerRulePreview({ event, draft })).toEqual(RESULT);
      expect(postMock).toHaveBeenCalledTimes(1);

      const request: {
        url: URL;
        data: JSONObject;
        headers: Record<string, string>;
      } = postMock.mock.calls[0]![0] as never;

      expect(request.url.toString()).toMatch(
        new RegExp(`${OwnerRulePreview.getApiPath(event)}$`),
      );
      expect(request.data).toEqual(OwnerRulePreview.draftToJSON(draft));
      expect(request.headers).toEqual({ tenantid: "project-1" });
    },
  );

  test("a refusal is thrown, for the review to decide what to say", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      422,
      { message: "You do not have permission" },
      {},
    );
    postMock.mockResolvedValue(refusal);

    await expect(
      fetchOwnerRulePreview({
        event: OwnerRulePreviewEvent.Incident,
        draft: OwnerRulePreview.emptyDraft(),
      }),
    ).rejects.toBe(refusal);
  });
});
