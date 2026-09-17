import { describe, expect, test } from "@jest/globals";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import CriteriaFilterUtil from "../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";

/*
 * The criteria form only renders the CheckOn / FilterType pairs it whitelists
 * per monitor type. A default criteria built from a pair the form does not
 * offer would show up as a blank dropdown the moment a user opened the
 * monitor - so the Incoming Request / Incoming Email defaults ("body contains
 * error" / "body does not contain error") have to be selectable options.
 */

const KEYWORD: string =
  MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD;

const ONLINE_STATUS_ID: ObjectID = new ObjectID("100000000000000000000011");
const OFFLINE_STATUS_ID: ObjectID = new ObjectID("100000000000000000000012");
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID("100000000000000000000013");
const ALERT_SEVERITY_ID: ObjectID = new ObjectID("100000000000000000000014");

interface IncomingMonitorCase {
  label: string;
  monitorType: MonitorType;
  bodyCheckOn: CheckOn;
}

const CASES: Array<IncomingMonitorCase> = [
  {
    label: "Incoming Request",
    monitorType: MonitorType.IncomingRequest,
    bodyCheckOn: CheckOn.RequestBody,
  },
  {
    label: "Incoming Email",
    monitorType: MonitorType.IncomingEmail,
    bodyCheckOn: CheckOn.EmailBody,
  },
];

function defaultFilters(
  testCase: IncomingMonitorCase,
): Array<{ label: string; filter: CriteriaFilter }> {
  const online: MonitorCriteriaInstance | null =
    MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
      monitorType: testCase.monitorType,
      monitorStatusId: ONLINE_STATUS_ID,
      monitorName: "Payments API",
    });

  const offline: MonitorCriteriaInstance =
    MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
      monitorType: testCase.monitorType,
      monitorStatusId: OFFLINE_STATUS_ID,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      alertSeverityId: ALERT_SEVERITY_ID,
      monitorName: "Payments API",
    });

  return [
    { label: "online", filter: online!.data!.filters[0]! },
    { label: "offline", filter: offline.data!.filters[0]! },
  ];
}

function optionValues(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption) => {
    return option.value as string;
  });
}

describe("Incoming monitor default criteria are renderable in the criteria form", () => {
  describe.each(CASES)(
    "$label monitor",
    (testCase: IncomingMonitorCase): void => {
      test("the body CheckOn is offered for this monitor type", () => {
        const options: Array<string> = optionValues(
          CriteriaFilterUtil.getCheckOnOptionsByMonitorType(
            testCase.monitorType,
          ),
        );

        expect(options).toContain(testCase.bodyCheckOn);
      });

      test.each(["online", "offline"])(
        "the %s default filter's CheckOn and FilterType are both selectable",
        (which: string) => {
          const entry: { label: string; filter: CriteriaFilter } | undefined =
            defaultFilters(testCase).find(
              (item: { label: string; filter: CriteriaFilter }) => {
                return item.label === which;
              },
            );

          expect(entry).toBeDefined();

          const filter: CriteriaFilter = entry!.filter;

          expect(
            optionValues(
              CriteriaFilterUtil.getCheckOnOptionsByMonitorType(
                testCase.monitorType,
              ),
            ),
          ).toContain(filter.checkOn);

          expect(
            optionValues(
              CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(filter.checkOn),
            ),
          ).toContain(filter.filterType as string);
        },
      );

      test("the body filter takes a free-text value rather than a dropdown", () => {
        expect(
          CriteriaFilterUtil.isDropdownValueField({
            checkOn: testCase.bodyCheckOn,
          }),
        ).toBe(false);
      });

      test("the defaults render as readable text in the criteria summary", () => {
        for (const entry of defaultFilters(testCase)) {
          const text: string = CriteriaFilterUtil.translateFilterToText(
            entry.filter,
          );

          expect(text).toContain(KEYWORD);
          expect(text.length).toBeGreaterThan(0);
        }
      });
    },
  );

  test("DropdownUtil is wired the way the form expects (guards the option shape used above)", () => {
    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEnum(FilterType);

    expect(optionValues(options)).toContain(FilterType.Contains);
    expect(optionValues(options)).toContain(FilterType.NotContains);
  });
});
