import Project from "../../../Models/DatabaseModels/Project";
import ProjectService from "../../../Server/Services/ProjectService";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";
import { IsNull, Repository, UpdateResult } from "typeorm";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBSCRIPTION_ID: string = "sub_seats_123";
const PLAN_ID: string = "price_growth_123";

interface SeatUpdateData {
  paymentProviderSubscriptionSeats: number | (() => string);
  version: () => string;
}

function setupRepository(affected: number | undefined = 1): jest.Mock {
  const update: jest.Mock = jest.fn().mockResolvedValue({
    affected,
    generatedMaps: [],
    raw: [],
  } as UpdateResult);

  jest.spyOn(ProjectService, "getRepository").mockReturnValue({
    update,
  } as unknown as Repository<Project>);

  return update;
}

async function updateSeats(seats: number | null): Promise<number> {
  return ProjectService.updateSubscriptionSeats({
    projectId: PROJECT_ID,
    subscriptionId: SUBSCRIPTION_ID,
    planId: PLAN_ID,
    seats,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectService.updateSubscriptionSeats", () => {
  it("guards the actual write by project, subscription, plan and deletion state", async () => {
    const update: jest.Mock = setupRepository();
    const findOneById: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );
    const updateOneBy: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "updateOneBy",
    );

    await expect(updateSeats(4)).resolves.toBe(1);

    /*
     * The normal update service applies predicates to a SELECT, then updates
     * by id alone. They must reach repository.update in this same statement.
     */
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      {
        _id: PROJECT_ID.toString(),
        paymentProviderSubscriptionId: SUBSCRIPTION_ID,
        paymentProviderPlanId: PLAN_ID,
        deletedAt: IsNull(),
      },
      {
        paymentProviderSubscriptionSeats: 4,
        version: expect.any(Function),
      },
    );
    const data: SeatUpdateData = update.mock.calls[0]![1] as SeatUpdateData;
    expect(data.version()).toBe('"version" + 1');
    expect(findOneById).not.toHaveBeenCalled();
    expect(updateOneBy).not.toHaveBeenCalled();
  });

  it("writes the null marker on every retry even when it is already null", async () => {
    const update: jest.Mock = setupRepository();

    await expect(updateSeats(null)).resolves.toBe(1);
    await expect(updateSeats(null)).resolves.toBe(1);

    expect(update).toHaveBeenCalledTimes(2);
    for (const call of update.mock.calls) {
      const data: SeatUpdateData = call[1] as SeatUpdateData;
      const value: number | (() => string) =
        data.paymentProviderSubscriptionSeats;
      expect(typeof value).toBe("function");
      expect((value as () => string)()).toBe("NULL");
    }
  });

  it("acknowledges zero seats without converting it to the null marker", async () => {
    const update: jest.Mock = setupRepository();

    await expect(updateSeats(0)).resolves.toBe(1);

    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentProviderSubscriptionSeats: 0 }),
    );
  });

  it.each([null, 4])(
    "returns zero when the guarded write of %s seats no longer matches",
    async (seats: number | null) => {
      const update: jest.Mock = setupRepository(0);

      await expect(updateSeats(seats)).resolves.toBe(0);

      expect(update).toHaveBeenCalledTimes(1);
    },
  );

  it("does not claim success when the driver does not report an affected count", async () => {
    const update: jest.Mock = setupRepository();
    update.mockResolvedValue({ generatedMaps: [], raw: [] } as UpdateResult);

    await expect(updateSeats(null)).resolves.toBe(0);
  });

  it("propagates a failed write so the caller cannot proceed as if it invalidated seats", async () => {
    const update: jest.Mock = setupRepository();
    const failure: Error = new Error("Project update unavailable");
    update.mockRejectedValue(failure);

    await expect(updateSeats(null)).rejects.toThrow(failure);
  });
});
