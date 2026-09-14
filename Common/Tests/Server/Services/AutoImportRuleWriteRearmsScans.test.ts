/*
 * Contract under test — writing an auto-import rule hands the project's
 * recent discovery results back to the auto-import sweep (OneUptime issue
 * #3487).
 *
 * The sweep only ever looks at results nothing has evaluated yet, so a rule
 * written after a scan finished reaches nothing until that scan reports
 * again — never, for the one-shot scans a project starts with. The operator
 * then has a rule that visibly does nothing and a "Run Now" button they have
 * to remember to press, which is the complaint the issue was filed as.
 *
 * What these tests pin is WHICH writes are worth a sweep, because both
 * mistakes are quiet: too few and the rule goes on doing nothing, too many
 * and every rename of a rule re-reads every recent scan in the project.
 *
 *   - a new enabled import rule re-arms; a disabled one and an exclusion one
 *     do not, because neither can newly claim a host;
 *   - an edit re-arms only when it changed what the rule CLAIMS (criteria,
 *     ping-only hosts, the enable toggle, the monitor template) — never for
 *     a rename;
 *   - the decision is made from the rule as the DATABASE holds it after the
 *     write, not from the payload, whose booleans arrive from a form as
 *     strings;
 *   - one re-arm per project however many rules a single update touched;
 *   - and a re-arm that fails is logged, never raised: it must not fail an
 *     otherwise valid rule save.
 *
 * The engine is stubbed at the MODULE level: the re-arm itself has its own
 * suite (AutoImportRuleRearmRecentScans.test.ts), and the real module would
 * pull the whole device/monitor write path — and Postgres with it — into a
 * suite about hooks.
 */

jest.mock(
  "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService",
  () => {
    return {
      __esModule: true,
      default: {
        rearmRecentScansForRuleChange: jest.fn(),
      },
    };
  },
);

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceAutoImportRuleEngineService from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyService from "../../../Server/Services/NetworkAlertPolicyService";
import logger from "../../../Server/Utils/Logger";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const rearmMock: jest.Mock =
  NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange as unknown as jest.Mock;
const loggerErrorMock: jest.Mock = logger.error as unknown as jest.Mock;

function makeRule(
  overrides: Partial<NetworkDeviceAutoImportRule> = {},
): NetworkDeviceAutoImportRule {
  const rule: NetworkDeviceAutoImportRule = new NetworkDeviceAutoImportRule();
  rule.id = RULE_ID;
  rule.projectId = PROJECT_ID;
  rule.ipMatchTarget = "10.0.0.0/24";
  rule.isEnabled = true;
  Object.assign(rule, overrides);

  return rule;
}

async function createSucceeds(
  createdItem: NetworkDeviceAutoImportRule,
  tenantId?: ObjectID,
): Promise<void> {
  const onCreate: OnCreate<NetworkDeviceAutoImportRule> = {
    createBy: {
      data: createdItem,
      props: tenantId ? { tenantId: tenantId } : { isRoot: true },
    } as CreateBy<NetworkDeviceAutoImportRule>,
    carryForward: null,
  };

  await (NetworkDeviceAutoImportRuleService as any).onCreateSuccess(
    onCreate,
    createdItem,
  );
}

/*
 * One update, start to finish: onBeforeUpdate decides whether the save
 * changed what the rule claims and carries that forward, and onUpdateSuccess
 * acts on it. Running BOTH is the point — a plan that is computed and never
 * carried, or carried and never read, is exactly the kind of break that
 * leaves the feature silently doing nothing.
 */
async function updateSucceeds(data: {
  payload: Record<string, unknown>;
  rulesAfterUpdate: Array<NetworkDeviceAutoImportRule>;
  updatedItemIds?: Array<ObjectID>;
}): Promise<void> {
  jest
    .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
    .mockResolvedValue(data.rulesAfterUpdate);

  const updateBy: UpdateBy<NetworkDeviceAutoImportRule> = {
    query: { _id: RULE_ID.toString() },
    data: data.payload,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDeviceAutoImportRule>;

  const onUpdate: OnUpdate<NetworkDeviceAutoImportRule> = await (
    NetworkDeviceAutoImportRuleService as any
  ).onBeforeUpdate(updateBy);

  await (NetworkDeviceAutoImportRuleService as any).onUpdateSuccess(
    onUpdate,
    data.updatedItemIds ||
      data.rulesAfterUpdate.map((rule: NetworkDeviceAutoImportRule) => {
        return rule.id!;
      }),
  );
}

// The project ids handed to the engine, in call order.
function rearmedProjectIds(): Array<string> {
  return rearmMock.mock.calls.map((args: Array<unknown>): string => {
    return (args[0] as { projectId: ObjectID }).projectId.toString();
  });
}

describe("Writing an auto-import rule re-arms the project's recent scan results", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rearmMock.mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("on create", () => {
    it("re-arms the project of a new enabled import rule", async () => {
      await createSucceeds(makeRule());

      expect(rearmedProjectIds()).toEqual([PROJECT_ID.toString()]);
    });

    /*
     * The column defaults to true, so a create that never mentions it is an
     * enabled rule — and the saved row a hook is handed need not carry every
     * defaulted column.
     */
    it("re-arms when the create never mentioned the enable toggle", async () => {
      const rule: NetworkDeviceAutoImportRule = makeRule();
      delete rule.isEnabled;

      await createSucceeds(rule);

      expect(rearmMock).toHaveBeenCalledTimes(1);
    });

    it("does not re-arm for a rule created disabled", async () => {
      await createSucceeds(makeRule({ isEnabled: false }));

      expect(rearmMock).not.toHaveBeenCalled();
    });

    /*
     * An exclusion rule only vetoes what other rules claim. It can never
     * take a host that was not already taken, so re-reading the project's
     * scans on its account is work with no possible outcome.
     */
    it("does not re-arm for a new exclusion rule", async () => {
      await createSucceeds(makeRule({ isExclusion: true }));

      expect(rearmMock).not.toHaveBeenCalled();
    });

    it("falls back to the tenant of the write when the row carries no projectId", async () => {
      const rule: NetworkDeviceAutoImportRule = makeRule();
      delete rule.projectId;

      await createSucceeds(rule, OTHER_PROJECT_ID);

      expect(rearmedProjectIds()).toEqual([OTHER_PROJECT_ID.toString()]);
    });

    it("returns the created rule and logs, rather than failing the save, when the re-arm fails", async () => {
      rearmMock.mockRejectedValue(new Error("connection terminated"));

      const rule: NetworkDeviceAutoImportRule = makeRule();

      await expect(createSucceeds(rule)).resolves.toBeUndefined();

      // The detached rejection is handled on the next tick.
      await Promise.resolve();
      await Promise.resolve();

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
      expect(String(loggerErrorMock.mock.calls[0]![0])).toContain(
        "connection terminated",
      );
    });
  });

  describe("on update", () => {
    it("re-arms when the rule's match criteria change", async () => {
      await updateSucceeds({
        payload: { ipMatchTarget: "10.0.0.0/8" },
        rulesAfterUpdate: [makeRule({ ipMatchTarget: "10.0.0.0/8" })],
      });

      expect(rearmedProjectIds()).toEqual([PROJECT_ID.toString()]);
    });

    it("re-arms when a disabled rule is switched on", async () => {
      await updateSucceeds({
        payload: { isEnabled: true },
        rulesAfterUpdate: [makeRule({ isEnabled: true })],
      });

      expect(rearmMock).toHaveBeenCalledTimes(1);
    });

    /*
     * Ping-only hosts are a whole class of discovered host the rule either
     * claims or does not — reach, even though it is not one of the pattern
     * criteria the validator groups together.
     */
    it("re-arms when the rule starts including ping-only hosts", async () => {
      await updateSucceeds({
        payload: { includePingOnlyHosts: true },
        rulesAfterUpdate: [makeRule({ includePingOnlyHosts: true })],
      });

      expect(rearmMock).toHaveBeenCalledTimes(1);
    });

    /*
     * Attaching a template backfills a monitor onto devices this rule
     * already imported, so the sweep has real work even though no new device
     * will be created.
     */
    it("re-arms when a monitor template is attached", async () => {
      const monitorTemplate: MonitorTemplate = new MonitorTemplate();
      monitorTemplate.projectId = PROJECT_ID;
      monitorTemplate.monitorType = MonitorType.NetworkDevice;
      const step: MonitorStep = new MonitorStep();
      step.data!.networkDeviceMonitor = {
        networkDeviceId: ObjectID.generate().toString(),
        monitorInterfaces: true,
        oids: [],
      };
      monitorTemplate.monitorSteps = new MonitorSteps();
      monitorTemplate.monitorSteps.data = {
        monitorStepsInstanceArray: [step],
      };

      jest
        .spyOn(MonitorTemplateService, "findOneById")
        .mockResolvedValue(monitorTemplate);
      jest.spyOn(NetworkAlertPolicyService, "findBy").mockResolvedValue([]);

      await updateSucceeds({
        payload: { monitorTemplateId: TEMPLATE_ID },
        rulesAfterUpdate: [makeRule({ monitorTemplateId: TEMPLATE_ID })],
      });

      expect(rearmMock).toHaveBeenCalledTimes(1);
    });

    it("does not re-arm when the save only renamed the rule", async () => {
      const findBySpy: jest.SpyInstance = jest
        .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
        .mockResolvedValue([makeRule()]);

      await updateSucceeds({
        payload: { name: "Access switches", description: "Ground floor" },
        rulesAfterUpdate: [makeRule()],
      });

      expect(rearmMock).not.toHaveBeenCalled();
      /*
       * And it costs nothing: a cosmetic edit must not read the rules back
       * either, or every rename in a big project pays for a query.
       */
      expect(findBySpy).not.toHaveBeenCalled();
    });

    /*
     * The toggle a form posts is a string, and the rule the operator sees is
     * the ROW. A save that switched the rule off must not re-arm on the
     * strength of its own payload mentioning isEnabled.
     */
    it("does not re-arm when the rule ends up disabled", async () => {
      await updateSucceeds({
        payload: { isEnabled: false },
        rulesAfterUpdate: [makeRule({ isEnabled: false })],
      });

      expect(rearmMock).not.toHaveBeenCalled();
    });

    it("does not re-arm when the rule ends up an exclusion rule", async () => {
      await updateSucceeds({
        payload: { isExclusion: true },
        rulesAfterUpdate: [makeRule({ isExclusion: true })],
      });

      expect(rearmMock).not.toHaveBeenCalled();
    });

    it("re-arms each project once, however many of its rules one update matched", async () => {
      await updateSucceeds({
        payload: { ipMatchTarget: "10.0.0.0/8" },
        rulesAfterUpdate: [
          makeRule(),
          makeRule({ id: OTHER_RULE_ID }),
          makeRule({ id: OTHER_RULE_ID, projectId: OTHER_PROJECT_ID }),
        ],
        updatedItemIds: [RULE_ID, OTHER_RULE_ID],
      });

      expect(rearmedProjectIds()).toEqual([
        PROJECT_ID.toString(),
        OTHER_PROJECT_ID.toString(),
      ]);
    });

    it("does nothing when the update matched no rows", async () => {
      const findBySpy: jest.SpyInstance = jest
        .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
        .mockResolvedValue([]);

      await updateSucceeds({
        payload: { ipMatchTarget: "10.0.0.0/8" },
        rulesAfterUpdate: [],
        updatedItemIds: [],
      });

      expect(rearmMock).not.toHaveBeenCalled();
      // onBeforeUpdate's own validation read is the only one.
      expect(findBySpy).toHaveBeenCalledTimes(1);
    });
  });
});
