import mongoose from 'mongoose';
import ProjectModel from '../../backend/models/project';

export default {
    /**
     * adds team members to a project
     * @param { {userId, role}[]} teamMembers
     * @param {Object} projectId
     * @returns {Object | {error : string}} the updated project or an error
     */
    addTeamMembersToProject: async function (
        projectId: string,
        teamMembers: $TSFixMe
    ) {
        try {
            if (
                Array.isArray(teamMembers) &&
                teamMembers.length &&
                mongoose.isValidObjectId(projectId)
            ) {
                const updatedProject = await ProjectModel.findOneAndUpdate(
                    {
                        _id: projectId,
                    },
                    {
                        $addToSet: {
                            users: {
                                $each: teamMembers,
                            },
                        },
                    },
                    {
                        new: true,
                    }
                );
                return updatedProject;
            }
        } catch (error) {
            return { error: 'Can not add team members to project' };
        }
    },

    /**
     * removes team members to a project
     * @param { {userId, role}[]} teamMembers
     * @param {Object} projectId
     * @returns {Object | {error : string}} the updated project or an error
     */
    removeTeamMembersFromProject: async function (
        projectId: string,
        teamMembers: $TSFixMe
    ) {
        try {
            if (
                Array.isArray(teamMembers) &&
                teamMembers.length &&
                mongoose.isValidObjectId(projectId)
            ) {
                const updatedProject = await ProjectModel.findOneAndUpdate(
                    {
                        _id: projectId,
                    },
                    {
                        $pullAll: {
                            users: teamMembers,
                        },
                    },
                    {
                        new: true,
                    }
                );
                return updatedProject;
            }
        } catch (error) {
            return { error: 'Can not remove team members to project' };
        }
    },
};
