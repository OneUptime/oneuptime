import RemediationApproval from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import RemediationFixProducts from "../../../../Server/Utils/AutoRemediation/RemediationFixProducts";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import PrivateRecordWriteCheck from "../../../../Server/Utils/Permission/PrivateRecordWriteCheck";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import ProductSwitchedOffException from "../../../../Types/Exception/ProductSwitchedOffException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import ProductKey from "../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";
import UserType from "../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A FIX OF ONEUPTIME AI, WHILE A PRODUCT IT ACTS ON IS SWITCHED OFF ON THE
 * SERVER (#9489).
 *
 * A fix is for an incident or an alert, and a fix that starts a runbook
 * starts it in Runbooks. While the server has the record's product off,
 * approving, dry-running and dismissing the fix are refused - with PR
 * #9484's words, and nothing claimed or posted - and while Runbooks is off,
 * so is approving a fix that starts a runbook. Dismissing it, which starts
 * nothing, goes on; a fix of a product that is on is never refused for
 * another one. The AI card's buttons and a Slack or Microsoft Teams press
 * come through the same RemediationApproval.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c9489aa0-0000-4000-8000-000000000001",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "c9489aa0-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("c9489aa0-0000-4000-8000-000000000003");
const INCIDENT_ID: ObjectID = new ObjectID(
  "c9489aa0-0000-4000-8000-000000000004",
);
const ALERT_ID: ObjectID = new ObjectID("c9489aa0-0000-4000-8000-000000000005");
const RUNBOOK_ID: ObjectID = new ObjectID(
  "c9489aa0-0000-4000-8000-000000000006",
);

// A Project Owner: everything a fix's buttons ask of a person.
const OWNER: DatabaseCommonInteractionProps =
  ((): DatabaseCommonInteractionProps => {
    const permissionMap: Dictionary<UserTenantAccessPermission> = {};

    permissionMap[PROJECT_ID.toString()] = {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
        } as UserPermission,
      ],
    };

    return {
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
      userTenantAccessPermission: permissionMap,
    };
  })();

const switchedOffMessage: (title: string) => string = (
  title: string,
): string => {
  return `${title} is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.`;
};

function fixRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    version: 1,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    runbookId: RUNBOOK_ID,
    runbookNameSnapshot: "Restart checkout",
    verificationWindowMinutes: 15,
    ...overrides,
  };
}

let row: Record<string, unknown>;
let casSpy: jest.SpiedFunction<
  typeof AutoRemediationSuggestionService.attemptStatusTransition
>;
let incidentFeedSpy: jest.SpiedFunction<
  typeof IncidentFeedService.createIncidentFeedItem
>;

const switchOff: (products: Array<ProductKey>) => void = (
  products: Array<ProductKey>,
): void => {
  jest.spyOn(ServerProducts, "getOff").mockResolvedValue(
    Object.fromEntries(
      products.map((product: ProductKey) => {
        return [product, ServerProductOffReason.SwitchedOff];
      }),
    ),
  );
};

beforeEach(() => {
  row = fixRow();

  jest.spyOn(PrivateRecordWriteCheck, "reaches").mockResolvedValue(true);

  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation((async (args: {
      select: Record<string, unknown>;
    }): Promise<AutoRemediationSuggestion> => {
      const picked: Record<string, unknown> = { id: row["id"] };

      for (const key of Object.keys(args.select)) {
        if (key in row) {
          picked[key] = row[key];
        }
      }

      return picked as unknown as AutoRemediationSuggestion;
    }) as never);

  casSpy = jest
    .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
    .mockResolvedValue(1 as never);

  incidentFeedSpy = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a fix of a record whose product is switched off", () => {
  test("approving it is refused with who can switch Incidents on, and nothing is claimed or posted", async () => {
    switchOff([ProductKey.Incidents]);

    const refusal: unknown = await RemediationApproval.approve({
      props: OWNER,
      suggestionId: SUGGESTION_ID.toString(),
    }).catch((err: unknown) => {
      return err;
    });

    expect(refusal).toBeInstanceOf(ProductSwitchedOffException);
    expect((refusal as ProductSwitchedOffException).product).toBe(
      ProductKey.Incidents,
    );
    expect((refusal as Error).message).toBe(switchedOffMessage("Incidents"));
    expect(casSpy).not.toHaveBeenCalled();
    expect(incidentFeedSpy).not.toHaveBeenCalled();
  });

  test("an alert's fix names Alerts", async () => {
    row = fixRow({ incidentId: undefined, alertId: ALERT_ID });
    switchOff([ProductKey.Alerts]);

    await expect(
      RemediationApproval.approve({
        props: OWNER,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(switchedOffMessage("Alerts"));
    expect(casSpy).not.toHaveBeenCalled();
  });

  test("dismissing it is refused too: it writes to the record", async () => {
    switchOff([ProductKey.Incidents]);

    await expect(
      RemediationApproval.dismiss({
        props: OWNER,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toBeInstanceOf(ProductSwitchedOffException);
    expect(casSpy).not.toHaveBeenCalled();
    expect(incidentFeedSpy).not.toHaveBeenCalled();
  });

  test("a dry run of its cloud changes is refused", async () => {
    row = fixRow({
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      runbookId: undefined,
    });
    switchOff([ProductKey.Incidents]);

    await expect(
      RemediationApproval.startDryRun({
        props: OWNER,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(switchedOffMessage("Incidents"));
  });

  test("so is a dry run while Cloud is off: it asks the account's Cloud AI agent", async () => {
    row = fixRow({
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      runbookId: undefined,
    });
    switchOff([ProductKey.Cloud]);

    await expect(
      RemediationApproval.startDryRun({
        props: OWNER,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(switchedOffMessage("Cloud"));
  });

  test("a fix of a product that is on is never refused for another one", async () => {
    switchOff([ProductKey.Alerts, ProductKey.Logs]);

    const outcome: unknown = await RemediationApproval.approve({
      props: OWNER,
      suggestionId: SUGGESTION_ID.toString(),
    }).catch((err: unknown) => {
      return err;
    });

    // What approving does next is the rest of the suites'; it is not this.
    expect(outcome).not.toBeInstanceOf(ProductSwitchedOffException);

    const dismissed: JSONObject = await RemediationApproval.dismiss({
      props: OWNER,
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(dismissed["status"]).toBe(AutoRemediationSuggestionStatus.Dismissed);
  });
});

describe("a fix that starts a runbook, while Runbooks is switched off", () => {
  test("approving it is refused with who can switch Runbooks on, before anything is claimed", async () => {
    switchOff([ProductKey.Runbooks]);

    const refusal: unknown = await RemediationApproval.approve({
      props: OWNER,
      suggestionId: SUGGESTION_ID.toString(),
    }).catch((err: unknown) => {
      return err;
    });

    expect(refusal).toBeInstanceOf(ProductSwitchedOffException);
    expect((refusal as Error).message).toBe(switchedOffMessage("Runbooks"));
    expect(casSpy).not.toHaveBeenCalled();
  });

  test("so is a fix from before fixes had a kind, which starts a runbook", async () => {
    row = fixRow({ suggestionType: undefined });
    switchOff([ProductKey.Runbooks]);

    await expect(
      RemediationApproval.approve({
        props: OWNER,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(switchedOffMessage("Runbooks"));
  });

  test("dismissing it starts nothing, and goes on", async () => {
    switchOff([ProductKey.Runbooks]);

    const dismissed: JSONObject = await RemediationApproval.dismiss({
      props: OWNER,
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(dismissed["status"]).toBe(AutoRemediationSuggestionStatus.Dismissed);
    expect(casSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    AutoRemediationSuggestionType.CommandPlan,
    AutoRemediationSuggestionType.McpToolCalls,
  ])(
    "a fix that runs no runbook (%s) is not refused for Runbooks",
    async (suggestionType: AutoRemediationSuggestionType) => {
      row = fixRow({ suggestionType: suggestionType, runbookId: undefined });
      switchOff([ProductKey.Runbooks]);

      const outcome: unknown = await RemediationApproval.approve({
        props: OWNER,
        suggestionId: SUGGESTION_ID.toString(),
      }).catch((err: unknown) => {
        return err;
      });

      expect(outcome).not.toBeInstanceOf(ProductSwitchedOffException);
    },
  );
});

describe("RemediationFixProducts", () => {
  test("a fix acts on its record's product, and a runbook's fix on Runbooks too", () => {
    expect(
      RemediationFixProducts.ofSubject({ incidentId: INCIDENT_ID }),
    ).toEqual([ProductKey.Incidents]);
    expect(RemediationFixProducts.ofSubject({ alertId: ALERT_ID })).toEqual([
      ProductKey.Alerts,
    ]);
    expect(RemediationFixProducts.ofSubject({})).toEqual([]);

    expect(
      RemediationFixProducts.ofApproval({
        incidentId: INCIDENT_ID,
        suggestionType: AutoRemediationSuggestionType.Runbook,
      }),
    ).toEqual([ProductKey.Incidents, ProductKey.Runbooks]);
    expect(
      RemediationFixProducts.ofApproval({
        alertId: ALERT_ID,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
      }),
    ).toEqual([ProductKey.Alerts]);
    expect(
      RemediationFixProducts.ofApproval({
        incidentId: INCIDENT_ID,
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
      }),
    ).toEqual([ProductKey.Incidents]);
  });

  test("a dry run asks the account's Cloud AI agent", () => {
    expect(
      RemediationFixProducts.ofDryRun({
        incidentId: INCIDENT_ID,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
      }),
    ).toEqual([ProductKey.Incidents, ProductKey.Cloud]);
  });

  test("assertMayActOn names the first product that is off, and says nothing while all are on", async () => {
    switchOff([ProductKey.Runbooks]);

    await expect(
      RemediationFixProducts.assertMayActOn([
        ProductKey.Incidents,
        ProductKey.Runbooks,
      ]),
    ).rejects.toThrow(switchedOffMessage("Runbooks"));
    await expect(
      RemediationFixProducts.assertMayActOn([ProductKey.Incidents]),
    ).resolves.toBeUndefined();
    await expect(
      RemediationFixProducts.assertMayActOn([]),
    ).resolves.toBeUndefined();
  });
});
