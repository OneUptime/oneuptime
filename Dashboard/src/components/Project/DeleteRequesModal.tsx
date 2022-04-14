import React, { Component } from 'react';
import PropTypes from 'prop-types';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Spinner } from '../basic/Loader';

interface DeleteRequestModalProps {
    closeNotice?: Function;
    requesting?: boolean;
}

class DeleteRequestModal extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeNotice();
            default:
                return false;
        }
    };

    override render() {

        const { closeNotice, requesting }: $TSFixMe = this.props;

        return (
            <div className="bs-Modal bs-Modal--medium">

                <ClickOutside onClickOutside={this.props.closeNotice}>
                    <div className="bs-Modal-header">
                        <div className="bs-Modal-header-copy">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Delete Project</span>
                            </span>
                        </div>
                    </div>
                    <div className="bs-Modal-content">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                            Support team has been notified of your request and
                            will reach you shortly
                        </span>
                    </div>
                    <div className="bs-Modal-footer">
                        <div className="bs-Modal-footer-actions">
                            <button
                                className={`bs-Button bs-Button--red Box-background--red ${requesting &&
                                    'bs-is-disabled'}`}
                                onClick={closeNotice}
                                disabled={requesting}
                            >
                                <ShouldRender if={requesting}>
                                    <Spinner />
                                </ShouldRender>
                                <span>OK</span>
                            </button>
                        </div>
                    </div>
                </ClickOutside>
            </div>
        );
    }
}


DeleteRequestModal.displayName = 'DeleteRequestModal';


DeleteRequestModal.propTypes = {
    closeNotice: PropTypes.func,
    requesting: PropTypes.bool,
};

export default DeleteRequestModal;
