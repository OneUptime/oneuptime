import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import {
  PROJECT_PRODUCTS_PINS_ROUTE,
  PROJECT_PRODUCTS_ROUTE,
  PROJECT_PRODUCTS_VISIBILITY_ROUTE,
  ProjectProductsAnswer,
  parseProjectProductsAnswer,
} from "Common/Types/Product/ProjectProductsAnswer";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's reads and writes of a project's products (issue #6814):
 * one GET for the whole answer, and POSTs that each answer with the
 * products as they now stand (Types/Product/ProjectProductsAnswer).
 *
 * A read answers null when it fails: the store keeps what it knew, and the
 * menu shows every product rather than none. A write throws, with the
 * server's words, so the page that asked can say what went wrong.
 */

const toUrl: (route: string) => URL = (route: string): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(route);
};

const toAnswer: (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => ProjectProductsAnswer | null = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): ProjectProductsAnswer | null => {
  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    return null;
  }

  return parseProjectProductsAnswer(response.data);
};

/*
 * The answer for a project: asked in that project's name (its `tenantid`),
 * whichever project the tab has open.
 */
export const fetchProjectProducts: (
  projectId: ObjectID,
) => Promise<ProjectProductsAnswer | null> = async (
  projectId: ObjectID,
): Promise<ProjectProductsAnswer | null> => {
  try {
    return toAnswer(
      await API.get<JSONObject>({
        url: toUrl(PROJECT_PRODUCTS_ROUTE),
        headers: {
          ...ModelAPI.getCommonHeaders(),
          tenantid: projectId.toString(),
        },
      }),
    );
  } catch {
    return null;
  }
};

const postProjectProducts: (
  route: string,
  data: JSONObject,
) => Promise<ProjectProductsAnswer> = async (
  route: string,
  data: JSONObject,
): Promise<ProjectProductsAnswer> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: toUrl(route),
      data: data,
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw new Error(API.getFriendlyMessage(response));
  }

  const answer: ProjectProductsAnswer | null = parseProjectProductsAnswer(
    response.data,
  );

  if (!answer) {
    throw new Error("The server's answer could not be read.");
  }

  return answer;
};

// Shows or hides one product for the project.
export const postProductShown: (data: {
  product: ProductKey;
  isShown: boolean;
}) => Promise<ProjectProductsAnswer> = (data: {
  product: ProductKey;
  isShown: boolean;
}): Promise<ProjectProductsAnswer> => {
  return postProjectProducts(PROJECT_PRODUCTS_VISIBILITY_ROUTE, {
    product: data.product,
    isShown: data.isShown,
  });
};

// Shows every product again, for the project.
export const postEveryProductShown: () => Promise<ProjectProductsAnswer> =
  (): Promise<ProjectProductsAnswer> => {
    return postProjectProducts(PROJECT_PRODUCTS_VISIBILITY_ROUTE, {
      showAll: true,
    });
  };

// Keeps this person's pins, in order.
export const postPinnedProducts: (
  pinned: ReadonlyArray<ProductKey>,
) => Promise<ProjectProductsAnswer> = (
  pinned: ReadonlyArray<ProductKey>,
): Promise<ProjectProductsAnswer> => {
  return postProjectProducts(PROJECT_PRODUCTS_PINS_ROUTE, {
    pinned: [...pinned],
  });
};
