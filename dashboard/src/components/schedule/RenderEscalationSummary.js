import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { withRouter } from 'react-router';
import ShouldRender from '../basic/ShouldRender';
import { subProjectTeamLoading } from '../../actions/team';
import { getEscalation } from '../../actions/schedule';
import { teamLoading } from '../../actions/team';
import { ListLoader } from '../basic/Loader'
import EscalationSummarySingle from './EscalationSummarySingle'

export class RenderEscalationSummary extends Component {

    constructor(props) {
        super(props)
        this.state = {};
    }

    async componentDidMount() {

        this.setState({ isLoading: true });

        const { subProjectId, scheduleId } = this.props;
        try {
            await Promise.all([
                this.props.getEscalation(subProjectId, scheduleId),
                this.props.subProjectTeamLoading(subProjectId),
                this.props.teamLoading(subProjectId)
            ]);

            this.setState({ isLoading: false, error: null })
        } catch (e) {
            this.setState({ error: e, isLoading: false });
        }
    }

    render() {
        var {
            onEditClicked,
            schedule,
            escalationData,
            teamMembers
        } = this.props;

        var { isLoading, error } = this.state;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">

                        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">

                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span> Call Schedule and Escalation Policy Summary</span>
                                    </span>
                                    <p>
                                        Define your call schedule here. Alert your backup on-call team if your primary on-call team does not respond to alerts.
                        </p>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                    <div className="Box-root">

                                        <button
                                            type="button"
                                            className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--edit"
                                            onClick={() => { return onEditClicked ? onEditClicked() : null }}
                                        >
                                            Edit Call Schedule

                                    </button>

                                    </div>
                                </div>
                            </div>


                        </div>
                        {!isLoading &&
                            !error &&
                            escalationData &&
                            escalationData.length > 0 &&
                            escalationData.map((escalation, i) => {
                                return (<div className="bs-ContentSection-content Box-root">

                                    <div className="Card-root" style={{ backgroundColor: '#ffffff' }}>
                                        <div className="Box-root">
                                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root">
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        <span>Escalation Policy {i + 1} </span>
                                                    </span>
                                                    <p>
                                                        <span>

                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2" style={{ backgroundColor: '#f7f7f7' }}>
                                        <div>
                                            <EscalationSummarySingle isActiveTeam={true} teamMemberList={teamMembers} escalation={escalation} />

                                            <div className="bs-Fieldset-row">

                                            </div>
                                        
                                            <EscalationSummarySingle isNextActiveTeam={true} teamMemberList={teamMembers} escalation={escalation} />
                                            
                                        </div>
                                    </div>

                                </div>)
                            })}


                        {error && <div className="bs-ContentSection-content Box-root">
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2" style={{ backgroundColor: '#f7f7f7' }}>
                                <div>
                                    <div className="bs-Fieldset-row flex-center">
                                        Network Error. Please try again.
                                    </div>
                                </div>
                            </div>
                        </div>}

                        {isLoading && <div className="bs-ContentSection-content Box-root">
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2" style={{ backgroundColor: '#f7f7f7' }}>
                                <div>
                                    <div className="bs-Fieldset-row flex-center">
                                        <ListLoader />
                                    </div>
                                </div>
                            </div>
                        </div>}


                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>


                                </div>
                            </div>

                            <div>

                            </div>
                        </div>
                    </div>
                </div>
            </div >

        )
    }
}

RenderEscalationSummary.displayName = 'RenderEscalationSummary';

RenderEscalationSummary.propTypes = {
    getEscalation: PropTypes.func.isRequired,
    subProjectTeamLoading: PropTypes.func.isRequired,
}

const mapDispatchToProps = dispatch => (
    bindActionCreators({ getEscalation, subProjectTeamLoading, teamLoading }, dispatch)
)

const mapStateToProps = (state, props) => {
    const { scheduleId } = props.match.params;

    var schedule = state.schedule.subProjectSchedules.map((subProjectSchedule) => {
        return subProjectSchedule.schedules.find(schedule => schedule._id === scheduleId)
    });

    schedule = schedule.find(schedule => schedule && schedule._id === scheduleId)
    var escalationData = state.schedule.escalationData;
    const { projectId } = props.match.params;

    const { subProjectId } = props.match.params;
    return {
        schedule,
        escalationData,
        projectId,
        subProjectId,
        scheduleId,
        teamMembers: state.team.teamMembers
    }
}

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(RenderEscalationSummary));
