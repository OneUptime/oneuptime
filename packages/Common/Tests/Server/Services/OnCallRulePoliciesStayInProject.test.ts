import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOnCallRule from "../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOnCallRule from "../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOnCallRuleService from "../../../Server/Services/AlertEpisodeOnCallRuleService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOnCallRuleService from "../../../Server/Services/IncidentEpisodeOnCallRuleService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The on-call rule engines merge the policies of every matching rule into
 * the incident's, alert's or episode's own list and persist them straight
 * through the repository; the on-call fan-out then pages each one, as root.
 * Rules are checked when they are saved, but a rule saved before that check
 * could still name another project's policy - whose responders must never
 * be paged about this project's incident. So each engine keeps only the
 * project's own policies (OnCallRulePolicyScope): one read, pinned to the
 * project, and the others are logged by id.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OWN_POLICY: string = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const SECOND_OWN_POLICY: string = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b";
const FOREIGN_POLICY: string = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

interface EngineCase {
  label: string;
  newRule: () => BaseModel;
  newRecord: () => BaseModel;
  ruleService: { findBy: unknown };
  recordService: { getRepository: unknown };
  stubFeed: () => void;
  apply: (record: BaseModel) => Promise<void>;
}

function policy(id: string): OnCallDutyPolicy {
  const item: OnCallDutyPolicy = new OnCallDutyPolicy();
  item._id = id;
  return item;
}

function withProject<T extends BaseModel>(record: T): T {
  record.id = ObjectID.generate();
  record.setColumnValue("projectId", PROJECT_ID);
  record.setColumnValue("onCallDutyPolicies", []);
  return record;
}

const ENGINES: Array<EngineCase> = [
  {
    label: "incident on-call rules",
    newRule: (): BaseModel => {
      return new IncidentOnCallRule();
    },
    newRecord: (): BaseModel => {
      return withProject(new Incident());
    },
    ruleService: IncidentOnCallRuleService,
    recordService: IncidentService,
    stubFeed: (): void => {
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never);
    },
    apply: (record: BaseModel): Promise<void> => {
      return IncidentOnCallRuleEngineService.applyRulesToIncident(
        record as Incident,
      );
    },
  },
  {
    label: "alert on-call rules",
    newRule: (): BaseModel => {
      return new AlertOnCallRule();
    },
    newRecord: (): BaseModel => {
      return withProject(new Alert());
    },
    ruleService: AlertOnCallRuleService,
    recordService: AlertService,
    stubFeed: (): void => {
      jest
        .spyOn(AlertFeedService, "createAlertFeedItem")
        .mockResolvedValue(undefined as never);
    },
    apply: (record: BaseModel): Promise<void> => {
      return AlertOnCallRuleEngineService.applyRulesToAlert(record as Alert);
    },
  },
  {
    label: "incident episode on-call rules",
    newRule: (): BaseModel => {
      return new IncidentEpisodeOnCallRule();
    },
    newRecord: (): BaseModel => {
      return withProject(new IncidentEpisode());
    },
    ruleService: IncidentEpisodeOnCallRuleService,
    recordService: IncidentEpisodeService,
    stubFeed: (): void => {
      jest
        .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
    },
    apply: (record: BaseModel): Promise<void> => {
      return IncidentEpisodeOnCallRuleEngineService.applyRulesToEpisode(
        record as IncidentEpisode,
      );
    },
  },
  {
    label: "alert episode on-call rules",
    newRule: (): BaseModel => {
      return new AlertEpisodeOnCallRule();
    },
    newRecord: (): BaseModel => {
      return withProject(new AlertEpisode());
    },
    ruleService: AlertEpisodeOnCallRuleService,
    recordService: AlertEpisodeService,
    stubFeed: (): void => {
      jest
        .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
        .mockResolvedValue(undefined as never);
    },
    apply: (record: BaseModel): Promise<void> => {
      return AlertEpisodeOnCallRuleEngineService.applyRulesToEpisode(
        record as AlertEpisode,
      );
    },
  },
];

describe.each(ENGINES)("$label", (engine: EngineCase) => {
  let directory: ProjectDirectoryStub;
  let persisted: Array<unknown>;
  let warnings: Array<string>;

  function ruleNaming(policyIds: Array<string>): BaseModel {
    const rule: BaseModel = engine.newRule();
    rule.id = ObjectID.generate();
    rule.setColumnValue("name", "Page the platform rota");
    rule.setColumnValue(
      "onCallDutyPolicies",
      policyIds.map((id: string): OnCallDutyPolicy => {
        return policy(id);
      }),
    );
    return rule;
  }

  function policyIdsOf(record: BaseModel): Array<string> {
    return (
      (record.getColumnValue("onCallDutyPolicies") as Array<BaseModel>) || []
    ).map((item: BaseModel): string => {
      return item.id!.toString();
    });
  }

  beforeEach(() => {
    directory = stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { OnCallDutyPolicy: [OWN_POLICY, SECOND_OWN_POLICY] },
    });

    persisted = [];
    warnings = [];

    jest
      .spyOn(engine.recordService as never, "getRepository" as never)
      .mockReturnValue({
        createQueryBuilder: () => {
          return {
            relation: () => {
              return {
                of: () => {
                  return {
                    add: async (ids: Array<unknown>): Promise<void> => {
                      persisted.push(...ids);
                    },
                  };
                },
              };
            },
          };
        },
      } as never);

    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([] as never);
    engine.stubFeed();

    jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
      warnings.push(String(message));
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("merges only the project's own policies, pinned to the project, and says which it left out", async () => {
    jest
      .spyOn(engine.ruleService as never, "findBy" as never)
      .mockResolvedValue([
        ruleNaming([OWN_POLICY, FOREIGN_POLICY]),
        ruleNaming([SECOND_OWN_POLICY]),
      ] as never);

    const record: BaseModel = engine.newRecord();

    await engine.apply(record);

    expect(policyIdsOf(record)).toEqual([OWN_POLICY, SECOND_OWN_POLICY]);
    expect(persisted).toEqual([OWN_POLICY, SECOND_OWN_POLICY]);

    expect(directory.recordLookups).toEqual([
      {
        model: "OnCallDutyPolicy",
        projectId: PROJECT_ID.toString(),
        ids: [OWN_POLICY, FOREIGN_POLICY, SECOND_OWN_POLICY],
      },
    ]);
    expect(
      warnings.some((warning: string): boolean => {
        return warning.includes(`"${FOREIGN_POLICY}"`);
      }),
    ).toBe(true);
  });

  test("pages nothing when every policy the rules name is another project's", async () => {
    jest
      .spyOn(engine.ruleService as never, "findBy" as never)
      .mockResolvedValue([ruleNaming([FOREIGN_POLICY])] as never);

    const record: BaseModel = engine.newRecord();

    await engine.apply(record);

    expect(policyIdsOf(record)).toEqual([]);
    expect(persisted).toEqual([]);
  });

  test("a failed policy read merges nothing rather than page what it could not check", async () => {
    jest.restoreAllMocks();
    jest
      .spyOn(engine.ruleService as never, "findBy" as never)
      .mockResolvedValue([ruleNaming([OWN_POLICY])] as never);
    jest
      .spyOn(engine.recordService as never, "getRepository" as never)
      .mockReturnValue({} as never);
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "findIdsInProject")
      .mockRejectedValue(new Error("Database is down") as never);

    const record: BaseModel = engine.newRecord();

    await expect(engine.apply(record)).resolves.toBeUndefined();

    expect(policyIdsOf(record)).toEqual([]);
  });
});
