/*
 * The services first, as a server loads them: Services/Index reaches
 * OneUptime AI's toolbox, which runs a Data Security store's rules through
 * RuleRunner, while the services it lists are still loading. This import
 * stays first.
 */
import Services from "../../../../../Server/Services/Index";
import RuleRunRegistry, {
  RuleRunDefinition,
} from "../../../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import { RuleRunType } from "../../../../../Types/Rules/RuleRun";
import { describe, expect, it } from "@jest/globals";

/*
 * EVERY RULE'S RUN NOW HAS ITS SERVICES, WHATEVER LOADED FIRST.
 *
 * RuleRunRegistry names, for each rule type, the services and the engine its
 * Run now uses. Built as its module loaded, the table took whatever those
 * services were at that moment - and loaded from the services, as a server
 * loads it, the registry was reached through OneUptime AI's toolbox while
 * the services of alerts, incidents, their episodes, monitors, on-call
 * policies, scheduled maintenance, hosts, network devices, data stores and
 * OpenStack clouds were still loading. The entries of 26 rule types held no
 * resource service, and every Run now of those label, owner and privacy
 * rules failed: "Cannot read properties of undefined (reading 'findBy')".
 * The table is now built on first use. RuleRunRegistry.test.ts checks what
 * each entry is wired to; this checks the wiring is there after a server's
 * load order.
 */

const RESOURCE_RULE_TYPES: Array<RuleRunType> = Object.values(
  RuleRunType,
).filter((ruleType: RuleRunType): boolean => {
  return !RuleRunRegistry.isSyncRuleRunType(ruleType);
});

describe("RuleRunRegistry, loaded after the services", () => {
  it("is loaded the way a server loads it: after every service", () => {
    expect(Services.length).toBeGreaterThan(500);
    expect(RESOURCE_RULE_TYPES.length).toBeGreaterThan(70);
  });

  it.each(RESOURCE_RULE_TYPES)(
    "%s has its rule's service, its resource's service and its engine",
    (ruleType: RuleRunType) => {
      const definition: RuleRunDefinition | null =
        RuleRunRegistry.getDefinition(ruleType);

      expect({
        ruleType: ruleType,
        ruleService: Boolean(definition?.ruleService),
        resourceService: Boolean(definition?.resourceService),
        engine: Boolean(definition?.engine),
      }).toEqual({
        ruleType: ruleType,
        ruleService: true,
        resourceService: true,
        engine: true,
      });
    },
  );
});
