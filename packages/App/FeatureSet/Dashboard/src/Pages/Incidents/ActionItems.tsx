import PostmortemActionItemsTable from "../../Components/Postmortem/ActionItems/PostmortemActionItemsTable";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Incidents > Action Items: what every postmortem says the team will do,
 * across the project (#6801) - who owns each, when each is due, and which
 * are done.
 */
const IncidentActionItemsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <PostmortemActionItemsTable />;
};

export default IncidentActionItemsPage;
