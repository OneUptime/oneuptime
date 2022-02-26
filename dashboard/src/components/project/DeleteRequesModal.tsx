import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { Spinner } from '../basic/Loader';

class DeleteRequestModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeNotice' does not exist on type 'Rea... Remove this comment to see the full error message
                return this.props.closeNotice();
            default:
                return false;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeNotice' does not exist on type 'Rea... Remove this comment to see the full error message
        const { closeNotice, requesting } = this.props;

        return (
            <div className="bs-Modal bs-Modal--medium">
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeNotice' does not exist on type 'Rea... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteRequestModal.displayName = 'DeleteRequestModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DeleteRequestModal.propTypes = {
    closeNotice: PropTypes.func,
    requesting: PropTypes.bool,
};

export default DeleteRequestModal;
