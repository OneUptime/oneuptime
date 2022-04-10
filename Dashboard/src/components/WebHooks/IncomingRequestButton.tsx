import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { openModal, closeModal } from 'Common-ui/actions/modal';
import DataPathHoC from '../DataPathHoC';
import CreateIncomingRequest from '../modals/CreateIncomingRequest';

interface IncomingRequestButtonProps {
    openModal: Function;
    currentProject?: object;
}

class IncomingRequestButton extends React.Component<IncomingRequestButtonProps> {
    override render() {

        const { currentProject } = this.props;

        return (
            <button
                className="Button bs-ButtonLegacy ActionIconParent"
                type="button"
                id="addIncomingRequestBtn"
                onClick={() =>

                    this.props.openModal({
                        id: currentProject._id,
                        onClose: () => '',
                        content: DataPathHoC(CreateIncomingRequest, {
                            projectId: currentProject._id,
                        }),
                    })
                }
            >
                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                    <div className="Box-root Margin-right--8">
                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                    </div>
                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                        <span>Add Incoming HTTP Request</span>
                    </span>
                </div>
            </button>
        );
    }
}


IncomingRequestButton.displayName = 'IncomingRequestButton';

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        openModal,
        closeModal,
    },
    dispatch
);

const mapStateToProps = (state: RootState) => ({
    currentProject: state.project.currentProject,
    modalId: state.modal.modals[0]
});


IncomingRequestButton.propTypes = {
    openModal: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncomingRequestButton);
