import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageLabelRuleEngineService from "../../../Server/Services/StatusPageLabelRuleEngineService";
import StatusPageOwnerRuleEngineService from "../../../Server/Services/StatusPageOwnerRuleEngineService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The owners picked when a status page is created are added once the whole
 * create has returned. An owner row is created only under a page its
 * creator may read (CreatePermission.checkParentPermission), and a teammate
 * whose read of status pages reaches only the ones they own owns the new
 * page only once DatabaseService.create has made them an owner - after the
 * success hook. So the owners are added after the create, as the creator,
 * with the same checks as adding them by hand.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PAGE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OWNER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OWNER_TEAM_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

// A teammate whose read of status pages reaches only the ones they own.
function creatorProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          {
            permission: Permission.CreateProjectStatusPage,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      } as never,
    },
  };
}

function createdPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page.id = PAGE_ID;
  page.projectId = PROJECT_ID;
  page.name = "Public status";
  return page;
}

function pickedOwners(): JSONObject {
  return {
    ownerUsers: [OWNER_USER_ID],
    ownerTeams: [OWNER_TEAM_ID],
  };
}

/*
 * The create the page's service builds on (ProjectReferencesService, then
 * DatabaseService): stood in for, recording when it returns.
 */
function stubTheCreate(events: Array<string>): void {
  const parentPrototype: {
    create: (createBy: CreateBy<StatusPage>) => Promise<StatusPage>;
  } = Object.getPrototypeOf(Object.getPrototypeOf(StatusPageService));

  jest
    .spyOn(parentPrototype, "create")
    .mockImplementation(async (): Promise<StatusPage> => {
      events.push("created");
      return createdPage();
    });
}

type SpyInstance = ReturnType<typeof getJestSpyOn>;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the owners picked when a status page is created", () => {
  test("are added once the whole create has returned, as the creator", async () => {
    const events: Array<string> = [];
    stubTheCreate(events);

    const addOwners: SpyInstance = getJestSpyOn(
      StatusPageService,
      "addOwners",
    ).mockImplementation(async (): Promise<void> => {
      events.push("owners");
    });

    const props: DatabaseCommonInteractionProps = creatorProps();

    await StatusPageService.create({
      data: new StatusPage(),
      props: props,
      miscDataProps: pickedOwners(),
    });

    expect(events).toEqual(["created", "owners"]);
    expect(addOwners).toHaveBeenCalledTimes(1);

    const [projectId, statusPageId, userIds, teamIds, notifyOwners, asProps]: [
      ObjectID,
      ObjectID,
      Array<ObjectID>,
      Array<ObjectID>,
      boolean,
      DatabaseCommonInteractionProps,
    ] = addOwners.mock.calls[0] as [
      ObjectID,
      ObjectID,
      Array<ObjectID>,
      Array<ObjectID>,
      boolean,
      DatabaseCommonInteractionProps,
    ];

    expect(projectId.toString()).toBe(PROJECT_ID.toString());
    expect(statusPageId.toString()).toBe(PAGE_ID.toString());
    expect(userIds).toEqual([OWNER_USER_ID]);
    expect(teamIds).toEqual([OWNER_TEAM_ID]);
    expect(notifyOwners).toBe(false);
    expect(asProps).toBe(props);
  });

  test("are not added by the success hook, which runs before the creator owns the page", async () => {
    jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);
    jest
      .spyOn(StatusPageLabelRuleEngineService, "applyRulesToStatusPage")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StatusPageOwnerRuleEngineService, "applyRulesToStatusPage")
      .mockResolvedValue(undefined as never);

    const addOwners: SpyInstance = getJestSpyOn(
      StatusPageService,
      "addOwners",
    ).mockResolvedValue(undefined);

    const onCreate: OnCreate<StatusPage> = {
      createBy: {
        data: new StatusPage(),
        props: creatorProps(),
        miscDataProps: pickedOwners(),
      },
      carryForward: null,
    };

    await (
      StatusPageService as unknown as {
        onCreateSuccess: (
          onCreate: OnCreate<StatusPage>,
          createdItem: StatusPage,
        ) => Promise<StatusPage>;
      }
    ).onCreateSuccess(onCreate, createdPage());

    expect(addOwners).not.toHaveBeenCalled();
  });

  test("a create that runs no hooks adds none", async () => {
    stubTheCreate([]);

    const addOwners: SpyInstance = getJestSpyOn(
      StatusPageService,
      "addOwners",
    ).mockResolvedValue(undefined);

    await StatusPageService.create({
      data: new StatusPage(),
      props: { ...creatorProps(), ignoreHooks: true },
      miscDataProps: pickedOwners(),
    });

    expect(addOwners).not.toHaveBeenCalled();
  });

  test("a create that picks no owners adds none", async () => {
    stubTheCreate([]);

    const addOwners: SpyInstance = getJestSpyOn(
      StatusPageService,
      "addOwners",
    ).mockResolvedValue(undefined);

    await StatusPageService.create({
      data: new StatusPage(),
      props: creatorProps(),
      miscDataProps: { ownerUsers: [], ownerTeams: [] },
    });

    expect(addOwners).not.toHaveBeenCalled();
  });

  test("owners that cannot be added are logged, and the page is kept", async () => {
    stubTheCreate([]);

    const refused: Error = new Error("refused");
    let settled: () => void = (): void => {};
    const loggedOnce: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        settled = resolve;
      },
    );

    getJestSpyOn(StatusPageService, "addOwners").mockRejectedValue(refused);
    const logged: SpyInstance = getJestSpyOn(
      logger,
      "error",
    ).mockImplementation((): void => {
      settled();
    });

    const page: StatusPage = await StatusPageService.create({
      data: new StatusPage(),
      props: creatorProps(),
      miscDataProps: pickedOwners(),
    });

    await loggedOnce;

    expect(page.id?.toString()).toBe(PAGE_ID.toString());
    expect(String(logged.mock.calls[0]![0])).toContain(
      "Error in StatusPageService owner assignment",
    );
  });
});
