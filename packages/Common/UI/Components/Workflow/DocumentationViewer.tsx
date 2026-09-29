import {
  API_DOCS_URL,
  DOCS_URL,
  HOME_URL,
  HOST,
  HTTP_PROTOCOL,
} from "../../Config";
import API from "../../Utils/API/API";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  documentationLink: Route;
  workflowId: ObjectID;
  webhookSecretKey?: string | undefined;
  /*
   * The model this component reads or writes, when it has one. Used to link to
   * that model's API reference page, which lists every column with its type and
   * an example - the thing a builder actually needs and the one thing a shared
   * markdown file can never carry. pascalCaseToDashes is the same transform
   * DatabaseBaseModel.getAPIDocumentationPath uses to build that page's route.
   */
  tableName?: string | undefined;
}

const DocumentationViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [markdown, setMarkdown] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  type PopulateWithEnvVarsFunction = (text: string) => string;

  const populateWithEnvVars: PopulateWithEnvVarsFunction = (
    text: string,
  ): string => {
    text = text.replace("{{serverUrl}}", HOME_URL.toString());
    text = text.replace("{{workflowId}}", props.workflowId.toString());
    text = text.replace(
      "{{webhookSecretKey}}",
      props.webhookSecretKey || "Loading...",
    );

    return text;
  };

  const loadDocs: PromiseVoidFunction = async (): Promise<void> => {
    if (props.documentationLink) {
      try {
        setIsLoading(true);
        /*
         * Cleared on every attempt. Without this a failure was permanent for
         * the life of the mount: setError was only ever set, so a doc that
         * failed once kept its error banner even after a later load succeeded.
         */
        setError("");
        const body: HTTPResponse<any> = await API.get({
          url: new URL(HTTP_PROTOCOL, HOST, props.documentationLink),
          data: {},
          headers: {
            Accept: "text/plain",
            "Content-Type": "text/plain",
          },
        });
        setMarkdown(populateWithEnvVars((body.data as any).data.toString()));
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
        setError(API.getFriendlyMessage(err));
      }
    }
  };

  useAsyncEffect(async () => {
    await loadDocs();
  }, [props.documentationLink]);

  /*
   * No heading of its own. The only caller renders this inside a card already
   * titled "Documentation", so the panel used to open with that word three
   * times over - the card's label, an <h2> repeating it, and a line of filler
   * saying the section was what its own title said it was - before any content.
   */
  return (
    <div className="mb-5">
      {error ? <ErrorMessage message={error} /> : <></>}
      {isLoading ? <ComponentLoader /> : <></>}

      <MarkdownViewer text={markdown} />

      {/*
       * A way out of the modal. The component docs are deliberately short now,
       * and the two things they cannot hold - the full guide, and this model's
       * own column reference - live on the docs site.
       */}
      <div className="mt-3 pt-3 border-t border-blue-100 flex flex-col gap-1">
        <a
          className="text-sm text-blue-500 hover:text-blue-600 underline"
          href={`${DOCS_URL.toString()}/workflows/components`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Workflow components guide
        </a>
        {props.tableName ? (
          <a
            className="text-sm text-blue-500 hover:text-blue-600 underline"
            href={`${API_DOCS_URL.toString()}/${Text.pascalCaseToDashes(
              props.tableName,
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Every column on this model
          </a>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default DocumentationViewer;
