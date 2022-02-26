import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { DASHBOARD_URL } from '../../config';

export class ProjectDetails extends Component {
    render() {
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root" style={{ width: '100%' }}>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <div style={{ width: '100%' }}>
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--White"
                                            type="submit"
                                            style={{ float: 'right' }}
                                            onClick={() =>
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'Location'... Remove this comment to see the full error message
                                                (window.location = `${DASHBOARD_URL}/project/${this.props.project.slug}`)
                                            }
                                        >
                                            <span>Goto Project</span>
                                        </button>
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
                                            <div
                                                className="bs-Fieldset-row"
                                                style={{
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        width: '10rem',
                                                        textAlign: 'left',
                                                        flex: 'none',
                                                    }}
                                                >
                                                    Project Name
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        maxWidth: '270px',
                                                    }}
                                                >
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    >
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        {this.props.project !==
                                                            null &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        this.props.project.name
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                            ? this.props.project
                                                                  .name
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div
                                                className="bs-Fieldset-row"
                                                style={{
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        width: '10rem',
                                                        textAlign: 'left',
                                                        flex: 'none',
                                                    }}
                                                >
                                                    Project ID
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        maxWidth: '270px',
                                                    }}
                                                >
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    >
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        {this.props.project !==
                                                            null &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        this.props.project._id
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                            ? this.props.project
                                                                  ._id
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div
                                                className="bs-Fieldset-row"
                                                style={{
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        width: '10rem',
                                                        textAlign: 'left',
                                                        flex: 'none',
                                                    }}
                                                >
                                                    API Key
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        maxWidth: '270px',
                                                    }}
                                                >
                                                    <span
                                                        className="value"
                                                        style={{
                                                            marginTop: '6px',
                                                        }}
                                                    >
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        {this.props.project !==
                                                            null &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        this.props.project
                                                            .apiKey
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                            ? this.props.project
                                                                  .apiKey
                                                            : 'LOADING...'}
                                                    </span>
                                                </div>
                                            </div>

                                            <div
                                                className="bs-Fieldset-row"
                                                style={{
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        width: '10rem',
                                                        textAlign: 'left',
                                                        flex: 'none',
                                                    }}
                                                >
                                                    Status
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        maxWidth: '270px',
                                                    }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            width: '10rem',
                                                            textAlign: 'left',
                                                            flex: 'none',
                                                        }}
                                                    >
                                                        {
                                                            <div
                                                                className={`Badge Badge--color--${
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                        .project
                                                                        .deleted
                                                                        ? 'red'
                                                                        : this
                                                                              .props
                                                                              // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                              .project
                                                                              .isBlocked
                                                                        ? 'yellow'
                                                                        : 'green'
                                                                } Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                            >
                                                                <span
                                                                    className={`Badge-text Text-color--${
                                                                        this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                            .project
                                                                            .deleted
                                                                            ? 'red'
                                                                            : this
                                                                                  .props
                                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                  .project
                                                                                  .isBlocked
                                                                            ? 'yellow'
                                                                            : 'green'
                                                                    } Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}
                                                                >
                                                                    <span>
                                                                        {this
                                                                            .props
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                            .project !==
                                                                        null
                                                                            ? this
                                                                                  .props
                                                                                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                  .project
                                                                                  .deleted
                                                                                ? 'Deleted'
                                                                                : this
                                                                                      .props
                                                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                      .project
                                                                                      .isBlocked
                                                                                ? 'Blocked'
                                                                                : 'Active'
                                                                            : 'LOADING...'}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        }
                                                    </label>
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ProjectDetails.displayName = 'ProjectDetails';

const mapStateToProps = (state: $TSFixMe) => {
    const project = state.project.project.project || {};
    return {
        project,
        isRequesting: state.project.projects.requesting,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({}, dispatch);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ProjectDetails.propTypes = {
    project: PropTypes.object.isRequired,
};

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
ProjectDetails.contextTypes = {};

export default connect(mapStateToProps, mapDispatchToProps)(ProjectDetails);
