import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Clipboard from '../Clipboard';

export class MonitorUrl extends React.Component {
    

	handleKeyBoard = (e)=>{
		switch(e.key){
			case 'Escape':
			return this.props.closeThisDialog()
			default:
			return false;
		}
    }

    render() {
        const { closeThisDialog, data, currentProject } = this.props;

        return (
            <div onKeyDown={this.handleKeyBoard} className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-Modal bs-Modal--medium">
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
                            <Clipboard value={`https://api.fyipe.com/monitors/${currentProject._id}/inbound/${data.data && data.data.deviceId && data.data.deviceId}`}>
                                copy to clipboard
                            </Clipboard>
                        </div>
                        <div className="bs-Modal-footer">
                            <div className="bs-Modal-footer-actions">
                                <button
                                    className="bs-Button"
                                    type="button"
                                    onClick={closeThisDialog}
                                >
                                    <span>OK</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

MonitorUrl.displayName = 'MonitorUrl'

MonitorUrl.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    data: PropTypes.object,
}

const mapStateToProps = state => (
    {
        currentProject: state.project.currentProject
    }
);

export default connect(mapStateToProps, null)(MonitorUrl);