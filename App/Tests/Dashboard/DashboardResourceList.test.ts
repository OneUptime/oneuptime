import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DashboardResourceList from "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardResourceList";
import {
  PublicDashboardPostJSON,
  setPublicDashboardContext,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import URL from "Common/Types/API/URL";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import ObjectID from "Common/Types/ObjectID";

describe("DashboardResourceList request context", () => {
  afterEach(() => {
    setPublicDashboardContext(null);
  });

  test("leaves authenticated dashboard requests unchanged", () => {
    expect(
      DashboardResourceList.getRequestOptions("log", {
        componentId: new ObjectID("component-id"),
        variables: [],
      }),
    ).toBeUndefined();
  });

  test("sends only widget identity and viewer variable selections", () => {
    setPublicDashboardContext({
      dashboardId: new ObjectID("dashboard-id"),
      apiUrl: URL.fromString("https://example.com/public-dashboard-api"),
      postJSON: jest.fn<PublicDashboardPostJSON>(),
    });

    const variables: Array<DashboardVariable> = [
      {
        id: "all",
        name: "Environment",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "deployment.environment.name",
        selectedValue: "",
      },
      {
        id: "unset",
        name: "Cluster",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "k8s.cluster.name",
        defaultValue: "production",
      },
      {
        id: "many",
        name: "Region",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "cloud.region",
        selectedValues: ["eu-west-1", "eu-west-2"],
        isMultiSelect: true,
      },
    ];

    const componentId: ObjectID = new ObjectID("component-id");
    const options: ReturnType<typeof DashboardResourceList.getRequestOptions> =
      DashboardResourceList.getRequestOptions("log", {
        componentId,
        variables,
      });

    expect(options?.additionalRequestBody).toEqual({
      componentId: "component-id",
      variables: [
        { id: "all", selectedValue: "", selectedValues: [] },
        { id: "unset", selectedValue: null, selectedValues: [] },
        {
          id: "many",
          selectedValue: null,
          selectedValues: ["eu-west-1", "eu-west-2"],
        },
      ],
    });
  });
});
