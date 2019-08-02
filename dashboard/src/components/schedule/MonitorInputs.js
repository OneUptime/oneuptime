import React from 'react';
import { Field } from 'redux-form';
import IsAdminSubProject from '../basic/IsAdminSubProject';
import IsOwnerSubProject from '../basic/IsOwnerSubProject';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

function MonitorInputs({ monitors, subProject, currentProject }){
    const monitorItems = currentProject._id === subProject._id ?
    monitors.map((monitor, index)=>{
        return <div className="Box-root Margin-bottom--12" key={index}>
            <div data-test="RetrySettings-failedPaymentsRow" className="Box-root">
                    <label className="Checkbox" htmlFor={`monitor_${index}`}>
                        <Field
                            component="input"
                            type="checkbox"
                            name={monitor._id}
                            data-test="RetrySettings-failedPaymentsCheckbox"
                            className="Checkbox-source"
                            id={`monitor_${index}`}
                            disabled={!IsAdminSubProject(subProject) && !IsOwnerSubProject(subProject)}
                        />
                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                            <div className="Checkbox-target Box-root">
                                <div className="Checkbox-color Box-root"></div>
                            </div>
                        </div>
                        <div className="Checkbox-label Box-root Margin-left--8">
                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span title={monitor.name}>{monitor.name}</span>
                            </span>
                        </div>
                    </label>
                    <div className="Box-root Padding-left--24">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                            <div className="Box-root">
                                <div className="Box-root">

                                </div>
                            </div>
                        </div>
                    </div>
                </div>
    </div> 
    }) : monitors.map((monitor, index) => {
         return monitor.projectId === subProject._id || monitor.projectId._id === subProject._id ? <div className="Box-root Margin-bottom--12" key={index}>
            <div data-test="RetrySettings-failedPaymentsRow" className="Box-root">
                <label className="Checkbox" htmlFor={`monitor_${index}`}>
                    <Field
                        component="input"
                        type="checkbox"
                        name={monitor._id}
                        data-test="RetrySettings-failedPaymentsCheckbox"
                        className="Checkbox-source"
                        id={`monitor_${index}`}
                        disabled={!IsAdminSubProject(subProject) && !IsOwnerSubProject(subProject)}
                    />
                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                        <div className="Checkbox-target Box-root">
                            <div className="Checkbox-color Box-root"></div>
                        </div>
                    </div>
                    <div className="Checkbox-label Box-root Margin-left--8">
                        <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span title={monitor.name}>{monitor.name}</span>
                        </span>
                    </div>
                </label>
                <div className="Box-root Padding-left--24">
                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                        <div className="Box-root">
                            <div className="Box-root">

                            </div>
                        </div>
                    </div>
                </div>
            </div>
    </div> : false
    });
    const allMonitorList = monitorItems.filter(monitor => monitor);
    return allMonitorList.length > 0 ? allMonitorList : 'There is no monitor present in this subproject'
}

MonitorInputs.displayName = 'MonitorInputs';

const mapStateToProps = (state) =>{
    return {
        currentProject: state.project.currentProject
    }
};

const mapDispatchToProps = (dispatch) => bindActionCreators({}, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(MonitorInputs);

