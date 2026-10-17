import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import ScheduledMaintenanceCalendarFeedService, {
  SCHEDULED_MAINTENANCE_CALENDAR_FEED_EXISTS_MESSAGE,
} from "../../../Server/Services/ScheduledMaintenanceCalendarFeedService";
import ScheduledMaintenanceCalendarFeed from "../../../Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import CalendarFeedToken, {
  CalendarFeedRotation,
} from "../../../Server/Utils/OnCall/CalendarFeedToken";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { PREVIOUS_TOKEN_GRACE_DAYS } from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";

/*
 * The team's maintenance calendar link: at most one per project, its token
 * minted by the service whatever a request carried, and a rotation that
 * keeps the old hash for 30 days so a subscribed app is answered with an
 * empty calendar rather than an error.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "77000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "77000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("77100000-0000-4000-8000-000000000001");
const FEED_ID: ObjectID = new ObjectID("77200000-0000-4000-8000-000000000001");

// A token a request might try to choose: the right shape, chosen by the caller.
const CHOSEN_TOKEN: string = `chosen${"Z".repeat(37)}`;

const DAY_MS: number = 24 * 60 * 60 * 1000;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<ScheduledMaintenanceCalendarFeed>,
  ) => Promise<OnCreate<ScheduledMaintenanceCalendarFeed>>;
};

const hooks: HookCaller =
  ScheduledMaintenanceCalendarFeedService as unknown as HookCaller;

function feed(
  overrides: Partial<ScheduledMaintenanceCalendarFeed> = {},
): ScheduledMaintenanceCalendarFeed {
  const model: ScheduledMaintenanceCalendarFeed =
    new ScheduledMaintenanceCalendarFeed();
  model.projectId = PROJECT_ID;
  Object.assign(model, overrides);
  return model;
}

function create(
  data: ScheduledMaintenanceCalendarFeed,
  props: Record<string, unknown> = {},
): CreateBy<ScheduledMaintenanceCalendarFeed> {
  return {
    data,
    props: {
      isRoot: false,
      userId: USER_ID,
      tenantId: PROJECT_ID,
      ...props,
    },
  } as unknown as CreateBy<ScheduledMaintenanceCalendarFeed>;
}

function existingLinks(
  count: number,
): jest.SpiedFunction<typeof ScheduledMaintenanceCalendarFeedService.countBy> {
  return jest
    .spyOn(ScheduledMaintenanceCalendarFeedService, "countBy")
    .mockResolvedValue(new PositiveNumber(count));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ScheduledMaintenanceCalendarFeedService wiring", () => {
  test("is registered once in Server/Services/Index.ts, so its table is created", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "Server", "Services", "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import ScheduledMaintenanceCalendarFeedService from "./ScheduledMaintenanceCalendarFeedService";',
    );
    expect(
      index.split("\n").filter((line: string) => {
        return line === "  ScheduledMaintenanceCalendarFeedService,";
      }),
    ).toHaveLength(1);
  });
});

describe("ScheduledMaintenanceCalendarFeedService.onBeforeCreate", () => {
  test("takes the project from the row, else from the request's tenant", async () => {
    existingLinks(0);

    await expect(
      hooks.onBeforeCreate(
        create(feed({ projectId: undefined }), { tenantId: undefined }),
      ),
    ).rejects.toThrow(BadDataException);

    const onCreate: OnCreate<ScheduledMaintenanceCalendarFeed> =
      await hooks.onBeforeCreate(
        create(feed({ projectId: undefined }), { tenantId: OTHER_PROJECT_ID }),
      );

    expect(onCreate.createBy.data.projectId).toBe(OTHER_PROJECT_ID);
  });

  test("refuses a second link for the project, with a message that says what to do", async () => {
    const countBy: ReturnType<typeof existingLinks> = existingLinks(1);

    await expect(hooks.onBeforeCreate(create(feed()))).rejects.toThrow(
      SCHEDULED_MAINTENANCE_CALENDAR_FEED_EXISTS_MESSAGE,
    );

    const asked: Record<string, any> = countBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(asked["query"]).toEqual({ projectId: PROJECT_ID });
    expect(asked["props"]).toEqual({ isRoot: true });
  });

  test("mints the token itself, ignoring one a request chose", async () => {
    existingLinks(0);

    const onCreate: OnCreate<ScheduledMaintenanceCalendarFeed> =
      await hooks.onBeforeCreate(create(feed({ token: CHOSEN_TOKEN })));

    const data: ScheduledMaintenanceCalendarFeed = onCreate.createBy.data;

    expect(data.token).not.toBe(CHOSEN_TOKEN);
    expect(CalendarFeedToken.isValidShape(data.token)).toBe(true);
    expect(data.tokenHash).toBe(CalendarFeedToken.hash(data.token as string));
    expect(data.tokenHint).toBe(CalendarFeedToken.hint(data.token as string));
    expect(data.rotatedAt).toBeInstanceOf(Date);
    expect(data.previousTokenHash).toBeUndefined();
  });
});

describe("ScheduledMaintenanceCalendarFeedService.rotateTokenById", () => {
  test("mints a new token, parks the old hash for the grace period, as root", async () => {
    const findOneBy: jest.SpiedFunction<
      typeof ScheduledMaintenanceCalendarFeedService.findOneBy
    > = jest
      .spyOn(ScheduledMaintenanceCalendarFeedService, "findOneBy")
      .mockResolvedValue({
        id: FEED_ID,
        tokenHash: "old-hash",
      } as unknown as ScheduledMaintenanceCalendarFeed);
    const updateOneById: jest.SpiedFunction<
      typeof ScheduledMaintenanceCalendarFeedService.updateOneById
    > = jest
      .spyOn(ScheduledMaintenanceCalendarFeedService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const rotation: CalendarFeedRotation =
      await ScheduledMaintenanceCalendarFeedService.rotateTokenById({
        id: FEED_ID,
      });

    const read: Record<string, any> = findOneBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(read["query"]).toEqual({ _id: FEED_ID });
    expect(read["select"]).toEqual({ _id: true, tokenHash: true });
    expect(read["props"]).toEqual({ isRoot: true, ignoreHooks: true });

    const written: Record<string, any> = updateOneById.mock
      .calls[0]![0] as Record<string, any>;

    expect(written["id"]).toBe(FEED_ID);
    expect(written["props"]).toEqual({ isRoot: true });
    expect(CalendarFeedToken.isValidShape(rotation.token)).toBe(true);
    expect(written["data"]["token"]).toBe(rotation.token);
    expect(written["data"]["tokenHash"]).toBe(
      CalendarFeedToken.hash(rotation.token),
    );
    expect(written["data"]["previousTokenHash"]).toBe("old-hash");

    const expiresAt: number = (
      written["data"]["previousTokenExpiresAt"] as Date
    ).getTime();
    const rotatedAt: number = (written["data"]["rotatedAt"] as Date).getTime();

    expect(
      Math.abs(expiresAt - (rotatedAt + PREVIOUS_TOKEN_GRACE_DAYS * DAY_MS)),
    ).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  test("a link that does not exist cannot be rotated", async () => {
    jest
      .spyOn(ScheduledMaintenanceCalendarFeedService, "findOneBy")
      .mockResolvedValue(null);
    const updateOneById: jest.SpiedFunction<
      typeof ScheduledMaintenanceCalendarFeedService.updateOneById
    > = jest
      .spyOn(ScheduledMaintenanceCalendarFeedService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await expect(
      ScheduledMaintenanceCalendarFeedService.rotateTokenById({ id: FEED_ID }),
    ).rejects.toThrow(NotFoundException);
    expect(updateOneById).not.toHaveBeenCalled();
  });
});
