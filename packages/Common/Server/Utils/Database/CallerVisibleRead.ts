import logger from "../Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";

/*
 * A read made with the caller's props, by a hook that lets a person write a
 * row naming a record only if they can see it - an alert linked to an
 * incident, an incident added to an episode. A refusal from the permission
 * layer (no read access to the table, a label the caller cannot see) is
 * reported exactly like a record that does not exist, so a refusal built on
 * the answer never reveals which it was. Anything else - a lapsed session,
 * an unpaid project, the database being unavailable - is not about the
 * record and is passed on as it is.
 */
export default class CallerVisibleRead {
  public static async find<T>(
    read: () => Promise<T | null>,
  ): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadDataException
      ) {
        logger.debug(
          `A record a write names is not readable by the caller: ${error.message}`,
        );
        return null;
      }

      throw error;
    }
  }
}
