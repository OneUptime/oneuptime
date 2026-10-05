import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { EpisodeMemberRoleAssignment } from "Common/Models/DatabaseModels/IncidentGroupingRule";
import IncidentRoleFormField from "../Incident/IncidentRoleFormField";
import {
  assignmentsToEpisodeRoles,
  episodeRolesToAssignments,
  RoleAssignment,
} from "../IncidentRole/IncidentRoleAssignments";

export interface EpisodeMemberRoleAssignmentsFormFieldProps {
  onChange?: ((value: Array<EpisodeMemberRoleAssignment>) => void) | undefined;
  initialValue?: Array<EpisodeMemberRoleAssignment> | undefined;
  error?: string | undefined;
}

/*
 * Who an incident grouping rule puts in each role of the episodes it opens:
 * the declare form's role picker (Incident/IncidentRoleFormField), not a
 * copy of it - the copy this was tagged roles "Primary" and "Multiple" of
 * its own. The rule keeps what it always stored, one { userId,
 * incidentRoleId } row per person (episodeMemberRoleAssignments), which
 * IncidentGroupingEngineService reads when it opens an episode; the rows are
 * turned into the picker's value and back here.
 */
const EpisodeMemberRoleAssignmentsFormField: FunctionComponent<
  EpisodeMemberRoleAssignmentsFormFieldProps
> = (props: EpisodeMemberRoleAssignmentsFormFieldProps): ReactElement => {
  const initialValue: Array<RoleAssignment> = useMemo(() => {
    return episodeRolesToAssignments(props.initialValue);
  }, [props.initialValue]);

  return (
    <div>
      <IncidentRoleFormField
        initialValue={initialValue}
        onChange={(assignments: Array<RoleAssignment>) => {
          props.onChange?.(assignmentsToEpisodeRoles(assignments));
        }}
      />

      {props.error && (
        <p className="text-sm text-red-500 mt-2">{props.error}</p>
      )}
    </div>
  );
};

export default EpisodeMemberRoleAssignmentsFormField;
