import React from 'react'
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import CreateIncident from '../modals/CreateIncident';
import { FormLoader } from '../basic/Loader';
import IncidentList from '../incident/IncidentList';
import DataPathHoC from '../DataPathHoC';

const IncidentProjectBox = (props) => (
    <div className="Box-root">
        <div>
            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                            <span style={{ 'textTransform': 'capitalize' }}>{props.currentProjectId !== props.subProjectIncident._id ? props.subProjectName : 'Project'} Incident Log</span>
                        </span>
                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                Incidents are automatically created when your monitor goes down. Here&#39;s a log of all of your incidents for {props.currentProjectId !== props.subProjectIncident._id ? `${props.subProjectName} sub-project` : `${props.subProjectName} project`}.
                            </span>
                        </span>
                    </div>
                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                        <div>

                            <button className={props.creating ? 'bs-Button bs-Button--blue' : 'Button bs-ButtonLegacy ActionIconParent'} type="button" disabled={props.creating}
                                id={`btnCreateIncident_${props.subProjectName}`}
                                onClick={() =>
                                    props.openModal({
                                        id: props.createIncidentModalId,
                                        onClose: () => '',
                                        onConfirm: () => new Promise(resolve => resolve()),
                                        content: DataPathHoC(CreateIncident, { subProjectId: props.subProjectIncident._id })
                                    })}>
                                <ShouldRender if={!props.creating}>
                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Create New Incident</span>
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={props.creating}>
                                    <FormLoader />
                                </ShouldRender>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <IncidentList incidents={props.subProjectIncident} prevClicked={props.prevClicked} nextClicked={props.nextClicked} />
        </div>
    </div>
);

IncidentProjectBox.displayName = 'IncidentProjectBox';

IncidentProjectBox.propTypes = {
    openModal: PropTypes.func.isRequired,
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    subProjectIncident: PropTypes.object.isRequired,
    subProjectName: PropTypes.string.isRequired,
    currentProjectId: PropTypes.string.isRequired,
    creating: PropTypes.bool.isRequired,
    createIncidentModalId: PropTypes.string.isRequired,
};

export default IncidentProjectBox;