/*
 * Which of the project's records each "who to page" setting lists.
 *
 * Four places name the list settings, and they have to name the same four:
 * the setting types themselves (Component.isRecordListInputType), the
 * control the settings form picks for them (ArgumentControl), the picker's
 * kind for each (RecordListKinds) and the kind of record the step pages
 * (OnCall.getPageTargetKind). A fifth list type added to one and not the
 * others would be drawn as a plain text box, or picked from the wrong
 * records - so the whole table is held together here.
 */

import ComponentMetadata, {
  Argument,
  ComponentInputType,
  isRecordListInputType,
} from "../../../../../Types/Workflow/Component";
import OnCallComponents, {
  PageTargetKind,
  getPageStepTarget,
  getPageTargetKind,
} from "../../../../../Types/Workflow/Components/OnCall";
import { getPeoplePickerKindDefinition } from "../../../../../UI/Components/PeoplePicker/PeoplePickerKinds";
import { PeoplePickerKind } from "../../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { RECORD_LIST_COPY } from "../../../../../UI/Components/Workflow/RecordList/RecordListField";
import {
  RECORD_LIST_KINDS,
  getRecordListKind,
} from "../../../../../UI/Components/Workflow/RecordList/RecordListKinds";
import {
  ArgumentControl,
  argumentControlFor,
} from "../../../../../UI/Components/Workflow/ValuePicker/ArgumentControl";
import { describe, expect, test } from "@jest/globals";

const EXPECTED: Array<[ComponentInputType, PeoplePickerKind, PageTargetKind]> =
  [
    [ComponentInputType.UserList, PeoplePickerKind.User, PageTargetKind.User],
    [ComponentInputType.TeamList, PeoplePickerKind.Team, PageTargetKind.Team],
    [
      ComponentInputType.OnCallScheduleList,
      PeoplePickerKind.OnCallSchedule,
      PageTargetKind.OnCallSchedule,
    ],
    [
      ComponentInputType.OnCallPolicyList,
      PeoplePickerKind.OnCallPolicy,
      PageTargetKind.OnCallPolicy,
    ],
  ];

describe("the kind of record each list setting lists", () => {
  test.each(EXPECTED)(
    "%s is picked from the project's %s records",
    (
      type: ComponentInputType,
      kind: PeoplePickerKind,
      target: PageTargetKind,
    ) => {
      expect(getRecordListKind(type)).toBe(kind);
      // The step pages the kind of record its setting picks.
      expect(getPageTargetKind(type)).toBe(target);
    },
  );

  test("the table is these four and no others", () => {
    expect(Object.keys(RECORD_LIST_KINDS).sort()).toEqual(
      EXPECTED.map(([type]: [ComponentInputType, unknown, unknown]): string => {
        return type;
      }).sort(),
    );
  });

  test("every setting type is a list exactly when it has a kind, and is then drawn as the list control", () => {
    for (const type of Object.values(ComponentInputType)) {
      const isList: boolean = isRecordListInputType(type);

      expect({ type, hasKind: getRecordListKind(type) !== null }).toEqual({
        type,
        hasKind: isList,
      });
      expect({
        type,
        isListControl:
          argumentControlFor({
            type: type,
            value: null,
            isRowsDictionary: false,
          }) === ArgumentControl.RecordList,
      }).toEqual({ type, isListControl: isList });
      expect({ type, hasTarget: getPageTargetKind(type) !== null }).toEqual({
        type,
        hasTarget: isList,
      });
    }
  });

  test("no two list settings pick from the same records", () => {
    const kinds: Array<PeoplePickerKind | null> = EXPECTED.map(
      ([type]: [ComponentInputType, unknown, unknown]) => {
        return getRecordListKind(type);
      },
    );

    expect(new Set(kinds).size).toBe(EXPECTED.length);
  });

  test("each kind is one the people picker knows how to search, and has words for its list", () => {
    for (const [, kind] of EXPECTED) {
      expect(typeof getPeoplePickerKindDefinition(kind).search).toBe(
        "function",
      );
      expect(typeof getPeoplePickerKindDefinition(kind).getByIds).toBe(
        "function",
      );
      expect(RECORD_LIST_COPY[kind]).toBeDefined();
    }
  });
});

describe("the Page steps' own settings", () => {
  test("each step's who-to-page setting is a list setting of the kind the step pages", () => {
    expect(OnCallComponents).toHaveLength(4);

    for (const metadata of OnCallComponents as Array<ComponentMetadata>) {
      const target: { argumentId: string; kind: PageTargetKind } =
        getPageStepTarget(metadata.id)!;
      const setting: Argument = metadata.arguments.find(
        (argument: Argument): boolean => {
          return argument.id === target.argumentId;
        },
      )!;

      expect(isRecordListInputType(setting.type)).toBe(true);
      expect(getPageTargetKind(setting.type)).toBe(target.kind);
      expect(getRecordListKind(setting.type)).not.toBeNull();
      // Who to page comes first, and a step has the one list.
      expect(metadata.arguments[0]).toBe(setting);
      expect(
        metadata.arguments.filter((argument: Argument): boolean => {
          return isRecordListInputType(argument.type);
        }),
      ).toHaveLength(1);
    }
  });
});
