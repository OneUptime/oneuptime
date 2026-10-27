import AlertEpisodeOnCallRule from "../../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../../Models/DatabaseModels/AlertOnCallRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeOnCallRule from "../../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import AlertEpisodeOnCallRuleService from "../../../../Server/Services/AlertEpisodeOnCallRuleService";
import AlertOnCallRuleService from "../../../../Server/Services/AlertOnCallRuleService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentEpisodeOnCallRuleService from "../../../../Server/Services/IncidentEpisodeOnCallRuleService";
import IncidentOnCallRuleService from "../../../../Server/Services/IncidentOnCallRuleService";
import OnCallRuleWhenToPageCheck from "../../../../Server/Utils/Rules/OnCallRuleWhenToPageCheck";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import OnCallRuleWhenToPage from "../../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes, {
  RestrictionType,
} from "../../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours, {
  WORKING_HOURS_DAILY_WINDOW_EMPTY_MESSAGE,
  WORKING_HOURS_NOT_SET_MESSAGE,
  WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE,
} from "../../../../Types/OnCallDutyPolicy/WorkingHours";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * AN ON-CALL RULE THAT PAGES ONLY DURING WORKING HOURS HAS HOURS THAT OPEN.
 *
 * Saving a working-hours rule with no hours, with a window that ends where
 * it starts, or in a time zone OneUptime does not know is refused - through
 * the API and Terraform as from the form - in the words the form shows. An
 * update is judged as the rules it writes will be: what it writes over each
 * rule as stored.
 */

const LONDON: string = "Europe/London";

function hours(): RestrictionTimes {
  return WorkingHours.getDefaultHours({
    timezone: LONDON,
    now: new Date("2026-10-20T12:00:00Z"),
  });
}

function emptyDailyWindow(): RestrictionTimes {
  const window: RestrictionTimes = new RestrictionTimes();
  window.restictionType = RestrictionType.Daily;
  window.dayRestrictionTimes = {
    startTime: new Date("2026-01-15T09:00:00Z"),
    endTime: new Date("2026-01-15T09:00:00Z"),
  };
  return window;
}

function rule(values: {
  whenToPage?: string | undefined;
  workingHours?: RestrictionTimes | null | undefined;
  workingHoursTimezone?: string | null | undefined;
}): AlertOnCallRule {
  const model: AlertOnCallRule = new AlertOnCallRule();

  for (const [key, value] of Object.entries(values)) {
    (model as unknown as Record<string, unknown>)[key] = value;
  }

  return model;
}

function create(model: AlertOnCallRule): void {
  OnCallRuleWhenToPageCheck.checkCreate({
    data: model,
    props: { isRoot: true },
  });
}

/*
 * The service's findRowsAndHoldUpdateToThem, as an update's check reads the
 * rules it writes: the rows the update writes, the update held to them.
 */
type FindBy = Mock<
  (...args: Array<unknown>) => Promise<Array<AlertOnCallRule>>
>;

// The last update a check handed findRowsAndHoldUpdateToThem.
let lastUpdateBy: unknown = null;

// An update, against the rules it names as they are stored.
async function update(
  written: AlertOnCallRule,
  stored: Array<AlertOnCallRule>,
): Promise<FindBy> {
  const findBy: FindBy = jest.fn<
    (...args: Array<unknown>) => Promise<Array<AlertOnCallRule>>
  >(async (): Promise<Array<AlertOnCallRule>> => {
    return stored;
  });

  const updateBy: unknown = {
    query: { _id: ObjectID.generate().toString() },
    data: written,
    props: { isRoot: true },
  };

  lastUpdateBy = updateBy;

  await OnCallRuleWhenToPageCheck.checkUpdate({
    service: {
      findRowsAndHoldUpdateToThem: findBy,
    } as unknown as DatabaseService<AlertOnCallRule>,
    updateBy: updateBy as never,
  });

  return findBy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new on-call rule", () => {
  test("that pages right away - or says nothing of when, as every rule before - is saved", () => {
    expect(() => {
      create(rule({ whenToPage: OnCallRuleWhenToPage.RightAway }));
    }).not.toThrow();
    expect(() => {
      create(rule({}));
    }).not.toThrow();
  });

  test("that pages during working hours that open, in a zone OneUptime knows, is saved", () => {
    expect(() => {
      create(
        rule({
          whenToPage: OnCallRuleWhenToPage.WorkingHours,
          workingHours: hours(),
          workingHoursTimezone: LONDON,
        }),
      );
    }).not.toThrow();
  });

  test.each([
    [
      "with no hours",
      { workingHoursTimezone: LONDON },
      WORKING_HOURS_NOT_SET_MESSAGE,
    ],
    [
      "whose window ends where it starts",
      { workingHours: emptyDailyWindow(), workingHoursTimezone: LONDON },
      WORKING_HOURS_DAILY_WINDOW_EMPTY_MESSAGE,
    ],
    [
      "with no time zone",
      { workingHours: hours() },
      WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE,
    ],
    [
      "in a time zone OneUptime does not know",
      { workingHours: hours(), workingHoursTimezone: "Nowhere/Nothing" },
      WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE,
    ],
  ] as Array<
    [
      string,
      { workingHours?: RestrictionTimes; workingHoursTimezone?: string },
      string,
    ]
  >)(
    "that pages during working hours %s is refused, saying why",
    (
      _name: string,
      values: {
        workingHours?: RestrictionTimes;
        workingHoursTimezone?: string;
      },
      message: string,
    ) => {
      expect(() => {
        create(
          rule({ whenToPage: OnCallRuleWhenToPage.WorkingHours, ...values }),
        );
      }).toThrow(new BadDataException(message));
    },
  );

  test("that says when to page in some other way is refused", () => {
    expect(() => {
      create(rule({ whenToPage: "Whenever" }));
    }).toThrow(
      'When to Page is "Right Away" or "Working Hours" or "After OneUptime AI".',
    );
  });

  test("whose hours came as JSON, as an API call sends them, is read the same", () => {
    expect(() => {
      create(
        rule({
          whenToPage: OnCallRuleWhenToPage.WorkingHours,
          workingHours: JSON.parse(
            JSON.stringify(hours().toJSON()),
          ) as RestrictionTimes,
          workingHoursTimezone: LONDON,
        }),
      );
    }).not.toThrow();
  });
});

describe("an update of an on-call rule", () => {
  const storedWorkingHoursRule: AlertOnCallRule = rule({
    whenToPage: OnCallRuleWhenToPage.WorkingHours,
    workingHours: hours(),
    workingHoursTimezone: LONDON,
  });

  const storedRightAwayRule: AlertOnCallRule = rule({
    whenToPage: OnCallRuleWhenToPage.RightAway,
  });

  test("that says nothing of when the rule pages reads nothing more", async () => {
    const findBy: FindBy = await update(rule({}), [storedRightAwayRule]);

    expect(findBy).not.toHaveBeenCalled();
  });

  test("to page right away needs nothing else", async () => {
    const findBy: FindBy = await update(
      rule({ whenToPage: OnCallRuleWhenToPage.RightAway }),
      [storedWorkingHoursRule],
    );

    expect(findBy).not.toHaveBeenCalled();
  });

  test("that writes all of it is judged on what it writes", async () => {
    const findBy: FindBy = await update(
      rule({
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
        workingHours: hours(),
        workingHoursTimezone: LONDON,
      }),
      [storedRightAwayRule],
    );

    expect(findBy).not.toHaveBeenCalled();
  });

  test("that changes only the time zone is judged with the hours the rule has", async () => {
    const findBy: FindBy = await update(
      rule({ workingHoursTimezone: "America/New_York" }),
      [storedWorkingHoursRule],
    );

    expect(findBy).toHaveBeenCalledTimes(1);
    // The update itself is handed over, so it is held to the rules read.
    expect(findBy.mock.calls[0]![0]).toBe(lastUpdateBy);
    expect(findBy.mock.calls[0]![1]).toEqual({
      whenToPage: true,
      workingHours: true,
      workingHoursTimezone: true,
    });
  });

  test("that switches a rule with no hours to working hours is refused", async () => {
    await expect(
      update(rule({ whenToPage: OnCallRuleWhenToPage.WorkingHours }), [
        storedRightAwayRule,
      ]),
    ).rejects.toThrow(WORKING_HOURS_NOT_SET_MESSAGE);
  });

  test("that clears the hours of a rule that pages during them is refused", async () => {
    await expect(
      update(rule({ workingHours: null }), [storedWorkingHoursRule]),
    ).rejects.toThrow(WORKING_HOURS_NOT_SET_MESSAGE);
  });

  test("that clears the hours of a rule that pages right away is saved", async () => {
    // Read, as the rule might page during working hours: it does not.
    const findBy: FindBy = await update(rule({ workingHours: null }), [
      storedRightAwayRule,
    ]);

    expect(findBy).toHaveBeenCalledTimes(1);
  });
});

describe("the four on-call rule services", () => {
  const SERVICES: Array<[string, unknown, () => BaseModel]> = [
    [
      "alert",
      AlertOnCallRuleService,
      (): BaseModel => {
        return new AlertOnCallRule();
      },
    ],
    [
      "incident",
      IncidentOnCallRuleService,
      (): BaseModel => {
        return new IncidentOnCallRule();
      },
    ],
    [
      "alert episode",
      AlertEpisodeOnCallRuleService,
      (): BaseModel => {
        return new AlertEpisodeOnCallRule();
      },
    ],
    [
      "incident episode",
      IncidentEpisodeOnCallRuleService,
      (): BaseModel => {
        return new IncidentEpisodeOnCallRule();
      },
    ],
  ];

  test.each(SERVICES)(
    "the %s rules refuse working hours that never open, before anything else is looked up",
    async (_name: string, service: unknown, newRule: () => BaseModel) => {
      const model: BaseModel = newRule();
      model.setColumnValue("whenToPage", OnCallRuleWhenToPage.WorkingHours);
      model.setColumnValue("workingHoursTimezone", LONDON);

      const checkCreate: (createBy: unknown) => Promise<void> = (
        service as {
          checkCreateBeforeReferences: (createBy: unknown) => Promise<void>;
        }
      ).checkCreateBeforeReferences.bind(service);

      await expect(
        checkCreate({ data: model, props: { isRoot: true } }),
      ).rejects.toThrow(WORKING_HOURS_NOT_SET_MESSAGE);

      model.setColumnValue("workingHours", hours());

      await expect(
        checkCreate({ data: model, props: { isRoot: true } }),
      ).resolves.toBeUndefined();
    },
  );

  test.each(SERVICES)(
    "the %s rules judge an update against the rules as stored",
    async (_name: string, service: unknown, newRule: () => BaseModel) => {
      const stored: BaseModel = newRule();
      stored.setColumnValue("whenToPage", OnCallRuleWhenToPage.RightAway);

      jest
        .spyOn(service as never, "findRowsAndHoldUpdateToThem" as never)
        .mockResolvedValue([stored] as never);

      const written: BaseModel = newRule();
      written.setColumnValue("whenToPage", OnCallRuleWhenToPage.WorkingHours);

      const checkUpdate: (updateBy: unknown) => Promise<void> = (
        service as {
          checkUpdateBeforeReferences: (updateBy: unknown) => Promise<void>;
        }
      ).checkUpdateBeforeReferences.bind(service);

      await expect(
        checkUpdate({
          query: { _id: ObjectID.generate().toString() },
          data: written,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(WORKING_HOURS_NOT_SET_MESSAGE);
    },
  );
});
