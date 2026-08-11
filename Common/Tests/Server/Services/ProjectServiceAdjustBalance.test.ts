import ProjectService, {
  MAX_BALANCE_ADJUSTMENT_IN_USD_CENTS,
  ProjectBalanceAdjustmentResult,
} from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import BalanceAdjustmentType from "../../../Types/Billing/BalanceAdjustmentType";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * ProjectService.adjustBalance is the only way a project's prepaid balances
 * move without a payment behind them. Two things matter and are asserted
 * throughout: the write is a single atomic delta (SMS sends and AI runs are
 * deducting from the same column concurrently, so a read-then-write would eat
 * whichever charge landed in between), and every guard that stands between a
 * mistyped number and a customer's balance actually fires.
 *
 * Everything below the service boundary is spied: no database.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const ADMIN_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SMS_COLUMN: string = "smsOrCallCurrentBalanceInUSDCents";
const AI_COLUMN: string = "aiCurrentBalanceInUSDCents";

interface AdjustBalanceSpies {
  findOneById: jest.SpyInstance;
  atomicAdd: jest.SpyInstance;
}

function setup(data?: {
  project?: Partial<Project> | null;
}): AdjustBalanceSpies {
  const project: Partial<Project> | null =
    data && "project" in data
      ? data.project!
      : ({
          id: PROJECT_ID,
          _id: PROJECT_ID.toString(),
          [SMS_COLUMN]: 5000,
          [AI_COLUMN]: 2500,
        } as unknown as Partial<Project>);

  return {
    findOneById: jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project as Project | null),
    atomicAdd: jest
      .spyOn(ProjectService, "atomicAddToColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined),
  };
}

type AdjustArgs = Parameters<typeof ProjectService.adjustBalance>[0];

function adjustArgs(overrides?: Partial<AdjustArgs>): AdjustArgs {
  return {
    projectId: PROJECT_ID,
    balanceType: ProjectBalanceType.SmsOrCall,
    adjustmentType: BalanceAdjustmentType.Add,
    amountInUSDCents: 1000,
    reason: "Refund for the SMS charged during the 12 Jan outage",
    adjustedByUserId: ADMIN_USER_ID,
    ...overrides,
  };
}

describe("ProjectService.adjustBalance", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("adding to a balance", () => {
    it("writes a single positive atomic delta rather than an absolute value", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({ amountInUSDCents: 1000 }),
      );

      expect(spies.atomicAdd).toHaveBeenCalledTimes(1);
      expect(spies.atomicAdd.mock.calls[0][0].id).toEqual(PROJECT_ID);
      expect(spies.atomicAdd.mock.calls[0][0].add).toEqual({
        [SMS_COLUMN]: 1000,
      });
    });

    it("reports the balance before and after", async () => {
      setup();

      const result: ProjectBalanceAdjustmentResult =
        await ProjectService.adjustBalance(
          adjustArgs({ amountInUSDCents: 1000 }),
        );

      expect(result).toEqual({
        previousBalanceInUSDCents: 5000,
        newBalanceInUSDCents: 6000,
      });
    });

    it("targets the AI column when the AI balance is chosen", async () => {
      const spies: AdjustBalanceSpies = setup();

      const result: ProjectBalanceAdjustmentResult =
        await ProjectService.adjustBalance(
          adjustArgs({
            balanceType: ProjectBalanceType.AI,
            amountInUSDCents: 750,
          }),
        );

      expect(spies.atomicAdd.mock.calls[0][0].add).toEqual({
        [AI_COLUMN]: 750,
      });
      expect(result).toEqual({
        previousBalanceInUSDCents: 2500,
        newBalanceInUSDCents: 3250,
      });
    });

    it("treats a missing balance column as zero", async () => {
      setup({
        project: {
          id: PROJECT_ID,
          _id: PROJECT_ID.toString(),
        } as unknown as Partial<Project>,
      });

      const result: ProjectBalanceAdjustmentResult =
        await ProjectService.adjustBalance(
          adjustArgs({ amountInUSDCents: 1000 }),
        );

      expect(result).toEqual({
        previousBalanceInUSDCents: 0,
        newBalanceInUSDCents: 1000,
      });
    });
  });

  describe("deducting from a balance", () => {
    it("writes a negative atomic delta", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({
          adjustmentType: BalanceAdjustmentType.Deduct,
          amountInUSDCents: 1000,
        }),
      );

      expect(spies.atomicAdd.mock.calls[0][0].add).toEqual({
        [SMS_COLUMN]: -1000,
      });
    });

    it("allows deducting the balance down to exactly zero", async () => {
      setup();

      const result: ProjectBalanceAdjustmentResult =
        await ProjectService.adjustBalance(
          adjustArgs({
            adjustmentType: BalanceAdjustmentType.Deduct,
            amountInUSDCents: 5000,
          }),
        );

      expect(result.newBalanceInUSDCents).toBe(0);
    });

    it("refuses to overdraw the balance, and writes nothing", async () => {
      /*
       * Usage is allowed to push a balance negative; a manual deduction that
       * does is a typo every time, and the customer would then have to pay off
       * a debt staff invented.
       */
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(
          adjustArgs({
            adjustmentType: BalanceAdjustmentType.Deduct,
            amountInUSDCents: 5001,
          }),
        ),
      ).rejects.toThrow("Cannot deduct 50.01 USD - the balance is only 50 USD");

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });

    it("checks the overdraw against the balance being adjusted, not the other one", async () => {
      /*
       * The AI balance here is 2500 and the SMS balance 5000. Deducting 4000
       * of AI must fail even though the project holds 7500 across both.
       */
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(
          adjustArgs({
            balanceType: ProjectBalanceType.AI,
            adjustmentType: BalanceAdjustmentType.Deduct,
            amountInUSDCents: 4000,
          }),
        ),
      ).rejects.toThrow("Cannot deduct 40 USD - the balance is only 25 USD");

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });
  });

  describe("setting a balance", () => {
    it("assigns the absolute value instead of a delta", async () => {
      const spies: AdjustBalanceSpies = setup();

      const result: ProjectBalanceAdjustmentResult =
        await ProjectService.adjustBalance(
          adjustArgs({
            adjustmentType: BalanceAdjustmentType.Set,
            amountInUSDCents: 250,
          }),
        );

      expect(spies.atomicAdd.mock.calls[0][0].add).toEqual({});
      expect(spies.atomicAdd.mock.calls[0][0].set).toMatchObject({
        [SMS_COLUMN]: 250,
      });
      expect(result).toEqual({
        previousBalanceInUSDCents: 5000,
        newBalanceInUSDCents: 250,
      });
    });

    it("allows setting a balance to zero", async () => {
      /*
       * Unlike add and deduct, zero is a real instruction here - "this project
       * should have no balance" - so it must not be rejected as a no-op.
       */
      const spies: AdjustBalanceSpies = setup();

      const result: ProjectBalanceAdjustmentResult =
        await ProjectService.adjustBalance(
          adjustArgs({
            adjustmentType: BalanceAdjustmentType.Set,
            amountInUSDCents: 0,
          }),
        );

      expect(result.newBalanceInUSDCents).toBe(0);
      expect(spies.atomicAdd.mock.calls[0][0].set).toMatchObject({
        [SMS_COLUMN]: 0,
      });
    });
  });

  describe("low balance notification latches", () => {
    /*
     * The paid recharge paths clear these flags when they top a project up.
     * A manual top-up has to do the same, or the flags keep claiming the
     * owners were already warned - about the shortfall this adjustment fixed -
     * and the next genuine low balance passes in silence.
     */

    it("resets the SMS latches when the SMS balance goes up", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({ amountInUSDCents: 1000 }),
      );

      expect(spies.atomicAdd.mock.calls[0][0].set).toEqual({
        lowCallAndSMSBalanceNotificationSentToOwners: false,
        failedCallAndSMSBalanceChargeNotificationSentToOwners: false,
        notEnabledSmsOrCallNotificationSentToOwners: false,
      });
    });

    it("resets the AI latches when the AI balance goes up", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({
          balanceType: ProjectBalanceType.AI,
          amountInUSDCents: 1000,
        }),
      );

      expect(spies.atomicAdd.mock.calls[0][0].set).toEqual({
        lowAiBalanceNotificationSentToOwners: false,
        failedAiBalanceChargeNotificationSentToOwners: false,
        notEnabledAiNotificationSentToOwners: false,
      });
    });

    it("does not reset the other balance's latches", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({
          balanceType: ProjectBalanceType.AI,
          amountInUSDCents: 1000,
        }),
      );

      expect(spies.atomicAdd.mock.calls[0][0].set).not.toHaveProperty(
        "lowCallAndSMSBalanceNotificationSentToOwners",
      );
    });

    it("leaves the latches alone when the balance goes down", async () => {
      // Nobody has been un-warned by a deduction.
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({
          adjustmentType: BalanceAdjustmentType.Deduct,
          amountInUSDCents: 1000,
        }),
      );

      expect(spies.atomicAdd.mock.calls[0][0].set).toEqual({});
    });

    it("resets the latches when Set raises the balance", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({
          adjustmentType: BalanceAdjustmentType.Set,
          amountInUSDCents: 9000,
        }),
      );

      expect(spies.atomicAdd.mock.calls[0][0].set).toMatchObject({
        lowCallAndSMSBalanceNotificationSentToOwners: false,
      });
    });

    it("does not reset the latches when Set lowers the balance", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({
          adjustmentType: BalanceAdjustmentType.Set,
          amountInUSDCents: 100,
        }),
      );

      expect(spies.atomicAdd.mock.calls[0][0].set).toEqual({
        [SMS_COLUMN]: 100,
      });
    });
  });

  describe("amount validation", () => {
    it.each([
      ["not a number", "twenty" as unknown as number],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
    ])(
      "rejects an amount that is %s",
      async (_label: string, amount: number) => {
        const spies: AdjustBalanceSpies = setup();

        await expect(
          ProjectService.adjustBalance(
            adjustArgs({ amountInUSDCents: amount }),
          ),
        ).rejects.toThrow("Adjustment amount is not a valid number");

        expect(spies.atomicAdd).not.toHaveBeenCalled();
      },
    );

    it("rejects a fractional cent", async () => {
      /*
       * A fraction of a cent cannot be stored, and rounding it here would make
       * the balance disagree with the amount the audit log records.
       */
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(adjustArgs({ amountInUSDCents: 10.5 })),
      ).rejects.toThrow("Adjustment amount must be a whole number of cents");

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });

    it("rejects a negative amount", async () => {
      /*
       * Direction is carried by adjustmentType. A negative amount alongside
       * Deduct would otherwise quietly ADD to the balance.
       */
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(
          adjustArgs({
            adjustmentType: BalanceAdjustmentType.Deduct,
            amountInUSDCents: -1000,
          }),
        ),
      ).rejects.toThrow("Adjustment amount cannot be negative");

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });

    it.each([BalanceAdjustmentType.Add, BalanceAdjustmentType.Deduct])(
      "rejects a zero amount for %s",
      async (adjustmentType: BalanceAdjustmentType) => {
        const spies: AdjustBalanceSpies = setup();

        await expect(
          ProjectService.adjustBalance(
            adjustArgs({ adjustmentType, amountInUSDCents: 0 }),
          ),
        ).rejects.toThrow("Adjustment amount must be greater than zero");

        expect(spies.atomicAdd).not.toHaveBeenCalled();
      },
    );

    it("rejects an amount over the single-adjustment ceiling", async () => {
      // Staff type dollars into a cents column; the classic slip is 100x.
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(
          adjustArgs({
            amountInUSDCents: MAX_BALANCE_ADJUSTMENT_IN_USD_CENTS + 1,
          }),
        ),
      ).rejects.toThrow(
        "Adjustment amount cannot be more than 10000 USD in a single adjustment",
      );

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });

    it("allows an amount exactly at the ceiling", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({ amountInUSDCents: MAX_BALANCE_ADJUSTMENT_IN_USD_CENTS }),
      );

      expect(spies.atomicAdd).toHaveBeenCalledTimes(1);
    });

    it("applies the ceiling to Set as well", async () => {
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(
          adjustArgs({
            adjustmentType: BalanceAdjustmentType.Set,
            amountInUSDCents: MAX_BALANCE_ADJUSTMENT_IN_USD_CENTS + 1,
          }),
        ),
      ).rejects.toThrow("cannot be more than 10000 USD");

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });
  });

  describe("reason validation", () => {
    it.each([
      ["empty", ""],
      ["whitespace only", "   "],
    ])("rejects a %s reason", async (_label: string, reason: string) => {
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(adjustArgs({ reason })),
      ).rejects.toThrow("A reason is required to adjust the balance");

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });

    it("rejects a missing reason", async () => {
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(
          adjustArgs({ reason: undefined as unknown as string }),
        ),
      ).rejects.toThrow("A reason is required to adjust the balance");

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });
  });

  describe("balance type validation", () => {
    it("rejects an unknown balance type", async () => {
      const spies: AdjustBalanceSpies = setup();

      await expect(
        ProjectService.adjustBalance(
          adjustArgs({
            balanceType: "Bitcoin" as unknown as ProjectBalanceType,
          }),
        ),
      ).rejects.toThrow("Invalid balance type: Bitcoin");

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });
  });

  describe("the project", () => {
    it("rejects an unknown project", async () => {
      const spies: AdjustBalanceSpies = setup({ project: null });

      await expect(ProjectService.adjustBalance(adjustArgs())).rejects.toThrow(
        "Project not found",
      );

      expect(spies.atomicAdd).not.toHaveBeenCalled();
    });

    it("reads only the balance column it is about to move", async () => {
      const spies: AdjustBalanceSpies = setup();

      await ProjectService.adjustBalance(
        adjustArgs({ balanceType: ProjectBalanceType.AI }),
      );

      expect(spies.findOneById).toHaveBeenCalledWith({
        id: PROJECT_ID,
        select: {
          _id: true,
          [AI_COLUMN]: true,
        },
        props: {
          isRoot: true,
        },
      });
    });
  });

  describe("audit trail", () => {
    it("logs the adjustment, the acting admin and the stated reason", async () => {
      /*
       * There is no admin-action table, so this log line is the only record
       * that staff moved a customer's balance.
       */
      setup();

      const info: jest.SpyInstance = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {});

      await ProjectService.adjustBalance(
        adjustArgs({
          amountInUSDCents: 1000,
          reason: "Goodwill credit agreed on ticket 4821",
        }),
      );

      const line: string = String(info.mock.calls[0]?.[0]);

      expect(line).toContain(PROJECT_ID.toString());
      expect(line).toContain(ADMIN_USER_ID.toString());
      expect(line).toContain("Goodwill credit agreed on ticket 4821");
      expect(line).toContain("5000");
      expect(line).toContain("6000");
    });

    it("records an unknown admin rather than failing when the identity is absent", async () => {
      setup();

      const info: jest.SpyInstance = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {});

      await ProjectService.adjustBalance(
        adjustArgs({ adjustedByUserId: undefined }),
      );

      expect(String(info.mock.calls[0]?.[0])).toContain("unknown");
    });

    it("logs the trimmed reason", async () => {
      setup();

      const info: jest.SpyInstance = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {});

      await ProjectService.adjustBalance(
        adjustArgs({ reason: "  padded reason  " }),
      );

      expect(String(info.mock.calls[0]?.[0])).toContain(
        "Reason: padded reason",
      );
    });
  });
});
