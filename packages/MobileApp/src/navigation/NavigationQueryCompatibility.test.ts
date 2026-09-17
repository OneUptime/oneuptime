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

describe("the latest stable React Navigation query parser", () => {
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
});
