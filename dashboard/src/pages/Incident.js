import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { incidentRequest, incidentError, incidentSuccess, resetIncident, getIncident, setInvestigationNote, setinternalNote } from '../actions/incident';
import { fetchIncidentAlert, fetchSubscriberAlert } from '../actions/alert';
import Dashboard from '../components/Dashboard';
import IncidentDescription from '../components/incident/IncidentDescription';
import IncidentStatus from '../components/incident/IncidentStatus';
import IncidentAlert from '../components/incident/IncidentAlert';
import SubscriberAlert from '../components/subscriber/subscriberAlert';
import IncidentInvestigation from '../components/incident/IncidentInvestigation';
import IncidentInternal from '../components/incident/IncidentInternal';
import PropTypes from 'prop-types';
import IncidentDeleteBox from '../components/incident/IncidentDeleteBox'
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import { logEvent } from '../analytics';
import { IS_DEV } from '../config';

class Incident extends React.Component {

  constructor(props) {
    super(props);
    this.props = props;
  }
  componentDidMount() {
    if(!IS_DEV){
      logEvent('Incident Page Loaded');
    }
  }
  internalNote = (note) => {
    this.props.setinternalNote(this.props.match.params.projectId, this.props.match.params.incidentId, note);
    if(!IS_DEV){
      logEvent('Internal Note Added',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  investigationNote = (note)=> {
    this.props.setInvestigationNote(this.props.match.params.projectId, this.props.match.params.incidentId, note);
    if(!IS_DEV){
      logEvent('Incident Note Added',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  nextAlerts = () => {
    this.props.fetchIncidentAlert(this.props.match.params.projectId, this.props.match.params.incidentId, (parseInt(this.props.skip, 10) + parseInt(this.props.limit, 10)), parseInt(this.props.limit, 10));
    if(!IS_DEV){
      logEvent('Next Incident Alert Requested',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  previousAlerts = () => {
    this.props.fetchIncidentAlert(this.props.match.params.projectId, this.props.match.params.incidentId, (parseInt(this.props.skip, 10) - parseInt(this.props.limit, 10)), parseInt(this.props.limit, 10));
    if(!IS_DEV){
      logEvent('Previous Incident Alert Requested',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  nextSubscribers = () => {
    this.props.fetchSubscriberAlert(this.props.match.params.projectId, this.props.match.params.incidentId, (parseInt(this.props.subscribersAlerts.skip, 10) + parseInt(this.props.subscribersAlerts.limit, 10)), parseInt(this.props.subscribersAlerts.limit, 10));
    if(!IS_DEV){
      logEvent('Next Subscriber Alert Requested',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  previousSubscribers = () => {
    this.props.fetchSubscriberAlert(this.props.match.params.projectId, this.props.match.params.incidentId, (parseInt(this.props.subscribersAlerts.skip, 10) - parseInt(this.props.subscribersAlerts.limit, 10)), parseInt(this.props.subscribersAlerts.limit, 10));
    if(!IS_DEV){
      logEvent('Previous Subscriber Alert Requested',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  ready = ()=> {
    this.props.getIncident(this.props.match.params.projectId, this.props.match.params.incidentId);
    this.props.fetchIncidentAlert(this.props.match.params.projectId, this.props.match.params.incidentId, 0, 10);
    this.props.fetchSubscriberAlert(this.props.match.params.projectId, this.props.match.params.incidentId, 0, 10);
    if(!IS_DEV){
      logEvent('Incident Page Ready, Data Requested', {
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  render() {
    let variable = null;
    if (this.props.incident) {
      variable =
        <div>
          <IncidentDescription incident={this.props.incident} projectId={this.props.currentProject._id} />
          <IncidentStatus incident={this.props.incident} />
          <IncidentAlert next={this.nextAlerts} previous={this.previousAlerts} />
          <SubscriberAlert next={this.nextSubscribers} previous={this.previousSubscribers} incident={this.props.incident}/>
          <IncidentInvestigation incident={this.props.incident} setdata={this.investigationNote} />
          <IncidentInternal incident={this.props.incident} setdata={this.internalNote} />
          <RenderIfSubProjectAdmin>
            <IncidentDeleteBox incident={this.props.incident} deleting={this.props.deleting} currentProject={this.props.currentProject} />
          </RenderIfSubProjectAdmin>
        </div>;
    } else {
      variable = <div id="app-loading" style={{ 'position': 'fixed', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'backgroundColor': '#e6ebf1', 'zIndex': '999', 'display': 'flex', 'justifyContent': 'center', 'alignItems': 'center' }}>
        <div style={{ 'transform': 'scale(2)' }}><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="bs-Spinner-svg"><ellipse cx="12" cy="12" rx="10" ry="10" className="bs-Spinner-ellipse"></ellipse></svg></div>
      </div>;
    }
    return (
      <Dashboard ready={this.ready}>
          <div>
            <div>
              <div className="db-BackboneViewContainer">
                <div className="react-settings-view react-view">
                  <span>
                    <div>
                      <div>
                        {variable}
                      </div>
                    </div>
                  </span>
                </div>
              </div>
            </div>
          </div>
      </Dashboard>
    );
  }
}

const mapStateToProps = state => {
  return {
    currentProject: state.project.currentProject,
    incident: state.incident.incident.incident,
    count: state.alert.incidentalerts.count,
    skip: state.alert.incidentalerts.skip,
    limit: state.alert.incidentalerts.limit,
    subscribersAlerts: state.alert.subscribersAlert,
    deleting: state.incident.incident.deleteIncident ? state.incident.incident.deleteIncident.requesting : false
  };
};

const mapDispatchToProps = dispatch => {
  return bindActionCreators({ setInvestigationNote, setinternalNote, fetchIncidentAlert, fetchSubscriberAlert, incidentRequest, incidentError, incidentSuccess, resetIncident, getIncident }, dispatch);
}

Incident.propTypes = {
  getIncident: PropTypes.func,
  fetchIncidentAlert: PropTypes.func,
  fetchSubscriberAlert: PropTypes.func,
  setinternalNote: PropTypes.func,
  match: PropTypes.object,
  incident: PropTypes.object,
  setInvestigationNote: PropTypes.func,
  limit: PropTypes.PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number
  ]),
  skip: PropTypes.PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number
  ]),
  subscribersAlerts: PropTypes.object.isRequired,
  deleting: PropTypes.bool.isRequired,
  currentProject: PropTypes.object.isRequired,
}

Incident.displayName = 'Incident'


export default connect(mapStateToProps, mapDispatchToProps)(Incident);