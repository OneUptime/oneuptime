/*
 * Help for the five API steps. They differ only in the HTTP method, and in
 * whether a body is the point of the request, so one builder writes all five.
 */

import ComponentDocumentation, {
  ComponentDocumentationNoteType,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  ownReference,
} from "./DocumentationContext";
import { WorkflowDocsPaths, docsLink } from "./DocumentationLinks";

export type APIDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

type GetAPIDocumentationFunction = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
) => APIDocumentationFunction;

const getAPIDocumentation: GetAPIDocumentationFunction = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
): APIDocumentationFunction => {
  // A GET or a DELETE carries no body in practice, so its help leaves it out.
  const sendsBody: boolean =
    method === "POST" || method === "PUT" || method === "PATCH";

  return (context: ComponentDocumentationContext): ComponentDocumentation => {
    return {
      summary: sendsBody
        ? `Sends a ${method} request with a JSON body to a URL, and passes the response to the next steps.`
        : `Sends a ${method} request to a URL, and passes the response to the next steps.`,
      steps: [
        sendsBody
          ? "Enter the address in **URL**, and the JSON to send in **Request Body**."
          : "Enter the address in **URL**.",
        "Add headers, such as an API key, in **Request Headers** under the advanced settings.",
        "Connect **Success** for an answer in the 2xx range, and **Error** for anything else.",
      ],
      examples: [
        {
          title: "Read a field of the response in a later step",
          code: ownReference(context, "response-body", ["id"]),
          description:
            "Change `id` to the field you need. **Response Status** holds the status code, such as `200`.",
        },
      ],
      notes: [
        {
          type: ComponentDocumentationNoteType.Tip,
          text: "Redirects are not followed, so use the address the API finally answers on.",
        },
      ],
      learnMore: [
        {
          title: "Sending an API key",
          paragraphs: [
            "Save the key in a secret global variable and use the variable in **Request Headers**. Secret values are hidden in run logs.",
          ],
          example: {
            title: "Request Headers",
            code: '{"Authorization": "Bearer {{global.variables.API_TOKEN}}"}',
          },
        },
        {
          title: "When it fails",
          paragraphs: [
            "**Error** runs when the request cannot be sent or the answer is not in the 2xx range. **Response Status** and **Response Body** still hold the answer, and **Error** says what went wrong.",
          ],
        },
        {
          title: "Which addresses it can reach",
          paragraphs: [
            "Requests go out from OneUptime's servers. Addresses on a private network, `localhost` and cloud metadata addresses are refused, unless a self-hosted install is set up to allow private ones.",
          ],
        },
      ],
      links: [docsLink("API step guide", WorkflowDocsPaths.api)],
    };
  };
};

export const getApiGetDocumentation: APIDocumentationFunction =
  getAPIDocumentation("GET");
export const getApiPostDocumentation: APIDocumentationFunction =
  getAPIDocumentation("POST");
export const getApiPutDocumentation: APIDocumentationFunction =
  getAPIDocumentation("PUT");
export const getApiPatchDocumentation: APIDocumentationFunction =
  getAPIDocumentation("PATCH");
export const getApiDeleteDocumentation: APIDocumentationFunction =
  getAPIDocumentation("DELETE");
