import React, { Component } from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import { FormLoader } from '../basic/Loader'
import { closeModal } from '../../actions/modal'
import { resetSubProjectToken, resetSubProjectKeyReset } from '../../actions/subProject'
import ShouldRender from '../basic/ShouldRender'

class SubProjectApiKey extends Component {
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog()
            default:
                return false
        }
    }

    resetSubProjectToken = () => {
        const { resetSubProjectToken, data } = this.props
        resetSubProjectToken(data.subProjectId);
    }

    render() {
        const { subProjectResetToken, closeModal, data, resetSubProjectKeyReset, subproject } = this.props
        return (
            <div onKeyDown={this.handleKeyBoard} className='ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center'>
                <div className='ModalLayer-contents' tabIndex={-1} style={{ marginTop: 40 }}>
                    <div className='bs-BIM'>
                        <div className='bs-Modal bs-Modal--medium'>
                            <div className='bs-Modal-header'>
                                <div className='bs-Modal-header-copy'>
                                    <span className='Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap'>
                                        <span>API Key For Sub Project {data.subProjectTitle}</span>
                                    </span>
                                </div>
                                <div className='bs-Modal-messages'>
                                    <ShouldRender if={subProjectResetToken.error}>
                                        <p className='bs-Modal-message'>{subProjectResetToken.error}</p>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div className='bs-Modal-content' style={{textAlign:'center'}}>
                                <span className='Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap'>
                                    {subproject.apiKey}
                                </span>
                            </div>
                            <div className='bs-Modal-footer'>
                                <div className='bs-Modal-footer-actions'>
                                    <button
                                        className='bs-Button bs-DeprecatedButton bs-Button--grey'
                                        type='button'
                                        onClick={() => {
                                            resetSubProjectKeyReset()
                                            return closeModal({
                                                id: data.subProjectModalId
                                            })
                                        }}>
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        id='removeSubProject'
                                        className='bs-Button bs-DeprecatedButton bs-Button--red'
                                        type='button'
                                        onClick={() => this.resetSubProjectToken()}
                                        disabled={subProjectResetToken.requesting}>
                                        {!subProjectResetToken.requesting && <span>Reset API Key</span>}
                                        {subProjectResetToken.requesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

SubProjectApiKey.displayName = 'SubProjectApiKeyModal'

const mapStateToProps = (state, props) => {
    var subproject = state.subProject && state.subProject.subProjects && state.subProject.subProjects.subProjects ? state.subProject.subProjects.subProjects : {};
    if (subproject && subproject.length && props.data && props.data.subProjectId) {
        subproject = subproject.find(obj => obj._id === props.data.subProjectId);
    }

    return {
        subproject: subproject && subproject._id ? subproject : {},
        subProjectResetToken: state.subProject.resetToken
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ closeModal, resetSubProjectToken, resetSubProjectKeyReset }, dispatch)
}

SubProjectApiKey.propTypes = {
    closeModal: PropTypes.func,
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object,
    resetSubProjectKeyReset: PropTypes.func,
    resetSubProjectToken: PropTypes.func,
    subProjectResetToken: PropTypes.object,
    subproject: PropTypes.object
}

export default connect(mapStateToProps, mapDispatchToProps)(SubProjectApiKey)
