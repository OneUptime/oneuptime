import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { User } from '../../config';
import { hideProfileMenu } from '../../actions/profile';
import { logoutUser } from '../../actions/logout';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import About from '../modals/About';
import { openModal, closeModal } from '../../actions/modal';

export class ProfileMenu extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { aboutId: uuidv4() };
    }

    logout() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'logoutUser' does not exist on type 'Read... Remove this comment to see the full error message
        const { logoutUser } = this.props;
        logoutUser();
    }

    showAboutModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideProfileMenu' does not exist on type ... Remove this comment to see the full error message
        this.props.hideProfileMenu();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'aboutId' does not exist on type 'Readonl... Remove this comment to see the full error message
            id: this.state.aboutId,
            onClose: () => '',
            content: About,
        });
    };

    componentDidMount() {
        window.addEventListener('keydown', this.handleShortcut);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleShortcut);
    }

    handleShortcut = (event: $TSFixMe) => {
        // Only execute keyboard shortcut when profile menu is open
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (this.props.visible) {
            if (event.key === 'a' || event.key === 'A') {
                this.showAboutModal();
            }
        }
    };

    render() {
        const name = User.getName();
        const email = User.getEmail();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'Readonl... Remove this comment to see the full error message
        return this.props.visible ? (
            <div
                className="ContextualLayer-layer--topright ContextualLayer-layer--anytop ContextualLayer-layer--anyright ContextualLayer-context--bottom ContextualLayer-context--anybottom ContextualLayer-container ContextualLayer--pointerEvents"
                style={{
                    top: '49px',
                    width: '232px',
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'Readon... Remove this comment to see the full error message
                    left: this.props.position
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'Readon... Remove this comment to see the full error message
                        ? `${this.props.position - 214.25}px`
                        : 'unset',
                    right: '40px',
                }}
            >
                <span>
                    <div
                        className="ContextualPopover"
                        style={{ transformOrigin: '100% 0px 0px' }}
                    >
                        <div className="ContextualPopover-arrowContainer">
                            <div className="ContextualPopover-arrow"></div>
                        </div>
                        <div className="ContextualPopover-contents">
                            <div
                                className="Box-root"
                                style={{ width: '232px' }}
                            >
                                <div className="Box-root Box-divider--surface-bottom-1 Padding-all--12">
                                    <div>
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            {name}
                                        </span>
                                    </div>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--12 Text-fontWeight--regular Text-lineHeight--16 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            <span>{email}</span>
                                        </span>
                                    </span>
                                </div>
                                <div className="Box-root Padding-vertical--8">
                                    <div
                                        className="Box-root"
                                        style={{
                                            padding: '10px',
                                            fontWeight: '500',
                                            marginTop: '-12px',
                                        }}
                                    >
                                        <button
                                            className="ButtonLink db-Menu-item db-Menu-item--link"
                                            id="about-button"
                                            type="button"
                                            onClick={() =>
                                                this.showAboutModal()
                                            }
                                            style={{ width: '100%' }}
                                        >
                                            <div
                                                className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed"
                                                style={{
                                                    display: 'flex',
                                                    width: '100%',
                                                    justifyContent:
                                                        'space-between',
                                                    flexDirection: 'row',
                                                }}
                                            >
                                                <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>About</span>
                                                    </span>
                                                </span>
                                                <span className="profile__keycode">
                                                    A
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div
                                        className="Box-root"
                                        style={{
                                            padding: '10px',
                                            fontWeight: '500',
                                            marginTop: '-12px',
                                        }}
                                    >
                                        <button
                                            className="ButtonLink db-Menu-item db-Menu-item--link"
                                            id="logout-button"
                                            type="button"
                                            onClick={() => this.logout()}
                                        >
                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed">
                                                <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>Sign out</span>
                                                    </span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </span>
            </div>
        ) : null;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ProfileMenu.displayName = 'ProfileMenu';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        position: state.profileSettings.menuPosition,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { openModal, closeModal, hideProfileMenu, logoutUser },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ProfileMenu.propTypes = {
    visible: PropTypes.bool,
    logoutUser: PropTypes.func.isRequired,
    position: PropTypes.number,
    openModal: PropTypes.func.isRequired,
    hideProfileMenu: PropTypes.func,
};

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
ProfileMenu.contextTypes = {};

export default connect(mapStateToProps, mapDispatchToProps)(ProfileMenu);
