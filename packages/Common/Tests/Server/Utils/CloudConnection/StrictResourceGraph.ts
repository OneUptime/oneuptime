import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeResponder,
  FakeResponse,
  bodyOf,
  json,
} from "../LlmObservability/FakeProviderApi";
import {
  KqlProblem,
  describeKqlProblem,
  resourceGraphErrors,
} from "./AzureKqlGrammar";

/*
 * A FAKE RESOURCE GRAPH THAT READS THE QUERIES IT IS SENT (#11142).
 *
 * The fakes before this one answered every query, so a query Resource
 * Graph refuses passed every suite: the subnet query of 16.0.0 among them.
 * strictResourceGraph reads each query as Resource Graph would - Microsoft's
 * parser, the Resources table, Resource Graph's documented operators and
 * limits (AzureKqlGrammar) - and refuses one it would refuse with the
 * answer Resource Graph gives: HTTP 400, "Query is invalid", and for a
 * query that does not parse a ParserFailure naming its line and character.
 * A query it takes is answered by the suite's own responder.
 *
 * Its ParserFailure names the line and character Kusto.Language points
 * at; Resource Graph's own parser may point at another character of the
 * same line, as it did for the customer (character 18, where this one
 * says 11).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

const SUPPORT_MESSAGE: string =
  "Please provide below info when asking for support: timestamp = 2026-11-25T07:46:04.6562375Z, correlationId = 5310d49b-300a-****-****-73b44307ac20.";
const INVALID_QUERY_MESSAGE: string =
  "Query is invalid. Please refer to the documentation for the Azure Resource Graph service and fix the error before retrying.";

/*
 * Resource Graph's answer to the subnet query of 16.0.0, as the customer's
 * report shows it (#11142): its codes, tokens and part of its correlation
 * id were left out there, and are left out here.
 */
export const RECORDED_PARSER_FAILURE: JSONObject = {
  error: {
    code: "...",
    message: SUPPORT_MESSAGE,
    details: [
      { code: "...", message: INVALID_QUERY_MESSAGE },
      {
        code: "...",
        message: "ParserFailure",
        line: 3,
        characterPositionInLine: 18,
        token: "...",
        expectedToken: "...",
      },
    ],
  },
};

// Resource Graph's answer to a query it refuses, for the first of its problems.
export function resourceGraphRefusal(problem: KqlProblem): FakeResponse {
  const detail: JSONObject =
    problem.isSyntax && problem.position
      ? {
          code: "ParserFailure",
          message: "ParserFailure",
          line: problem.position.line,
          characterPositionInLine: problem.position.character,
          token: describeKqlProblem(problem),
          expectedToken: "",
        }
      : { code: "InvalidQuery", message: describeKqlProblem(problem) };

  return json(
    {
      error: {
        code: "BadRequest",
        message: SUPPORT_MESSAGE,
        details: [
          { code: "InvalidQuery", message: INVALID_QUERY_MESSAGE },
          detail,
        ],
      },
    },
    400,
  );
}

export type ResourceGraphAnswer = (
  request: DataSourceHttpRequest,
  query: string,
) => FakeResponse | Promise<FakeResponse>;

/*
 * A Resource Graph route's responder: a query Resource Graph would refuse
 * is refused, and every other one is the suite's to answer.
 */
export function strictResourceGraph(
  answer: ResourceGraphAnswer,
): FakeResponder {
  return (
    request: DataSourceHttpRequest,
  ): FakeResponse | Promise<FakeResponse> => {
    const query: unknown = bodyOf(request)["query"];

    if (typeof query !== "string") {
      return json(
        {
          error: {
            code: "BadRequest",
            message: SUPPORT_MESSAGE,
            details: [
              { code: "InvalidQuery", message: "The query is missing." },
            ],
          },
        },
        400,
      );
    }

    const problems: Array<KqlProblem> = resourceGraphErrors(query);

    if (problems.length > 0) {
      return resourceGraphRefusal(problems[0]!);
    }

    return answer(request, query);
  };
}
