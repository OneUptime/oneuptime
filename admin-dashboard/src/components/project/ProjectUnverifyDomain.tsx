import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import {
    unVerifyProjectDomain,
    fetchProjectDomains,
    resetUnverifyProjectDomain,
} from '../../actions/project';

class ProjectUnverifyDomain extends Component {
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetUnverifyProjectDomain' does not exi... Remove this comment to see the full error message
        this.props.resetUnverifyProjectDomain();
        window.addEventListener('keydown', this.handleKeyBoard);
    }
    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'domainId' does not exist on type 'Readon... Remove this comment to see the full error message
            id: this.props.domainId,
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return this.handleUnverifyDomain();
            default:
                return false;
        }
    };

    handleUnverifyDomain = async () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'domainId' does not exist on type 'Readon... Remove this comment to see the full error message
            domainId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'unVerifyProjectDomain' does not exist on... Remove this comment to see the full error message
            unVerifyProjectDomain,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'unverifyError' does not exist on type 'R... Remove this comment to see the full error message
            unverifyError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectDomains' does not exist on t... Remove this comment to see the full error message
            fetchProjectDomains,
        } = this.props;
        await unVerifyProjectDomain(projectId, domainId).then(() => {
            if (!unverifyError) {
                fetchProjectDomains(projectId, 0, 10);
                this.handleCloseModal();
            }
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
        const { requesting, unverifyError } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div
                            className="bs-Modal bs-Modal--large"
                            style={{ maxWidth: 'none' }}
                        >
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Unverify Domain</span>
                                        </span>
                                    </div>
                                </div>
                                <div
                                    className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2"
                                    style={{ padding: '20px' }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to unverify this
                                        domain?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="Flex-flex Flex-direction--row bs-u-justify--between"
                                        style={{ width: '100%' }}
                                    >
                                        <div>
                                            <ShouldRender
                                                if={
                                                    !requesting && unverifyError
                                                }
                                            >
                                                <div
                                                    id="verifyDomainError"
                                                    className="bs-Tail-copy Flex-flex--3"
                                                >
                                                    <div
                                                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                        style={{
                                                            marginTop: '10px',
                                                        }}
                                                    >
                                                        <div className="Box-root Margin-right--8">
                                                            <div
                                                                className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                                style={{
                                                                    marginTop:
                                                                        '2px',
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="Box-root">
                                                            <span
                                                                style={{
                                                                    color:
                                                                        'red',
                                                                }}
                                                            >
                                                                {unverifyError}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignSelf: 'flex-start',
                                            }}
                                            className="Margin-top--8 bs-u-self--end Text-align--right"
                                        >
                                            <button
                                                id="cancelVerifyDomain"
                                                className={`bs-Button btn__modal ${requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                disabled={requesting}
                                                onClick={this.handleCloseModal}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="confirmVerifyDomain"
                                                className={`bs-Button bs-Button--blue btn__modal ${requesting &&
                                                    'bs-is-disabled'}`}
                                                onClick={
                                                    this.handleUnverifyDomain
                                                }
                                                disabled={requesting}
                                                autoFocus={true}
                                            >
                                                {!requesting && (
                                                    <>
                                                        <span>Unverify</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}

                                                {requesting && <FormLoader />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ProjectUnverifyDomain.displayName = 'ProjectUnverifyDomain';

const mapStateToProps = (state: $TSFixMe) => ({
    requesting: state.project.unverifyDomain.requesting,
    unverifyError: state.project.unverifyDomain.error,
    domainId: state.modal.modals[0].id,
    projectId: state.modal.modals[0].projectId
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        closeModal,
        unVerifyProjectDomain,
        fetchProjectDomains,
        resetUnverifyProjectDomain,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ProjectUnverifyDomain.propTypes = {
    closeModal: PropTypes.func,
    domainId: PropTypes.string,
    requesting: PropTypes.bool,
    unverifyError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    unVerifyProjectDomain: PropTypes.func,
    fetchProjectDomains: PropTypes.func,
    resetUnverifyProjectDomain: PropTypes.func,
    projectId: PropTypes.string,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ProjectUnverifyDomain);
