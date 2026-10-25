import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DatabaseDocumentationCard from "../../../Components/DatabaseServer/DocumentationCard";
import {
  DatabaseDocumentationTarget,
  getDatabaseDocumentationHeading,
} from "../Utils/DocumentationMarkdown";
import { DATABASE_NOT_FOUND_MESSAGE } from "../Utils/DatabaseServerPresentation";
import { fetchDatabaseDocumentationTarget } from "../Utils/DatabaseDocumentationTarget";

/*
 * The Database Agent guide prefilled for THIS database: its engine, the
 * address applications use, and its id as DATABASE_SERVER_ID (so the
 * agent's data joins this row whatever address it reports). A Kubernetes
 * database is offered the Deployment for its namespace first. An engine
 * the agent has no config for gets the own-collector guide, and the
 * heading says so.
 */
const DatabaseServerDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [target, setTarget] = useState<DatabaseDocumentationTarget | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const found: DatabaseDocumentationTarget | null =
        await fetchDatabaseDocumentationTarget(modelId);

      if (!found) {
        setError(DATABASE_NOT_FOUND_MESSAGE);
        setIsLoading(false);
        return;
      }

      setTarget(found);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!target) {
    return <ErrorMessage message="Database not found." />;
  }

  const heading: { title: string; description: string } =
    getDatabaseDocumentationHeading(target);

  return (
    <Fragment>
      <DatabaseDocumentationCard
        title={heading.title}
        description={heading.description}
        database={target}
      />
    </Fragment>
  );
};

export default DatabaseServerDocumentation;
