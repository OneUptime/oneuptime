import React, { FunctionComponent, ReactElement } from "react";
import IncidentRoleFormField, {
  IncidentRoleFormFieldProps,
  RoleAssignment,
} from "../Incident/IncidentRoleFormField";

export type { RoleAssignment };

export type IncidentEpisodeRoleFormFieldProps = IncidentRoleFormFieldProps;

/*
 * Who takes each role on an incident episode. Episodes share the project's
 * incident roles, so this is the incident's role picker - one component, so
 * the two create forms cannot drift apart. The episode's role assignments
 * are copied onto every incident in it (IncidentEpisodeRoleMemberService).
 */
const IncidentEpisodeRoleFormField: FunctionComponent<
  IncidentEpisodeRoleFormFieldProps
> = (props: IncidentEpisodeRoleFormFieldProps): ReactElement => {
  return <IncidentRoleFormField {...props} />;
};

export default IncidentEpisodeRoleFormField;
