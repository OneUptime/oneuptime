import React, { Component } from 'react';
import PropTypes from 'prop-types';

import ClickOutside from 'react-click-outside';

interface UnauthorisedProps {
    closeThisDialog: Function;
}

class Unauthorised extends Component<UnauthorisedProps> {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':

                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {

        const { closeThisDialog } = this.props;

        return (
            <div
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
                id="unauthorisedModal"
            >
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Unauthorised Action</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        You are not authorized to perform this
                                        action since you are not an admin of
                                        this project. If you like to perform
                                        this action, please contact project
                                        admin.
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            style={{
                                                minWidth: 50,
                                                textAlign: 'center',
                                            }}
                                            type="button"

                                            onClick={this.props.closeThisDialog}
                                            autoFocus={true}
                                        >
                                            <span>Ok</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
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


Unauthorised.displayName = 'Unauthorised';


Unauthorised.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
};

export default Unauthorised;
