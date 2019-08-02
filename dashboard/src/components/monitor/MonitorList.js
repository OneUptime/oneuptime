import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import RenderIfUserInSubProject from '../basic/RenderIfUserInSubProject';
import MonitorDetail from './MonitorDetail';
import NewMonitor from './NewMonitor';
import {mapCriteria} from '../../config';

export function MonitorList(props) {
    let monitorDetails = null;

    const initialValues = {
        name_1000: '',
        url_1000: '',
    };

    props.monitors && props.monitors.forEach((monitor) => {
        initialValues[`name_${monitor._id}`] = monitor.name;
        initialValues[`url_${monitor._id}`] = monitor.data && monitor.data.url;
        initialValues[`subProject_${monitor._id}`] = monitor.projectId._id || monitor.projectId;
        initialValues[`monitorCategoryId_${monitor._id}`] = monitor.monitorCategoryId;
        if (monitor.type === 'url' || monitor.type === 'api') {
            if (monitor.criteria && monitor.criteria.up) {
                initialValues[`up_${monitor._id}`] = mapCriteria(monitor.criteria.up);
                initialValues[`up_${monitor._id}_createAlert`] = monitor.criteria && monitor.criteria.up && monitor.criteria.up.createAlert;
                initialValues[`up_${monitor._id}_autoAcknowledge`] = monitor.criteria && monitor.criteria.up && monitor.criteria.up.autoAcknowledge;
                initialValues[`up_${monitor._id}_autoResolve`] = monitor.criteria && monitor.criteria.up && monitor.criteria.up.autoResolve;
            }
            if (monitor.criteria && monitor.criteria.degraded) {
                initialValues[`degraded_${monitor._id}`] = mapCriteria(monitor.criteria.degraded);
                initialValues[`degraded_${monitor._id}_createAlert`] = monitor.criteria && monitor.criteria.degraded && monitor.criteria.degraded.createAlert;
                initialValues[`degraded_${monitor._id}_autoAcknowledge`] = monitor.criteria && monitor.criteria.degraded && monitor.criteria.degraded.autoAcknowledge;
                initialValues[`degraded_${monitor._id}_autoResolve`] = monitor.criteria && monitor.criteria.degraded && monitor.criteria.degraded.autoResolve;
            }
            if (monitor.criteria && monitor.criteria.down) {
                initialValues[`down_${monitor._id}`] = mapCriteria(monitor.criteria.down);
                initialValues[`down_${monitor._id}_createAlert`] = monitor.criteria && monitor.criteria.down && monitor.criteria.down.createAlert;
                initialValues[`down_${monitor._id}_autoAcknowledge`] = monitor.criteria && monitor.criteria.down && monitor.criteria.down.autoAcknowledge;
                initialValues[`down_${monitor._id}_autoResolve`] = monitor.criteria && monitor.criteria.down && monitor.criteria.down.autoResolve;
            }
        }
        if (monitor.type === 'api') {
            if(monitor.method && monitor.method.length) initialValues[`method_${monitor._id}`] = monitor.method;
            if(monitor.bodyType && monitor.bodyType.length) initialValues[`bodyType_${monitor._id}`] = monitor.bodyType;
            if(monitor.text && monitor.text.length) initialValues[`text_${monitor._id}`] = monitor.text;
            if(monitor.formData && monitor.formData.length) initialValues[`formData_${monitor._id}`] = monitor.formData;
            if(monitor.headers && monitor.headers.length) initialValues[`headers_${monitor._id}`] = monitor.headers;
        }
    })

    if (props.monitors && props.monitors.length > 0) {
        monitorDetails = props.monitors.map((monitor, i) => (
            <div id={`monitor${i}`} key={monitor._id}>
                <RenderIfUserInSubProject subProjectId={monitor.projectId._id || monitor.projectId}>

                        <ShouldRender if={!monitor.editMode}>
                            <MonitorDetail monitor={monitor} index={monitor._id} key={monitor._id} />
                        </ShouldRender>

                        <ShouldRender if={monitor.editMode}>
                            <NewMonitor
                                editMonitorProp={monitor}
                                index={monitor._id}
                                edit={true}
                                key={monitor._id}
                                formKey={monitor._id}
                                initialValues={initialValues}
                            />
                        </ShouldRender>
                </RenderIfUserInSubProject>
            </div>
        ));
    }

    return monitorDetails;
}

MonitorList.displayName = 'MonitorList'

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch)

const mapStateToProps = state => (
    {
        currentProject: state.project.currentProject
    }
)

export default connect(mapStateToProps, mapDispatchToProps)(MonitorList);