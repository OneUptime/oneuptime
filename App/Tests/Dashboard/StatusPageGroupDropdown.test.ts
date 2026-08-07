import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil from "Common/Utils/StatusPage/GroupTree";
import {
  StatusPageGroupDropdownOption,
  toStatusPageGroupDropdownOptions,
} from "../../FeatureSet/Dashboard/src/Utils/StatusPageGroupDropdown";

/*
 * Pins the group pickers - "Parent Group" on Status Page > Groups, "Add to
 * Group" on Status Page > Monitor Rules.
 *
 * Both list every group on the status page, and a group's own name does not
 * identify it: two groups at different levels are very often both called
 * "Region 1000", and picking the wrong one silently nests a group (or files a
 * monitor rule) somewhere the author never meant. So every option carries its
 * full path, and the test that matters most is that two same-named groups come
 * back distinguishable.
 *
 * The other half is cost. Deriving a path per option used to re-walk every
 * group per option, so a status page with a thousand groups walked a thousand
 * groups a thousand times to open a dropdown.
 */

const CORPORATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_ONE: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REGION_TWO: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MARKET: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const UNIT: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const MISSING: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

function makeGroup(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  order?: number | undefined;
}): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id.toString();
  group.name = data.name;

  if (data.parentId) {
    group.parentStatusPageGroupId = data.parentId;
  }

  if (data.order !== undefined) {
    group.order = data.order;
  }

  return group;
}

/*
 * Corporate
 *   Region 1000
 *     Market 1001
 *       Unit 0152
 *   Region 2000
 */
function makeHierarchy(): Array<StatusPageGroup> {
  return [
    makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
    makeGroup({
      id: REGION_ONE,
      name: "Region 1000",
      parentId: CORPORATE,
      order: 2,
    }),
    makeGroup({
      id: MARKET,
      name: "Market 1001",
      parentId: REGION_ONE,
      order: 3,
    }),
    makeGroup({ id: UNIT, name: "Unit 0152", parentId: MARKET, order: 4 }),
    makeGroup({
      id: REGION_TWO,
      name: "Region 2000",
      parentId: CORPORATE,
      order: 5,
    }),
  ];
}

type OptionLabelsFunction = (
  options: Array<StatusPageGroupDropdownOption>,
) => Array<string>;

const optionLabels: OptionLabelsFunction = (
  options: Array<StatusPageGroupDropdownOption>,
): Array<string> => {
  return options.map((option: StatusPageGroupDropdownOption) => {
    return option.label;
  });
};

describe("toStatusPageGroupDropdownOptions", () => {
  test("labels every option with its full path", () => {
    expect(
      optionLabels(
        toStatusPageGroupDropdownOptions({
          statusPageGroups: makeHierarchy(),
        }),
      ),
    ).toEqual([
      "Corporate",
      "Corporate › Region 1000",
      "Corporate › Region 1000 › Market 1001",
      "Corporate › Region 1000 › Market 1001 › Unit 0152",
      "Corporate › Region 2000",
    ]);
  });

  test("an option's value is the group id the form writes back", () => {
    const options: Array<StatusPageGroupDropdownOption> =
      toStatusPageGroupDropdownOptions({
        statusPageGroups: makeHierarchy(),
      });

    expect(options[0]!.value).toBe(CORPORATE.toString());
    expect(options[3]!.value).toBe(UNIT.toString());
  });

  /*
   * The reason the path is there at all. Two groups called the same thing must
   * not read the same in the list.
   */
  test("tells apart two groups that share a name", () => {
    expect(
      optionLabels(
        toStatusPageGroupDropdownOptions({
          statusPageGroups: [
            makeGroup({ id: CORPORATE, name: "Region 1000", order: 1 }),
            makeGroup({
              id: REGION_ONE,
              name: "Region 1000",
              parentId: CORPORATE,
              order: 2,
            }),
          ],
        }),
      ),
    ).toEqual(["Region 1000", "Region 1000 › Region 1000"]);
  });

  test("lists a parent immediately above the groups nested under it", () => {
    expect(
      optionLabels(
        toStatusPageGroupDropdownOptions({
          statusPageGroups: [
            makeGroup({
              id: UNIT,
              name: "Unit 0152",
              parentId: MARKET,
              order: 4,
            }),
            makeGroup({ id: CORPORATE, name: "Corporate", order: 1 }),
            makeGroup({
              id: MARKET,
              name: "Market 1001",
              parentId: REGION_ONE,
              order: 3,
            }),
            makeGroup({
              id: REGION_ONE,
              name: "Region 1000",
              parentId: CORPORATE,
              order: 2,
            }),
          ],
        }),
      ),
    ).toEqual([
      "Corporate",
      "Corporate › Region 1000",
      "Corporate › Region 1000 › Market 1001",
      "Corporate › Region 1000 › Market 1001 › Unit 0152",
    ]);
  });

  test("a status page with no groups offers no options", () => {
    expect(toStatusPageGroupDropdownOptions({ statusPageGroups: [] })).toEqual(
      [],
    );
  });

  /*
   * A dropped option is a group the author cannot pick, so bad data must not
   * lose one. Each option is still labelled with where it ends up rendering:
   * of the Market/Unit cycle below, one of the two is promoted to the top
   * level and the other hangs off it.
   */
  test("offers every group even when the data is malformed", () => {
    const options: Array<StatusPageGroupDropdownOption> =
      toStatusPageGroupDropdownOptions({
        statusPageGroups: [
          makeGroup({ id: CORPORATE, name: "Corporate", parentId: CORPORATE }),
          makeGroup({ id: REGION_ONE, name: "Region 1000", parentId: MISSING }),
          makeGroup({ id: MARKET, name: "Market 1001", parentId: UNIT }),
          makeGroup({ id: UNIT, name: "Unit 0152", parentId: MARKET }),
        ],
      });

    expect(optionLabels(options).sort()).toEqual([
      "Corporate",
      "Market 1001",
      "Market 1001 › Unit 0152",
      "Region 1000",
    ]);
    expect(
      options.map((option: StatusPageGroupDropdownOption) => {
        return option.value;
      }),
    ).toEqual([
      CORPORATE.toString(),
      REGION_ONE.toString(),
      MARKET.toString(),
      UNIT.toString(),
    ]);
  });

  test("an orphan is offered at the top level rather than hidden", () => {
    expect(
      optionLabels(
        toStatusPageGroupDropdownOptions({
          statusPageGroups: [
            makeGroup({
              id: REGION_ONE,
              name: "Region 1000",
              parentId: MISSING,
            }),
          ],
        }),
      ),
    ).toEqual(["Region 1000"]);
  });

  test("builds a thousand options off a single walk of the tree", () => {
    const groups: Array<StatusPageGroup> = [];

    for (let index: number = 0; index < 1000; index++) {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = `group-${index}`;
      group.name = `Group ${index}`;
      group.order = index;

      if (index % 10 !== 0) {
        group.parentStatusPageGroupId = new ObjectID(`group-${index - 1}`);
      }

      groups.push(group);
    }

    const getParentId: typeof StatusPageGroupTreeUtil.getParentId =
      StatusPageGroupTreeUtil.getParentId;

    let parentPointerReads: number = 0;

    StatusPageGroupTreeUtil.getParentId = (
      statusPageGroup: StatusPageGroup,
    ): string | null => {
      parentPointerReads++;
      return getParentId.call(StatusPageGroupTreeUtil, statusPageGroup);
    };

    try {
      const options: Array<StatusPageGroupDropdownOption> =
        toStatusPageGroupDropdownOptions({ statusPageGroups: groups });

      expect(options).toHaveLength(1000);
      expect(options[2]!.label).toBe("Group 0 › Group 1 › Group 2");
      expect(parentPointerReads).toBeLessThanOrEqual(groups.length * 2);
    } finally {
      StatusPageGroupTreeUtil.getParentId = getParentId;
    }
  });
});
