import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ProbeList from '../components/probe/ProbeList';
import { getProbes } from '../actions/probe';
import ShouldRender from '../components/basic/ShouldRender';
import { FormLoader } from '../components/basic/Loader';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import ProbeAddModal from '../components/probe/ProbeAddModal';

class Probes extends React.Component {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);

        this.state = { addModalId: uuidv4(), page: 1 };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(0, 10);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (event: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalId' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { modalId, modalList } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addModalId' does not exist on type 'Read... Remove this comment to see the full error message
        const { addModalId } = this.state;

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

    prevClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = (skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(skip + limit, 10);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };

    handleClick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addModalId' does not exist on type 'Read... Remove this comment to see the full error message
        const { addModalId } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            id: addModalId,
            onConfirm: () => true,
            content: ProbeAddModal,
        });
    };

    render() {
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
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ prevClicked: (skip: any, limit: any) => vo... Remove this comment to see the full error message
                                            prevClicked={this.prevClicked}
                                            nextClicked={this.nextClicked}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Probes.displayName = 'Probes';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ getProbes, openModal, closeModal }, dispatch);
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        modalId: state.modal.modals[0] && state.modal.modals[0].id,
        modalList: state.modal.modals,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Probes.propTypes = {
    getProbes: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    modalId: PropTypes.string,
    modalList: PropTypes.array,
};

export default connect(mapStateToProps, mapDispatchToProps)(Probes);
