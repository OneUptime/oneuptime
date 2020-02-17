import { connect } from 'react-redux';
import { User } from '../../config';

// Description: Will render the component is the current user in the project is member.
// Params
// params 1: props
// returns JSX.Element or NULL
function RenderIfSubProjectMember(props) {
    const {currentProject, subProjects, children} = props;
    const userId = User.getUserId();
    let renderItems = null;
    if (
        userId && currentProject &&
        currentProject.users &&
        currentProject.users.length > 0 &&
        currentProject.users.filter(user => user.userId === userId
            && (user.role !== 'Administrator' && user.role !== 'Owner' && user.role !== 'Viewer')).length > 0
    ) {
        renderItems = children
    }else{
        if(subProjects){
            subProjects.forEach((subProject)=>{
                if (
                    userId && subProject &&
                    subProject.users &&
                    subProject.users.length > 0 &&
                    subProject.users.filter(user => user.userId === userId
                        && (user.role !== 'Administrator' && user.role !== 'Owner' && user.role !== 'Viewer')).length > 0
                ) {
                    renderItems = children
                }
            })
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

export default connect(mapStateToProps)(RenderIfSubProjectMember);