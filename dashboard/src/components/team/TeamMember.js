import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import Dropdown, {
    MenuItem
} from '@trendmicro/react-dropdown';
import { reduxForm } from 'redux-form';
import { teamDelete, teamUpdateRole } from '../../actions/team';
import { changeProjectRoles } from '../../actions/project';
import { FormLoader, TeamListLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { User } from '../../config';

import '@trendmicro/react-dropdown/dist/react-dropdown.css';

export class TeamMember extends Component {
    constructor(props) {
        super(props);
        this.removeTeamMember = this.removeTeamMember.bind(this);
        this.updateTeamMemberRole = this.updateTeamMemberRole.bind(this);
    }

    removeTeamMember(values) {
        this.props.teamDelete(this.props.subProjectId, values.userId);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Team Member Removed', { projectId: this.props.subProjectId, userId: values.userId });
        }
    }

    updateTeamMemberRole(values, to) {
        var data = {};
        data.teamMemberId = values.userId;
        if (values.role === to) {
            return;

        } else {
            data.role = to;
        }
        const { changeProjectRoles } = this.props;
        this.props.teamUpdateRole(this.props.subProjectId, data)
            .then((team) => changeProjectRoles(team.data));
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Team Member Role Changed', { projectId: this.props.subProjectId, role: data.role });
        }
    }

    render() {
        const { handleSubmit, userId, deleting, team: { subProjectTeamMembers }, updating } = this.props;
        let teamMembers = subProjectTeamMembers.map(teamMembers => {
            return teamMembers.teamMembers;
        });
        teamMembers = teamMembers.flat();
        const loggedInUser = User.getUserId();
        const loggedInUserIsOwner = teamMembers.some(user => user.userId === loggedInUser && user.role === 'Owner');
        const thisUserIsAViewer = teamMembers.some(user => user.userId === userId && user.role === 'Viewer');
        const thisUserIsAMember = teamMembers.some(user => user.userId === userId && user.role === 'Member');
        const thisUserIsAdmin = teamMembers.some(user => user.userId === userId && user.role === 'Administrator');
        const thereAreOtherAdmins = teamMembers.some(user => user.userId !== loggedInUser && (user.role === 'Administrator' || user.role === 'Owner') && user.name);

        return (
            <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withName">
                <div className="bs-ObjectList-cell bs-u-v-middle">
                    <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">{this.props.name}</div>
                    <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted">
                        {this.props.email}
                    </div>
                </div>
                <div className="bs-ObjectList-cell bs-u-v-middle">
                    <div className="bs-ObjectList-cell-row">
                        {this.props.role}
                    </div>
                </div>
                <div className="bs-ObjectList-cell bs-u-v-middle">

                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                            <span>
                                {this.props.name ? 'Online ' + this.props.lastActive + ' ago' : 'Invitation Sent'}
                            </span>
                        </span>
                    </div>

                </div>
                <div className="bs-ObjectList-cell bs-u-v-middle"></div>
                <div className="bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween"><div>
                    <ShouldRender if={(loggedInUserIsOwner && (thisUserIsAMember || thisUserIsAdmin || thisUserIsAViewer)) || (loggedInUserIsOwner && thereAreOtherAdmins)}>
                        <div className="Flex-flex Flex-alignContent--spaceBetween">
                            <Dropdown disabled={updating}>
                                {!updating && <Dropdown.Toggle id={`changeRole_${this.props.email}`} title="Change Role" className="bs-Button bs-DeprecatedButton" />}
                                {updating &&
                                    <button disabled={updating} className="bs-Button bs-DeprecatedButton Margin-left--8" type="button">
                                        <TeamListLoader />
                                    </button>}

                                <Dropdown.Menu>
                                    <MenuItem
                                        title="Owner"
                                        onClick={handleSubmit(values =>
                                            this.updateTeamMemberRole({
                                                ...values,
                                                role: this.props.role,
                                                userId: userId
                                            }, 'Owner'))
                                        }
                                    >
                                        Owner
                                </MenuItem>
                                    <MenuItem
                                        title="Administrator"
                                        onClick={handleSubmit(values =>
                                            this.updateTeamMemberRole({
                                                ...values,
                                                role: this.props.role,
                                                userId: userId
                                            }, 'Administrator'))
                                        }
                                    >
                                        Administrator
                                </MenuItem>
                                    <MenuItem
                                        title="Member"
                                        onClick={handleSubmit(values =>
                                            this.updateTeamMemberRole({
                                                ...values,
                                                role: this.props.role,
                                                userId: userId
                                            }, 'Member'))
                                        }
                                    >
                                        Member
                                </MenuItem>
                                <MenuItem
                                        title="Viewer"
                                        onClick={handleSubmit(values =>
                                            this.updateTeamMemberRole({
                                                ...values,
                                                role: this.props.role,
                                                userId: userId
                                            }, 'Viewer'))
                                        }
                                    >
                                        Viewer
                                </MenuItem>
                                </Dropdown.Menu>
                            </Dropdown>
                            <button
                                title="delete"
                                disabled={deleting}
                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                type="button"
                                onClick={handleSubmit(values =>
                                    this.removeTeamMember({
                                        ...values,
                                        userId: userId
                                    }))
                                }
                                style={deleting ? { backgroundColor: '#ce636f' } : {}}
                            >
                                {!deleting && <span>Remove</span>}
                                {deleting && <FormLoader />}
                            </button>
                        </div>
                    </ShouldRender>
                </div></div>
            </div>
        )
    }
}

TeamMember.displayName = 'TeamMember'

TeamMember.propTypes = {
    team: PropTypes.object.isRequired,
    deleting: PropTypes.oneOf([null, false, true]),
    userId: PropTypes.string.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    teamDelete: PropTypes.func.isRequired,
    changeProjectRoles: PropTypes.func.isRequired,
    teamUpdateRole: PropTypes.func.isRequired,
    email: PropTypes.string.isRequired,
    name: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined])
    ]),
    role: PropTypes.string.isRequired,
    lastActive: PropTypes.string.isRequired,
    updating:PropTypes.oneOf([null, false, true]),
    subProjectId:PropTypes.string.isRequired,
}

let TeamMemberForm = reduxForm({
    form: 'TeamMember'
})(TeamMember)

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ teamDelete, teamUpdateRole, changeProjectRoles }, dispatch)
}

function mapStateToProps(state, props) {
    return {
        team: state.team,
        deleting: state.team.teamdelete.deleting.some(id => id === props.userId),
        updating: state.team.teamUpdateRole.updating.some(id => id === props.userId),
        currentProject: state.project.currentProject
    };
}

TeamMember.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(TeamMemberForm);