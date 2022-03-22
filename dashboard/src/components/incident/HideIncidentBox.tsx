import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { hideIncident } from '../../actions/incident';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
class HideIncidentBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            checked: props.incident.hideIncident,
        };
    }
    handleChange = (e: $TSFixMe) => {

        const { incident, currentProject, hideIncident } = this.props;
        const checked = e.target.checked;
        this.setState({ checked });
        const data = {
            hideIncident: checked,
            incidentId: incident._id,
            projectId: currentProject._id,
        };
        hideIncident(data);
    };
    render() {

        const { hideIncidentError } = this.props;
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Hide Incident On Status Page</span>
                                </span>
                                <p>
                                    <span>
                                        Hide this incident on the status page.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div className="bs-Fieldset-fields">
                                    <label
                                        className="Toggler-wrap"
                                        style={{
                                            marginTop: '10px',
                                        }}
                                    >
                                        <input
                                            className="btn-toggler"
                                            type="checkbox"
                                            onChange={this.handleChange}
                                            name="hideIncident"
                                            id="hideIncident"

                                            checked={this.state.checked}
                                        />
                                        <span className="TogglerBtn-slider round"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <ShouldRender
                            if={hideIncidentError && hideIncidentError.error}
                        >
                            <div className="hide_incident">
                                <div className="Box-root Margin-right--8">
                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                </div>
                                <div className="Box-root">
                                    <span
                                        style={{
                                            color: 'red',
                                            marginTop: '-4px',
                                        }}
                                    >
                                        {hideIncidentError &&
                                            hideIncidentError.error &&
                                            hideIncidentError.error.error}
                                    </span>
                                </div>
                            </div>
                        </ShouldRender>
                    </div>
                </div>
            </div>
        );
    }
}


HideIncidentBox.displayName = 'HideIncidentBox';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        hideIncidentError: state.incident.hideIncident,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ hideIncident }, dispatch);


HideIncidentBox.propTypes = {
    hideIncident: PropTypes.func,
    hideIncidentError: PropTypes.string,
    incident: PropTypes.object,
    currentProject: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(HideIncidentBox);
