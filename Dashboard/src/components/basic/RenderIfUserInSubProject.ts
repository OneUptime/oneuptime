import { connect } from 'react-redux';
import { User } from '../../config';
import { RootState } from '../../store';
// Description: Will render the component is the current user in the project is admin.
// Params
// params 1: props
// returns JSX.Element or NULL
export const RenderIfUserInSubProject: Function = (props: $TSFixMe): void => {
    const { children, currentProject, subProjectId, subProjects } = props;
    const userId = User.getUserId();
    let renderItems = null;
    if (
        currentProject &&
        currentProject.users.filter(
            (user: $TSFixMe) => user.userId === userId && user.role !== 'Viewer'
        ).length > 0
    ) {
        renderItems = children;
    } else if (
        currentProject &&
        currentProject.users.filter(
            (user: $TSFixMe) => user.userId === userId && user.role === 'Viewer'
        ).length > 0
    ) {
        renderItems = children;
    } else {
        if (subProjects) {
            subProjects.forEach((subProject: $TSFixMe) => {
                if (
                    subProject._id === subProjectId &&
                    subProject.users.length > 0
                ) {
                    renderItems = children;
                }
            });
        }
    }
    return renderItems;
};

function mapStateToProps(state: RootState): void {
    return {
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
    };
}

export default connect(mapStateToProps)(RenderIfUserInSubProject);
