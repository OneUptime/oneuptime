import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
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

  /*
   * No credentials at all is an expired session, not someone else's data:
   * 401 so the client refreshes. The countBy overrides reach this before the
   * permission layer's own login check does.
   */
  DatabaseCommonInteractionPropsUtil.assertCredentialsPresent(props);

  if (!props.userId) {
    throw new NotAuthorizedException(
      "AI conversations are personal and can only be accessed by the user who created them.",
    );
  }

  (query as Record<string, unknown>)[userColumnName] = props.userId;

  return query;
}
