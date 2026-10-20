import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodePrivacyRuleEngineService from "../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodePrivacyRuleService from "../../../Server/Services/AlertEpisodePrivacyRuleService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertPrivacyRuleService from "../../../Server/Services/AlertPrivacyRuleService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodePrivacyRuleService from "../../../Server/Services/IncidentEpisodePrivacyRuleService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentPrivacyRuleService from "../../../Server/Services/IncidentPrivacyRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import ObjectID from "../../../Types/ObjectID";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../Server/Utils/Rules/RuleRun/RuleApplication";
import { PatternWorkAllowance } from "../../../Utils/LinearRegExp/PatternWork";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A PRIVACY RULE NEVER LEAVES A RECORD VISIBLE BECAUSE IT WAS NOT READ.
 *
 * A pattern question can end without an answer: it needed more work than
 * the text allows, or the rule evaluation's allowance of work was spent by
 * the rules before it (Utils/LinearRegExp/PatternWork.ts). A label rule
 * that cannot be answered does not match. A privacy rule that cannot be
 * answered may have matched - so the incident, alert or episode is made
 * private, and its feed says which rules could not be checked in full,
 * rather than shown to the whole project on a guess. A rule answered no
 * still leaves the record as it was.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

// Written to need many steps per character on a's and b's (LinearRegExp.test.ts).
const EXPLODING: string = "(?:[ab]*a[ab]{14}|[ab]{0,2000})Q";

function randomAb(length: number, seed: number): string {
  const random: SeededRandom = seededRandom(seed);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += random(2) === 0 ? "a" : "b";
  }

  return text;
}

// A title the exploding pattern cannot answer within its own limit.
const UNANSWERABLE_TITLE: string = randomAb(60_000, 5);

interface PrivateResource {
  id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  isPrivate?: boolean | undefined;
}

type RuleFields = Record<string, unknown>;

interface PrivacyRuleRunEngine {
  applyRulesToExistingResource: (data: {
    resource: PrivateResource;
    rules: Array<RuleFields>;
    allowOwnerNotification: boolean;
  }) => Promise<RuleApplicationResult>;
}

interface EngineMocks {
  findRules: jest.SpyInstance;
  updateOneById: jest.SpyInstance;
  createFeedItem: jest.SpyInstance;
}

interface PrivacyEngineCase {
  name: string;
  // The kind as the feed names it.
  ruleKind: string;
  engine: PrivacyRuleRunEngine;
  applyCreateHook: (resource: PrivateResource) => Promise<boolean>;
  mockServices: () => EngineMocks;
  titlePatternField: string;
  severityIdField: string;
}

const engineCases: Array<PrivacyEngineCase> = [
  {
    name: "IncidentPrivacyRuleEngineService",
    ruleKind: "Incident Privacy Rule",
    engine: IncidentPrivacyRuleEngineService as unknown as PrivacyRuleRunEngine,
    applyCreateHook: (resource: PrivateResource): Promise<boolean> => {
      return IncidentPrivacyRuleEngineService.applyRulesToIncident(
        resource as unknown as Incident,
      );
    },
    mockServices: (): EngineMocks => {
      return {
        findRules: jest
          .spyOn(IncidentPrivacyRuleService, "findBy")
          .mockResolvedValue([]),
        updateOneById: jest
          .spyOn(IncidentService, "updateOneById")
          .mockResolvedValue(undefined as any),
        createFeedItem: jest
          .spyOn(IncidentFeedService, "createIncidentFeedItem")
          .mockResolvedValue(undefined as any),
      };
    },
    titlePatternField: "incidentTitlePattern",
    severityIdField: "incidentSeverityId",
  },
  {
    name: "AlertPrivacyRuleEngineService",
    ruleKind: "Alert Privacy Rule",
    engine: AlertPrivacyRuleEngineService as unknown as PrivacyRuleRunEngine,
    applyCreateHook: (resource: PrivateResource): Promise<boolean> => {
      return AlertPrivacyRuleEngineService.applyRulesToAlert(
        resource as unknown as Alert,
      );
    },
    mockServices: (): EngineMocks => {
      return {
        findRules: jest
          .spyOn(AlertPrivacyRuleService, "findBy")
          .mockResolvedValue([]),
        updateOneById: jest
          .spyOn(AlertService, "updateOneById")
          .mockResolvedValue(undefined as any),
        createFeedItem: jest
          .spyOn(AlertFeedService, "createAlertFeedItem")
          .mockResolvedValue(undefined as any),
      };
    },
    titlePatternField: "alertTitlePattern",
    severityIdField: "alertSeverityId",
  },
  {
    name: "IncidentEpisodePrivacyRuleEngineService",
    ruleKind: "Incident Episode Privacy Rule",
    engine:
      IncidentEpisodePrivacyRuleEngineService as unknown as PrivacyRuleRunEngine,
    applyCreateHook: (resource: PrivateResource): Promise<boolean> => {
      return IncidentEpisodePrivacyRuleEngineService.applyRulesToEpisode(
        resource as unknown as IncidentEpisode,
      );
    },
    mockServices: (): EngineMocks => {
      return {
        findRules: jest
          .spyOn(IncidentEpisodePrivacyRuleService, "findBy")
          .mockResolvedValue([]),
        updateOneById: jest
          .spyOn(IncidentEpisodeService, "updateOneById")
          .mockResolvedValue(undefined as any),
        createFeedItem: jest
          .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
          .mockResolvedValue(undefined as any),
      };
    },
    titlePatternField: "episodeTitlePattern",
    severityIdField: "incidentSeverityId",
  },
  {
    name: "AlertEpisodePrivacyRuleEngineService",
    ruleKind: "Alert Episode Privacy Rule",
    engine:
      AlertEpisodePrivacyRuleEngineService as unknown as PrivacyRuleRunEngine,
    applyCreateHook: (resource: PrivateResource): Promise<boolean> => {
      return AlertEpisodePrivacyRuleEngineService.applyRulesToEpisode(
        resource as unknown as AlertEpisode,
      );
    },
    mockServices: (): EngineMocks => {
      return {
        findRules: jest
          .spyOn(AlertEpisodePrivacyRuleService, "findBy")
          .mockResolvedValue([]),
        updateOneById: jest
          .spyOn(AlertEpisodeService, "updateOneById")
          .mockResolvedValue(undefined as any),
        createFeedItem: jest
          .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
          .mockResolvedValue(undefined as any),
      };
    },
    titlePatternField: "episodeTitlePattern",
    severityIdField: "alertSeverityId",
  },
];

function fakeResource(
  engineCase: PrivacyEngineCase,
  title: string,
): PrivateResource {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    title: title,
    description: "",
    labels: [],
    monitors: [],
    [engineCase.severityIdField]: undefined,
  } as unknown as PrivateResource;
}

function rule(index: number, fields: RuleFields): RuleFields {
  const id: ObjectID = new ObjectID(
    `77777777-7777-4777-8777-${index.toString().padStart(12, "0")}`,
  );

  return {
    id: id,
    _id: id.toString(),
    name: `Privacy rule ${index}`,
    ...fields,
  };
}

function titleRule(
  engineCase: PrivacyEngineCase,
  index: number,
  pattern: string,
): RuleFields {
  return rule(index, { [engineCase.titlePatternField]: pattern });
}

function criteriaRule(
  engineCase: PrivacyEngineCase,
  index: number,
  operator: RuleCriteriaOperator,
  value: string,
): RuleFields {
  return rule(index, {
    criteria: {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        { field: engineCase.titlePatternField, operator, value: value },
      ],
    },
  });
}

function run(
  engineCase: PrivacyEngineCase,
  resource: PrivateResource,
  rules: Array<RuleFields>,
): Promise<RuleApplicationResult> {
  return engineCase.engine.applyRulesToExistingResource({
    resource: resource,
    rules: rules,
    allowOwnerNotification: false,
  });
}

function feedOf(mocks: EngineMocks): string {
  expect(mocks.createFeedItem).toHaveBeenCalledTimes(1);

  return String(
    (mocks.createFeedItem.mock.calls[0]![0] as Record<string, unknown>)[
      "feedInfoInMarkdown"
    ],
  );
}

/*
 * Each evaluation's allowance, small: a few questions spend it, as thousands
 * of rules would spend the real one.
 */
function smallAllowances(): void {
  jest
    .spyOn(PatternWorkAllowance, "forRuleEvaluation")
    .mockImplementation((): PatternWorkAllowance => {
      return new PatternWorkAllowance({
        pool: 1_000_000,
        workPerCharacterOfTextAsked: 128,
      });
    });
}

describe.each(engineCases)("$name", (engineCase: PrivacyEngineCase) => {
  let mocks: EngineMocks;

  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    mocks = engineCase.mockServices();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("makes the record private when a rule's pattern cannot be answered on its title", async () => {
    const resource: PrivateResource = fakeResource(
      engineCase,
      UNANSWERABLE_TITLE,
    );

    const result: RuleApplicationResult = await run(engineCase, resource, [
      titleRule(engineCase, 1, EXPLODING),
    ]);

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(mocks.updateOneById).toHaveBeenCalledWith({
      id: RESOURCE_ID,
      data: { isPrivate: true },
      props: { isRoot: true },
    });
    expect(resource.isPrivate).toBe(true);

    const feed: string = feedOf(mocks);

    expect(feed).toContain(`${engineCase.ruleKind} not checked in full:`);
    expect(feed).toContain("**Privacy rule 1**");
    expect(feed).toContain("counted as matching");
    expect(feed).toContain("has been marked **private**");
  });

  it("does so when the rule says the title does not match a pattern it cannot answer", async () => {
    const resource: PrivateResource = fakeResource(
      engineCase,
      UNANSWERABLE_TITLE,
    );

    await run(engineCase, resource, [
      criteriaRule(
        engineCase,
        2,
        RuleCriteriaOperator.DoesNotMatchPattern,
        EXPLODING,
      ),
    ]);

    expect(resource.isPrivate).toBe(true);
  });

  it("does so when the rules before it spent the evaluation's allowance", async () => {
    smallAllowances();

    const title: string = randomAb(2000, 9);
    const resource: PrivateResource = fakeResource(engineCase, title);
    const rules: Array<RuleFields> = [];

    // Each needs as much work as its own limit allows on the title.
    for (let index: number = 0; index < 20; index++) {
      rules.push(titleRule(engineCase, index, `${EXPLODING}${index}?`));
    }

    // A rule that would not match, but can no longer be answered.
    rules.push(titleRule(engineCase, 99, "^this-is-not-the-title$"));

    await run(engineCase, resource, rules);

    expect(resource.isPrivate).toBe(true);

    const feed: string = feedOf(mocks);

    expect(feed).toContain(`${engineCase.ruleKind}s not checked in full:`);
    expect(feed).toContain(" more.");
  });

  it("does so on the create hook too, as the rules a project has are read", async () => {
    const resource: PrivateResource = fakeResource(
      engineCase,
      UNANSWERABLE_TITLE,
    );

    mocks.findRules.mockResolvedValue([titleRule(engineCase, 3, EXPLODING)]);

    await engineCase.applyCreateHook(resource);

    expect(resource.isPrivate).toBe(true);
    expect(mocks.updateOneById).toHaveBeenCalledTimes(1);
  });

  it("names the rules that matched, as before, when one did", async () => {
    const resource: PrivateResource = fakeResource(
      engineCase,
      `Production outage ${UNANSWERABLE_TITLE}`,
    );

    await run(engineCase, resource, [
      titleRule(engineCase, 1, EXPLODING),
      titleRule(engineCase, 2, "^production"),
    ]);

    expect(resource.isPrivate).toBe(true);

    const feed: string = feedOf(mocks);

    expect(feed).toContain(`${engineCase.ruleKind} executed:`);
    expect(feed).toContain("**Privacy rule 2**");
    expect(feed).not.toContain("not checked in full");
  });

  it("leaves the record as it was when every rule is answered no", async () => {
    const resource: PrivateResource = fakeResource(
      engineCase,
      "Staging deploy finished",
    );

    const result: RuleApplicationResult = await run(engineCase, resource, [
      titleRule(engineCase, 1, "^production"),
      criteriaRule(
        engineCase,
        2,
        RuleCriteriaOperator.DoesNotMatchPattern,
        "deploy",
      ),
    ]);

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(resource.isPrivate).toBeUndefined();
    expect(mocks.updateOneById).not.toHaveBeenCalled();
    expect(mocks.createFeedItem).not.toHaveBeenCalled();
  });

  it("makes it private, as before, when a rule matches", async () => {
    const resource: PrivateResource = fakeResource(
      engineCase,
      "Production outage",
    );

    await run(engineCase, resource, [titleRule(engineCase, 1, "^production")]);

    expect(resource.isPrivate).toBe(true);
    expect(feedOf(mocks)).toContain(`${engineCase.ruleKind} executed:`);
  });
});
