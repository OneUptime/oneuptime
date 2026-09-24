import Incident from "../../../../Models/DatabaseModels/Incident";
import Query from "../../../../Server/Types/Database/Query";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * jsonContains finds the incident / alert / ... whose
 * postUpdatesToWorkspaceChannels lists a chat channel — how a reaction in a
 * channel is traced back to what the channel is for.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as RawOperator;
}

const ALIAS: string = '"Incident"."postUpdatesToWorkspaceChannels"';

describe("QueryHelper.jsonContains", () => {
  it("renders a jsonb containment against a bound parameter", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.jsonContains([{ id: "C0INCIDENT" }]),
    );

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");

    const parameterNames: Array<string> = Object.keys(
      operator.objectLiteralParameters,
    );
    expect(parameterNames).toHaveLength(1);

    expect(operator.getSql(ALIAS)).toBe(
      `(${ALIAS} @> CAST(:${parameterNames[0]} AS JSONB))`,
    );
    expect(operator.objectLiteralParameters[parameterNames[0]!]).toBe(
      '[{"id":"C0INCIDENT"}]',
    );
  });

  it("keeps hostile values in the parameter, never in the SQL", () => {
    const hostile: string = `'); DROP TABLE "Incident"; --`;
    const operator: RawOperator = asRaw(
      QueryHelper.jsonContains([{ id: hostile }]),
    );

    expect(operator.getSql(ALIAS)).not.toContain("DROP TABLE");
    expect(
      JSON.parse(Object.values(operator.objectLiteralParameters)[0] as string),
    ).toEqual([{ id: hostile }]);
  });

  it("accepts an object as well as an array", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.jsonContains({ workspaceType: "MicrosoftTeams" }),
    );

    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      '{"workspaceType":"MicrosoftTeams"}',
    ]);
  });

  it("uses a fresh parameter name each time so two filters can share a query", () => {
    const first: RawOperator = asRaw(QueryHelper.jsonContains([{ id: "a" }]));
    const second: RawOperator = asRaw(QueryHelper.jsonContains([{ id: "b" }]));

    expect(Object.keys(first.objectLiteralParameters)[0]).not.toBe(
      Object.keys(second.objectLiteralParameters)[0],
    );
  });

  it("survives query serialization on a JSON column, next to a relation filter", () => {
    const filter: unknown = QueryHelper.jsonContains([{ id: "C0INCIDENT" }]);
    const projectId: ObjectID = ObjectID.generate();

    const serialized: Record<string, unknown> = QueryUtil.serializeQuery(
      Incident,
      {
        projectId: projectId,
        postUpdatesToWorkspaceChannels: filter,
        currentIncidentState: { isResolvedState: false },
      } as Query<Incident>,
    ) as Record<string, unknown>;

    // The JSON-column branch must pass the operator through untouched.
    expect(serialized["postUpdatesToWorkspaceChannels"]).toBe(filter);
  });
});
