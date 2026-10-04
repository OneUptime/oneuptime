/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Billing on, with the plans CI configures (packages/Common/test-setup.sh),
 * rather than following the environment the suite runs in: on OneUptime
 * Cloud a scrub rule is created on a project with a plan, and the refusal
 * must hold there too.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
    getAllEnvVars: () => {
      return {
        SUBSCRIPTION_PLAN_BASIC:
          "Free,price_basic_monthly,price_basic_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,price_growth_monthly,price_growth_yearly,22,20,2,14",
        SUBSCRIPTION_PLAN_SCALE:
          "Scale,price_scale_monthly,price_scale_yearly,99,84,3,14",
        SUBSCRIPTION_PLAN_ENTERPRISE:
          "Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14",
      };
    },
  };
});

import LogScrubRuleService from "../../../Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../Server/Services/TraceScrubRuleService";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ListOrderMaintainer from "../../../Server/Utils/Database/ListOrderMaintainer";
import logger from "../../../Server/Utils/Logger";
import {
  getScrubRuleCustomRegexRefusal,
  ScrubRuleValidationOptions,
  validateScrubRule,
} from "../../../Server/Utils/ScrubRuleValidation";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogScrubRule from "../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
  ScrubRuleCustomRegexProblem,
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
} from "../../../Types/Telemetry/ScrubRule";
import TraceScrubPatternType from "../../../Types/Trace/TraceScrubPatternType";
import { getJestSpyOn } from "../../Spy";
import { inspect } from "util";

/*
 * Contract under test - a log or trace scrub rule is refused unless ingest
 * can scrub with it.
 *
 * The reported failure: a "Custom Regex" rule could be saved with an empty
 * pattern (customRegex is optional) or one that does not compile. Ingest's
 * getRegexForPattern returns null for both and skips the rule, so the rules
 * table showed an active rule while the personal data it was made for was
 * stored in the clear. The same happened to a pattern type or a
 * fields-to-scrub value ingest does not know, which only the API could send.
 *
 * Update is the harder half: a request need not name every column, so
 * switching a rule to Custom Regex without a pattern, or blanking the pattern
 * of a custom rule, must be caught on the MERGED row. And an update that
 * touches none of the three columns - a rename, Enabled switched off, a drag
 * to another place in the list - must never be held up, not even by a rule
 * saved broken before this check existed: those are left as they are.
 */

const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const VALID_REGEX: string = "\\bSECRET-[A-Z0-9]+\\b";

interface Suite {
  name: string;
  service: any;
  modelType: { new (): BaseModel };
  recordNoun: string;
  emailPatternType: string;
  customPatternType: string;
  sensitiveKeysPatternType: string;
  validFieldsToScrub: string;
  otherFieldsToScrub: string;
  createPermission: Permission;
  editPermission: Permission;
}

/*
 * Each case runs against both services: separate classes over separate
 * tables, and the whole point of sharing one check is that neither can drift.
 */
const SUITES: Array<Suite> = [
  {
    name: "LogScrubRuleService",
    service: LogScrubRuleService,
    modelType: LogScrubRule,
    recordNoun: "logs",
    emailPatternType: LogScrubPatternType.Email,
    customPatternType: LogScrubPatternType.Custom,
    sensitiveKeysPatternType: LogScrubPatternType.SensitiveKeys,
    validFieldsToScrub: "both",
    otherFieldsToScrub: "body",
    createPermission: Permission.CreateProjectLogScrubRule,
    editPermission: Permission.EditProjectLogScrubRule,
  },
  {
    name: "TraceScrubRuleService",
    service: TraceScrubRuleService,
    modelType: TraceScrubRule,
    recordNoun: "spans",
    emailPatternType: TraceScrubPatternType.Email,
    customPatternType: TraceScrubPatternType.Custom,
    sensitiveKeysPatternType: TraceScrubPatternType.SensitiveKeys,
    validFieldsToScrub: "all",
    otherFieldsToScrub: "events",
    createPermission: Permission.CreateProjectTraceScrubRule,
    editPermission: Permission.EditProjectTraceScrubRule,
  },
];

function silenceLogs(): void {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    getJestSpyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }
}

describe("validateScrubRule", () => {
  const LOG_OPTIONS: ScrubRuleValidationOptions = {
    recordNoun: "logs",
    patternTypes: LOG_SCRUB_PATTERN_TYPES,
    fieldsToScrub: LOG_SCRUB_FIELDS,
  };

  const TRACE_OPTIONS: ScrubRuleValidationOptions = {
    recordNoun: "spans",
    patternTypes: TRACE_SCRUB_PATTERN_TYPES,
    fieldsToScrub: TRACE_SCRUB_FIELDS,
  };

  test("accepts every built-in pattern type without a regex", () => {
    for (const patternType of LOG_SCRUB_PATTERN_TYPES) {
      if (patternType === LogScrubPatternType.Custom) {
        continue;
      }

      expect(() => {
        validateScrubRule(
          { patternType, customRegex: undefined, fieldsToScrub: "both" },
          LOG_OPTIONS,
        );
      }).not.toThrow();
    }
  });

  test("accepts a custom rule with a pattern ingest can use", () => {
    expect(() => {
      validateScrubRule(
        { patternType: "custom", customRegex: VALID_REGEX },
        LOG_OPTIONS,
      );
    }).not.toThrow();
  });

  test("refuses a custom rule without a pattern, saying it would scrub nothing", () => {
    for (const customRegex of [undefined, null, "", "   "]) {
      expect(() => {
        validateScrubRule({ patternType: "custom", customRegex }, LOG_OPTIONS);
      }).toThrow(
        new BadDataException(
          "A Custom Regex rule needs a regular expression to match. Without one it scrubs nothing. Enter the pattern, or pick another pattern type.",
        ),
      );
    }
  });

  test("refuses a custom rule whose pattern does not compile, with the engine's reason", () => {
    let caught: unknown = null;

    try {
      validateScrubRule(
        { patternType: "custom", customRegex: "(unclosed" },
        LOG_OPTIONS,
      );
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadDataException);
    const message: string = (caught as Error).message;
    expect(message).toMatch(
      /^The custom pattern is not a valid regular expression \(.+\), so the rule would scrub nothing\./,
    );
    expect(message).not.toContain("Invalid regular expression: /");
  });

  test("refuses a custom pattern that matches empty text, naming the records", () => {
    expect(() => {
      validateScrubRule(
        { patternType: "custom", customRegex: "\\d*" },
        TRACE_OPTIONS,
      );
    }).toThrow(
      "The custom pattern matches empty text, so it would put its replacement between every character of your spans. Make it match at least one character.",
    );
  });

  test("refuses a pattern type ingest does not know, or none", () => {
    for (const patternType of ["Email", "creditcard", "regex", ""]) {
      expect(() => {
        validateScrubRule({ patternType }, LOG_OPTIONS);
      }).toThrow(BadDataException);
    }

    expect(() => {
      validateScrubRule({ patternType: undefined }, LOG_OPTIONS);
    }).toThrow(/Pattern type is required/);
  });

  test("refuses a fields-to-scrub value ingest does not know", () => {
    expect(() => {
      validateScrubRule(
        { patternType: "email", fieldsToScrub: "all" },
        LOG_OPTIONS,
      );
    }).toThrow(/Fields to scrub "all" is not one ingest knows/);

    expect(() => {
      validateScrubRule(
        { patternType: "email", fieldsToScrub: "both" },
        TRACE_OPTIONS,
      );
    }).toThrow(/would scrub none of your spans' fields/);
  });

  test("lets fields-to-scrub be left out, for the column's default", () => {
    for (const fieldsToScrub of [undefined, null]) {
      expect(() => {
        validateScrubRule({ patternType: "email", fieldsToScrub }, LOG_OPTIONS);
      }).not.toThrow();
    }
  });

  test("ignores the regex of a rule that is not custom", () => {
    expect(() => {
      validateScrubRule(
        { patternType: "email", customRegex: "(" },
        LOG_OPTIONS,
      );
    }).not.toThrow();
  });

  test("words each problem of a custom pattern for the records it is about", () => {
    expect(
      getScrubRuleCustomRegexRefusal(
        { problem: ScrubRuleCustomRegexProblem.MatchesEmptyText },
        LOG_OPTIONS,
      ),
    ).toContain("every character of your logs");
    expect(
      getScrubRuleCustomRegexRefusal(
        { problem: ScrubRuleCustomRegexProblem.Invalid, reason: "Nope" },
        TRACE_OPTIONS,
      ),
    ).toContain("(Nope)");
  });
});

describe.each(SUITES)("$name save-time hooks", (suite: Suite) => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createBy(data: Record<string, unknown>): CreateBy<any> {
    const model: any = new suite.modelType();
    model.name = "A rule";
    model.projectId = PROJECT_ID;

    for (const [key, value] of Object.entries(data)) {
      model[key] = value;
    }

    return { data: model, props: { isRoot: true } } as CreateBy<any>;
  }

  function updateBy(patch: Record<string, unknown>): UpdateBy<any> {
    return {
      query: { _id: RULE_ID.toString() },
      data: patch,
      props: { isRoot: true },
    } as unknown as UpdateBy<any>;
  }

  function storedRow(row: Record<string, unknown>): any {
    const model: any = new suite.modelType();
    model._id = RULE_ID.toString();

    for (const [key, value] of Object.entries(row)) {
      model[key] = value;
    }

    return model;
  }

  function mockStoredRows(rows: Array<any>): jest.SpyInstance {
    return getJestSpyOn(suite.service, "findBy").mockImplementation(
      async (): Promise<Array<any>> => {
        return rows;
      },
    );
  }

  describe("on create", () => {
    test("accepts a built-in pattern type with the columns left at their defaults", async () => {
      await expect(
        suite.service.onBeforeCreate(
          createBy({ patternType: suite.emailPatternType }),
        ),
      ).resolves.toBeDefined();
    });

    test("accepts a custom rule with a pattern", async () => {
      await expect(
        suite.service.onBeforeCreate(
          createBy({
            patternType: suite.customPatternType,
            customRegex: VALID_REGEX,
            fieldsToScrub: suite.validFieldsToScrub,
          }),
        ),
      ).resolves.toBeDefined();
    });

    /*
     * The regression: these were all saved, and all scrubbed nothing.
     */
    test("REGRESSION: refuses a custom rule with an empty pattern", async () => {
      for (const customRegex of [undefined, null, "", "  "]) {
        await expect(
          suite.service.onBeforeCreate(
            createBy({ patternType: suite.customPatternType, customRegex }),
          ),
        ).rejects.toThrow(BadDataException);
      }
    });

    test("REGRESSION: refuses a custom rule whose pattern does not compile", async () => {
      for (const customRegex of ["(", "[a-", "a{2,1}", "*abc"]) {
        await expect(
          suite.service.onBeforeCreate(
            createBy({ patternType: suite.customPatternType, customRegex }),
          ),
        ).rejects.toThrow(/not a valid regular expression/);
      }
    });

    test("refuses a custom pattern that matches empty text", async () => {
      await expect(
        suite.service.onBeforeCreate(
          createBy({
            patternType: suite.customPatternType,
            customRegex: "(secret)?",
          }),
        ),
      ).rejects.toThrow(
        new RegExp(`every character of your ${suite.recordNoun}`),
      );
    });

    test("refuses a pattern type or fields to scrub ingest does not know", async () => {
      await expect(
        suite.service.onBeforeCreate(createBy({ patternType: "Email" })),
      ).rejects.toThrow(BadDataException);

      await expect(
        suite.service.onBeforeCreate(
          createBy({
            patternType: suite.emailPatternType,
            fieldsToScrub: "everything",
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    test("does not judge the regex of a rule that is not custom", async () => {
      await expect(
        suite.service.onBeforeCreate(
          createBy({
            patternType: suite.sensitiveKeysPatternType,
            customRegex: "(",
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("does not judge the fields of a sensitive-keys rule, which ingest ignores", async () => {
      await expect(
        suite.service.onBeforeCreate(
          createBy({
            patternType: suite.sensitiveKeysPatternType,
            fieldsToScrub: "everything",
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("leaves updates to the check that runs after the permission checks", async () => {
      /*
       * onBeforeUpdate runs before any permission check, so a read there
       * would see rows the caller may not: the service does not override it.
       */
      expect(
        Object.prototype.hasOwnProperty.call(
          Object.getPrototypeOf(suite.service),
          "onBeforeUpdate",
        ),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(
          Object.getPrototypeOf(suite.service),
          "onBeforeUpdateUniqueCheck",
        ),
      ).toBe(true);
    });
  });

  describe("on update", () => {
    /*
     * A rename, Enabled switched off, a drag to another place in the list:
     * none of them can make a rule scrub less, so none costs a read - and
     * none is held up by a rule saved broken before this check.
     */
    test("does not read the rows when no column it judges is touched", async () => {
      const findBy: jest.SpyInstance = mockStoredRows([
        storedRow({ patternType: suite.customPatternType, customRegex: "" }),
      ]);

      for (const patch of [
        { name: "Renamed" },
        { isEnabled: false },
        { sortOrder: 3 },
        { description: "Why it exists" },
        { scrubAction: "mask" },
      ]) {
        await expect(
          suite.service.onBeforeUpdateUniqueCheck(updateBy(patch)),
        ).resolves.toBeUndefined();
      }

      expect(findBy).not.toHaveBeenCalled();
    });

    test("accepts a new pattern for a custom rule", async () => {
      mockStoredRows([
        storedRow({
          patternType: suite.customPatternType,
          customRegex: VALID_REGEX,
        }),
      ]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({ customRegex: "token=\\w+" }),
        ),
      ).resolves.toBeUndefined();
    });

    test("REGRESSION: refuses blanking the pattern of a custom rule", async () => {
      mockStoredRows([
        storedRow({
          patternType: suite.customPatternType,
          customRegex: VALID_REGEX,
        }),
      ]);

      for (const customRegex of ["", null]) {
        await expect(
          suite.service.onBeforeUpdateUniqueCheck(updateBy({ customRegex })),
        ).rejects.toThrow(BadDataException);
      }
    });

    /*
     * The merge case a patch-only check would miss: the request names only
     * the pattern type, and the row it lands on has no pattern.
     */
    test("REGRESSION: refuses switching a rule to Custom Regex without a pattern", async () => {
      mockStoredRows([storedRow({ patternType: suite.emailPatternType })]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({ patternType: suite.customPatternType }),
        ),
      ).rejects.toThrow(/needs a regular expression/);
    });

    test("accepts switching to Custom Regex when the patch brings the pattern", async () => {
      mockStoredRows([storedRow({ patternType: suite.emailPatternType })]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({
            patternType: suite.customPatternType,
            customRegex: VALID_REGEX,
          }),
        ),
      ).resolves.toBeUndefined();
    });

    test("accepts switching a broken custom rule to a built-in pattern type", async () => {
      mockStoredRows([
        storedRow({ patternType: suite.customPatternType, customRegex: "" }),
      ]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({ patternType: suite.emailPatternType }),
        ),
      ).resolves.toBeUndefined();
    });

    /*
     * A rule saved broken is given a pattern the moment its scrubbing is
     * edited - it never worked, so this asks for nothing it used to do.
     */
    test("asks a broken custom rule for a pattern when its scope is edited", async () => {
      mockStoredRows([
        storedRow({ patternType: suite.customPatternType, customRegex: "" }),
      ]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({ fieldsToScrub: suite.otherFieldsToScrub }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    /*
     * The edit dialog sends every column it selected, the hidden Fields to
     * Scrub of a sensitive-keys rule included: a value ingest ignores is
     * never what holds such a rule up.
     */
    test("does not judge the fields of a sensitive-keys rule, which ingest ignores", async () => {
      mockStoredRows([
        storedRow({
          patternType: suite.sensitiveKeysPatternType,
          fieldsToScrub: "Both",
        }),
      ]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({
            name: "Secrets",
            patternType: suite.sensitiveKeysPatternType,
            fieldsToScrub: "Both",
          }),
        ),
      ).resolves.toBeUndefined();
    });

    test("refuses an unknown pattern type or fields-to-scrub value", async () => {
      mockStoredRows([storedRow({ patternType: suite.emailPatternType })]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({ patternType: "ssn-us" }),
        ),
      ).rejects.toThrow(BadDataException);
      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({ fieldsToScrub: "nothing" }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    test("judges every row the update matches, not just the first", async () => {
      const healthy: any = storedRow({
        patternType: suite.customPatternType,
        customRegex: VALID_REGEX,
      });
      const wouldBreak: any = storedRow({
        patternType: suite.emailPatternType,
      });
      wouldBreak._id = OTHER_RULE_ID.toString();

      mockStoredRows([healthy, wouldBreak]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({ patternType: suite.customPatternType }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    test("passes when the update matches no rows", async () => {
      mockStoredRows([]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(updateBy({ customRegex: "" })),
      ).resolves.toBeUndefined();
    });

    test("skips a column set to a raw SQL expression, which cannot be judged", async () => {
      const findBy: jest.SpyInstance = mockStoredRows([
        storedRow({ patternType: suite.customPatternType }),
      ]);

      await expect(
        suite.service.onBeforeUpdateUniqueCheck(
          updateBy({
            customRegex: () => {
              return "'x'";
            },
          }),
        ),
      ).resolves.toBeUndefined();

      expect(findBy).not.toHaveBeenCalled();
    });

    test("reads only the three columns it judges, as root", async () => {
      const findBy: jest.SpyInstance = mockStoredRows([
        storedRow({
          patternType: suite.customPatternType,
          customRegex: VALID_REGEX,
        }),
      ]);

      await suite.service.onBeforeUpdateUniqueCheck(
        updateBy({ customRegex: "\\w+@x" }),
      );

      expect(findBy).toHaveBeenCalledTimes(1);
      const request: any = findBy.mock.calls[0]![0];
      expect(request.query).toEqual({ _id: RULE_ID.toString() });
      expect(request.select).toEqual({
        _id: true,
        patternType: true,
        customRegex: true,
        fieldsToScrub: true,
      });
      expect(request.props).toEqual({ isRoot: true });
    });
  });
});

/*
 * Through each service's real create pipeline (DatabaseService.create) with
 * billing on and only the database stubbed: the refusal holds for a project
 * member on a plan, and a rule created with nothing but its pattern type is
 * saved - the action, the fields and Enabled are left for the database's
 * defaults rather than refused as "required".
 */
describe.each(SUITES)(
  "$name created through DatabaseService.create",
  (suite: Suite) => {
    let save: jest.Mock;

    function memberProps(): DatabaseCommonInteractionProps {
      return {
        userId: USER_ID,
        tenantId: PROJECT_ID,
        currentPlan: PlanType.Free,
        userGlobalAccessPermission: {
          projectIds: [PROJECT_ID],
          globalPermissions: [Permission.Public, Permission.User],
          _type: "UserGlobalAccessPermission",
        },
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: {
            projectId: PROJECT_ID,
            permissions: [
              {
                permission: suite.createPermission,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              },
            ],
            _type: "UserTenantAccessPermission",
          },
        },
      } as DatabaseCommonInteractionProps;
    }

    function newRule(data: Record<string, unknown>): any {
      const model: any = new suite.modelType();
      model.name = "A rule";
      model.projectId = PROJECT_ID;

      for (const [key, value] of Object.entries(data)) {
        model[key] = value;
      }

      return model;
    }

    beforeEach(() => {
      silenceLogs();

      save = jest.fn(async (entity: any) => {
        entity._id = ObjectID.generate().toString();
        return entity;
      });

      getJestSpyOn(suite.service, "getRepository").mockReturnValue({
        save,
      } as never);
      getJestSpyOn(suite.service, "countBy").mockResolvedValue(
        new PositiveNumber(0) as never,
      );
      getJestSpyOn(suite.service, "findOneBy").mockResolvedValue(null as never);
      getJestSpyOn(suite.service, "onTriggerWorkflow").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(suite.service, "onTriggerRealtime").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(suite.service, "onCreateSuccess").mockImplementation(
        async (_onCreate: unknown, item: unknown): Promise<unknown> => {
          return item;
        },
      );
      // The new rule goes to the end of the list; the list is not under test.
      getJestSpyOn(ListOrderMaintainer, "planCreate").mockResolvedValue(
        null as never,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("runs with billing on", () => {
      expect(IsBillingEnabled).toBe(true);
    });

    test("REGRESSION: refuses a custom rule with no pattern, and saves nothing", async () => {
      await expect(
        suite.service.create({
          data: newRule({ patternType: suite.customPatternType }),
          props: memberProps(),
        }),
      ).rejects.toThrow(/needs a regular expression/);

      expect(save).not.toHaveBeenCalled();
    });

    test("REGRESSION: refuses a custom rule whose pattern does not compile, and saves nothing", async () => {
      await expect(
        suite.service.create({
          data: newRule({
            patternType: suite.customPatternType,
            customRegex: "([unclosed",
          }),
          props: memberProps(),
        }),
      ).rejects.toThrow(/not a valid regular expression/);

      expect(save).not.toHaveBeenCalled();
    });

    test("saves a rule given only its pattern type, leaving the rest to the database's defaults", async () => {
      await suite.service.create({
        data: newRule({ patternType: suite.emailPatternType }),
        props: memberProps(),
      });

      expect(save).toHaveBeenCalledTimes(1);
      const saved: any = save.mock.calls[0]![0];
      expect(saved.patternType).toBe(suite.emailPatternType);
      // Left out, so the INSERT takes the column defaults: redact, every field, on.
      expect(saved.scrubAction).toBeUndefined();
      expect(saved.fieldsToScrub).toBeUndefined();
      expect(saved.isEnabled).toBeUndefined();
    });

    test("saves a working custom rule with what it was given", async () => {
      await suite.service.create({
        data: newRule({
          patternType: suite.customPatternType,
          customRegex: VALID_REGEX,
          scrubAction: "mask",
          fieldsToScrub: suite.otherFieldsToScrub,
          isEnabled: false,
        }),
        props: memberProps(),
      });

      expect(save).toHaveBeenCalledTimes(1);
      const saved: any = save.mock.calls[0]![0];
      expect(saved.customRegex).toBe(VALID_REGEX);
      expect(saved.scrubAction).toBe("mask");
      expect(saved.fieldsToScrub).toBe(suite.otherFieldsToScrub);
      expect(saved.isEnabled).toBe(false);
    });
  },
);

/*
 * Through the real update pipeline (DatabaseService.updateOneById): the
 * hook runs on an edit from the dashboard or the API, before anything is
 * written.
 */
describe.each(SUITES)(
  "$name updated through DatabaseService.updateOneById",
  (suite: Suite) => {
    beforeEach(() => {
      silenceLogs();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("REGRESSION: refuses blanking a custom rule's pattern before writing", async () => {
      const stored: any = new suite.modelType();
      stored._id = RULE_ID.toString();
      stored.patternType = suite.customPatternType;
      stored.customRegex = VALID_REGEX;

      getJestSpyOn(suite.service, "findBy").mockResolvedValue([
        stored,
      ] as never);
      const getRepository: jest.SpyInstance = getJestSpyOn(
        suite.service,
        "getRepository",
      );

      await expect(
        suite.service.updateOneById({
          id: RULE_ID,
          data: { customRegex: "" },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(BadDataException);

      expect(getRepository).not.toHaveBeenCalled();
    });

    function projectMember(
      permissions: Array<Permission>,
    ): DatabaseCommonInteractionProps {
      return {
        userId: USER_ID,
        tenantId: PROJECT_ID,
        currentPlan: PlanType.Free,
        userGlobalAccessPermission: {
          projectIds: [PROJECT_ID],
          globalPermissions: [Permission.Public, Permission.User],
          _type: "UserGlobalAccessPermission",
        },
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: {
            projectId: PROJECT_ID,
            permissions: permissions.map((permission: Permission) => {
              return {
                permission,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              };
            }),
            _type: "UserTenantAccessPermission",
          },
        },
      } as DatabaseCommonInteractionProps;
    }

    /*
     * The stored rows are read once the permission checks have narrowed the
     * update to the caller's own project, so a refusal never tells anyone
     * about another project's rule.
     */
    test("reads the stored rule only within the caller's project", async () => {
      const stored: any = new suite.modelType();
      stored._id = RULE_ID.toString();
      stored.patternType = suite.customPatternType;
      stored.customRegex = VALID_REGEX;

      const findBy: jest.SpyInstance = getJestSpyOn(
        suite.service,
        "findBy",
      ).mockResolvedValue([stored] as never);

      await expect(
        suite.service.updateOneById({
          id: RULE_ID,
          data: { customRegex: "" },
          props: projectMember([
            Permission.ProjectMember,
            suite.editPermission,
          ]),
        }),
      ).rejects.toThrow(/needs a regular expression/);

      expect(findBy).toHaveBeenCalledTimes(1);
      const request: any = findBy.mock.calls[0]![0];
      expect(request.query["_id"]?.toString()).toBe(RULE_ID.toString());
      // The tenant scope the permission check added: this project only.
      expect(request.query["projectId"]).toBeDefined();
      expect(inspect(request.query["projectId"], { depth: 4 })).toContain(
        PROJECT_ID.toString(),
      );
    });

    test("reads nothing for a caller who may not edit scrub rules", async () => {
      const findBy: jest.SpyInstance = getJestSpyOn(
        suite.service,
        "findBy",
      ).mockResolvedValue([] as never);

      await expect(
        suite.service.updateOneById({
          id: RULE_ID,
          data: { customRegex: "" },
          props: projectMember([Permission.ProjectMember]),
        }),
      ).rejects.toThrow();

      expect(findBy).not.toHaveBeenCalled();
    });
  },
);
