import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";

/*
 * AI conversations (and their messages, runs and run events) are personal to
 * the user who created them. This filter pins every non-root query to the
 * requesting user so one project member can never read another member's
 * conversations — including through the auto-generated list/count endpoints.
 */
export function pinQueryToRequestingUser<TQuery>(
  query: TQuery,
  props: DatabaseCommonInteractionProps,
  userColumnName: string,
): TQuery {
  if (props.isRoot || props.isMasterAdmin) {
    return query;
  }

  if (!props.userId) {
    throw new NotAuthorizedException(
      "AI conversations are personal and can only be accessed by the user who created them.",
    );
  }

  (query as Record<string, unknown>)[userColumnName] = props.userId;

  return query;
}
