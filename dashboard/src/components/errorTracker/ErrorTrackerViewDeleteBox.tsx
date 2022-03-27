import React, { Component } from 'react';
import { openModal, closeModal } from 'common-ui/actions/modal';

import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import { deleteErrorTracker } from '../../actions/errorTracker';

import { history, RootState } from '../../store';
import DeleteErrorTracker from '../modals/DeleteErrorTracker';

interface ErrorTrackerViewDeleteBoxProps {
    errorTracker?: object;
    openModal?: Function;
    currentProject?: object;
    deleteErrorTracker?: Function;
    component?: object;
}

class ErrorTrackerViewDeleteBox extends Component<ComponentProps> {
    handleKeyBoard: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            deleteModalId: uuidv4(),
        };
    }
    deleteErrorTracker = () => {

        const { currentProject, errorTracker, deleteErrorTracker } = this.props;
        const componentId = errorTracker.componentId._id;
        const promise = deleteErrorTracker(
            currentProject._id,
            componentId,
            errorTracker._id
        );
        history.push(
            `/dashboard/project/${currentProject.slug}/component/${this.props

                .component && this.props.component.slug}/error-tracker`
        );

        return promise;
    };
    override render() {

        const { deleteModalId } = this.state;

        const { openModal, errorTracker } = this.props;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-bottom--12"
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Delete Error Tracker</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanantly delete
                                        this error tracker.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red Box-background--red"
                                        onClick={() =>
                                            openModal({
                                                id: deleteModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.deleteErrorTracker(),
                                                content: DataPathHoC(
                                                    DeleteErrorTracker,
                                                    {
                                                        errorTracker,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <span>Delete</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ openModal, closeModal, deleteErrorTracker }, dispatch);

const mapStateToProps = (state: RootState, props: $TSFixMe) => {
    const componentId = props.errorTracker.componentId._id;
    let component;
    state.component.componentList.components.forEach((item: $TSFixMe) => {
        item.components.forEach((c: $TSFixMe) => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });
    return {
        currentProject: state.project.currentProject,
        component,
    };
};

ErrorTrackerViewDeleteBox.propTypes = {
    errorTracker: PropTypes.object,
    openModal: PropTypes.func,
    currentProject: PropTypes.object,
    deleteErrorTracker: PropTypes.func,
    component: PropTypes.object,
};

ErrorTrackerViewDeleteBox.displayName = 'ErrorTrackerViewDeleteBox';
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ErrorTrackerViewDeleteBox);
