import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { withRouter } from 'react-router';
import UserInputs from './UserInputs';
import { FormLoader, Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { addUsers } from '../../actions/schedule';
import { teamLoading } from '../../actions/team';
import { reduxForm } from 'redux-form';
import RenderIfAdmin from '../basic/RenderIfAdmin';
import RenderIfMember from '../basic/RenderIfMember';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

function submitUserForm(values, dispatch, props) {
    const { projectId, scheduleId } = props.match.params;
    const users = [];
    /* eslint-disable no-unused-vars */
    for (const id in values) {
        if (Object.prototype.hasOwnProperty.call(values, id)) {
            values[id] && users.push(id);
        }
    }
    props.addUsers(projectId, scheduleId, { users });
    if(!IS_DEV){
        logEvent('Added Users To Schedule', {projectId, scheduleId, users });
    }
}

export class UserBox extends Component {

    componentDidMount() {

        if (this.props.projectId && this.props.users.length === 0) {
            this.props.teamLoading(this.props.projectId);
        }

    }

    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <form onSubmit={this.props.handleSubmit(submitUserForm)}>
                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Team Members
                                        </span>
                                    </span>
                                    <p>
                                        <RenderIfAdmin>
                                            <span>Check the boxes and save to add more engineers to the schedule.</span>
                                        </RenderIfAdmin>
                                        <RenderIfMember>
                                            <span>Here are the list of team members that are attached to this schedule</span>
                                        </RenderIfMember>
                                    </p>
                                </div>
                            </div>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset data-test="RetrySettings-failedAndExpiring" className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">

                                                <ShouldRender if={this.props.users.length === 0 && !this.props.isRequesting}>
                                                    <div style={{ textAlign: 'center', padding: '10px' }}>
                                                        There are no Users in this schedule.
                                                    </div>
                                                </ShouldRender>

                                                <ShouldRender if={this.props.users.length > 0}>
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            <span>Schedule Team</span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div className="Box-root" style={{ height: '5px' }}></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <UserInputs users={this.props.users} project={this.props.currentProject} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </ShouldRender>

                                                <ShouldRender if={this.props.isRequesting}>
                                                    <div style={{ textAlign: 'center', padding: '10px' }}>
                                                        <Spinner />
                                                    </div>
                                                </ShouldRender>

                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>

                            <ShouldRender if={this.props.users.length > 0}>
                                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <span className="db-SettingsForm-footerMessage"></span>
                                    <div>
                                        <RenderIfAdmin>
                                            <button className="bs-Button bs-Button--blue" disabled={this.props.addUserRequesting || this.props.users.length === 0} type="submit">

                                                <ShouldRender if={!this.props.addUserRequesting}>
                                                    <span>Save</span>
                                                </ShouldRender>

                                                <ShouldRender if={this.props.addUserRequesting}>
                                                    <FormLoader />
                                                </ShouldRender>

                                            </button>
                                        </RenderIfAdmin>
                                    </div>
                                </div>
                            </ShouldRender>

                        </form>
                    </div>
                </div>
            </div>
        )
    }
}

UserBox.displayName = 'UserBox'

UserBox.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    teamLoading:PropTypes.func.isRequired,
    projectId: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null,undefined])
    ]),
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null,undefined])
    ]),
    users: PropTypes.array.isRequired,
    isRequesting: PropTypes.oneOf([null,undefined,true,false]),
    addUserRequesting: PropTypes.oneOf([null,undefined,true,false])


}

const AddUsersForm = new reduxForm({
    form: 'AddUsersForm',
    enableReinitialize: true
})(UserBox);

const mapStateToProps = (state, props) => {
    const initialValues = {};
    const schedules = state.schedule.schedules.data;
    const users = state.teams.teamMembers.filter(user => user.name && user.name !== '') || [];
    const { projectId } = props.match.params;
    const isRequesting = state.teams.teamLoading.requesting;
    const addUserRequesting = state.schedule.addUser.requesting;
    const currentProject = state.project.currentProject;
    if (schedules.length > 0 && users.length > 0) {

        const schedule = schedules.find(
            ({ _id }) => _id === props.match.params.scheduleId
        );

        const scheduleUserIds = schedule.userIds.map(({ _id }) => _id);

        users.forEach(({ userId }) => {
            initialValues[userId] = scheduleUserIds.some(id => userId === id);
        });
    }

    return { initialValues, users, projectId, isRequesting, addUserRequesting, currentProject };
}

const mapDispatchToProps = dispatch => (
    bindActionCreators({ addUsers, teamLoading }, dispatch)
)

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(AddUsersForm));