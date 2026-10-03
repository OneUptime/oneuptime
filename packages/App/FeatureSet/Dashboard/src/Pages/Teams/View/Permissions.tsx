import PageComponentProps from "../../PageComponentProps";
import TeamPermissionTable, {
  PermissionType,
} from "../../../Components/Team/TeamPermissionTable";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * A team's Permissions page: what its members can do, then - folded under
 * Advanced - what they can never do.
 *
 * Block permissions had a page of their own, next to Permissions in the
 * team's menu and as prominent as what the team can do, though few teams
 * ever need one. They now sit in the Advanced section at the bottom of this
 * page, as on an API key's page, which says "Configured" while the team has
 * any. The old Block Permissions address forwards here (TeamsRoutes).
 */
export const TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID: string =
  "team-permissions-advanced-section";

const TeamViewPermissions: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [blockPermissionCount, setBlockPermissionCount] = useState<number>(0);

  return (
    <Fragment>
      {/* What the team's members can do: a role, or single permissions. */}
      <TeamPermissionTable
        teamId={modelId}
        permissionType={PermissionType.AllowPermissions}
        currentProject={props.currentProject}
      />

      {/* What they can never do, folded away. */}
      <AdvancedPageSection
        description="Block permissions: what this team can never do, even when one of its roles or permissions allows it."
        isConfigured={blockPermissionCount > 0}
        dataTestId={TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID}
      >
        <TeamPermissionTable
          teamId={modelId}
          permissionType={PermissionType.BlockPermissions}
          currentProject={props.currentProject}
          onPermissionCountChange={(count: number) => {
            setBlockPermissionCount(count);
          }}
        />
      </AdvancedPageSection>
    </Fragment>
  );
};

export default TeamViewPermissions;
