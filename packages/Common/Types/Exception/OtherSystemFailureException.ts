import BadDataExceptionWithDetails from "./BadDataExceptionWithDetails";
import {
  getOtherSystemDetailsAnswer,
  getOtherSystemFailureMessage,
  OtherSystemFailure,
  toOtherSystemDetails,
} from "./OtherSystemFailure";

/*
 * Another system refused or failed (#7268): OneUptime's sentence is the
 * message - what happened and what to do next - and the other system's
 * own words go beside it, in the answer's otherSystemDetails field, for
 * the page to fold under "Details" (OtherSystemFailure). A 400, as the
 * BadDataException these places threw before: what the person sent or set
 * up is what to change.
 */
export default class OtherSystemFailureException extends BadDataExceptionWithDetails {
  // The other system's words, as kept: none when it gave none.
  public readonly otherSystemDetails: string | undefined;

  public constructor(failure: OtherSystemFailure) {
    const message: string = getOtherSystemFailureMessage(failure);
    const details: string | undefined = toOtherSystemDetails(
      failure.details,
      message,
    );

    super(message, getOtherSystemDetailsAnswer(details));
    this.otherSystemDetails = details;
  }
}
