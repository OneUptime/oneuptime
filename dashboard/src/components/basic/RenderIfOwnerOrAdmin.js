/**
 * @description renders the children if the user is an admin or owner of the project
 * @param children children component
 * @param currentProject the current project
 */

import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { User } from '../../config';

const RenderIfOwnerOrAdmin = ({ currentProject, children }) => {
    const userId = User.getUserId();
    const currentUser =
        currentProject &&
        currentProject.users.filter(
            user => String(user.userId) === String(userId)
        );

    const isOwnerOrAdmin =
        currentUser &&
        (currentUser[0].role === 'Owner' ||
        currentUser[0].role === 'Administrator'
            ? true
            : false);

    return isOwnerOrAdmin ? children : null;
};

RenderIfOwnerOrAdmin.propTypes = {
    currentProject: PropTypes.object,
};

const mapStateToProps = state => {
    return {
        currentProject: state.project.currentProject,
    };
};

export default connect(mapStateToProps)(RenderIfOwnerOrAdmin);
