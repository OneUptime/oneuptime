import Exception from "./Exception";
import ExceptionCode from "./ExceptionCode";
import ErrorClass from "../Telemetry/ErrorClass";

/*
 * 409 Conflict: the write was made to a record as it no longer is. A save
 * sent with the revision of the graph it was made to is refused once someone
 * else has saved a newer one (WorkflowService, issue #6257), so it never
 * replaces their change without the sender knowing. The sender reads the
 * record again and decides.
 */
export default class ConflictException extends Exception {
  public constructor(message: string) {
    super(ExceptionCode.ConflictException, message);
  }

  /*
   * A check we deliberately wrote, doing exactly its job: the record moved
   * on, and saying so IS the correct behaviour, so it is not an Issue.
   * Promoted back to CodeFault outside an HTTP request - see
   * ErrorClassResolver.
   */
  protected override getErrorClass(): ErrorClass {
    return ErrorClass.ExpectedDenial;
  }
}
