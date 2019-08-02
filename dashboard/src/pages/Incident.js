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


class Incident extends React.Component {

  constructor(props) {
    super(props);
    this.props = props;
  }
  componentDidMount() {
    if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Incident Page Loaded');
    }
  }
  internalNote = (note) => {
    this.props.setinternalNote(this.props.match.params.projectId, this.props.match.params.incidentId, note);
    if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Internal Note Added',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  investigationNote = (note)=> {
    this.props.setInvestigationNote(this.props.match.params.projectId, this.props.match.params.incidentId, note);
    if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Incident Note Added',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  nextAlerts = () => {
    this.props.fetchIncidentAlert(this.props.match.params.projectId, this.props.match.params.incidentId, (parseInt(this.props.skip, 10) + parseInt(this.props.limit, 10)), parseInt(this.props.limit, 10));
    if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Next Incident Alert Requested',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  previousAlerts = () => {
    this.props.fetchIncidentAlert(this.props.match.params.projectId, this.props.match.params.incidentId, (parseInt(this.props.skip, 10) - parseInt(this.props.limit, 10)), parseInt(this.props.limit, 10));
    if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Previous Incident Alert Requested',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  nextSubscribers = () => {
    this.props.fetchSubscriberAlert(this.props.match.params.projectId, this.props.match.params.incidentId, (parseInt(this.props.subscribersAlerts.skip, 10) + parseInt(this.props.subscribersAlerts.limit, 10)), parseInt(this.props.subscribersAlerts.limit, 10));
    if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Next Subscriber Alert Requested',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  previousSubscribers = () => {
    this.props.fetchSubscriberAlert(this.props.match.params.projectId, this.props.match.params.incidentId, (parseInt(this.props.subscribersAlerts.skip, 10) - parseInt(this.props.subscribersAlerts.limit, 10)), parseInt(this.props.subscribersAlerts.limit, 10));
    if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Previous Subscriber Alert Requested',{
        projectId:this.props.match.params.projectId,
        incidentId:this.props.match.params.incidentId
      });
    }
  }

  ready = ()=> {
    this.props.getIncident(this.props.match.params.projectId, this.props.match.params.incidentId);
    this.props.fetchIncidentAlert(this.props.match.params.projectId, this.props.match.params.incidentId, 0, 10);
    this.props.fetchSubscriberAlert(this.props.match.params.projectId, this.props.match.params.incidentId, 0, 10);
    if(window.location.href.indexOf('localhost') <= -1){
      this.context.mixpanel.track('Incident Page Ready, Data Requested', {
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
          <IncidentDescription incident={this.props.incident} />
          <IncidentStatus incident={this.props.incident} />
          <IncidentAlert next={this.nextAlerts} previous={this.previousAlerts} />
          <SubscriberAlert next={this.nextSubscribers} previous={this.previousSubscribers} incident={this.props.incident}/>
          <IncidentInvestigation incident={this.props.incident} setdata={this.investigationNote} />
          <IncidentInternal incident={this.props.incident} setdata={this.internalNote} />
        </div>;
    } else {
      variable = <div id="app-loading" style={{ 'position': 'fixed', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'backgroundColor': '#e6ebf1', 'zIndex': '999', 'display': 'flex', 'justifyContent': 'center', 'alignItems': 'center' }}>
        <div style={{ 'transform': 'scale(2)' }}><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="bs-Spinner-svg"><ellipse cx="12" cy="12" rx="10" ry="10" className="bs-Spinner-ellipse"></ellipse></svg></div>
      </div>;
    }
    return (
      <Dashboard ready={this.ready}>
        <div className="db-World-contentPane Box-root Padding-bottom--48">
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
  };
};

const mapDispatchToProps = dispatch => {
  return bindActionCreators({ setInvestigationNote, setinternalNote, fetchIncidentAlert, fetchSubscriberAlert, incidentRequest, incidentError, incidentSuccess, resetIncident, getIncident }, dispatch);
}

Incident.contextTypes = {
  mixpanel: PropTypes.object.isRequired
};

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
}

Incident.displayName = 'Incident'


export default connect(mapStateToProps, mapDispatchToProps)(Incident);