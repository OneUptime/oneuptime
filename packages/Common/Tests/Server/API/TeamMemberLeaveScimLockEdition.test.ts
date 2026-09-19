import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import logger from "../../../Server/Utils/Logger";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * POST /team-member/:id/leave lets a member leave a team. While SCIM Push
 * Groups owns the project's teams, only the identity provider may remove
 * members, so the route refuses - while SCIM is active
 * (EnterpriseEdition.isFeatureActive(SCIM)). The Community Edition has no
 * SCIM endpoint, and an Enterprise install whose license lapsed answers none,
 * so there a Push Groups setting left on must not trap the member in the team.
 */

const ROUTE: string = "/team-member/:id/leave";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEMBERSHIP_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const EDITION_CASES: Array<EditionStateCase> = createEditionStateCases();

const toMatrix: (
  cases: Array<EditionStateCase>,
) => Array<[string, EditionStateCase]> = (
  cases: Array<EditionStateCase>,
): Array<[string, EditionStateCase]> => {
  return cases.map(
    (editionCase: EditionStateCase): [string, EditionStateCase] => {
      return [editionCase.label, editionCase];
    },
  );
};

const LOCKED_MATRIX: Array<[string, EditionStateCase]> = toMatrix(
  EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
    return editionCase.isActive;
  }),
);

const UNLOCKED_MATRIX: Array<[string, EditionStateCase]> = toMatrix(
  EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
    return !editionCase.isActive;
  }),
);

let scimCount: SpyInstance;
let deleteMembership: SpyInstance;

const leave: () => Promise<void> = async (): Promise<void> => {
  const req: ExpressRequest = {
    params: { id: MEMBERSHIP_ID.toString() },
    query: {},
    body: {},
    headers: {},
    userAuthorization: { userId: USER_ID },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("POST", ROUTE).handlerFunction(req, res, next);

  expect(next).not.toHaveBeenCalled();
};

const expectRefusedBecauseOfScim: () => void = (): void => {
  expect(Response.sendErrorResponse).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    new BadDataException(
      "Team membership is managed by SCIM Push Groups for this project. Please contact your administrator to be removed.",
    ),
  );
  expect(deleteMembership).not.toHaveBeenCalled();
  expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
};

const expectLeft: () => void = (): void => {
  expect(Response.sendErrorResponse).not.toHaveBeenCalled();
  expect(deleteMembership).toHaveBeenCalledWith({
    id: MEMBERSHIP_ID,
    props: { isRoot: true },
  });
  expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
};

describe("POST /team-member/:id/leave and SCIM Push Groups, by edition", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();

    const membership: TeamMember = new TeamMember();
    membership.userId = USER_ID;
    membership.projectId = PROJECT_ID;

    getJestSpyOn(TeamMemberService, "findOneById").mockResolvedValue(
      membership,
    );
    deleteMembership = getJestSpyOn(
      TeamMemberService,
      "deleteOneById",
    ).mockResolvedValue(1);
    getJestSpyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    getJestSpyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    // Push Groups is ON for the project.
    scimCount = getJestSpyOn(ProjectSCIMService, "countBy").mockResolvedValue(
      new PositiveNumber(1),
    );
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  test.each(LOCKED_MATRIX)(
    "SCIM active (%s): leaving is refused",
    async (_label: string, editionCase: EditionStateCase) => {
      editionCase.apply();

      await leave();

      expect(scimCount).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { projectId: PROJECT_ID, enablePushGroups: true },
        }),
      );
      expectRefusedBecauseOfScim();
    },
  );

  test.each(UNLOCKED_MATRIX)(
    "SCIM not active (%s): the member can leave",
    async (_label: string, editionCase: EditionStateCase) => {
      editionCase.apply();

      await leave();

      expect(scimCount).not.toHaveBeenCalled();
      expectLeft();
    },
  );

  test("the lock follows the license at request time: a lapse lets the member leave, a renewal locks again", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("valid"),
    });

    await leave();
    expectRefusedBecauseOfScim();

    jest.clearAllMocks();
    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));

    await leave();
    expectLeft();
  });

  test("with Push Groups off the Enterprise Edition lets the member leave", async () => {
    installFakeEnterpriseModule();
    scimCount.mockResolvedValue(new PositiveNumber(0));

    await leave();

    expectLeft();
  });
});
