import PageComponentProps from "../../PageComponentProps";
import useSecurityCaseMatches, {
  SecurityCaseMatchesState,
} from "../../../Components/SecurityCase/Matches/useSecurityCaseMatches";
import SecurityCaseEntitiesCard from "../../../Components/SecurityCase/SecurityCaseEntitiesCard";
import { readSecurityEntities } from "../../../Components/SecurityCase/SecurityEntityChips";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import { getCaseBlockableAddresses } from "Common/Utils/SecurityCase/ResponsePlan/BlockableAddresses";
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
  const entities: Array<SecurityEntity> = readSecurityEntities(
    view.securityCase.entities,
  );
  // Which of its addresses its requests only claimed: never offered for blocking (#10416).
  const matches: SecurityCaseMatchesState = useSecurityCaseMatches(
    view.caseId,
    view.refreshToggle,
  );

  return (
    <SecurityCaseEntitiesCard
      entities={entities}
      securityCaseId={view.caseId}
      // Until the requests are read, none: an address they only claimed is never offered.
      blockableAddresses={
        matches.matches
          ? getCaseBlockableAddresses({
              entities,
              matches: matches.matches,
            })
          : []
      }
    />
  );
};

export default SecurityCaseEntitiesPage;
