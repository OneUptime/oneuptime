import React from 'react';
import Dashboard from '../components/Dashboard';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ProbeList from '../components/probe/ProbeList';
import { getProbes } from '../actions/probe';

class Probe extends React.Component {

  constructor(props) {
    super(props);
    this.props = props;
  }

  ready = () => {
    this.props.getProbes(this.props.currentProject._id, 0, 10); //0 -> skip, 10-> limit.
  }

  prevClicked = () => {
    this.props.getProbes(this.props.currentProject._id, (this.props.probes.skip ? (parseInt(this.props.probes.skip, 10) - 10) : 10), 10);
    /* if (!IS_DEV) {
       logEvent('Previous Incident Requested', {
         projectId: this.props.currentProject._id,
       });
     }*/
  }

  nextClicked = () => {
    this.props.getProbes(this.props.currentProject._id, (this.props.probes.skip ? (parseInt(this.props.probes.skip, 10) + 10) : 10), 10);
    /* if (!IS_DEV) {
       logEvent('Next Incident Requested', {
         projectId: this.props.currentProject._id,
       });
     }*/
  }

  render() {
    return (

      <Dashboard ready={this.ready}>
        <div className="Box-root Margin-vertical--12">
          <div>
            <div>
              <div className="db-RadarRulesLists-page">

                <div className="Box-root Margin-bottom--12">
                  <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                      <div>
                        <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                          <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                              <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>
                                  Probes
                              </span>
                              </span>
                              <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                  Probes will monitor resources in your project like API&apos;s, Websites and more from different locations around the world.
                                </span>
                              </span>
                            </div>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                              <div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <ProbeList probesList={this.props.probes} prevClicked={this.prevClicked} nextClicked={this.nextClicked} />
                      </div>
                    </div>
                  </div>
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
    probes: state.probe.probes,
  };
};

const mapDispatchToProps = dispatch => {
  return bindActionCreators({ getProbes }, dispatch);
}

Probe.propTypes = {
  getProbes: PropTypes.func,
  currentProject: PropTypes.object,
  _id: PropTypes.string,
  probes: PropTypes.object,
  skip: PropTypes.number,
}

Probe.displayName = 'Probe'

export default connect(mapStateToProps, mapDispatchToProps)(Probe);
