import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';

export class ProjectDetails extends Component {
    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <div>
                                        {this.props.project.deleted ? (
                                            <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    <span>Deleted</span>
                                                </span>
                                            </div>
                                        ) : this.props.project.isBlocked ? (
                                            <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    <span>Blocked</span>
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                    <span>Active</span>
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <span>Project Details</span>
                                </span>
                                <p>
                                    <span>
                                        Project Information and API Settings
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
                                                    Project Name
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    >
                                                        {this.props.project !==
                                                        null
                                                            ? this.props.project
                                                                  .name
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Project ID
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    >
                                                        {this.props.project !==
                                                        null
                                                            ? this.props.project
                                                                  ._id
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    API Key
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    >
                                                        {this.props.project !==
                                                        null
                                                            ? this.props.project
                                                                  .apiKey
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>

                            <div></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ProjectDetails.displayName = 'ProjectDetails';

const mapStateToProps = state => {
    const project = state.project.project.project || {};
    return {
        project,
        isRequesting: state.project.projects.requesting,
    };
};

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

ProjectDetails.propTypes = {
    project: PropTypes.object.isRequired,
};

ProjectDetails.contextTypes = {
    mixpanel: PropTypes.object.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(ProjectDetails);
