import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import Clipboard from '../Clipboard';

interface MonitorUrlProps {
    closeThisDialog: Function;
    currentProject: object;
    data?: object;
}

export class MonitorUrl extends React.Component<MonitorUrlProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
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

    override render() {

        const { closeThisDialog, data, currentProject } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-Modal bs-Modal--medium">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Monitor Inbound URL</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <p>Click to copy inbound URL?</p>
                                <br />
                                <Clipboard

                                    value={`https://oneuptime.com/api/monitors/${currentProject._id
                                        }/inbound/${data.data &&
                                        data.data.deviceId &&
                                        data.data.deviceId}`}
                                >
                                    copy to clipboard
                                </Clipboard>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button btn__modal"
                                        type="button"
                                        onClick={closeThisDialog}
                                        autoFocus={true}
                                    >
                                        <span>OK</span>
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
        );
    }
}


MonitorUrl.displayName = 'MonitorUrl';


MonitorUrl.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    data: PropTypes.object,
};

const mapStateToProps = (state: RootState) => ({
    currentProject: state.project.currentProject
});

export default connect(mapStateToProps, null)(MonitorUrl);
