import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { User } from '../../config';
import { hideProfileMenu } from '../../actions/profile';
import { logoutUser } from '../../actions/logout';

import { v4 as uuidv4 } from 'uuid';
import About from '../modals/About';
import { openModal, closeModal } from 'CommonUI/actions/modal';

export class ProfileMenu extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    constructor(props: $TSFixMe) {
        super(props);
        this.state = { aboutId: uuidv4() };
    }

    logout() {

        const { logoutUser } = this.props;
        logoutUser();
    }

    showAboutModal = () => {

        this.props.hideProfileMenu();

        this.props.openModal({

            id: this.state.aboutId,
            onClose: () => '',
            content: About,
        });
    };

    override componentDidMount() {
        window.addEventListener('keydown', this.handleShortcut);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleShortcut);
    }

    handleShortcut = (event: $TSFixMe) => {
        // Only execute keyboard shortcut when profile menu is open

        if (this.props.visible) {
            if (event.key === 'a' || event.key === 'A') {
                this.showAboutModal();
            }
        }
    };

    override render() {
        const name = User.getName();
        const email = User.getEmail();


        return this.props.visible ? (
            <div
                className="ContextualLayer-layer--topright ContextualLayer-layer--anytop ContextualLayer-layer--anyright ContextualLayer-context--bottom ContextualLayer-context--anybottom ContextualLayer-container ContextualLayer--pointerEvents"
                style={{
                    top: '49px',
                    width: '232px',

                    left: this.props.position

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


ProfileMenu.displayName = 'ProfileMenu';

const mapStateToProps: Function = (state: RootState) => {
    return {
        position: state.profileSettings.menuPosition,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        { openModal, closeModal, hideProfileMenu, logoutUser },
        dispatch
    );
};


ProfileMenu.propTypes = {
    visible: PropTypes.bool,
    logoutUser: PropTypes.func.isRequired,
    position: PropTypes.number,
    openModal: PropTypes.func.isRequired,
    hideProfileMenu: PropTypes.func,
};


ProfileMenu.contextTypes = {};

export default connect(mapStateToProps, mapDispatchToProps)(ProfileMenu);
