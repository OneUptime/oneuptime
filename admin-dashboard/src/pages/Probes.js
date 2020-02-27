import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import ProbeList from '../components/probe/ProbeList';
import { getProbes } from '../actions/probe';
import Dashboard from '../components/Dashboard';
import ShouldRender from '../components/basic/ShouldRender';
import { FormLoader } from '../components/basic/Loader';
import uuid from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import ProbeAddModal from '../components/probe/ProbeAddModal';

class Probes extends React.Component {
    constructor(props) {
        super(props);

        this.state = { addModalId: uuid.v4() };
    }

    prevClicked = (skip, limit) => {
        this.props.getProbes(
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
    };

    nextClicked = (skip, limit) => {
        this.props.getProbes(skip + limit, 10);
    };

    ready = () => {
        this.props.getProbes(0, 10);
    };

    handleClick = () => {
        const { addModalId } = this.state;
        this.props.openModal({
            id: addModalId,
            onConfirm: () => true,
            content: ProbeAddModal,
        });
    };

    render() {
        return (
            <Dashboard ready={this.ready}>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className="db-World-contentPane Box-root Padding-bottom--48"
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
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                <span
                                                                    style={{
                                                                        textTransform:
                                                                            'capitalize',
                                                                    }}
                                                                >
                                                                    Fyipe Probes
                                                                </span>
                                                            </span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Here is a
                                                                    list of all
                                                                    fyipe probes
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
                                                                        >
                                                                            <ShouldRender
                                                                                if={
                                                                                    true
                                                                                }
                                                                            >
                                                                                <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                    <span>
                                                                                        Add
                                                                                        New
                                                                                        Probe
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
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

Probes.displayName = 'Probes';

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ getProbes, openModal, closeModal }, dispatch);
};

const mapStateToProps = () => {
    return {};
};

Probes.propTypes = {
    getProbes: PropTypes.func.isRequired,
    openModal: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(Probes);
