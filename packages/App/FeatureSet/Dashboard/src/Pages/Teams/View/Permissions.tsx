import PageComponentProps from "../../PageComponentProps";
import {
  CustomRolesCardState,
  getCustomRoleCount,
  getCustomRolesFoldedItem,
  getTeamMoreSettingsDescription,
} from "../../../Components/CustomRole/CustomRolesFold";
import TeamCustomRolesSettings from "../../../Components/Team/TeamCustomRolesSettings";
import TeamPermissionTable, {
  PermissionType,
} from "../../../Components/Team/TeamPermissionTable";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * A team's Permissions page: what its members can do, then - folded under
 * More settings - the custom roles it is given and what they can never do.
 *
 * Block permissions had a page of their own, next to Permissions in the
 * team's menu and as prominent as what the team can do, though few teams
 * ever need one. They sit in the More settings section at the bottom of
 * this page, as on an API key's page, whose folded header shows how many
 * the team has. The old Block Permissions address forwards here
 * (TeamsRoutes).
 *
 * Custom roles - an Enterprise feature most projects never use - opened the
 * page, above Permissions, once the project had one. The maintainer: "Move
 * custom roles to More settings because it is an advanced feature." They
 * sit in More settings now, before Block Permissions, and the folded header
 * names them while the card is drawn, with how many roles the team has
 * (Components/CustomRole/CustomRolesFold); a link to #custom-roles opens it
 * there.
 */
export const TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID: string =
  "team-permissions-advanced-section";

// The Block Permissions card's place: its title's, as in any More settings.
export const TEAM_BLOCK_PERMISSIONS_PLACE: string = "block-permissions";

const TeamViewPermissions: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [blockPermissionCount, setBlockPermissionCount] = useState<number>(0);
  // What the Custom Roles card holds, once it says: null until then.
  const [customRoles, setCustomRoles] = useState<CustomRolesCardState | null>(
    null,
  );

  const customRolesItem: FoldedSectionItem | null =
    getCustomRolesFoldedItem(customRoles);

  return (
    <Fragment>
      {/* What the team's members can do: a role, or single permissions. */}
      <TeamPermissionTable
        teamId={modelId}
        permissionType={PermissionType.AllowPermissions}
        currentProject={props.currentProject}
        customRoleCount={getCustomRoleCount(customRoles)}
      />

      {/*
       * The custom roles it is given, and what it can never do, folded
       * away. Custom roles are an Enterprise feature: where roles cannot be
       * given, the ones the team still has, with Remove.
       */}
      <AdvancedPageSection
        description={getTeamMoreSettingsDescription(customRoles)}
        items={[
          ...(customRolesItem ? [customRolesItem] : []),
          foldedSectionItem("Block Permissions", {
            key: TEAM_BLOCK_PERMISSIONS_PLACE,
            isSet: blockPermissionCount > 0,
            value: String(blockPermissionCount),
          }),
        ]}
        dataTestId={TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID}
      >
        <TeamCustomRolesSettings
          teamId={modelId}
          onRolesChange={(state: CustomRolesCardState) => {
            setCustomRoles(state);
          }}
        />

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
