import { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import * as CB from 'cloudboost';
import { User } from '../../config';
import uuid from 'uuid';
import { openModal, closeModal } from '../../actions/modal';
import { addnotifications } from '../../actions/socket';
import DataPathHoC from '../DataPathHoC';

class SocketApp extends Component {
    shouldComponentUpdate(nextProps) {
        if (this.props.project !== nextProps.project) {
            if (this.props.project) {
                CB.CloudNotification.off(`NewNotification-${this.props.project._id}`);
            }
            return true;
        }
        else {
            return false;
        }
    }
    render() {
        var thisObj = this;
        const loggedInUser = User.getUserId();
        if (this.props.project) {
            CB.CloudNotification.on(`NewNotification-${this.props.project._id}`, function (data) {
                const isUserInProject = thisObj.props.project ? thisObj.props.project.users.some(user => user.userId === loggedInUser) : false;
                if(isUserInProject){
                    if (data.createdBy && data.createdBy !== User.getUserId()) {
                        thisObj.props.addnotifications(data);
                    }
                }else{
                    const subProject = thisObj.props.subProjects.find(subProject => subProject._id === data.projectId);
                    const isUserInSubProject = subProject ? subProject.users.some(user => user.userId === loggedInUser) : false;
                    if (data.createdBy && data.createdBy !== User.getUserId()) {
                        if(isUserInSubProject) thisObj.props.addnotifications(data);
                    }
                }
            });
        }
        return null;
    }
}

SocketApp.displayName = 'SocketApp'

SocketApp.propTypes = {
    project: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined])
    ]),
    _id: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
}

let mapStateToProps = state => ({
})

let mapDispatchToProps = dispatch => (
    bindActionCreators({
        addnotifications,
        openModal,
        closeModal
    }, dispatch)
)

export default connect(mapStateToProps, mapDispatchToProps)(SocketApp);
