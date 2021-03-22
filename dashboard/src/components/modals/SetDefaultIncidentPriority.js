import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ClickOutside from 'react-click-outside';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import {updateDefaultIncidentSettings} from '../../actions/incidentBasicsSettings';

class SetDefaultIncidentPriority extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleSubmit() {
        const {data} = this.props;
        const incidentPriorityId = data.incidentPriorityId;              
        this.props
            .updateDefaultIncidentSettings(this.props.currentProject._id, incidentPriorityId );
        this.props.closeThisDialog();            
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            case 'Enter':
                return this.handleSubmit();
            default:
                return false;
        }
    };

    render() {        
        const { closeThisDialog, data } = this.props;        
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
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
                                            <span>Set Default Priority</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    You’re setting {data.incidentPriorityName} as default priority.
                                    What this means is, all new incidents when created will have a {data.incidentPriorityName} priority set to them.
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--white btn__modal"
                                            type="button"
                                            onClick={() => this.handleSubmit()}                                            
                                            id="SetDefaultIncidentPriority"                                            
                                        >
                                            <span>OK</span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
                                            <ShouldRender
                                                if={
                                                    this.props
                                                        .updatedIncident
                                                        .requesting
                                                }
                                            >
                                                <Spinner />
                                            </ShouldRender>
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

SetDefaultIncidentPriority.displayName = 'SetDefaultIncidentPriorityFormModal';

SetDefaultIncidentPriority.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,    
    currentProject: PropTypes.object.isRequired,
    updatedIncident: PropTypes.object,
    data: PropTypes.object.isRequired,    
};

const mapStateToProps = state => {    
    return {
        updatedIncident: state.incidentBasicSettings.updateIncidentBasicSettings,
        currentProject: state.project.currentProject,        
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            updateDefaultIncidentSettings
        },
        dispatch
    );

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(SetDefaultIncidentPriority);
