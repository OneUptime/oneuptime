import Permission from "Common/Types/Permission";
import GrantablePermission from "Common/UI/Utils/GrantablePermission";

/*
 * WHO MAY ADD OR CHANGE A PROJECT'S SCIM CONNECTION.
 *
 * Through its Groups endpoints a SCIM connection lets the identity provider
 * change the members of any team in the project, so the server saves one -
 * creating it, editing it, or resetting its bearer token - only for someone
 * who could invite people to every team (Common/Server/Utils
 * /SsoProviderTeamGrant). Every project has its Owners team, which holds
 * Project Owner and cannot be changed, so that is someone who holds Project
 * Owner for the whole project with nothing blocking it, or a master admin:
 * exactly who may hand on Project Owner (GrantablePermission).
 *
 * Settings > SCIM offers Create, Edit and Reset Bearer Token only to them,
 * and shows them alone the bearer token - the server lets only a project
 * owner read it - telling everyone else why (ScimSaveAccessNotice). Seeing
 * and deleting connections stays as it was.
 *
 * React-free: the page and the tests read it.
 */
export const canCurrentUserSaveScimConnections: () => boolean = (): boolean => {
  return GrantablePermission.canCurrentUserGrant(Permission.ProjectOwner);
};

export default canCurrentUserSaveScimConnections;
