import IncidentEpisodeRoleMember from "Common/Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * Giving one of the project's incident roles to a person, on an incident
 * or an incident episode: one row naming the record, the project, the
 * person and the role. The roles card's own Assign gives a role this way,
 * and so does the overview header's, which gives the commander right where
 * it names them. Handing a role on to someone else changes that row's
 * person (reassignIncidentRole). Each rejects with the server's reason.
 */

export const assignIncidentRole: (data: {
  incidentId: ObjectID;
  userId: ObjectID;
  roleId: ObjectID;
}) => Promise<void> = async (data: {
  incidentId: ObjectID;
  userId: ObjectID;
  roleId: ObjectID;
}): Promise<void> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new Error("Project ID not found");
  }

  const member: IncidentMember = new IncidentMember();
  member.incidentId = data.incidentId;
  member.projectId = projectId;
  member.userId = data.userId;
  member.incidentRoleId = data.roleId;

  await ModelAPI.create({
    model: member,
    modelType: IncidentMember,
  });
};

/*
 * Handing a role on an incident from the person who holds it to someone
 * else (Reassign): one update of the role's row, which keeps its incident
 * and its role and names the new person - one change, which Edit Incident
 * Member allows (#10191). It was a delete and then a create, so handing a
 * role on asked to take people off roles, and a create refused after the
 * delete left the role with nobody. The roles card's Reassign hands a role
 * on this way, and so does the overview header, where the commander is
 * named. Rejects with the server's reason.
 */
export const reassignIncidentRole: (data: {
  memberId: ObjectID;
  userId: ObjectID;
}) => Promise<void> = async (data: {
  memberId: ObjectID;
  userId: ObjectID;
}): Promise<void> => {
  await ModelAPI.updateById({
    modelType: IncidentMember,
    id: data.memberId,
    data: {
      userId: data.userId,
    },
  });
};

// The same on an incident episode, whose incidents follow it on the server.
export const reassignIncidentEpisodeRole: (data: {
  memberId: ObjectID;
  userId: ObjectID;
}) => Promise<void> = async (data: {
  memberId: ObjectID;
  userId: ObjectID;
}): Promise<void> => {
  await ModelAPI.updateById({
    modelType: IncidentEpisodeRoleMember,
    id: data.memberId,
    data: {
      userId: data.userId,
    },
  });
};

export const assignIncidentEpisodeRole: (data: {
  incidentEpisodeId: ObjectID;
  userId: ObjectID;
  roleId: ObjectID;
}) => Promise<void> = async (data: {
  incidentEpisodeId: ObjectID;
  userId: ObjectID;
  roleId: ObjectID;
}): Promise<void> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new Error("Project ID not found");
  }

  const member: IncidentEpisodeRoleMember = new IncidentEpisodeRoleMember();
  member.incidentEpisodeId = data.incidentEpisodeId;
  member.projectId = projectId;
  member.userId = data.userId;
  member.incidentRoleId = data.roleId;

  await ModelAPI.create({
    model: member,
    modelType: IncidentEpisodeRoleMember,
  });
};
