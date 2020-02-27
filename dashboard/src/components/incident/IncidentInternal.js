import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import RenderIfUserInSubProject from '../basic/RenderIfUserInSubProject';

export class IncidentInternal extends Component {
    constructor(props) {
        super(props);
        this.internalNotesRef = React.createRef();
    }
    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Internal Notes</span>
                                </span>
                                <p>
                                    <span>
                                        Internal Notes for your team about this
                                        incident. This is only visible to your
                                        team.
                                    </span>
                                </p>
                            </div>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Internal Notes
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <textarea
                                                        id="txtInternalNote"
                                                        name="product_description"
                                                        rows="5"
                                                        className="bs-TextArea"
                                                        type="text"
                                                        ref={
                                                            this
                                                                .internalNotesRef
                                                        }
                                                        defaultValue={
                                                            this.props.incident
                                                                .internalNote
                                                        }
                                                    ></textarea>
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
                                <RenderIfUserInSubProject
                                    subProjectId={this.props.incident.projectId}
                                >
                                    <button
                                        onClick={() =>
                                            this.props.setdata(
                                                this.internalNotesRef.current &&
                                                    this.internalNotesRef
                                                        .current.value
                                                    ? this.internalNotesRef
                                                          .current.value
                                                    : this.props.incident
                                                          .internalNote
                                            )
                                        }
                                        id="btnUpdateInternalNote"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={this.props.request}
                                        type="button"
                                    >
                                        <ShouldRender
                                            if={this.props.requesting}
                                        >
                                            <FormLoader />
                                        </ShouldRender>
                                        <ShouldRender
                                            if={!this.props.requesting}
                                        >
                                            <span>Save</span>
                                        </ShouldRender>
                                    </button>
                                </RenderIfUserInSubProject>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

IncidentInternal.displayName = 'IncidentInternal';

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

const mapStateToProps = state => ({
    requesting:
        state.incident && state.incident.internalNotes
            ? state.incident.internalNotes.requesting
            : false,
});

IncidentInternal.propTypes = {
    setdata: PropTypes.func.isRequired,
    request: PropTypes.bool,
    incident: PropTypes.object.isRequired,
    requesting: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentInternal);
