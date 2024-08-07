import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/src/Components/Card/Card";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/src/Utils/Navigation";
import CopilotCodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/src/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/src/Utils/API/API";
import PageLoader from "Common/UI/src/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/src/Components/ErrorMessage/ErrorMessage";
import MarkdownViewer from "Common/UI/src/Components/Markdown.tsx/MarkdownViewer";
import URL from "Common/Types/API/URL";
import { DOCS_URL } from "Common/UI/src/Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";

const CopilotDocuementationPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const codeRepositoryId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [documentation, setDocumentation] = useState<string | null>(null);

  // get code repository

  const [codeRepository, setCodeRepository] =
    useState<CopilotCodeRepository | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCodeRepositoryAndDocumentation: PromiseVoidFunction =
    async (): Promise<void> => {
      // get item.
      setIsLoading(true);

      setError("");
      try {
        const item: CopilotCodeRepository | null = await ModelAPI.getItem({
          modelType: CopilotCodeRepository,
          id: codeRepositoryId,
          select: {
            repositoryHostedAt: true,
            repositoryName: true,
            organizationName: true,
            lastCopilotRunDateTime: true,
          },
        });

        if (!item) {
          setError(`Code Repository not found`);

          return;
        }

        // Send api request to get documentation
        // http://localhost/docs/copilot/introduction

        const documentation: HTTPErrorResponse | HTTPResponse<JSONObject> =
          (await API.get(
            URL.fromString(DOCS_URL.toString()).addRoute(
              "/as-markdown/copilot/introduction",
            ),
          )) as HTTPErrorResponse | HTTPResponse<JSONObject>;

        if (documentation instanceof HTTPErrorResponse) {
          setError(API.getFriendlyMessage(documentation));
        }

        if (documentation.data && documentation.data["data"]) {
          setDocumentation(
            (documentation.data as JSONObject)["data"] as string,
          );
        }

        setCodeRepository(item);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
    };

  useEffect(() => {
    fetchCodeRepositoryAndDocumentation().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  if (!codeRepository) {
    return <ErrorMessage error={"Code Repository not found"} />;
  }

  if (!documentation) {
    return <ErrorMessage error={"Documentation not found"} />;
  }

  return (
    <Fragment>
      <Card
        title={``}
        description={
          <div className="space-y-2 w-full mt-5">
            <MarkdownViewer text={documentation || ""} />
          </div>
        }
      />
    </Fragment>
  );
};

export default CopilotDocuementationPage;
