import Alert, { AlertType } from "../Alerts/Alert";
import ErrorExplanation, {
  isUnexplainedErrorMessage,
} from "../ErrorMessage/ErrorExplanation";
import { sayRefusalWithValues } from "../../Utils/ErrorInSentence";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: Array<ReactElement> | ReactElement;
  error?: string | undefined;
  /*
   * What the dialog was doing, in the reader's language - "Couldn't delete
   * the note." - said first when the error is one nobody explained
   * (ErrorExplanation). Without it, that line says "This did not finish."
   */
  whatFailed?: string | undefined;
}

/*
 * A dialog's body, with the reason its last action failed - a refusal the
 * server sent back - drawn first, above what the dialog holds. The alert
 * keeps the gap the rest of a dialog's blocks keep: drawn flush, it ran into
 * whatever came first (Start Packet Capture's red refusal sat on its yellow
 * notice, two banners read as one). The Modal brings it into view when it
 * appears.
 *
 * A refusal with values in it - a monitor's type beside a template's, a
 * setting a template does not sync - is said in the reader's language
 * around its values (sayRefusalWithValues, #7711): the Alert looks its title
 * up whole, and such a refusal is no key once its values are in.
 */
const ModalBody: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const refusal: string | null = sayRefusalWithValues(props.error, translator);

  return (
    <div className="modal-body">
      {props.error && (
        <Alert
          title={
            isUnexplainedErrorMessage(props.error) ? (
              <ErrorExplanation
                message={props.error}
                whatFailed={props.whatFailed}
              />
            ) : (
              refusal ?? props.error
            )
          }
          type={AlertType.DANGER}
          className="mb-4"
          dataTestId="modal-error"
        />
      )}
      {props.children}
    </div>
  );
};

export default ModalBody;
