import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { openModal } from 'CommonUI/actions/modal';
import DeleteContainerSecurity from '../modals/DeleteContainerSecurity';

interface ContainerSecurityDeleteBoxProps {
    componentId: string;
    componentSlug: string;
    projectId: string;
    containerSecurityId: string;
    containerSecuritySlug?: string;
    openModal: Function;
    deleting?: boolean;
}

export class ContainerSecurityDeleteBox extends Component<ContainerSecurityDeleteBoxProps>{
    public static displayName = '';
    public static propTypes = {};
    handleDelete = ({
        projectId,
        componentId,
        containerSecurityId,
        containerSecuritySlug,
        componentSlug
    }: $TSFixMe) => {

        const { openModal } = this.props;

        openModal({
            id: containerSecurityId,
            content: DeleteContainerSecurity,
            propArr: [
                {
                    projectId,
                    componentId,
                    containerSecurityId,
                    containerSecuritySlug,
                    componentSlug,
                },
            ],
        });
    };

    override render() {
        const {

            deleting,

            projectId,

            componentId,

            containerSecurityId,

            containerSecuritySlug,

            componentSlug,
        } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Delete Container Security</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to permanantly delete
                                        this container security.
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        className="bs-Button bs-Button--red Box-background--red"
                                        id="deleteContainerSecurityBtn"
                                        disabled={deleting}
                                        onClick={() =>
                                            this.handleDelete({
                                                projectId,
                                                componentId,
                                                containerSecurityId,
                                                containerSecuritySlug,
                                                componentSlug,
                                            })
                                        }
                                    >
                                        <ShouldRender if={!deleting}>
                                            <span>Delete</span>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
                                            <FormLoader />
                                        </ShouldRender>
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


ContainerSecurityDeleteBox.displayName = 'ContainerSecurityDeleteBox';

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ openModal }, dispatch);

const mapStateToProps: Function = (state: RootState) => {
    return {
        deleting: state.security.deleteApplication.requesting,
    };
};


ContainerSecurityDeleteBox.propTypes = {
    componentId: PropTypes.string.isRequired,
    componentSlug: PropTypes.string.isRequired,
    projectId: PropTypes.string.isRequired,
    containerSecurityId: PropTypes.string.isRequired,
    containerSecuritySlug: PropTypes.string,
    openModal: PropTypes.func.isRequired,
    deleting: PropTypes.bool,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ContainerSecurityDeleteBox);
