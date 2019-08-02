import React from 'react';
import PropTypes from 'prop-types'
import ShouldRender from '../basic/ShouldRender';
import { Spinner } from '../basic/Loader';

export function DeleteRequestModal(props) { 

    const { closeNotice, requesting } = props;
    return (
        <div className="bs-Modal bs-Modal--medium">
            <div className="bs-Modal-header">
                <div className="bs-Modal-header-copy">
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                        <span>Delete Project</span>
                    </span>
                </div>
            </div>
            <div className="bs-Modal-content">
                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                    Support team has been notified of your request and will reach you shortly
				</span>
            </div>
            <div className="bs-Modal-footer">
                <div className="bs-Modal-footer-actions">
                    <button
                        className={`bs-Button bs-Button--red Box-background--red ${requesting && 'bs-is-disabled'}`}
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
        </div>
    );
}

DeleteRequestModal.displayName = 'DeleteRequestModal'

DeleteRequestModal.propTypes = {
    closeNotice: PropTypes.func,
    requesting: PropTypes.bool
}

export default DeleteRequestModal