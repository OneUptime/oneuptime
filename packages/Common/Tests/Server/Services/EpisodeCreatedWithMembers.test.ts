import AlertEpisodeLabelRuleEngineService from "../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodePrivacyRuleEngineService from "../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeLabelRuleEngineService from "../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import ChannelMembersNotAddedNotice from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ALERT_IDS_TO_ADD_KEY,
  INCIDENT_IDS_TO_ADD_KEY,
} from "../../../Types/Episode/EpisodeMembersAdd";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

// Refusals below are deliberate; @CaptureSpan and the services log them.
jest.mock("../../../Server/Utils/Logger");

/*
 * "Add to New Episode" on the alerts and incidents lists creates the episode
 * with what goes in it: the create names the ids under miscDataProps
 * (alertIdsToAdd / incidentIdsToAdd), and the episode services
 *
 *   - check them before the episode's number is taken and before anything
 *     is written - one the caller cannot see, or a caller who may not add to
 *     episodes, refuses the whole create;
 *   - start an episode named with no severity at the most severe of theirs,
 *     and keep one the create names;
 *   - add them once the episode exists - after its privacy rules ran, and
 *     before the create answers, so the episode the person opens lists them;
 *   - name them in one feed entry after "Episode Created" (and the note on
 *     who a new channel could not add), not one per record.
 *
 * The episode services' own hooks run; the member services' adds, and every
 * other service the hooks call out to, are stand-ins.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-c4e1-4aaa-8bbb-000000000001",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-c4e1-4aaa-8bbb-0000000000e1",
);
const PERSON_ID: ObjectID = new ObjectID(
  "0193c0de-c4e1-4aaa-8bbb-0000000000a1",
);
const CREATOR_ID: ObjectID = new ObjectID(
  "0193c0de-c4e1-4aaa-8bbb-0000000000a2",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "0193c0de-c4e1-4aaa-8bbb-0000000000b1",
);
const CREATED_STATE: ObjectID = new ObjectID(
  "0193c0de-c4e1-4aaa-8bbb-0000000000d1",
);
const CRITICAL_ID: ObjectID = new ObjectID(
  "0193c0de-c4e1-4aaa-8bbb-0000000000c1",
);
const MINOR_ID: ObjectID = new ObjectID("0193c0de-c4e1-4aaa-8bbb-0000000000c3");
const RECORD_1: string = "0193c0de-c4e1-4aaa-8bbb-000000000101";
const RECORD_2: string = "0193c0de-c4e1-4aaa-8bbb-000000000102";

type AnyFunction = (...args: Array<any>) => any;
type AnyService = Record<string, AnyFunction>;

// A stand-in's calls, as the tests read them.
interface CallRecorder {
  mock: { calls: Array<Array<any>> };
}

interface Kind {
  plural: string;
  service: AnyService;
  memberService: AnyService;
  stateService: AnyService;
  createdStateMethod: string;
  counter: string;
  episodeModel: new () => DatabaseBaseModel;
  idsToAddKey: string;
  severityIdColumn: string;
  severityRelation: string;
  validateMethod: string;
  validatedIdsKey: string;
  mostSevereKey: string;
  addNewMethod: string;
  episodeIdKey: string;
  feedMethod: string;
  privacyEngine: AnyService;
  ownerEngine: AnyService;
  labelEngine: AnyService;
  onCallEngine: AnyService;
  // An incident's entry names the API key that created the episode.
  namesApiKey: boolean;
}

const KINDS: Array<Kind> = [
  {
    plural: "alerts",
    service: AlertEpisodeService as unknown as AnyService,
    memberService: AlertEpisodeMemberService as unknown as AnyService,
    stateService: AlertStateService as unknown as AnyService,
    createdStateMethod: "getCreatedAlertStateId",
    counter: "incrementAndGetAlertEpisodeCounter",
    episodeModel: AlertEpisode,
    idsToAddKey: ALERT_IDS_TO_ADD_KEY,
    severityIdColumn: "alertSeverityId",
    severityRelation: "alertSeverity",
    validateMethod: "validateAlertsForNewEpisode",
    validatedIdsKey: "alertIds",
    mostSevereKey: "mostSevereAlertSeverityId",
    addNewMethod: "addAlertsToNewEpisode",
    episodeIdKey: "alertEpisodeId",
    feedMethod: "createAlertsAddedFeedItem",
    privacyEngine:
      AlertEpisodePrivacyRuleEngineService as unknown as AnyService,
    ownerEngine: AlertEpisodeOwnerRuleEngineService as unknown as AnyService,
    labelEngine: AlertEpisodeLabelRuleEngineService as unknown as AnyService,
    onCallEngine: AlertEpisodeOnCallRuleEngineService as unknown as AnyService,
    namesApiKey: false,
  },
  {
    plural: "incidents",
    service: IncidentEpisodeService as unknown as AnyService,
    memberService: IncidentEpisodeMemberService as unknown as AnyService,
    stateService: IncidentStateService as unknown as AnyService,
    createdStateMethod: "getCreatedIncidentStateId",
    counter: "incrementAndGetIncidentEpisodeCounter",
    episodeModel: IncidentEpisode,
    idsToAddKey: INCIDENT_IDS_TO_ADD_KEY,
    severityIdColumn: "incidentSeverityId",
    severityRelation: "incidentSeverity",
    validateMethod: "validateIncidentsForNewEpisode",
    validatedIdsKey: "incidentIds",
    mostSevereKey: "mostSevereIncidentSeverityId",
    addNewMethod: "addIncidentsToNewEpisode",
    episodeIdKey: "incidentEpisodeId",
    feedMethod: "createIncidentsAddedFeedItem",
    privacyEngine:
      IncidentEpisodePrivacyRuleEngineService as unknown as AnyService,
    ownerEngine: IncidentEpisodeOwnerRuleEngineService as unknown as AnyService,
    labelEngine: IncidentEpisodeLabelRuleEngineService as unknown as AnyService,
    onCallEngine:
      IncidentEpisodeOnCallRuleEngineService as unknown as AnyService,
    namesApiKey: true,
  },
];

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

function hookOf(service: AnyService, name: string): AnyFunction {
  return service[name]!.bind(service);
}

// Every stood-in step, in the order it ran.
let steps: Array<string> = [];

// The numbers the creates spent from the project's counter.
let numbersUsed: number = 0;

beforeEach(() => {
  steps = [];
  numbersUsed = 0;

  stubProjectDirectory({});

  const useNumber: () => Promise<{
    counter: number;
    prefix: string | undefined;
  }> = async (): Promise<{ counter: number; prefix: string | undefined }> => {
    numbersUsed++;
    return { counter: 12, prefix: undefined };
  };

  jest
    .spyOn(ProjectService, "incrementAndGetAlertEpisodeCounter")
    .mockImplementation(useNumber as never);
  jest
    .spyOn(ProjectService, "incrementAndGetIncidentEpisodeCounter")
    .mockImplementation(useNumber as never);
  jest
    .spyOn(AlertStateService, "getCreatedAlertStateId")
    .mockResolvedValue(CREATED_STATE as never);
  jest
    .spyOn(IncidentStateService, "getCreatedIncidentStateId")
    .mockResolvedValue(CREATED_STATE as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockResolvedValue(undefined as never);
  jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
    // no analytics in tests
  }) as never);
  jest
    .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
    .mockImplementation((async (): Promise<void> => {
      steps.push("note");
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "creating an episode with the $plural it is for",
  (kind: Kind) => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: PERSON_ID,
    };

    // What the member service's check answers, unless a test says otherwise.
    function validates(mostSevere: ObjectID | null): CallRecorder {
      return jest
        .spyOn(kind.memberService, kind.validateMethod)
        .mockImplementation((async () => {
          steps.push("checked");
          return {
            [kind.validatedIdsKey]: [
              new ObjectID(RECORD_1),
              new ObjectID(RECORD_2),
            ],
            [kind.mostSevereKey]: mostSevere,
          };
        }) as never);
    }

    async function beforeCreate(
      data: Record<string, unknown>,
      miscDataProps?: Record<string, unknown>,
    ): Promise<{
      data: Record<string, unknown>;
      carryForward: Record<string, unknown>;
    }> {
      const episode: DatabaseBaseModel = new kind.episodeModel();
      Object.assign(episode, { title: "Checkout is down", ...data });

      const result: {
        createBy: { data: DatabaseBaseModel };
        carryForward: Record<string, unknown>;
      } = await hookOf(
        kind.service,
        "onBeforeCreate",
      )({
        data: episode,
        props: props,
        ...(miscDataProps ? { miscDataProps } : {}),
      });

      return {
        data: result.createBy.data as unknown as Record<string, unknown>,
        carryForward: result.carryForward,
      };
    }

    test("the ids are checked as the person, in the project, and handed on to be added", async () => {
      const validate: CallRecorder = validates(null);

      const { carryForward } = await beforeCreate(
        {},
        { [kind.idsToAddKey]: [RECORD_1, RECORD_2] },
      );

      expect(validate).toHaveBeenCalledTimes(1);
      const asked: Record<string, unknown> = validate.mock.calls[0]![0];
      expect(idOf(asked["projectId"])).toBe(idOf(PROJECT_ID));
      expect(asked[kind.validatedIdsKey]).toEqual([RECORD_1, RECORD_2]);
      expect(asked["props"]).toBe(props);

      expect(
        (carryForward[kind.idsToAddKey] as Array<ObjectID>).map(idOf),
      ).toEqual([RECORD_1, RECORD_2]);
    });

    test("one that cannot be added refuses the whole create, before a number is used", async () => {
      jest
        .spyOn(kind.memberService, kind.validateMethod)
        .mockRejectedValue(
          new BadDataException(
            `Some of the ${kind.plural} to add to the episode do not exist in this project, or you do not have access to them.`,
          ) as never,
        );

      let outcome: unknown = "went on";

      try {
        await beforeCreate({}, { [kind.idsToAddKey]: [RECORD_1] });
      } catch (error) {
        outcome = error;
      }

      expect(outcome).toBeInstanceOf(BadDataException);
      expect(numbersUsed).toBe(0);
    });

    test("an episode named with no severity starts at the most severe of theirs", async () => {
      validates(CRITICAL_ID);

      const { data } = await beforeCreate(
        {},
        { [kind.idsToAddKey]: [RECORD_1, RECORD_2] },
      );

      expect(idOf(data[kind.severityIdColumn])).toBe(idOf(CRITICAL_ID));
      expect(numbersUsed).toBe(1);
    });

    test("a severity the create names is kept, under either of its names", async () => {
      validates(CRITICAL_ID);

      const byColumn: { data: Record<string, unknown> } = await beforeCreate(
        { [kind.severityIdColumn]: MINOR_ID },
        { [kind.idsToAddKey]: [RECORD_1] },
      );
      expect(idOf(byColumn.data[kind.severityIdColumn])).toBe(idOf(MINOR_ID));

      // The create form sends the relation: it is left as it came.
      const byRelation: { data: Record<string, unknown> } = await beforeCreate(
        { [kind.severityRelation]: { _id: MINOR_ID.toString() } },
        { [kind.idsToAddKey]: [RECORD_1] },
      );
      expect(byRelation.data[kind.severityIdColumn]).toBeUndefined();
      expect(
        idOf(
          (byRelation.data[kind.severityRelation] as { _id?: unknown })?._id,
        ),
      ).toBe(idOf(MINOR_ID));
    });

    test("none of theirs with a severity leaves the episode's empty", async () => {
      validates(null);

      const { data } = await beforeCreate(
        {},
        { [kind.idsToAddKey]: [RECORD_1] },
      );

      expect(data[kind.severityIdColumn]).toBeUndefined();
    });

    test("an episode created with nothing to add is created as it always was", async () => {
      const validate: CallRecorder = validates(null);

      for (const miscDataProps of [
        undefined,
        {},
        { [kind.idsToAddKey]: null },
      ]) {
        const { carryForward } = await beforeCreate({}, miscDataProps);

        expect(carryForward[kind.idsToAddKey]).toEqual([]);
      }

      expect(validate).not.toHaveBeenCalled();
    });
  },
);

describe.each(KINDS)(
  "once an episode created with $plural exists",
  (kind: Kind) => {
    // A promise for the chain's last step.
    let ended: Promise<void>;

    // What the member service's add answers, and the args it was given.
    let added: Array<Record<string, unknown>>;
    let entries: Array<Record<string, unknown>>;

    function standIn(options: { addFails?: boolean } = {}): void {
      added = [];
      entries = [];

      let end: () => void = () => {};
      ended = new Promise<void>((resolve: () => void) => {
        end = resolve;
      });

      const step: (
        target: AnyService,
        method: string,
        name: string,
        done?: () => void,
      ) => void = (
        target: AnyService,
        method: string,
        name: string,
        done?: () => void,
      ): void => {
        jest.spyOn(target, method).mockImplementation((async () => {
          steps.push(name);
          if (done) {
            done();
          }
          return undefined;
        }) as never);
      };

      jest
        .spyOn(kind.privacyEngine, "applyRulesToEpisode")
        .mockImplementation((async () => {
          // Takes a moment, so an add that does not wait for it shows.
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 20);
          });
          steps.push("privacy");
        }) as never);
      // The new channel could not add someone, so the note is posted.
      jest
        .spyOn(kind.service, "handleEpisodeWorkspaceOperationsAsync")
        .mockImplementation((async () => {
          steps.push("workspace");
          return [
            {
              workspaceType: WorkspaceType.Slack,
              channels: [{ id: "C0NEW", name: "episode-12" }],
              userIds: [PERSON_ID],
            },
          ];
        }) as never);
      step(kind.service, "changeEpisodeState", "first state");
      step(kind.service, "createEpisodeCreatedFeed", "Episode Created");
      step(kind.ownerEngine, "applyRulesToEpisode", "owners");
      step(kind.labelEngine, "applyRulesToEpisode", "labels");
      step(kind.onCallEngine, "applyRulesToEpisode", "on-call");
      step(
        kind.service,
        "executeEpisodeOnCallDutyPoliciesAsync",
        "paging",
        end,
      );

      jest
        .spyOn(kind.memberService, kind.addNewMethod)
        .mockImplementation((async (data: Record<string, unknown>) => {
          added.push(data);
          // Takes a moment, so a create that does not wait for it shows.
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 20);
          });

          if (options.addFails) {
            throw new Error("the database went away");
          }

          steps.push("added");
          return data[kind.validatedIdsKey];
        }) as never);

      jest
        .spyOn(kind.memberService, kind.feedMethod)
        .mockImplementation((async (data: Record<string, unknown>) => {
          entries.push(data);
          steps.push("one entry");
        }) as never);
    }

    async function waitForChain(): Promise<void> {
      await Promise.race([
        ended,
        new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 2000);
        }),
      ]);
    }

    function theEpisode(): DatabaseBaseModel {
      const episode: DatabaseBaseModel = new kind.episodeModel();
      Object.assign(episode, {
        _id: EPISODE_ID.toString(),
        projectId: PROJECT_ID,
        createdByUserId: CREATOR_ID,
        [kind.service === (AlertEpisodeService as unknown as AnyService)
          ? "currentAlertStateId"
          : "currentIncidentStateId"]: CREATED_STATE,
      });
      return episode;
    }

    async function created(
      props: DatabaseCommonInteractionProps,
      idsToAdd: Array<ObjectID>,
    ): Promise<void> {
      const episode: DatabaseBaseModel = theEpisode();

      await hookOf(kind.service, "onCreateSuccess")(
        {
          createBy: { data: episode, props: props },
          carryForward: { startingStage: null, [kind.idsToAddKey]: idsToAdd },
        },
        episode,
      );
    }

    const ids: Array<ObjectID> = [
      new ObjectID(RECORD_1),
      new ObjectID(RECORD_2),
    ];

    test("they are in it before the create answers, added once its privacy rules have run", async () => {
      standIn();

      await created({ tenantId: PROJECT_ID, userId: PERSON_ID }, ids);

      // The create answered: the add had finished.
      expect(steps).toContain("added");
      expect(steps.indexOf("privacy")).toBeLessThan(steps.indexOf("added"));

      expect(added).toHaveLength(1);
      expect(idOf(added[0]![kind.episodeIdKey])).toBe(idOf(EPISODE_ID));
      expect(idOf(added[0]!["projectId"])).toBe(idOf(PROJECT_ID));
      expect(
        (added[0]![kind.validatedIdsKey] as Array<ObjectID>).map(idOf),
      ).toEqual([RECORD_1, RECORD_2]);
      expect(idOf(added[0]!["addedByUserId"])).toBe(idOf(PERSON_ID));

      await waitForChain();
    });

    test("one entry names them, after Episode Created and the channel note, before the rules run", async () => {
      standIn();

      await created({ tenantId: PROJECT_ID, userId: PERSON_ID }, ids);
      await waitForChain();

      // The chain's own steps, in order: the entry right after the note.
      expect(
        steps.filter((name: string): boolean => {
          return name !== "added";
        }),
      ).toEqual([
        "privacy",
        "workspace",
        "first state",
        "Episode Created",
        "note",
        "one entry",
        "owners",
        "labels",
        "on-call",
        "paging",
      ]);
      // And it waits for them to be in the episode.
      expect(steps.indexOf("added")).toBeLessThan(steps.indexOf("one entry"));

      expect(entries).toHaveLength(1);
      expect(
        (entries[0]![kind.validatedIdsKey] as Array<ObjectID>).map(idOf),
      ).toEqual([RECORD_1, RECORD_2]);
      expect(idOf(entries[0]!["addedByUserId"])).toBe(idOf(PERSON_ID));
    });

    test("OneUptime's own create names the episode's creator as the one who added them", async () => {
      standIn();

      await created({ isRoot: true }, ids);
      await waitForChain();

      expect(idOf(added[0]!["addedByUserId"])).toBe(idOf(CREATOR_ID));
      expect(idOf(entries[0]!["addedByUserId"])).toBe(idOf(CREATOR_ID));
    });

    test("an API key's create names no person", async () => {
      standIn();

      await created(
        {
          tenantId: PROJECT_ID,
          apiKeyId: API_KEY_ID,
          apiKeyName: "Grafana bridge",
        },
        ids,
      );
      await waitForChain();

      expect(added[0]!["addedByUserId"]).toBeUndefined();

      if (kind.namesApiKey) {
        // Each incident's own entry names the key, as for one added alone.
        expect(added[0]!["apiKeyActor"]).toEqual({
          apiKeyId: API_KEY_ID,
          apiKeyName: "Grafana bridge",
        });
      }
    });

    test("an add that fails leaves the episode created, with no entry naming what is not in it", async () => {
      standIn({ addFails: true });

      await created({ tenantId: PROJECT_ID, userId: PERSON_ID }, ids);
      await waitForChain();

      expect(steps).toContain("Episode Created");
      expect(steps).toContain("paging");
      expect(entries).toEqual([]);
    });

    test("an episode created with nothing to add adds nothing and names nothing", async () => {
      standIn();

      await created({ tenantId: PROJECT_ID, userId: PERSON_ID }, []);
      await waitForChain();

      expect(added).toEqual([]);
      expect(entries).toEqual([]);
      expect(steps).toContain("paging");
    });
  },
);
