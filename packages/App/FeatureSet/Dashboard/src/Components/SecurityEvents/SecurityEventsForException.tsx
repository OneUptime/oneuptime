import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import { ExceptionGroupFingerprintsOfException } from "Common/Types/Telemetry/ExceptionGroupFingerprints";
import { findExceptionGroupFingerprints } from "../../Utils/ExceptionMerge";
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
 * The exception is read for the fingerprints its occurrences carry - its
 * own, then those of the exceptions merged into it, which count on it
 * (findExceptionGroupFingerprints) - what a followed event names it by
 * (SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint). The events are then
 * read as SecurityEventsInSignal reads them.
 */
const SecurityEventsForException: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [fingerprints, setFingerprints] = useState<Array<string>>([]);
  const exceptionId: string = props.telemetryExceptionId.toString();

  useEffect(() => {
    setFingerprints([]);

    if (!ObjectID.isValidUUID(exceptionId)) {
      return;
    }

    let isCurrent: boolean = true;

    findExceptionGroupFingerprints([exceptionId])
      .then((groups: Array<ExceptionGroupFingerprintsOfException>): void => {
        const group: ExceptionGroupFingerprintsOfException | undefined =
          groups.find(
            (entry: ExceptionGroupFingerprintsOfException): boolean => {
              return (
                entry.telemetryExceptionId.toLowerCase() ===
                exceptionId.toLowerCase()
              );
            },
          );

        if (isCurrent && group && group.fingerprints.length > 0) {
          setFingerprints(group.fingerprints);
        }
      })
      .catch((): void => {
        // The exception's own page says what went wrong reading it.
      });

    return () => {
      isCurrent = false;
    };
  }, [exceptionId]);

  if (fingerprints.length === 0) {
    return <></>;
  }

  return (
    <SecurityEventsInSignal
      scope={{
        exceptionFingerprint: fingerprints[0],
        ...(fingerprints.length > 1
          ? { mergedExceptionFingerprints: fingerprints.slice(1) }
          : {}),
      }}
      className={props.className}
    />
  );
};

export default SecurityEventsForException;
