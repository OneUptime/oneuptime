import LogFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import {
  buildFilterQuery,
  parseFilterQuery,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryParser";

describe("FilterQueryParser", () => {
  test("round-trips custom attribute IN filters", () => {
    const query: string = buildFilterQuery(
      [
        {
          field: "attributes.k8s.object.kind",
          operator: "IN",
          value: "Pod, Deployment, ReplicaSet",
        },
      ],
      "AND",
      LogFilterConfig,
    );

    expect(query).toBe(
      "attributes.k8s.object.kind IN ('Pod', 'Deployment', 'ReplicaSet')",
    );

    expect(parseFilterQuery(query, LogFilterConfig)).toEqual({
      connector: "AND",
      conditions: [
        {
          field: "attributes.k8s.object.kind",
          operator: "IN",
          value: "Pod, Deployment, ReplicaSet",
        },
      ],
    });
  });

  test("keeps IN filters when wrapped in grouping parentheses", () => {
    const query: string =
      "(attributes.k8s.namespace.name IN ('prod', 'staging'))";

    expect(parseFilterQuery(query, LogFilterConfig)).toEqual({
      connector: "AND",
      conditions: [
        {
          field: "attributes.k8s.namespace.name",
          operator: "IN",
          value: "prod, staging",
        },
      ],
    });
  });
});
