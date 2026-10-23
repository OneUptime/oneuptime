import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import ExternalStatusPageComponentStatusUtil, {
  ExternalStatusPageComponentStatusValue,
} from "../../../Utils/Monitor/ExternalStatusPageComponentStatusUtil";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * The Component Status criteria compare a component's status with a value
 * picked from a fixed dropdown, exactly. A OneUptime status page's
 * resources are reported as one of those values
 * (ExternalStatusPageComponentStatusUtil), so every value it can report must
 * be one a person can pick - or a criterion could never match it. The one
 * exception is "unknown", for a resource whose status the page hides: no
 * criterion should fire on a status nobody can see.
 */

const DROPDOWN: Array<DropdownOption> = CriteriaFilterUtil.getDropdownOptionsByCheckOn({
  checkOn: CheckOn.ExternalStatusPageComponentStatus,
});

const DROPDOWN_VALUES: Array<string> = DROPDOWN.map(
  (option: DropdownOption): string => {
    return option.value.toString();
  },
);

describe("the Component Status dropdown and a OneUptime status page's values", () => {
  test("offers every value a status can stand for but unknown, in the order people read them", () => {
    expect(DROPDOWN_VALUES).toEqual([
      ExternalStatusPageComponentStatusValue.Operational,
      ExternalStatusPageComponentStatusValue.UnderMaintenance,
      ExternalStatusPageComponentStatusValue.DegradedPerformance,
      ExternalStatusPageComponentStatusValue.PartialOutage,
      ExternalStatusPageComponentStatusValue.MajorOutage,
      ExternalStatusPageComponentStatusValue.FullOutage,
    ]);

    expect(
      Object.values(ExternalStatusPageComponentStatusValue).filter(
        (value: string): boolean => {
          return !DROPDOWN_VALUES.includes(value);
        },
      ),
    ).toEqual([ExternalStatusPageComponentStatusValue.Unknown]);
  });

  test("keeps the labels people read", () => {
    expect(
      DROPDOWN.map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual([
      "Operational",
      "Under Maintenance",
      "Degraded Performance",
      "Partial Outage",
      "Major Outage",
      "Full Outage",
    ]);
  });

  test("a status named as a label reads that label's value", () => {
    for (const option of DROPDOWN) {
      expect({
        label: option.label,
        value: ExternalStatusPageComponentStatusUtil.fromStatusPageStatus({
          status: {
            name: option.label,
            color: null,
            isOperational: option.value === "operational",
          },
          isUnderMaintenance: false,
        }),
      }).toEqual({ label: option.label, value: option.value });
    }
  });
});
