import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import UserInputs from './UserInputs';
import { FormLoader, Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { addUsers } from '../../actions/schedule';
import { teamLoading } from '../../actions/team';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm } from 'redux-form';
import RenderIfAdmin from '../basic/RenderIfAdmin';
import RenderIfMember from '../basic/RenderIfMember';

function submitUserForm(values: $TSFixMe, dispatch: $TSFixMe, props: $TSFixMe) {
    const scheduleId = props && props.scheduleId;
    const users = [];

    for (const id in values) {
        if (Object.prototype.hasOwnProperty.call(values, id)) {
            values[id] && users.push(id);
        }
    }
    props.addUsers(props.projectId, scheduleId, { users });
}

export class UserBox extends Component {
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        if (this.props.projectId && this.props.users.length === 0) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamLoading' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.teamLoading(this.props.projectId);
        }
    }

    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <form
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
                            onSubmit={this.props.handleSubmit(submitUserForm)}
                        >
                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Team Members</span>
                                    </span>
                                    <p>
                                        <RenderIfAdmin>
                                            <span>
                                                Check the boxes and save to add
                                                more engineers to the schedule.
                                            </span>
                                        </RenderIfAdmin>
                                        <RenderIfMember>
                                            <span>
                                                Here are the list of team
                                                members that are attached to
                                                this schedule
                                            </span>
                                        </RenderIfMember>
                                    </p>
                                </div>
                            </div>
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset
                                            data-test="RetrySettings-failedAndExpiring"
                                            className="bs-Fieldset"
                                        >
                                            <div className="bs-Fieldset-rows">
                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                        this.props.users
                                                            .length === 0 &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                                        !this.props.isRequesting
                                                    }
                                                >
                                                    <div
                                                        style={{
                                                            textAlign: 'center',
                                                            padding: '10px',
                                                        }}
                                                    >
                                                        There are no Users in
                                                        this schedule.
                                                    </div>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                        this.props.users
                                                            .length > 0
                                                    }
                                                >
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            <span>
                                                                Schedule Team
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    height:
                                                                        '5px',
                                                                }}
                                                            ></div>
                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                <UserInputs
                                                                    users={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                            .users
                                                                    }
                                                                    project={
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                                            .currentProject
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </ShouldRender>

                                                <ShouldRender
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                                                    if={this.props.isRequesting}
                                                >
                                                    <div
                                                        style={{
                                                            textAlign: 'center',
                                                            padding: '10px',
                                                        }}
                                                    >
                                                        <Spinner />
                                                    </div>
                                                </ShouldRender>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                            </div>

                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
                            <ShouldRender if={this.props.users.length > 0}>
                                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <span className="db-SettingsForm-footerMessage"></span>
                                    <div>
                                        <RenderIfAdmin>
                                            <button
                                                className="bs-Button bs-Button--blue"
                                                disabled={
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addUserRequesting' does not exist on typ... Remove this comment to see the full error message
                                                        .addUserRequesting ||
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                    this.props.users.length ===
                                                        0
                                                }
                                                type="submit"
                                            >
                                                <ShouldRender
                                                    if={
                                                        !this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addUserRequesting' does not exist on typ... Remove this comment to see the full error message
                                                            .addUserRequesting
                                                    }
                                                >
                                                    <span>Save</span>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addUserRequesting' does not exist on typ... Remove this comment to see the full error message
                                                            .addUserRequesting
                                                    }
                                                >
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
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
UserBox.displayName = 'UserBox';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
UserBox.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    teamLoading: PropTypes.func.isRequired,
    projectId: PropTypes.string,
    currentProject: PropTypes.object,
    users: PropTypes.array.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    addUserRequesting: PropTypes.oneOf([null, undefined, true, false]),
};

const AddUsersForm = new reduxForm({
    form: 'AddUsersForm',
    enableReinitialize: true,
})(UserBox);

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const initialValues = {};
    const schedules = state.schedule.schedules.data;
    const users =
        state.teams.teamMembers.filter((user: $TSFixMe) => user.name && user.name !== '') ||
        [];
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const isRequesting = state.teams.teamLoading.requesting;
    const addUserRequesting = state.schedule.addUser.requesting;
    const currentProject = state.project.currentProject;
    let schedule;
    if (schedules.length > 0 && users.length > 0) {
        schedule = schedules.find(
            ({
                slug
            }: $TSFixMe) => slug === props.match.params.scheduleSlug
        );

        const scheduleUserIds = schedule.userIds.map(({
            _id
        }: $TSFixMe) => _id);

        users.forEach(({
            userId
        }: $TSFixMe) => {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            initialValues[userId] = scheduleUserIds.some((id: $TSFixMe) => userId === id);
        });
    }

    return {
        initialValues,
        users,
        projectId,
        isRequesting,
        addUserRequesting,
        currentProject,
        scheduleId: schedule && schedule._id,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ addUsers, teamLoading }, dispatch);

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(AddUsersForm)
);
