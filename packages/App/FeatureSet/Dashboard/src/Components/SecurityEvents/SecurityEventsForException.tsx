import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SecurityEventsInSignal from "./SecurityEventsInSignal";

export interface ComponentProps {
  telemetryExceptionId: ObjectID;
  className?: string | undefined;
}

/*
 * On an exception's page: the security events whose request threw it. An
 * exception an attack keeps triggering is the code path the attack found,
 * and is worth fixing before anything else.
 *
 * The exception group is read for its fingerprint (what a followed event
 * names it by, SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint); the
 * events are then read as SecurityEventsInSignal reads them.
 */
const SecurityEventsForException: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [fingerprint, setFingerprint] = useState<string>("");
  const exceptionId: string = props.telemetryExceptionId.toString();

  useEffect(() => {
    setFingerprint("");

    if (!ObjectID.isValidUUID(exceptionId)) {
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getItem<TelemetryException>({
      modelType: TelemetryException,
      id: new ObjectID(exceptionId),
      select: { fingerprint: true },
    })
      .then((exception: TelemetryException | null): void => {
        if (isCurrent && exception?.fingerprint) {
          setFingerprint(exception.fingerprint);
        }
      })
      .catch((): void => {
        // The exception's own page says what went wrong reading it.
      });

    return () => {
      isCurrent = false;
    };
  }, [exceptionId]);

  if (!fingerprint) {
    return <></>;
  }

  return (
    <SecurityEventsInSignal
      scope={{ exceptionFingerprint: fingerprint }}
      className={props.className}
    />
  );
};

export default SecurityEventsForException;
