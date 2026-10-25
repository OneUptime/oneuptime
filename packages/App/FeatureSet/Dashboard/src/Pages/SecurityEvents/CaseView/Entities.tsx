import PageComponentProps from "../../PageComponentProps";
import SecurityCaseEntitiesCard from "../../../Components/SecurityCase/SecurityCaseEntitiesCard";
import { readSecurityEntities } from "../../../Components/SecurityCase/SecurityEntityChips";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The users, hosts, addresses, domains and files the case is about, each
 * with its activity across all the project's security events this past
 * week, and the way into Correlate to see everything it touched.
 */
const SecurityCaseEntitiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <SecurityCaseEntitiesCard
      entities={readSecurityEntities(view.securityCase.entities)}
    />
  );
};

export default SecurityCaseEntitiesPage;
