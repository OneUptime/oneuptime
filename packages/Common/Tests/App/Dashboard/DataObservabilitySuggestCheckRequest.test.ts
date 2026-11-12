import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * WRITE A CHECK FROM A SENTENCE: WHAT THE DASHBOARD SENDS (#7220).
 *
 * The table, the rule as the person wrote it, and the language they read
 * OneUptime in - what the server asks OneUptime AI to write the check's
 * name and explanation in (DataCheckSuggestLanguage).
 */

const TABLE: string = "8b000000-0000-4000-8000-000000000002";

const SUGGESTION: JSONObject = {
  name: "Bestellungen mit negativer Summe",
  customSql:
    'SELECT COUNT(*) AS value FROM "public"."orders" WHERE "total" < 0',
  alertCondition: "Above",
  alertThreshold: 0,
  explanation: "Zählt Bestellungen, deren Summe unter null liegt.",
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("suggestCheck", () => {
  test.each(["de", "en", "ar"])(
    "sends the table, the rule and the reader's language (%s), and returns the check the server wrote",
    async (language: string) => {
      jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

      const post: ReturnType<typeof jest.spyOn> = jest
        .spyOn(API, "post")
        .mockResolvedValue(
          new HTTPResponse<JSONObject>(200, SUGGESTION, {}) as never,
        );

      const answer: unknown = await DataObservabilityApi.suggestCheck(
        new ObjectID(TABLE),
        "Bestellungen haben nie eine negative Summe",
        language,
      );

      expect(post).toHaveBeenCalledTimes(1);

      const request: { url: URL; data: JSONObject } = post.mock
        .calls[0]![0] as { url: URL; data: JSONObject };

      expect(request.url.toString()).toContain(
        DATA_OBSERVABILITY_API_ROUTES.checkSuggest,
      );
      expect(request.data).toEqual({
        dataAssetId: TABLE,
        sentence: "Bestellungen haben nie eine negative Summe",
        language,
      });
      expect(answer).toEqual(SUGGESTION);
    },
  );
});
