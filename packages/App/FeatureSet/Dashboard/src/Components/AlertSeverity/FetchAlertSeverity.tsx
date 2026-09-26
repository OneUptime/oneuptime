import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import AlertSeverityElement from "./AlertSeverityElement";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  alertSeverityId: ObjectID;
}

/*
 * A form holds only the chosen severity's id, so a create wizard's summary step
 * looks the severity up to show its name and color - the same pill the alert
 * pages use - instead of a sentence that names no severity at all.
 */
const FetchAlertSeverity: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const alertSeverityId: string = props.alertSeverityId.toString();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [alertSeverity, setAlertSeverity] = useState<AlertSeverity | null>(
    null,
  );

  useEffect(() => {
    // Only the answer for the id on screen may land.
    let isCurrent: boolean = true;

    const fetchAlertSeverity: PromiseVoidFunction = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const fetchedAlertSeverity: AlertSeverity | null =
          await ModelAPI.getItem<AlertSeverity>({
            modelType: AlertSeverity,
            id: new ObjectID(alertSeverityId),
            select: {
              _id: true,
              name: true,
              color: true,
            },
          });

        /*
         * A missing or deleted severity does not come back as null: the API
         * answers an empty object, which arrives as a model with no id.
         */
        if (isCurrent) {
          setAlertSeverity(
            fetchedAlertSeverity?.id ? fetchedAlertSeverity : null,
          );
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    fetchAlertSeverity().catch((err: Exception) => {
      if (isCurrent) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [alertSeverityId]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (!alertSeverity) {
    return <p>The selected alert severity could not be found.</p>;
  }

  return <AlertSeverityElement alertSeverity={alertSeverity} />;
};

export default FetchAlertSeverity;
