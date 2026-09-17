import {
  OnBehalfOfBanner,
  UserOnCallContextProvider,
  UserOnCallData,
  useUserOnCallData,
} from "./Context";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * The Users > View > On-Call section layout.
 *
 * A PATHLESS route: it adds no segment to the URL, it exists so that the six
 * pages under it share one load of the identity and readiness they all need,
 * one permission decision, and one "you are editing on behalf of" banner.
 * Navigating between Readiness, Notification Methods and the four rule pages
 * therefore re-renders rather than re-fetches.
 *
 * The two loads are separated on purpose — see useUserOnCallData. The identity
 * one blocks the whole section, because a page that offers to change how
 * somebody is paged without being able to say WHO is the one state this section
 * must never be in. A readiness failure does not block anything: it is a
 * computed opinion, and the rules underneath stay editable without it.
 *
 * The permission check here is a convenience, never the boundary. Someone who
 * types the URL reaches this component, which repeats it, and the API refuses
 * the reads and writes regardless.
 */
const UserViewOnCallLayout: FunctionComponent = (): ReactElement => {
  /*
   * Read from the router rather than from the path. The section is nested under
   * `:id`, and counting URL segments — which the single page this replaced had
   * to do — breaks the moment a page is added at a different depth.
   */
  const { id: idParam } = useParams();
  const userId: ObjectID = new ObjectID(idParam || "");

  const data: UserOnCallData = useUserOnCallData(userId);

  if (!data.value.canRead) {
    return (
      <ErrorMessage message="You do not have permission to view this user's on-call notification configuration. Ask a project owner or admin for the 'Read User Notification Rules' permission." />
    );
  }

  if (data.isLoadingUser) {
    return <PageLoader isVisible={true} />;
  }

  if (data.userError) {
    return <ErrorMessage message={data.userError} />;
  }

  return (
    <UserOnCallContextProvider value={data.value}>
      <OnBehalfOfBanner
        isSelf={data.value.isSelf}
        canEdit={data.value.canEdit}
        displayName={data.value.displayName}
        firstName={data.value.firstName}
      />
      <Outlet />
    </UserOnCallContextProvider>
  );
};

export default UserViewOnCallLayout;
