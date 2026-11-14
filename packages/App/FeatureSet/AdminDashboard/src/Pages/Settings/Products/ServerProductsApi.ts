import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ProductKey from "Common/Types/Product/ProductKey";
import { ServerProductsPreset } from "Common/Types/Product/ServerProducts";
import {
  SERVER_PRODUCTS_ROUTE,
  ServerProductsAnswer,
  parseServerProductsAnswer,
} from "Common/Types/Product/ServerProductsAnswer";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * Admin Dashboard > Settings > Products, over HTTP (issue #6815): GET and
 * POST /global-config/server-products (Types/Product/ServerProductsAnswer).
 * A refusal throws, with the server's words for the page to show.
 */

const serverProductsUrl: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(new Route(SERVER_PRODUCTS_ROUTE));
};

const readAnswer: (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => ServerProductsAnswer = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): ServerProductsAnswer => {
  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  const answer: ServerProductsAnswer | null = parseServerProductsAnswer(
    response.data,
  );

  if (!answer) {
    throw new Error("The server did not answer with its products.");
  }

  return answer;
};

export const fetchServerProducts: () => Promise<ServerProductsAnswer> =
  async (): Promise<ServerProductsAnswer> => {
    return readAnswer(
      await API.fetch<JSONObject>({
        method: HTTPMethod.GET,
        url: serverProductsUrl(),
      }),
    );
  };

// One click: the products a preset keeps on, every other one off.
export const postServerProductsPreset: (
  preset: ServerProductsPreset,
) => Promise<ServerProductsAnswer> = async (
  preset: ServerProductsPreset,
): Promise<ServerProductsAnswer> => {
  return readAnswer(
    await API.post<JSONObject>({
      url: serverProductsUrl(),
      data: { preset: preset },
    }),
  );
};

// One switch.
export const postServerProductSwitched: (data: {
  product: ProductKey;
  isOn: boolean;
}) => Promise<ServerProductsAnswer> = async (data: {
  product: ProductKey;
  isOn: boolean;
}): Promise<ServerProductsAnswer> => {
  return readAnswer(
    await API.post<JSONObject>({
      url: serverProductsUrl(),
      data: { product: data.product, isOn: data.isOn },
    }),
  );
};
