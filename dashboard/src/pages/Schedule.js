import React, { Component } from 'react';
import Dashboard from '../components/Dashboard';
import DeleteBox from '../components/schedule/DeleteBox';
import MonitorBox from '../components/schedule/MonitorBox';
import RenameScheduleBox from '../components/schedule/RenameScheduleBox';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import OnCallAlertBox from '../components/schedule/OnCallAlertBox';
import PropTypes from 'prop-types';
import EscalationSummary from '../components/schedule/EscalationSummary';

class Schedule extends Component {
    constructor(props) {
        super(props);
        this.state = {editSchedule: false};

    }
    
    render() {
        const { editSchedule } = this.state;

        const { subProjectId } = this.props.match.params;

        return (
            <Dashboard>
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            <div>

                                                <RenameScheduleBox />

                                                <MonitorBox />

                                                {!editSchedule && <EscalationSummary onEditClicked={() => {
                                                    this.setState({ editSchedule: true })
                                                }} />}


                                                {editSchedule && <OnCallAlertBox afterSave={() => {
                                                    this.setState({ editSchedule: false })
                                                }} />}


                                                <RenderIfSubProjectAdmin subProjectId={subProjectId}>
                                                    <DeleteBox />
                                                </RenderIfSubProjectAdmin>

                                            </div>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        )
    }
}

Schedule.displayName = 'Settings'

Schedule.propTypes = {
    match: PropTypes.object.isRequired
}

export default Schedule