import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import ProbeList from '../components/probe/ProbeList';
import { getProbes } from '../actions/probe';
import ShouldRender from '../components/basic/ShouldRender';
import { FormLoader } from '../components/basic/Loader';

import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../actions/Modal';
import ProbeAddModal from '../components/probe/ProbeAddModal';

class Probes extends Component<ComponentProps> {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.state = { addModalId: uuidv4(), page: 1 };
    }

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);

        this.props.getProbes(0, 10);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (event: $TSFixMe) => {

        const { modalId, modalList }: $TSFixMe = this.props;

        const { addModalId }: $TSFixMe = this.state;

        if (event.target.localName === 'body' && event.key) {
            switch (event.key) {
                case 'N':
                case 'n':
                    if (modalList.length === 0 && modalId !== addModalId) {
                        event.preventDefault();
                        return this.handleClick();
                    }
                    return false;
                default:
                    return false;
            }
        }
    };

    prevClicked = (skip: PositiveNumber, limit: PositiveNumber) => {

        this.props.getProbes(
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: PositiveNumber, limit: PositiveNumber) => {

        this.props.getProbes(skip + limit, 10);

        this.setState({ page: this.state.page + 1 });
    };

    handleClick = () => {

        const { addModalId }: $TSFixMe = this.state;

        this.props.openModal({
            id: addModalId,
            onConfirm: () => true,
            content: ProbeAddModal,
        });
    };

    override render() {
        return (
            <div
                id="oneuptimeProbe"
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-vertical--12"
            >
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div
                                className="customers-list-view react-view popover-container"
                                style={{
                                    position: 'relative',
                                    overflow: 'visible',
                                }}
                            ></div>
                            <div className="bs-BIM">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                            <span
                                                                style={{
                                                                    textTransform:
                                                                        'capitalize',
                                                                }}
                                                            >
                                                                OneUptime Probes
                                                            </span>
                                                        </span>
                                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>
                                                                List of Probes
                                                                on OneUptime.
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                        <div className="Box-root">
                                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                <div>
                                                                    <button
                                                                        className="bs-Button bs-ButtonLegacy ActionIconParent"
                                                                        type="button"
                                                                        disabled={
                                                                            false
                                                                        }
                                                                        id="add_probe"
                                                                        onClick={
                                                                            this
                                                                                .handleClick
                                                                        }
                                                                        style={{
                                                                            paddingTop: 3,
                                                                            paddingBottom: 3,
                                                                        }}
                                                                    >
                                                                        <ShouldRender
                                                                            if={
                                                                                true
                                                                            }
                                                                        >
                                                                            <span className="bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                                                                <span>
                                                                                    Add
                                                                                    New
                                                                                    Probe
                                                                                </span>
                                                                                <span className="new-btn__keycode">
                                                                                    N
                                                                                </span>
                                                                            </span>
                                                                        </ShouldRender>
                                                                        <ShouldRender
                                                                            if={
                                                                                false
                                                                            }
                                                                        >
                                                                            <FormLoader />
                                                                        </ShouldRender>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                <div></div>
                                            </div>
                                        </div>
                                        <ProbeList

                                            prevClicked={this.prevClicked}
                                            nextClicked={this.nextClicked}

                                            page={this.state.page}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


Probes.displayName = 'Probes';

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators({ getProbes, openModal, closeModal }, dispatch);
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        modalId: state.modal.modals[0] && state.modal.modals[0].id,
        modalList: state.modal.modals,
    };
};


Probes.propTypes = {
    getProbes: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    modalId: PropTypes.string,
    modalList: PropTypes.array,
};

export default connect(mapStateToProps, mapDispatchToProps)(Probes);
