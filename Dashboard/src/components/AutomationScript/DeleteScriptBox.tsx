import React from 'react';

import { v4 as uuidv4 } from 'uuid';
import { deleteAutomatedScript } from '../../actions/automatedScript';
import { openModal, closeModal } from 'CommonUI/actions/Modal';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import DataPathHoC from '../DataPathHoC';
import DeleteAutomatedScript from '../Modals/DeleteAutomatedScript';
import { history, RootState } from '../../store';

interface DeleteScriptBoxProps {
    deleteAutomatedScript: Function;
    currentProject?: object;
    openModal: Function;
    name: string;
    automatedSlug?: string;
}

const DeleteScriptBox: Function = (props: DeleteScriptBoxProps) => {
    const { name, openModal }: $TSFixMe = props;
    const deleteModalId: $TSFixMe = uuidv4();

    const deleteScript: Function = async (): $TSFixMe => {
        const automatedSlug: $TSFixMe = props.automatedSlug;
        const projectId: $TSFixMe = props.currentProject._id;
        await props.deleteAutomatedScript(projectId, automatedSlug).then(() => {
            history.push(
                `/dashboard/project/${props.currentProject.slug}/automation-scripts`
            );
        });
    };

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Delete {name} script</span>
                            </span>
                            <p>
                                <span>
                                    Click the button to permanantly delete this
                                    script.
                                </span>
                            </p>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div>
                                <button
                                    id="delete"
                                    className="bs-Button bs-Button--red Box-background--red"
                                    disabled={false}
                                    onClick={() =>
                                        openModal({
                                            id: deleteModalId,
                                            onClose: () => '',
                                            onConfirm: () => deleteScript(),

                                            content: DataPathHoC(
                                                DeleteAutomatedScript
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
};

DeleteScriptBox.propTypes = {
    deleteAutomatedScript: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    openModal: PropTypes.func.isRequired,
    name: PropTypes.string.isRequired,
    automatedSlug: PropTypes.string,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        scripts: state.automatedScripts.scripts,
    };
};

export default connect(mapStateToProps, {
    deleteAutomatedScript,
    openModal,
    closeModal,
})(DeleteScriptBox);
