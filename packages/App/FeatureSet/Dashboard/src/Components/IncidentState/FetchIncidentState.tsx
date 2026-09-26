import IncidentState from "Common/Models/DatabaseModels/IncidentState";
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
import IncidentStateElement from "./IncidentStateElement";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";

export interface ComponentProps {
  incidentStateId: ObjectID;
}

/*
 * A form holds only the chosen state's id, so a create wizard's summary step
 * looks the state up to show its name and color - the same pill the incident
 * pages use - instead of a sentence that names no state at all.
 */
const FetchIncidentState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const incidentStateId: string = props.incidentStateId.toString();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [incidentState, setIncidentState] = useState<IncidentState | null>(
    null,
  );

  useEffect(() => {
    // Only the answer for the id on screen may land.
    let isCurrent: boolean = true;

    const fetchIncidentState: PromiseVoidFunction = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const fetchedIncidentState: IncidentState | null =
          await ModelAPI.getItem<IncidentState>({
            modelType: IncidentState,
            id: new ObjectID(incidentStateId),
            select: {
              _id: true,
              name: true,
              color: true,
            },
          });

        if (isCurrent) {
          setIncidentState(fetchedIncidentState);
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

    fetchIncidentState().catch((err: Exception) => {
      if (isCurrent) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [incidentStateId]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (!incidentState) {
    return <p>The selected incident state could not be found.</p>;
  }

  return <IncidentStateElement incidentState={incidentState} />;
};

export default FetchIncidentState;
