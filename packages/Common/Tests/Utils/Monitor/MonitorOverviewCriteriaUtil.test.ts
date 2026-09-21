import { JSONObject } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorOverviewCriteriaUtil from "../../../Utils/Monitor/MonitorOverviewCriteriaUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * The heartbeat facts quote the missing-request window from the monitor's
 * own criteria, and the network-device fact links the device the first step
 * points at. Criteria are user-written JSON, so these also pin that odd
 * shapes are skipped rather than thrown on.
 */

const filter: (
  checkOn: CheckOn,
  filterType: FilterType,
  value: unknown,
) => JSONObject = (
  checkOn: CheckOn,
  filterType: FilterType,
  value: unknown,
): JSONObject => {
  return {
    checkOn: checkOn,
    filterType: filterType,
    value: value as string,
  };
};

const criteria: (
  filters: Array<JSONObject>,
  isEnabled?: boolean,
) => JSONObject = (
  filters: Array<JSONObject>,
  isEnabled?: boolean,
): JSONObject => {
  return {
    data: {
      filters: filters,
      ...(isEnabled === undefined ? {} : { isEnabled: isEnabled }),
    },
  };
};

const stepsOf: (...steps: Array<JSONObject>) => MonitorSteps = (
  ...steps: Array<JSONObject>
): MonitorSteps => {
  return {
    data: {
      monitorStepsInstanceArray: steps.map((data: JSONObject) => {
        return { data: data };
      }),
    },
  } as unknown as MonitorSteps;
};

const stepWithCriteria: (...instances: Array<JSONObject>) => JSONObject = (
  ...instances: Array<JSONObject>
): JSONObject => {
  return {
    monitorCriteria: {
      data: { monitorCriteriaInstanceArray: instances },
    },
  };
};

describe("MonitorOverviewCriteriaUtil.getMissingSignalMinutes", () => {
  it("smallest missing-signal minutes across steps and criteria", () => {
    const monitorSteps: MonitorSteps = stepsOf(
      stepWithCriteria(
        criteria([
          filter(CheckOn.IncomingRequest, FilterType.NotRecievedInMinutes, 30),
        ]),
        criteria([
          filter(CheckOn.IncomingRequest, FilterType.RecievedInMinutes, "15"),
        ]),
      ),
      stepWithCriteria(
        criteria([
          filter(CheckOn.IncomingRequest, FilterType.NotRecievedInMinutes, 10),
        ]),
      ),
    );

    expect(
      MonitorOverviewCriteriaUtil.getMissingSignalMinutes({
        monitorSteps: monitorSteps,
        checkOn: CheckOn.IncomingRequest,
      }),
    ).toBe(10);
  });

  it("ignores other checkOn and filter types and non-numeric values", () => {
    const monitorSteps: MonitorSteps = stepsOf(
      stepWithCriteria(
        criteria([
          filter(CheckOn.EmailReceivedAt, FilterType.NotRecievedInMinutes, 1),
          filter(CheckOn.IncomingRequest, FilterType.EqualTo, 2),
          filter(
            CheckOn.IncomingRequest,
            FilterType.NotRecievedInMinutes,
            "soon",
          ),
          filter(CheckOn.IncomingRequest, FilterType.NotRecievedInMinutes, ""),
          filter(CheckOn.IncomingRequest, FilterType.NotRecievedInMinutes, 0),
          filter(CheckOn.IncomingRequest, FilterType.NotRecievedInMinutes, -5),
          filter(
            CheckOn.IncomingRequest,
            FilterType.NotRecievedInMinutes,
            null,
          ),
        ]),
      ),
    );

    expect(
      MonitorOverviewCriteriaUtil.getMissingSignalMinutes({
        monitorSteps: monitorSteps,
        checkOn: CheckOn.IncomingRequest,
      }),
    ).toBeNull();

    // The email window is found when that is what is asked for.
    expect(
      MonitorOverviewCriteriaUtil.getMissingSignalMinutes({
        monitorSteps: monitorSteps,
        checkOn: CheckOn.EmailReceivedAt,
      }),
    ).toBe(1);
  });

  it("skips criteria that are switched off", () => {
    const monitorSteps: MonitorSteps = stepsOf(
      stepWithCriteria(
        criteria(
          [filter(CheckOn.IncomingRequest, FilterType.NotRecievedInMinutes, 5)],
          false,
        ),
        criteria(
          [
            filter(
              CheckOn.IncomingRequest,
              FilterType.NotRecievedInMinutes,
              20,
            ),
          ],
          true,
        ),
      ),
    );

    expect(
      MonitorOverviewCriteriaUtil.getMissingSignalMinutes({
        monitorSteps: monitorSteps,
        checkOn: CheckOn.IncomingRequest,
      }),
    ).toBe(20);
  });

  it("returns null for missing or malformed criteria", () => {
    for (const monitorSteps of [
      undefined,
      { data: undefined } as unknown as MonitorSteps,
      stepsOf({}),
      stepsOf({
        monitorCriteria: { data: { monitorCriteriaInstanceArray: 5 } },
      }),
      stepsOf(stepWithCriteria({ data: { filters: "nope" } })),
      stepsOf(stepWithCriteria({ data: { filters: [null] } })),
    ]) {
      expect(
        MonitorOverviewCriteriaUtil.getMissingSignalMinutes({
          monitorSteps: monitorSteps,
          checkOn: CheckOn.IncomingRequest,
        }),
      ).toBeNull();
    }
  });
});

describe("MonitorOverviewCriteriaUtil.getStepCount", () => {
  it("step count", () => {
    expect(MonitorOverviewCriteriaUtil.getStepCount(stepsOf({}, {}, {}))).toBe(
      3,
    );
    expect(MonitorOverviewCriteriaUtil.getStepCount(stepsOf())).toBe(0);
    expect(MonitorOverviewCriteriaUtil.getStepCount(undefined)).toBe(0);
    expect(
      MonitorOverviewCriteriaUtil.getStepCount({
        data: { monitorStepsInstanceArray: "x" },
      } as unknown as MonitorSteps),
    ).toBe(0);
  });

  it("counts real MonitorSteps instances", () => {
    // A fresh MonitorSteps starts with one empty step.
    expect(MonitorOverviewCriteriaUtil.getStepCount(new MonitorSteps())).toBe(
      1,
    );
  });
});

describe("MonitorOverviewCriteriaUtil.getNetworkDeviceId", () => {
  it("network device id from step 0", () => {
    expect(
      MonitorOverviewCriteriaUtil.getNetworkDeviceId(
        stepsOf(
          {
            networkDeviceMonitor: {
              networkDeviceId: "66666666-6666-4666-8666-666666666666",
            },
          },
          {
            networkDeviceMonitor: {
              networkDeviceId: "77777777-7777-4777-8777-777777777777",
            },
          },
        ),
      ),
    ).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("null when step 0 names no device", () => {
    expect(
      MonitorOverviewCriteriaUtil.getNetworkDeviceId(
        stepsOf(
          { networkDeviceMonitor: { networkDeviceId: "" } },
          {
            networkDeviceMonitor: {
              networkDeviceId: "77777777-7777-4777-8777-777777777777",
            },
          },
        ),
      ),
    ).toBeNull();
    expect(
      MonitorOverviewCriteriaUtil.getNetworkDeviceId(stepsOf({})),
    ).toBeNull();
    expect(
      MonitorOverviewCriteriaUtil.getNetworkDeviceId(undefined),
    ).toBeNull();
  });
});
