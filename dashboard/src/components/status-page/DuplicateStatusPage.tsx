// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import DataPathHoC from '../DataPathHoC';
import DuplicateStatusPageForm from './DuplicateStatusPageForm';
import { openModal, closeModal } from '../../actions/modal';

export class DuplicateStatusPageBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            duplicateModalId: uuidv4(),
        };
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'duplicateModalId' does not exist on type... Remove this comment to see the full error message
                    id: this.state.duplicateModalId,
                });
            default:
                return false;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
        const { isRequesting } = this.props;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-bottom--12"
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Duplicate Status Page</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to create a duplicate
                                        copy of this status page.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        id="duplicate"
                                        className="bs-Button bs-DeprecatedButton bs-Button--new"
                                        disabled={isRequesting}
                                        onClick={() => {
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                            this.props.openModal({
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'duplicateModalId' does not exist on type... Remove this comment to see the full error message
                                                id: this.state.duplicateModalId,
                                                content: DataPathHoC(
                                                    DuplicateStatusPageForm,
                                                    {
                                                        statusPageSlug: this
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                            .props.match.params
                                                            .statusPageSlug,
                                                        subProjectId: this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
                                                            .subProjectId,
                                                        projectId: this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                                                            .projectId,
                                                    }
                                                ),
                                            });
                                        }}
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Duplicate</span>
                                        </ShouldRender>
                                        <ShouldRender if={isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DuplicateStatusPageBox.displayName = 'DuplicateStatusPageBox';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        openModal,
        closeModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        isRequesting:
            state.statusPage &&
            state.statusPage.newStatusPage &&
            state.statusPage.newStatusPage.requesting,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DuplicateStatusPageBox.propTypes = {
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    statusPageSlug: PropTypes.object,
    subProjectId: PropTypes.object,
    match: PropTypes.object.isRequired,
    projectId: PropTypes.object,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(DuplicateStatusPageBox)
);
