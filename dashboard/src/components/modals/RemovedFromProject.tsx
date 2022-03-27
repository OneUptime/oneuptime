import React, { Component } from 'react';

import ClickOutside from 'react-click-outside';

import { PropTypes } from 'prop-types';

interface RemovedFromProjectProps {
    closeThisDialog: Function;
}

class RemovedFromProject extends Component<ComponentProps> {
    override render() {

        const { closeThisDialog } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Removal warning</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        You have been removed from this project.
                                        Please reload the page to continue.
                                    </span>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


RemovedFromProject.displayName = 'RemovedFromProjectModal';


RemovedFromProject.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
};

export default RemovedFromProject;
