import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ServerlessDocumentationCard from "../../../Components/Serverless/ServerlessDocumentationCard";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  TranslatableTerm,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

const ServerlessFunctionDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [serverlessFunction, setServerlessFunction] =
    useState<ServerlessFunction | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchModel: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: ServerlessFunction | null = await ModelAPI.getItem({
        modelType: ServerlessFunction,
        id: modelId,
        select: {
          name: true,
          functionIdentifier: true,
          cloudPlatform: true,
        },
      });
      setServerlessFunction(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchModel().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!serverlessFunction) {
    return <ErrorMessage message="Serverless function not found." />;
  }

  const label: string | TranslatableTerm =
    (serverlessFunction.functionIdentifier as string) ||
    (serverlessFunction.name as string) ||
    translatableTerm("this function");

  return (
    <Fragment>
      <ServerlessDocumentationCard
        title="Send telemetry to this serverless function"
        description={translator.translateTemplate(
          "Instrument your function with OpenTelemetry so {{function}} reports to OneUptime.",
          { function: label },
        )}
        functionName={serverlessFunction.functionIdentifier as string}
        cloudPlatform={serverlessFunction.cloudPlatform as string}
      />
    </Fragment>
  );
};

export default ServerlessFunctionDocumentation;
