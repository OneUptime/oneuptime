import EditionPermissions from "../../../../../Server/Types/Database/Permissions/EditionPermission";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Query from "../../../../../Server/Types/Database/Query";
import EnterpriseEdition from "../../../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../../../Server/Enterprise/EnterpriseFeature";
import logger from "../../../../../Server/Utils/Logger";
import { DatabaseBaseModelType } from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomNotificationChannel from "../../../../../Models/DatabaseModels/CustomNotificationChannel";
import UserNotificationRule from "../../../../../Models/DatabaseModels/UserNotificationRule";
import UserNotificationSetting from "../../../../../Models/DatabaseModels/UserNotificationSetting";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import {
  createEditionStateCases,
  createLicenseSnapshot,
  EditionStateCase,
  installFakeEnterpriseModule,
  LICENSE_STATE_CASES,
  LicenseStateCase,
  uninstallEnterpriseModule,
} from "../../../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WRITING CUSTOM CHANNEL CONFIGURATION NEEDS THE LICENSE; REMOVING IT NEVER
 * DOES (EditionPermissions).
 *
 * Custom notification channels are an Enterprise feature
 * (EnterpriseFeature.CustomNotificationChannels). Self-hosted (billing off):
 *
 *   - CustomNotificationChannel is enterprise configuration
 *     (@TableEditionAccessControl requiresEnterprise): adding or changing a
 *     channel - turning it off included, there is no tighten-only update for
 *     it - is refused while the feature is not available, on the Community
 *     Edition in its words and on the Enterprise Edition in the license's.
 *     Reading and deleting one never is.
 *   - Pointing an on-call rule at a channel
 *     (UserNotificationRule.customNotificationChannelId) and sending a
 *     person's notifications to the channels
 *     (UserNotificationSetting.alertByCustomChannel) are enterprise columns:
 *     setting one is refused the same way, clearing it (no channel, the
 *     switch off) never is, and every other column of the same write is
 *     left to the usual checks.
 *   - Master admins are checked too; internal root writes never are, which
 *     is how core keeps its own rules (a deleted channel's rules) in order.
 *   - An unknown license state fails closed: availability, not activity.
 *
 * OneUptime Cloud (billing on) is never refused here.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const FEATURE: EnterpriseFeature = EnterpriseFeature.CustomNotificationChannels;

const ALL_BUT_CUSTOM_CHANNELS: Array<EnterpriseFeature> =
  ALL_ENTERPRISE_FEATURES.filter((feature: EnterpriseFeature): boolean => {
    return feature !== FEATURE;
  });

const projectId: ObjectID = new ObjectID(
  "c4a60000-0000-4000-8000-000000000001",
);
const userId: ObjectID = new ObjectID("c4a60000-0000-4000-8000-000000000002");
const channelId: ObjectID = new ObjectID(
  "c4a60000-0000-4000-8000-000000000003",
);

const memberProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    } as UserTenantAccessPermission;

    return {
      userId,
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  };

const masterAdminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return { userId, isMasterAdmin: true };
  };

const rootProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return { isRoot: true };
  };

type Outcome = "allowed" | "community" | "license" | string;

// Runs a gate and names how it answered.
const outcomeOf: (check: () => void) => Outcome = (
  check: () => void,
): Outcome => {
  try {
    check();
    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      if (err.message === EnterpriseEdition.COMMUNITY_EDITION_MESSAGE) {
        return "community";
      }

      if (err.message === EnterpriseEdition.LICENSE_REQUIRED_MESSAGE) {
        return "license";
      }

      return err.message;
    }

    throw err;
  }
};

// The model gate, for a write of CustomNotificationChannel.
const channelGate: (
  operation: DatabaseRequestType,
  data?: unknown,
  props?: DatabaseCommonInteractionProps,
) => Outcome = (
  operation: DatabaseRequestType,
  data?: unknown,
  props?: DatabaseCommonInteractionProps,
): Outcome => {
  return outcomeOf(() => {
    EditionPermissions.checkEditionPermissions(
      CustomNotificationChannel,
      props || masterAdminProps(),
      operation,
      data,
    );
  });
};

// The column gate, for a write of a rule or a notification setting.
const columnGate: (
  modelType: DatabaseBaseModelType,
  operation: DatabaseRequestType,
  data: unknown,
  props?: DatabaseCommonInteractionProps,
) => Outcome = (
  modelType: DatabaseBaseModelType,
  operation: DatabaseRequestType,
  data: unknown,
  props?: DatabaseCommonInteractionProps,
): Outcome => {
  return outcomeOf(() => {
    EditionPermissions.checkEnterpriseColumnPermissions(
      modelType,
      props || memberProps(),
      operation,
      data,
    );
  });
};

interface ColumnCase {
  table: string;
  modelType: DatabaseBaseModelType;
  column: string;
  // Values that set it, with a label for each.
  setting: Array<[string, unknown]>;
  // Values that clear it, with a label for each.
  clearing: Array<[string, unknown]>;
  // Another column of the same model, never gated here.
  other: Record<string, unknown>;
}

const COLUMN_CASES: Array<ColumnCase> = [
  {
    table: "UserNotificationRule",
    modelType: UserNotificationRule,
    column: "customNotificationChannelId",
    setting: [
      ["a channel's id", channelId],
      ["a channel's id as text", channelId.toString()],
      // An id column has no empty text: "" is not "no channel" (fail closed).
      ["an empty string", ""],
    ],
    clearing: [["null (no channel)", null]],
    other: { notifyAfterMinutes: 5, userEmailId: ObjectID.generate() },
  },
  {
    table: "UserNotificationSetting",
    modelType: UserNotificationSetting,
    column: "alertByCustomChannel",
    setting: [
      ["true", true],
      // Exactly the default clears it; an unclear value never gets the feature.
      ['"true"', "true"],
    ],
    clearing: [["false (the switch off)", false]],
    other: { alertByEmail: true, alertBySMS: true, alertByPush: false },
  },
];

const COLUMN_ROWS: Array<[string, ColumnCase]> = COLUMN_CASES.map(
  (columnCase: ColumnCase): [string, ColumnCase] => {
    return [`${columnCase.table}.${columnCase.column}`, columnCase];
  },
);

/*
 * Whether configuration may be written in each license state: a usable
 * license that includes custom channels, known now. An unknown state fails
 * closed here (the runtime keeps running in it).
 */
const WRITE_BY_LICENSE_STATE: Record<string, Outcome> = {
  "valid license": "allowed",
  "license expired less than 30 days ago (grace)": "allowed",
  "no license, inside the 14-day trial": "allowed",
  "unverified legacy license, accepted": "allowed",
  "license expired more than 30 days ago": "license",
  "no license after the trial": "license",
  "invalid license": "license",
  "valid license without SCIM or audit logs": "license",
  "license not read yet (unknown)": "license",
  "no license, trial start not recorded yet (unknown)": "license",
  "license snapshot unreadable (unknown)": "license",
};

const LICENSE_ROWS: Array<[string, LicenseStateCase]> = LICENSE_STATE_CASES.map(
  (state: LicenseStateCase): [string, LicenseStateCase] => {
    return [state.label, state];
  },
);

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("what is gated", () => {
  test("a custom channel is enterprise configuration of custom channels", () => {
    expect(new CustomNotificationChannel().requiresEnterprise).toBe(true);
    expect(EnterpriseEdition.getModelFeature(CustomNotificationChannel)).toBe(
      FEATURE,
    );
  });

  test("a channel has no tighten-only update: turning it off is a change like any other", () => {
    expect(
      EditionPermissions.getTightenOnlyColumns().has(
        "CustomNotificationChannel",
      ),
    ).toBe(false);
    expect(
      EditionPermissions.isTightenOnlyUpdate("CustomNotificationChannel", {
        isEnabled: false,
      }),
    ).toBe(false);
  });

  test.each(COLUMN_ROWS)(
    "%s is the one enterprise column of its table",
    (_label: string, columnCase: ColumnCase) => {
      expect(
        EnterpriseEdition.getEnterpriseColumnsForTableName(columnCase.table),
      ).toEqual({ [columnCase.column]: FEATURE });
    },
  );

  test.each(COLUMN_ROWS)(
    "%s: what sets it names the feature once; what clears it, or another column, names none",
    (_label: string, columnCase: ColumnCase) => {
      for (const [, value] of columnCase.setting) {
        expect(
          EditionPermissions.getEnterpriseFeaturesWritten(
            columnCase.modelType,
            {
              ...columnCase.other,
              [columnCase.column]: value,
            },
          ),
        ).toEqual([FEATURE]);
      }

      for (const [, value] of columnCase.clearing) {
        expect(
          EditionPermissions.getEnterpriseFeaturesWritten(
            columnCase.modelType,
            {
              ...columnCase.other,
              [columnCase.column]: value,
            },
          ),
        ).toEqual([]);
      }

      expect(
        EditionPermissions.getEnterpriseFeaturesWritten(
          columnCase.modelType,
          columnCase.other,
        ),
      ).toEqual([]);
    },
  );
});

describe("a custom channel, self-hosted", () => {
  test.each([DatabaseRequestType.Create, DatabaseRequestType.Update])(
    "the Community Edition refuses to %s one, in the Community Edition's words, for master admins and anybody else",
    (operation: DatabaseRequestType) => {
      expect(channelGate(operation, { name: "CorpoApp" })).toBe("community");
      expect(channelGate(operation, { name: "CorpoApp" }, memberProps())).toBe(
        "community",
      );
    },
  );

  test("turning a channel off is refused too: without the license the page is read-only", () => {
    expect(channelGate(DatabaseRequestType.Update, { isEnabled: false })).toBe(
      "community",
    );
  });

  test.each([DatabaseRequestType.Read, DatabaseRequestType.Delete])(
    "%s is never refused: what was configured can be seen and removed",
    (operation: DatabaseRequestType) => {
      expect(channelGate(operation)).toBe("allowed");
    },
  );

  test("internal root writes are never checked", () => {
    for (const operation of [
      DatabaseRequestType.Create,
      DatabaseRequestType.Update,
    ]) {
      expect(channelGate(operation, { name: "CorpoApp" }, rootProps())).toBe(
        "allowed",
      );
    }
  });

  test.each(LICENSE_ROWS)(
    "the Enterprise Edition, %s",
    (label: string, state: LicenseStateCase) => {
      state.install();

      for (const operation of [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
      ]) {
        expect({ operation, outcome: channelGate(operation, {}) }).toEqual({
          operation,
          outcome: WRITE_BY_LICENSE_STATE[label],
        });
      }

      expect(channelGate(DatabaseRequestType.Delete)).toBe("allowed");
    },
  );

  test("a license that leaves custom channels out cannot add one, whatever else it includes", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: ALL_BUT_CUSTOM_CHANNELS }),
    });

    expect(channelGate(DatabaseRequestType.Create, {})).toBe("license");
  });

  test("a license that names custom channels alone can", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: [FEATURE] }),
    });

    expect(channelGate(DatabaseRequestType.Create, {})).toBe("allowed");
  });
});

describe.each(COLUMN_ROWS)(
  "%s, self-hosted",
  (_label: string, columnCase: ColumnCase) => {
    test.each([DatabaseRequestType.Create, DatabaseRequestType.Update])(
      "the Community Edition refuses a %s that sets it, for anybody and for master admins",
      (operation: DatabaseRequestType) => {
        for (const [valueLabel, value] of columnCase.setting) {
          const write: Record<string, unknown> = {
            ...columnCase.other,
            [columnCase.column]: value,
          };

          expect({
            valueLabel,
            outcome: columnGate(columnCase.modelType, operation, write),
          }).toEqual({ valueLabel, outcome: "community" });
          expect({
            valueLabel,
            outcome: columnGate(
              columnCase.modelType,
              operation,
              write,
              masterAdminProps(),
            ),
          }).toEqual({ valueLabel, outcome: "community" });
        }
      },
    );

    test.each([DatabaseRequestType.Create, DatabaseRequestType.Update])(
      "the Community Edition lets anybody %s it cleared, or not written at all",
      (operation: DatabaseRequestType) => {
        for (const [, value] of columnCase.clearing) {
          expect(
            columnGate(columnCase.modelType, operation, {
              ...columnCase.other,
              [columnCase.column]: value,
            }),
          ).toBe("allowed");
        }

        expect(
          columnGate(columnCase.modelType, operation, columnCase.other),
        ).toBe("allowed");
      },
    );

    test("internal root writes, reads and deletes are never checked", () => {
      const write: Record<string, unknown> = {
        [columnCase.column]: columnCase.setting[0]![1],
      };

      expect(
        columnGate(
          columnCase.modelType,
          DatabaseRequestType.Create,
          write,
          rootProps(),
        ),
      ).toBe("allowed");
      expect(
        columnGate(columnCase.modelType, DatabaseRequestType.Read, write),
      ).toBe("allowed");
      expect(
        columnGate(columnCase.modelType, DatabaseRequestType.Delete, write),
      ).toBe("allowed");
    });

    test.each(LICENSE_ROWS)(
      "the Enterprise Edition, %s",
      (label: string, state: LicenseStateCase) => {
        state.install();

        expect(
          columnGate(columnCase.modelType, DatabaseRequestType.Update, {
            [columnCase.column]: columnCase.setting[0]![1],
          }),
        ).toBe(WRITE_BY_LICENSE_STATE[label]);
        // Clearing it always works.
        expect(
          columnGate(columnCase.modelType, DatabaseRequestType.Update, {
            [columnCase.column]: columnCase.clearing[0]![1],
          }),
        ).toBe("allowed");
      },
    );

    test("a license that leaves custom channels out cannot set it, and can clear it", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({ features: ALL_BUT_CUSTOM_CHANNELS }),
      });

      expect(
        columnGate(columnCase.modelType, DatabaseRequestType.Create, {
          [columnCase.column]: columnCase.setting[0]![1],
        }),
      ).toBe("license");
      expect(
        columnGate(columnCase.modelType, DatabaseRequestType.Create, {
          [columnCase.column]: columnCase.clearing[0]![1],
        }),
      ).toBe("allowed");
    });
  },
);

describe("OneUptime Cloud: the edition gate never refuses", () => {
  test.each(
    createEditionStateCases()
      .filter((state: EditionStateCase): boolean => {
        return state.billing;
      })
      .map((state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      }),
  )("%s", (_label: string, state: EditionStateCase) => {
    state.apply();

    expect(channelGate(DatabaseRequestType.Create, {})).toBe("allowed");

    for (const columnCase of COLUMN_CASES) {
      expect(
        columnGate(columnCase.modelType, DatabaseRequestType.Update, {
          [columnCase.column]: columnCase.setting[0]![1],
        }),
      ).toBe("allowed");
    }
  });
});

describe("through the real permission entry points, as a master admin", () => {
  const channelQuery: Query<CustomNotificationChannel> = {
    _id: channelId.toString(),
  } as Query<CustomNotificationChannel>;
  const ruleQuery: Query<UserNotificationRule> = {
    _id: ObjectID.generate().toString(),
  } as Query<UserNotificationRule>;

  const newChannel: () => CustomNotificationChannel =
    (): CustomNotificationChannel => {
      const channel: CustomNotificationChannel =
        new CustomNotificationChannel();
      channel.name = "CorpoApp";
      channel.webhookUrl = "https://push.internal.example.com/oneuptime";
      return channel;
    };

  test("Community Edition: adding a channel is refused", () => {
    expect(() => {
      CreatePermission.checkCreatePermissions(
        CustomNotificationChannel,
        newChannel(),
        masterAdminProps(),
      );
    }).toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
  });

  test("Community Edition: changing a channel is refused", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        CustomNotificationChannel,
        channelQuery,
        { name: "CorpoApp 2" },
        masterAdminProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
  });

  test("Community Edition: deleting a channel is allowed", async () => {
    await expect(
      DeletePermission.checkDeletePermission(
        CustomNotificationChannel,
        channelQuery,
        masterAdminProps(),
      ),
    ).resolves.toEqual(channelQuery);
  });

  test("Enterprise Edition after a lapse: adding a channel is refused in the license's words; deleting one is not", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: ALL_BUT_CUSTOM_CHANNELS }),
    });

    expect(() => {
      CreatePermission.checkCreatePermissions(
        CustomNotificationChannel,
        newChannel(),
        masterAdminProps(),
      );
    }).toThrow(
      new PaymentRequiredException(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE),
    );
    await expect(
      DeletePermission.checkDeletePermission(
        CustomNotificationChannel,
        channelQuery,
        masterAdminProps(),
      ),
    ).resolves.toBeDefined();
  });

  test("Enterprise Edition with a license that includes them: adding and changing a channel go through", async () => {
    installFakeEnterpriseModule();

    expect(() => {
      CreatePermission.checkCreatePermissions(
        CustomNotificationChannel,
        newChannel(),
        masterAdminProps(),
      );
    }).not.toThrow();
    await expect(
      UpdatePermission.checkUpdatePermissions(
        CustomNotificationChannel,
        channelQuery,
        { isEnabled: false },
        masterAdminProps(),
      ),
    ).resolves.toEqual(channelQuery);
  });

  test("Community Edition: pointing a rule at a channel is refused, and taking it off is allowed", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        UserNotificationRule,
        ruleQuery,
        { customNotificationChannelId: channelId },
        masterAdminProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
    await expect(
      UpdatePermission.checkUpdatePermissions(
        UserNotificationRule,
        ruleQuery,
        { customNotificationChannelId: null },
        masterAdminProps(),
      ),
    ).resolves.toEqual(ruleQuery);
  });

  test("Community Edition: a rule created through a channel is refused; one through an email is not", () => {
    const throughChannel: UserNotificationRule = new UserNotificationRule();
    throughChannel.projectId = projectId;
    throughChannel.userId = userId;
    throughChannel.customNotificationChannelId = channelId;

    expect(() => {
      CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        throughChannel,
        masterAdminProps(),
      );
    }).toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );

    const throughEmail: UserNotificationRule = new UserNotificationRule();
    throughEmail.projectId = projectId;
    throughEmail.userId = userId;
    throughEmail.userEmailId = ObjectID.generate();

    expect(() => {
      CreatePermission.checkCreatePermissions(
        UserNotificationRule,
        throughEmail,
        masterAdminProps(),
      );
    }).not.toThrow();
  });
});
