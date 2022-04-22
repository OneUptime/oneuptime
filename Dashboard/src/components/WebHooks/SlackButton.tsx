import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import DataPathHoC from '../DataPathHoC';
import CreateSlackWebhook from '../modals/CreateSlackWebhook';

interface SlackButtonProps {
    openModal: Function;
    monitorId?: string;
}

class SlackButton extends React.Component<SlackButtonProps> {
    override render() {

        const { monitorId }: $TSFixMe = this.props;

        return (
            <button
                className="Button bs-ButtonLegacy ActionIconParent"
                type="button"
                id="addSlackButton"
                onClick={() =>

                    this.props.openModal({
                        id: 'data._id',
                        onClose: () => '',
                        content: DataPathHoC(CreateSlackWebhook, {
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
                        <span>Add Slack Integration</span>
                    </span>
                </div>
            </button>
        );
    }
}


SlackButton.displayName = 'SlackButton';

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        closeModal,
    },
    dispatch
);

const mapStateToProps: Function = (state: RootState) => ({
    currentProject: state.project.currentProject
});


SlackButton.propTypes = {
    openModal: PropTypes.func.isRequired,
    monitorId: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(SlackButton);
