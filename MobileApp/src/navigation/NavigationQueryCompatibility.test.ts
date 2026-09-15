import { describe, expect, test } from "@jest/globals";
import {
  getPathFromState,
  getStateFromPath,
  type ParamListBase,
  type PathConfigMap,
} from "@react-navigation/native";

const pathConfig: PathConfigMap<ParamListBase> = {
  IncidentDetail: "incident/:projectId/:incidentId",
};

describe("React Navigation's advisory-safe query parser", () => {
  test("keeps route params and decoded query params compatible", () => {
    const state: ReturnType<typeof getStateFromPath> = getStateFromPath(
      "/incident/project-a/incident-a?view=timeline%20detail",
      { screens: pathConfig },
    );

    expect(state?.routes[0]?.name).toBe("IncidentDetail");
    expect(state?.routes[0]?.params).toEqual({
      projectId: "project-a",
      incidentId: "incident-a",
      view: "timeline detail",
    });
  });

  test("round-trips query values through the upgraded parser", () => {
    const path: string = getPathFromState(
      {
        stale: false,
        type: "stack",
        key: "root",
        routeNames: ["IncidentDetail"],
        index: 0,
        routes: [
          {
            key: "incident-detail",
            name: "IncidentDetail",
            params: {
              projectId: "project-a",
              incidentId: "incident-a",
              view: "timeline & notes",
            },
          },
        ],
      },
      { screens: pathConfig },
    );
    const state: ReturnType<typeof getStateFromPath> = getStateFromPath(path, {
      screens: pathConfig,
    });

    expect(state?.routes[0]?.params).toEqual({
      projectId: "project-a",
      incidentId: "incident-a",
      view: "timeline & notes",
    });
  });

  test.each([
    ["%E=%80%80", "%E=%80%80"],
    ["%C3", "%C3"],
    ["%ea%ba%5a%ba", "%ea%baZ%ba"],
  ])(
    "preserves malformed query value %s without rejecting the route",
    (encoded: string, decoded: string) => {
      const state: ReturnType<typeof getStateFromPath> = getStateFromPath(
        `/incident/project-a/incident-a?view=${encoded}`,
        { screens: pathConfig },
      );

      expect(state?.routes[0]?.params).toEqual({
        projectId: "project-a",
        incidentId: "incident-a",
        view: decoded,
      });
    },
  );

  test("handles a long malformed value without exponential decoding", () => {
    /*
     * This shape exercised the CPU-denial-of-service path in
     * decode-uri-component (GHSA-vcc3-ghjq-m6fr).
     */
    const malformedValue: string = "%C3".repeat(20_000);
    const state: ReturnType<typeof getStateFromPath> = getStateFromPath(
      `/incident/project-a/incident-a?view=${malformedValue}`,
      { screens: pathConfig },
    );

    expect(state?.routes[0]?.params).toEqual({
      projectId: "project-a",
      incidentId: "incident-a",
      view: malformedValue,
    });
  });
});
