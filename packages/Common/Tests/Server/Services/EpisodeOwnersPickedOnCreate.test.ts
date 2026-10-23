import AlertEpisodeLabelRuleEngineService from "../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeOnCallRuleEngineService from "../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodeOwnerTeamService from "../../../Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodePrivacyRuleEngineService from "../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeLabelRuleEngineService from "../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeOnCallRuleEngineService from "../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodeOwnerTeamService from "../../../Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import OwnerRuleAssignment from "../../../Server/Utils/Rules/OwnerRuleAssignment";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
/*
 * jest itself is the global one: @jest/globals types spyOn and fn as mocks
 * the global jest.SpiedFunction annotation here does not accept.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

// Refusals below are deliberate; @CaptureSpan and the services log them.
jest.mock("../../../Server/Utils/Logger");

/*
 * OWNERS PICKED ON THE CREATE EPISODE FORMS.
 *
 * Create Alert Episode has asked for owners for a while, and AlertEpisode
 * Service never added them: the picks travelled as misc data and were
 * dropped. Create Incident Episode now asks too (under More fields). Both
 * episode services now do what the incident and alert services do with the
 * owners a create form picks (misc data's ownerUsers and ownerTeams):
 *
 *   - ask, before the episode's number is taken, whether the creator may add
 *     them to the episode as it will be saved - a pick the creator may not
 *     add refuses the whole create (OwnerRuleAssignment
 *     .checkOwnersPickedOnCreate);
 *   - add them once the episode exists, after "Episode Created" and its
 *     channels, and before the owner rules run - quietly, as a person's
 *     create always adds them (addOwnersPickedOnCreate). One that fails is
 *     logged and the episode stays created.
 *
 * The episode services' own hooks run; the owner writes, and every other
 * service the hooks call out to, are stand-ins.
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
const CREATED_STATE: ObjectID = new ObjectID(
  "0193c0de-c4e1-4aaa-8bbb-0000000000d1",
);
const OWNER_USER: string = "0193c0de-c4e1-4aaa-8bbb-000000000201";
const OWNER_TEAM: string = "0193c0de-c4e1-4aaa-8bbb-000000000301";

type AnyFunction = (...args: Array<any>) => any;
type AnyService = Record<string, AnyFunction>;

interface Kind {
  name: string;
  service: AnyService;
  episodeModel: new () => DatabaseBaseModel;
  ownerUserService: unknown;
  ownerTeamService: unknown;
  resourceIdColumn: string;
  stateColumn: string;
  privacyEngine: AnyService;
  ownerEngine: AnyService;
  labelEngine: AnyService;
  onCallEngine: AnyService;
}

const KINDS: Array<Kind> = [
  {
    name: "an alert episode",
    service: AlertEpisodeService as unknown as AnyService,
    episodeModel: AlertEpisode,
    ownerUserService: AlertEpisodeOwnerUserService,
    ownerTeamService: AlertEpisodeOwnerTeamService,
    resourceIdColumn: "alertEpisodeId",
    stateColumn: "currentAlertStateId",
    privacyEngine:
      AlertEpisodePrivacyRuleEngineService as unknown as AnyService,
    ownerEngine: AlertEpisodeOwnerRuleEngineService as unknown as AnyService,
    labelEngine: AlertEpisodeLabelRuleEngineService as unknown as AnyService,
    onCallEngine: AlertEpisodeOnCallRuleEngineService as unknown as AnyService,
  },
  {
    name: "an incident episode",
    service: IncidentEpisodeService as unknown as AnyService,
    episodeModel: IncidentEpisode,
    ownerUserService: IncidentEpisodeOwnerUserService,
    ownerTeamService: IncidentEpisodeOwnerTeamService,
    resourceIdColumn: "incidentEpisodeId",
    stateColumn: "currentIncidentStateId",
    privacyEngine:
      IncidentEpisodePrivacyRuleEngineService as unknown as AnyService,
    ownerEngine: IncidentEpisodeOwnerRuleEngineService as unknown as AnyService,
    labelEngine: IncidentEpisodeLabelRuleEngineService as unknown as AnyService,
    onCallEngine:
      IncidentEpisodeOnCallRuleEngineService as unknown as AnyService,
  },
];

const PICKED: Record<string, unknown> = {
  ownerUsers: [OWNER_USER],
  ownerTeams: [OWNER_TEAM],
};

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: PERSON_ID,
};

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("the owners picked when creating $name", (kind: Kind) => {
  async function beforeCreate(
    miscDataProps?: Record<string, unknown>,
  ): Promise<DatabaseBaseModel> {
    const episode: DatabaseBaseModel = new kind.episodeModel();
    Object.assign(episode, { title: "Checkout is down" });

    await hookOf(
      kind.service,
      "onBeforeCreate",
    )({
      data: episode,
      props: PROPS,
      ...(miscDataProps ? { miscDataProps } : {}),
    });

    return episode;
  }

  test("are asked about on the episode as it will be saved, as the person creating it", async () => {
    const check: jest.SpiedFunction<
      typeof OwnerRuleAssignment.checkOwnersPickedOnCreate
    > = jest
      .spyOn(OwnerRuleAssignment, "checkOwnersPickedOnCreate")
      .mockResolvedValue(undefined);

    const episode: DatabaseBaseModel = await beforeCreate(PICKED);

    expect(check).toHaveBeenCalledTimes(1);

    const asked: Record<string, unknown> = check.mock.calls[0]![0] as never;

    expect(asked["ownerUserService"]).toBe(kind.ownerUserService);
    expect(asked["ownerTeamService"]).toBe(kind.ownerTeamService);
    expect(asked["resourceIdColumn"]).toBe(kind.resourceIdColumn);
    expect(asked["resourceModelType"]).toBe(kind.episodeModel);
    expect(asked["resource"]).toBe(episode);
    expect(asked["miscDataProps"]).toEqual(PICKED);
    expect(asked["props"]).toBe(PROPS);
  });

  test("one the person may not add refuses the whole create, before a number is used", async () => {
    jest
      .spyOn(OwnerRuleAssignment, "checkOwnersPickedOnCreate")
      .mockRejectedValue(
        new NotAuthorizedException("You do not have permission to add owners."),
      );

    let outcome: unknown = "went on";

    try {
      await beforeCreate(PICKED);
    } catch (error) {
      outcome = error;
    }

    expect(outcome).toBeInstanceOf(NotAuthorizedException);
    expect(numbersUsed).toBe(0);
  });

  /*
   * The real check, with nothing picked: it reads nothing and refuses
   * nothing, so an episode created without owners is created as before.
   */
  test("none picked is no question at all", async () => {
    for (const miscDataProps of [undefined, {}, { ownerUsers: [] }]) {
      await beforeCreate(miscDataProps);
    }

    expect(numbersUsed).toBe(3);
  });
});

describe.each(KINDS)("once $name created with owners exists", (kind: Kind) => {
  // A promise for the chain's last step.
  let ended: Promise<void>;

  let addedOwners: Array<Record<string, unknown>>;

  function standIn(options: { addFails?: boolean } = {}): void {
    addedOwners = [];

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

    step(kind.privacyEngine, "applyRulesToEpisode", "privacy");
    jest
      .spyOn(kind.service, "handleEpisodeWorkspaceOperationsAsync")
      .mockImplementation((async () => {
        steps.push("workspace");
        return [];
      }) as never);
    step(kind.service, "changeEpisodeState", "first state");
    step(kind.service, "createEpisodeCreatedFeed", "Episode Created");
    step(kind.ownerEngine, "applyRulesToEpisode", "owner rules");
    step(kind.labelEngine, "applyRulesToEpisode", "labels");
    step(kind.onCallEngine, "applyRulesToEpisode", "on-call");
    step(kind.service, "executeEpisodeOnCallDutyPoliciesAsync", "paging", end);

    jest
      .spyOn(OwnerRuleAssignment, "addOwnersPickedOnCreate")
      .mockImplementation((async (data: Record<string, unknown>) => {
        addedOwners.push(data);

        if (options.addFails) {
          throw new Error("the database went away");
        }

        steps.push("picked owners");
        return { userIds: [], teamIds: [] };
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

  async function created(
    miscDataProps?: Record<string, unknown>,
  ): Promise<void> {
    const episode: DatabaseBaseModel = new kind.episodeModel();
    Object.assign(episode, {
      _id: EPISODE_ID.toString(),
      projectId: PROJECT_ID,
      createdByUserId: PERSON_ID,
      [kind.stateColumn]: CREATED_STATE,
    });

    await hookOf(kind.service, "onCreateSuccess")(
      {
        createBy: {
          data: episode,
          props: PROPS,
          ...(miscDataProps ? { miscDataProps } : {}),
        },
        carryForward: { startingStage: null },
      },
      episode,
    );
  }

  test("are added to it, for the person who created it", async () => {
    standIn();

    await created(PICKED);
    await waitForChain();

    expect(addedOwners).toHaveLength(1);

    const added: Record<string, unknown> = addedOwners[0]!;

    expect(added["ownerUserService"]).toBe(kind.ownerUserService);
    expect(added["ownerTeamService"]).toBe(kind.ownerTeamService);
    expect(added["resourceIdColumn"]).toBe(kind.resourceIdColumn);
    expect(idOf(added["resourceId"])).toBe(idOf(EPISODE_ID));
    expect(idOf(added["projectId"])).toBe(idOf(PROJECT_ID));
    expect(added["miscDataProps"]).toEqual(PICKED);
    expect(added["props"]).toBe(PROPS);
  });

  test("after Episode Created and its channels, and before the owner rules run", async () => {
    standIn();

    await created(PICKED);
    await waitForChain();

    expect(steps).toEqual([
      "privacy",
      "workspace",
      "first state",
      "Episode Created",
      "picked owners",
      "owner rules",
      "labels",
      "on-call",
      "paging",
    ]);
  });

  test("an add that fails leaves the episode created, and its rules still run", async () => {
    standIn({ addFails: true });

    await created(PICKED);
    await waitForChain();

    expect(addedOwners).toHaveLength(1);
    expect(steps).toContain("Episode Created");
    expect(steps).toContain("owner rules");
    expect(steps).toContain("paging");
  });
});
