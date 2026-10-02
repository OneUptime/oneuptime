import { toSeverityDropdownOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateSideOver";
import MonitorRecommendationSeverityMapper, {
  MonitorRecommendationSeverityOption,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Creating monitors from recommendations maps each recommendation's
 * "Critical" / "Warning" onto one of the project's own incident and alert
 * severities, one "Critical -> [severity]" row each. Those severity pickers
 * listed plain names; like every other severity picker they now draw each
 * severity's colour.
 */

const CRITICAL_ID: ObjectID = new ObjectID(
  "0193c0de-0000-4aaa-8bbb-000000000101",
);
const MINOR_ID: ObjectID = new ObjectID("0193c0de-0000-4aaa-8bbb-000000000102");

const SEVERITIES: Array<MonitorRecommendationSeverityOption> = [
  {
    id: CRITICAL_ID,
    name: "Critical Incident",
    order: 1,
    color: new Color("#dc2626"),
  },
  { id: MINOR_ID, name: "Minor Incident", order: 3 },
];

describe("monitor recommendation severity pickers", () => {
  test("offer each severity by id and name, with its colour", () => {
    const options: Array<DropdownOption> =
      toSeverityDropdownOptions(SEVERITIES);

    expect(
      options.map((option: DropdownOption) => {
        return [option.value, option.label, option.color?.toString()];
      }),
    ).toEqual([
      [CRITICAL_ID.toString(), "Critical Incident", "#dc2626"],
      [MINOR_ID.toString(), "Minor Incident", undefined],
    ]);
  });

  test("a severity without a colour has no color key at all", () => {
    const options: Array<DropdownOption> =
      toSeverityDropdownOptions(SEVERITIES);

    expect(Object.keys(options[1]!)).not.toContain("color");
  });

  test("keep the order they are given in", () => {
    const reversed: Array<MonitorRecommendationSeverityOption> = [
      ...SEVERITIES,
    ].reverse();

    expect(
      toSeverityDropdownOptions(reversed).map((option: DropdownOption) => {
        return option.label;
      }),
    ).toEqual(["Minor Incident", "Critical Incident"]);
  });

  test("the colour rides along without changing which severity is chosen", () => {
    // The mapper reads ids and ranks only; a colour is just carried.
    expect(
      MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(SEVERITIES),
    ).toEqual({ Critical: CRITICAL_ID, Warning: MINOR_ID });
  });
});
