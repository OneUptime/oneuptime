import ExceptionMessages from "./ExceptionMessages";
import ForbiddenException from "./ForbiddenException";

/*
 * A master admin has blocked the project a request is for (Admin Dashboard >
 * Projects). Everyone but a master admin is refused in it - its members, its
 * API keys, the MCP clients connected to it - until it is unblocked.
 *
 * A 403: the Dashboard answers a 401 or a 405 by signing the person out of
 * every project, and nothing about their session is wrong. Told apart from
 * other 403s by its message (isException), as the Dashboard shows a blocked
 * project its own page rather than the Forbidden one.
 */
export default class ProjectBlockedException extends ForbiddenException {
  public constructor() {
    super(ExceptionMessages.ProjectBlocked);
  }

  public static isException(errorMessage: unknown): boolean {
    return errorMessage === ExceptionMessages.ProjectBlocked;
  }
}
