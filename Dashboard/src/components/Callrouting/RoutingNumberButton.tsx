import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import RoutingNumberModal from './RoutingNumberModal';
import DataPathHoC from '../DataPathHoC';

import { v4 as uuidv4 } from 'uuid';

interface RoutingNumberButtonProps {
    openModal: Function;
}

class RoutingNumberButton extends React.Component<RoutingNumberButtonProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            addNumberModalId: uuidv4(),
        };
    }

    override render() {

        const { addNumberModalId } = this.state;
        return (
            <button
                className="Button bs-ButtonLegacy ActionIconParent"
                type="button"
                id="addRoutingNumberButton"
                onClick={() =>

                    this.props.openModal({
                        id: addNumberModalId,
                        onClose: () => '',
                        content: DataPathHoC(RoutingNumberModal, {}),
                    })
                }
            >
                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                    <div className="Box-root Margin-right--8">
                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                    </div>
                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                        <span>Reserve Number</span>
                    </span>
                </div>
            </button>
        );
    }
}


RoutingNumberButton.displayName = 'RoutingNumberButton';

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


RoutingNumberButton.propTypes = {
    openModal: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RoutingNumberButton);
