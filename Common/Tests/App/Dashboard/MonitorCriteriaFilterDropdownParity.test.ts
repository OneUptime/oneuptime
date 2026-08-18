import CriteriaFilterUiUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilterUtil,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #3225. Which checks the dashboard offers and which checks are legal to
 * save used to be two separately maintained lists, and they had drifted: an SSL
 * Certificate monitor could carry an "Is Online" filter that its dropdown would
 * not render (blank select over a live value), while a DNSSEC monitor could
 * carry one that no evaluator read at all. Both produce a criteria that can
 * never match, and a criteria set where nothing matches is silent - the monitor
 * stays parked at its default status with no timeline event and no error.
 *
 * Both sides now read CriteriaFilterUtil.getSupportedCheckOns. These tests hold
 * them together.
 */

function values(options: Array<DropdownOption>): Array<CheckOn> {
  return options.map((option: DropdownOption) => {
    return option.value as CheckOn;
  });
}

const AUDITED_TYPES: Array<MonitorType> = [
  MonitorType.SSLCertificate,
  MonitorType.DNSSEC,
  MonitorType.Ping,
  MonitorType.IP,
];

describe("monitor criteria dropdown / validation parity", () => {
  test.each(AUDITED_TYPES)(
    "the %s dropdown offers exactly the supported checks",
    (monitorType: MonitorType) => {
      const supported: Array<CheckOn> | undefined =
        CriteriaFilterUtil.getSupportedCheckOns(monitorType);

      expect(supported).toBeDefined();
      expect(
        values(
          CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(monitorType),
        ).sort(),
      ).toEqual([...supported!].sort());
    },
  );

  test.each(AUDITED_TYPES)(
    "every check the %s dropdown offers passes save-time validation",
    (monitorType: MonitorType) => {
      for (const option of CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(
        monitorType,
      )) {
        const instance: MonitorCriteriaInstance =
          MonitorCriteriaInstance.getEmptyCriteriaInstance(monitorType);

        instance.data!.filters[0]!.checkOn = option.value as CheckOn;

        const error: string | null = MonitorCriteriaInstance.getValidationError(
          instance,
          monitorType,
        );

        expect(error).not.toContain("cannot have filter type");
      }
    },
  );

  test("SSL Certificate monitors can now pick the reachability checks", () => {
    const offered: Array<CheckOn> = values(
      CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(
        MonitorType.SSLCertificate,
      ),
    );

    expect(offered).toContain(CheckOn.IsOnline);
    expect(offered).toContain(CheckOn.IsRequestTimeout);
  });

  test("DNSSEC monitors can now pick the reachability checks", () => {
    const offered: Array<CheckOn> = values(
      CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(MonitorType.DNSSEC),
    );

    expect(offered).toContain(CheckOn.IsOnline);
    expect(offered).toContain(CheckOn.IsRequestTimeout);
  });

  test("SSL Certificate monitors still offer every certificate check", () => {
    expect(
      values(
        CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(
          MonitorType.SSLCertificate,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        CheckOn.IsValidCertificate,
        CheckOn.IsSelfSignedCertificate,
        CheckOn.IsExpiredCertificate,
        CheckOn.IsNotAValidCertificate,
        CheckOn.ExpiresInDays,
        CheckOn.ExpiresInHours,
      ]),
    );
  });

  test("SSL Certificate monitors are not offered unrelated HTTP checks", () => {
    const offered: Array<CheckOn> = values(
      CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(
        MonitorType.SSLCertificate,
      ),
    );

    expect(offered).not.toContain(CheckOn.ResponseStatusCode);
    expect(offered).not.toContain(CheckOn.ResponseBody);
  });

  /*
   * Port relabels Response Time after filtering, so it must keep going through
   * the bespoke path rather than the shared early return.
   */
  test("an unaudited type keeps its bespoke dropdown handling", () => {
    expect(
      CriteriaFilterUtil.getSupportedCheckOns(MonitorType.Port),
    ).toBeUndefined();

    const responseTimeOption: DropdownOption | undefined =
      CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(
        MonitorType.Port,
      ).find((option: DropdownOption) => {
        return option.value === CheckOn.ResponseTime;
      });

    expect(responseTimeOption?.label).toBe(
      "Total Connection Time (DNS + TCP) (in ms)",
    );
  });

  /*
   * The dashboard's "Add Criteria" button seeds from this, so it has to land on
   * something the dropdown can render.
   */
  test.each(AUDITED_TYPES)(
    "the seeded criteria for %s uses a check its dropdown offers",
    (monitorType: MonitorType) => {
      const instance: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getEmptyCriteriaInstance(monitorType);

      expect(
        values(
          CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(monitorType),
        ),
      ).toContain(instance.data!.filters[0]!.checkOn);
    },
  );
});
