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
 * it names them. Each rejects with the server's reason.
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
