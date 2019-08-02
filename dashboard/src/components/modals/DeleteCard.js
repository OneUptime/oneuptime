import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { deleteCard } from '../../actions/card';
import { closeModal } from '../../actions/modal';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';

class DeleteCard extends Component {

    handleKeyBoard = (e) => {
        var { deleteCardModalId } = this.props;
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({
                    id: deleteCardModalId
                })
            default:
                return false;
        }
    }

    handleDelete = () => {
        const { deleteCard, projectId, deleteCardId, closeModal, deleteCardModalId } = this.props;
        deleteCard(projectId, deleteCardId)
        .then(() => closeModal({
            id: deleteCardModalId
        }))
    }

    render() {
        const { requesting, deleteCardModalId, error} = this.props;
        return (
            <div onKeyDown={this.handleKeyBoard} className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Confirm Deletion</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    Are you sure you want to remove this card ?
					</span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions" style={{width: 280}}>
                                <ShouldRender if={error}>
                                        <div  id="deleteCardError" className="bs-Tail-copy">
                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                                    </div>
                                                </div>
                                                <div className="Box-root">
                                                    <span style={{ color: 'red' }}>{error}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                </div>
                                <button id="deleteCardCancel" className="bs-Button bs-DeprecatedButton bs-Button--grey" type="button" onClick={() => this.props.closeModal({
                                        id: deleteCardModalId
                                    })}>
                                        <span>Cancel</span>
                                    </button>
                                    <button onClick={this.handleDelete}
                                        id="deleteCardButton"
                                        className="bs-Button bs-DeprecatedButton bs-Button--red"
                                        disabled={requesting}
                                        type="submit">
                                        {!requesting && <span>Remove</span>}
                                        {requesting && <FormLoader />}
                                    </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

DeleteCard.displayName = 'DeleteCardFormModal';

DeleteCard.propTypes = {
    deleteCard: PropTypes.object,
    projectId: PropTypes.string,
    deleteCardId: PropTypes.string,
    closeModal: PropTypes.func.isRequired,
    deleteCardModalId: PropTypes.string,
    requesting: PropTypes.bool,
    error: PropTypes.string
}


const mapStateToProps = state => {
    return {
        projectId: state.project.currentProject !== null && state.project.currentProject._id,
        requesting: state.card.deleteCard.requesting,
        deleteCardModalId: state.modal.modals[0].id,
        deleteCardId: state.modal.modals[0].deleteCardId,
        error: state.card.deleteCard.error
    }
}

const mapDispatchToProps = dispatch => bindActionCreators(
    { closeModal, deleteCard }, dispatch
)
export default connect(mapStateToProps, mapDispatchToProps)(DeleteCard);
