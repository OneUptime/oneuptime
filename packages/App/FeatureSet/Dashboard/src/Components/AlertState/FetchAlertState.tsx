import AlertState from "Common/Models/DatabaseModels/AlertState";
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
import AlertStateElement from "./AlertStateElement";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  alertStateId: ObjectID;
}

/*
 * A form holds only the chosen state's id, so a create wizard's summary step
 * looks the state up to show its name and color - the same pill the alert
 * pages use - instead of a sentence that names no state at all.
 */
const FetchAlertState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const alertStateId: string = props.alertStateId.toString();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [alertState, setAlertState] = useState<AlertState | null>(null);

  useEffect(() => {
    // Only the answer for the id on screen may land.
    let isCurrent: boolean = true;

    const fetchAlertState: PromiseVoidFunction = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const fetchedAlertState: AlertState | null =
          await ModelAPI.getItem<AlertState>({
            modelType: AlertState,
            id: new ObjectID(alertStateId),
            select: {
              _id: true,
              name: true,
              color: true,
            },
          });

        if (isCurrent) {
          setAlertState(fetchedAlertState);
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

    fetchAlertState().catch((err: Exception) => {
      if (isCurrent) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [alertStateId]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (!alertState) {
    return <p>The selected alert state could not be found.</p>;
  }

  return <AlertStateElement alertState={alertState} />;
};

export default FetchAlertState;
