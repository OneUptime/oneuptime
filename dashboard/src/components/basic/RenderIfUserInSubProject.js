import { connect } from 'react-redux';
import { User } from '../../config';

// Description: Will render the component is the current user in the project is admin.
// Params
// params 1: props
// returns JSX.Element or NULL
export function RenderIfUserInSubProject(props) {
    const {children, currentProject, subProjectId, subProjects} = props;
    var userId = User.getUserId();
    var renderItems = null;
    if (
        currentProject && 
        currentProject.users.filter(user => user.userId === userId && user.role != 'Viewer').length > 0)
    {
        renderItems = children
    }else{
        if(subProjects){
            subProjects.forEach((subProject)=>{
                if (subProject._id === subProjectId && subProject.users.filter(user => user.userId === userId && user.role != 'Viewer').length > 0){
                    renderItems = children
                }
            });
        }
    }
    return renderItems;
}

function mapStateToProps(state) {
    return {
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
    };
}

export default connect(mapStateToProps)(RenderIfUserInSubProject);