import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { connect } from 'react-redux';
import { hideDeleteModal } from '../../actions/component';
import { bindActionCreators } from 'redux';

class DeleteComponentModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.hideDeleteModal();
            default:
                return false;
        }
    }
    render() {
        const { visible } = this.props;
        return visible && (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <form>
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Delete Component</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    Are you sure you want to delete this
                                    component?
                                </span>
                                <br />
                                <br />
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className={`bs-Button btn__modal`}
                                        type="button"
                                    onClick={() => this.props.hideDeleteModal()}
                                    // disabled={requesting}
                                    >
                                        <span>Close</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                    <button
                                        className={`bs-Button bs-Button--red Box-background--red btn__modal ${false &&
                                            'bs-is-disabled'}`}
                                        disabled={false}
                                        type="submit"
                                        autoFocus={true}
                                        id="btnDeleteProject"
                                    >
                                        <ShouldRender if={false}>
                                            <Spinner />
                                        </ShouldRender>
                                        <span>DELETE</span>
                                        <span className="delete-btn__keycode">
                                            <span className="keycode__icon keycode__icon--enter" />
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        )
    }
}
DeleteComponentModal.displayName = 'DeleteComponentModal';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            hideDeleteModal
        },
        dispatch
    )

const mapStateToProps = (state) => {
    return {
        visible: state.component.showDeleteModal
    }
}

DeleteComponentModal.proTypes = {
    visible: PropTypes.bool,
    hideDeleteModal: PropTypes.func
}

export default connect(mapStateToProps, mapDispatchToProps)(DeleteComponentModal);