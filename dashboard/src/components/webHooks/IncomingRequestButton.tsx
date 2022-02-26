import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { openModal, closeModal } from '../../actions/modal';
import DataPathHoC from '../DataPathHoC';
import CreateIncomingRequest from '../modals/CreateIncomingRequest';

class IncomingRequestButton extends React.Component {
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject } = this.props;

        return (
            <button
                className="Button bs-ButtonLegacy ActionIconParent"
                type="button"
                id="addIncomingRequestBtn"
                onClick={() =>
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
IncomingRequestButton.displayName = 'IncomingRequestButton';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        openModal,
        closeModal,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => ({
    currentProject: state.project.currentProject,
    modalId: state.modal.modals[0]
});

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
IncomingRequestButton.propTypes = {
    openModal: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncomingRequestButton);
