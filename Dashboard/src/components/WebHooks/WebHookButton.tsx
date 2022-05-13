import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { openModal, closeModal } from 'CommonUI/actions/Modal';
import CreateWebHook from '../Modals/CreateWebHook';
import DataPathHoC from '../DataPathHoC';

interface WebHookButtonProps {
    openModal: Function;
    monitorId?: string;
}

class WebHookButton extends React.Component<WebHookButtonProps> {
    override render() {

        const { monitorId }: $TSFixMe = this.props;

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
                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                        <span>Add WebHook</span>
                    </span>
                </div>
            </button>
        );
    }
}


WebHookButton.displayName = 'WebHookButton';

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        closeModal,
    },
    dispatch
);

const mapStateToProps: Function = (state: RootState) => ({
    currentProject: state.project.currentProject,
    modalId: state.modal.modals[0]
});


WebHookButton.propTypes = {
    openModal: PropTypes.func.isRequired,
    monitorId: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(WebHookButton);
