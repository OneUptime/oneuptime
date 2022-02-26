import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { openModal, closeModal } from '../../actions/modal';
import RoutingNumberModal from './RoutingNumberModal';
import DataPathHoC from '../DataPathHoC';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';

class RoutingNumberButton extends React.Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            addNumberModalId: uuidv4(),
        };
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addNumberModalId' does not exist on type... Remove this comment to see the full error message
        const { addNumberModalId } = this.state;
        return (
            <button
                className="Button bs-ButtonLegacy ActionIconParent"
                type="button"
                id="addRoutingNumberButton"
                onClick={() =>
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
RoutingNumberButton.displayName = 'RoutingNumberButton';

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
RoutingNumberButton.propTypes = {
    openModal: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RoutingNumberButton);
