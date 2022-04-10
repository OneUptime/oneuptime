
import { v4 as uuidv4 } from 'uuid';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import { withRouter } from 'react-router-dom';
import { bindActionCreators, Dispatch } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import DataPathHoC from '../DataPathHoC';
import DuplicateStatusPageForm from './DuplicateStatusPageForm';
import { openModal, closeModal } from 'CommonUI/actions/modal';

export class DuplicateStatusPageBox extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            duplicateModalId: uuidv4(),
        };
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({

                    id: this.state.duplicateModalId,
                });
            default:
                return false;
        }
    };

    override render() {

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

                                            this.props.openModal({

                                                id: this.state.duplicateModalId,
                                                content: DataPathHoC(
                                                    DuplicateStatusPageForm,
                                                    {
                                                        statusPageSlug: this

                                                            .props.match.params
                                                            .statusPageSlug,
                                                        subProjectId: this.props

                                                            .subProjectId,
                                                        projectId: this.props

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


DuplicateStatusPageBox.displayName = 'DuplicateStatusPageBox';

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        closeModal,
    },
    dispatch
);

const mapStateToProps = (state: RootState) => {
    return {
        isRequesting:
            state.statusPage &&
            state.statusPage.newStatusPage &&
            state.statusPage.newStatusPage.requesting,
    };
};


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
