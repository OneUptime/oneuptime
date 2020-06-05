import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ApplicationLogDetail from './ApplicationLogDetail';

export function ApplicationLogList(props) {
    let applicationLogDetails = null;

    if (props.applicationLogs && props.applicationLogs.length > 0) {
        applicationLogDetails = props.applicationLogs.map(
            (applicationLog, i) => (
                <div id={`applicationLog${i}`} key={applicationLog._id}>
                    <ApplicationLogDetail
                        componentId={props.componentId}
                        applicationLog={applicationLog}
                        index={applicationLog._id}
                        key={applicationLog._id}
                    />
                </div>
            )
        );
    }

    return applicationLogDetails;
}

ApplicationLogList.displayName = 'ApplicationLogList';

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

const mapStateToProps = state => ({
    currentProject: state.project.currentProject,
});

export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLogList);
