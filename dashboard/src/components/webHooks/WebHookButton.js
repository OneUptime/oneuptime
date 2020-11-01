import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { openModal, closeModal } from '../../actions/modal';
import CreateWebHook from '../modals/CreateWebHook';
import DataPathHoC from '../DataPathHoC';

class WebHookButton extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = event => {
        const { modalId } = this.props;
        if(event.target.localName === 'body' && event.key) {
            switch (event.key) {
                case 'N':
                case 'n':
                    if (!modalId) {
                        event.preventDefault();
                        return document.getElementById('addWebhookButton').click();
                    }
                    return false;
                default:
                    break;
            }
        }
    };

    render() {
        const { monitorId } = this.props;

        return (
            <button
                className="Button bs-ButtonLegacy ActionIconParent"
                type="button"
                id="addWebhookButton"
                onClick={() =>
                    this.props.openModal({
                        id: 'data._id',
                        onClose: () => '',
                        content: DataPathHoC(CreateWebHook, {
                            monitorId: monitorId,
                        }),
                    })
                }
            >
                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                    <div className="Box-root Margin-right--8">
                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                    </div>
                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                        <span>Add WebHook</span>
                        <span className="new-btn__keycode">N</span>
                    </span>
                </div>
            </button>
        );
    }
}

WebHookButton.displayName = 'WebHookButton';

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            openModal,
            closeModal,
        },
        dispatch
    );

const mapStateToProps = state => ({
    currentProject: state.project.currentProject,
    modalId: state.modal.modals[0],
});

WebHookButton.propTypes = {
    openModal: PropTypes.func.isRequired,
    monitorId: PropTypes.string,
    modalId: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
};

export default connect(mapStateToProps, mapDispatchToProps)(WebHookButton);
