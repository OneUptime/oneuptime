import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  OPENSTACK_HOURS_IN_A_MONTH,
  OPENSTACK_USAGE_DAY_ROWS_KEPT_DAYS,
  OPENSTACK_USAGE_EVERY_MINUTES,
  OPENSTACK_USAGE_MONTH_ROWS_KEPT_MONTHS,
} from "Common/Types/OpenStack/OpenStackProjectUsage";
import {
  OPENSTACK_WASTE_FLOATING_IP_DAYS,
  OPENSTACK_WASTE_IDLE_HOST_ALLOCATED_PERCENT,
  OPENSTACK_WASTE_IMAGE_DAYS,
  OPENSTACK_WASTE_INSTANCE_DAYS,
  OPENSTACK_WASTE_RULES,
  OPENSTACK_WASTE_SNAPSHOT_DAYS,
  OPENSTACK_WASTE_VOLUME_DAYS,
  OpenStackWasteRuleWords,
} from "Common/Types/OpenStack/OpenStackWaste";

/*
 * What the docs say of usage and waste, held to the constants the code runs on, so a rule moved
 * in one can't be left saying something else in the other.
 */

const SPEND: string = (() => {
  const text: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../../FeatureSet/Docs/Content/en/telemetry/openstack.md",
    ),
    "utf8",
  );
  const start: number = text.indexOf("## Spend");

  return text.substring(start, text.indexOf("## Real usage", start));
})();

describe("what the docs say of a cloud's Spend page", () => {
  test("how often it reads, and what it keeps", () => {
    expect(SPEND).toContain(`Every ${OPENSTACK_USAGE_EVERY_MINUTES} minutes`);
    expect(SPEND).toContain(
      `each of ${OPENSTACK_USAGE_MONTH_ROWS_KEPT_MONTHS} months`,
    );
    expect(SPEND).toContain(
      `the last ${OPENSTACK_USAGE_DAY_ROWS_KEPT_DAYS} days`,
    );
    expect(SPEND).toContain(`about ${OPENSTACK_HOURS_IN_A_MONTH} hours`);
  });

  test.each(Object.values(OPENSTACK_WASTE_RULES))(
    "$command is named, as the rule's own command",
    (rule: OpenStackWasteRuleWords) => {
      expect(SPEND).toContain(`\`${rule.command}\``);
    },
  );

  test("each rule's line says what the rule does", () => {
    expect(SPEND).toContain(
      `Unassociated for ${OPENSTACK_WASTE_FLOATING_IP_DAYS} days`,
    );
    expect(SPEND).toContain(
      `Shut off for ${OPENSTACK_WASTE_INSTANCE_DAYS} days`,
    );
    expect(SPEND).toContain(
      `Available for ${OPENSTACK_WASTE_VOLUME_DAYS} days`,
    );
    expect(SPEND).toContain(`Made ${OPENSTACK_WASTE_SNAPSHOT_DAYS} days ago`);
    expect(SPEND).toContain(`${OPENSTACK_WASTE_IMAGE_DAYS} days old`);
    expect(SPEND).toContain(
      `${OPENSTACK_WASTE_IDLE_HOST_ALLOCATED_PERCENT}% or less`,
    );
  });

  test("it says what it isn't", () => {
    expect(SPEND).toContain("OneUptime doesn't invoice anyone");
    expect(SPEND).toContain("OneUptime never removes anything");
    expect(SPEND).toContain("A price of zero means no price, not a free cloud");
    expect(SPEND).toContain("A real CloudKitty has answered this");
  });
});
