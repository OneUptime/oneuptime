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

/*
 * API Get By ID: API Get's help, less what it does the same, and how the ID
 * goes in (Types/Workflow/Components/ApiGetById).
 */
export const getApiGetByIdDocumentation: APIDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary:
      "Gets one item from an API by an ID from an earlier step, and passes the response to the next steps.",
    steps: [
      "Enter the item's address in **URL**, with `{id}` where its ID goes.",
      "Put the ID in **ID**, usually a value from an earlier step, such as an issue key a webhook sent.",
      "Connect **Success** for an answer in the 2xx range, and **Error** for anything else.",
    ],
    examples: [
      {
        title: "Read a Jira issue named by a webhook",
        fields: [
          {
            name: "URL",
            value:
              "https://your-company.atlassian.net/rest/api/3/issue/{id}?fields=labels",
          },
          {
            name: "ID",
            value:
              "{{local.components.webhook-1.returnValues.request-body.issue.key}}",
          },
        ],
        description: `A later step reads the issue's labels with \`${ownReference(
          context,
          "response-body",
          ["fields", "labels"],
        )}\`.`,
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "Only an ID made of letters, digits, dashes and underscores is sent. Anything else, such as text with a slash, goes down **Error** before any request is made.",
      },
    ],
    learnMore: [
      {
        title: "Why not API Get",
        paragraphs: [
          "An ID that came from another tool is outside text. Put into an address as it is, a value such as `x/../users` would ask for something else, with your token. This step sends only a plain ID, and percent-encodes it all the same.",
          "Otherwise it is **API Get (JSON)**: the same address rules, no redirects, and the same return values.",
        ],
      },
    ],
    links: [docsLink("API step guide", WorkflowDocsPaths.api)],
  };
};
