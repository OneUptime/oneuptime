import React, { Component } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import RenderIfUserInSubProject from '../basic/RenderIfUserInSubProject'

export class IncidentInvestigation extends Component {
    constructor(props) {
        super(props);
        this.investigationNotesRef = React.createRef();
    }
    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Investigation</span>
                                </span>
                                <p><span>Tell us more about what went wrong.</span></p>
                            </div>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Investigation Notes</label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <textarea id="txtInvestigationNote" name="product_description" rows="5" className="bs-TextArea" type="text" ref={this.investigationNotesRef} defaultValue={this.props.incident.investigationNote}>
                                                    </textarea>
                                                </div>
                                            </div>

                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div>
                            <RenderIfUserInSubProject subProjectId={this.props.incident.projectId}>
                                <button
                                    id="btnUpdateInvestigationNote"
                                    onClick={() => this.props.setdata(this.investigationNotesRef.current && this.investigationNotesRef.current.value ? this.investigationNotesRef.current.value : this.props.incident.investigationNote)}
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={this.props.request}
                                    type="button">
                                    <ShouldRender if={this.props.request}>
                                        <FormLoader />
                                    </ShouldRender>
                                    <ShouldRender if={!this.props.request}>
                                        <span>Save</span>
                                    </ShouldRender>
                                </button>
                            </RenderIfUserInSubProject>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

IncidentInvestigation.displayName = 'IncidentInvestigation'

const mapDispatchToProps = dispatch => bindActionCreators(
    {}
    , dispatch);

const mapStateToProps = state => (
    {
        request: state.incident && state.incident.investigationNotes ? state.incident.investigationNotes.requesting : false,
    }
)

IncidentInvestigation.propTypes = {
    setdata: PropTypes.func.isRequired,
    request: PropTypes.bool,
    incident: PropTypes.object.isRequired
}

export default connect(mapStateToProps, mapDispatchToProps)(IncidentInvestigation);
