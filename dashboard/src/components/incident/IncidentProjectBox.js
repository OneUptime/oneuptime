import React, { useState, useEffect } from 'react';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import CreateIncident from '../modals/CreateIncident';
import { FormLoader } from '../basic/Loader';
import IncidentList from '../incident/IncidentList';
import DataPathHoC from '../DataPathHoC';
import DropDownMenu from '../basic/DropDownMenu';

const IncidentProjectBox = props => {
    const [incidents, setIncidents] = useState({});
    const [filteredIncidents, setFilteredIncidents] = useState([]);
    const [filterOption, setFilterOption] = useState('Filter By');
    const [isFiltered, setIsFiltered] = useState(false);

    const filterIncidentLogs = status => {
        const unFilteredIncidents = props.subProjectIncident;
        const filtered = [];
        switch (status) {
            case 'unacknowledged':
                unFilteredIncidents.incidents.forEach(incident => {
                    if (!incident.acknowledged) {
                        filtered.push(incident);
                    }
                });
                setIsFiltered(true);
                setFilteredIncidents(filtered);
                break;
            case 'unresolved':
                unFilteredIncidents.incidents.forEach(incident => {
                    if (!incident.resolved) {
                        filtered.push(incident);
                    }
                });
                setIsFiltered(true);
                setFilteredIncidents(filtered);
                break;
            default:
                setIsFiltered(false);
                setFilteredIncidents([]);
                break;
        }
    };

    useEffect(() => {
        const handleKeyboard = event => {
            const { modalList, allProjectLength } = props;

            if (allProjectLength === 1) {
                if (event.target.localName === 'body' && event.key) {
                    switch (event.key) {
                        case 'N':
                        case 'n':
                            if (modalList.length === 0) {
                                event.preventDefault();
                                return document
                                    .getElementById(
                                        `btnCreateIncident_${props.subProjectName}`
                                    )
                                    .click();
                            }
                            return false;
                        default:
                            return false;
                    }
                }
            }
        };

        setIncidents(props.subProjectIncident);
        window.addEventListener('keydown', handleKeyboard);

        return () => {
            window.removeEventListener('keydown', handleKeyboard);
        };
    }, [props]);

    return (
        <div className="Box-root">
            <div>
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span style={{ textTransform: 'capitalize' }}>
                                    Incidents{' '}
                                    <span
                                        style={{
                                            textTransform: 'lowercase',
                                        }}
                                    >
                                        for
                                    </span>{' '}
                                    {props.showProjectName
                                        ? props.subProjectName
                                        : props.subProjectName}
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Incidents are automatically created when
                                    your monitor goes down. Here&#39;s a log of
                                    all of your incidents for{' '}
                                    {props.currentProjectId !==
                                    props.subProjectIncident._id
                                        ? `${props.subProjectName} sub-project`
                                        : `${props.subProjectName} project`}
                                    .
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <span className="Margin-right--8">
                                <DropDownMenu
                                    options={[
                                        {
                                            value: 'Clear Filters',
                                            show: true,
                                        },
                                        {
                                            value: 'Unacknowledged',
                                            show: true,
                                        },
                                        {
                                            value: 'Unresolved',
                                            show: true,
                                        },
                                    ]}
                                    value={filterOption}
                                    updateState={val => {
                                        switch (val) {
                                            case 'Unacknowledged':
                                                setFilterOption(
                                                    'Unacknowledged'
                                                );
                                                return filterIncidentLogs(
                                                    'unacknowledged'
                                                );
                                            case 'Unresolved':
                                                setFilterOption('Unresolved');
                                                return filterIncidentLogs(
                                                    'unresolved'
                                                );
                                            default:
                                                setFilterOption('Filter By');
                                                return filterIncidentLogs(
                                                    'clear'
                                                );
                                        }
                                    }}
                                />
                            </span>
                            <button
                                className={
                                    props.creating
                                        ? 'bs-Button bs-Button--blue'
                                        : 'Button bs-ButtonLegacy ActionIconParent'
                                }
                                type="button"
                                disabled={props.creating}
                                id={`btnCreateIncident_${props.subProjectName}`}
                                onClick={() =>
                                    props.openModal({
                                        id: props.createIncidentModalId,
                                        // onClose: () => '',
                                        // onConfirm: () =>
                                        //     new Promise(resolve => resolve()),
                                        content: DataPathHoC(CreateIncident, {
                                            subProjectId:
                                                props.subProjectIncident._id,
                                            componentId: props.componentId,
                                            componentSlug: props.componentSlug,
                                            currentProjectId:
                                                props.currentProjectId,
                                        }),
                                    })
                                }
                            >
                                <ShouldRender if={!props.creating}>
                                    {props.allProjectLength === 1 ? (
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                            <span>Create New Incident</span>
                                            <span className="new-btn__keycode">
                                                N
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>Create New Incident</span>
                                        </span>
                                    )}
                                </ShouldRender>
                                <ShouldRender if={props.creating}>
                                    <FormLoader />
                                </ShouldRender>
                            </button>
                        </div>
                    </div>
                </div>
                <IncidentList
                    incidents={incidents}
                    prevClicked={props.prevClicked}
                    nextClicked={props.nextClicked}
                    filteredIncidents={filteredIncidents}
                    isFiltered={isFiltered}
                    page={props.page}
                />
            </div>
        </div>
    );
};

IncidentProjectBox.displayName = 'IncidentProjectBox';

IncidentProjectBox.propTypes = {
    openModal: PropTypes.func.isRequired,
    componentId: PropTypes.string,
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    subProjectIncident: PropTypes.object.isRequired,
    subProjectName: PropTypes.string.isRequired,
    currentProjectId: PropTypes.string.isRequired,
    creating: PropTypes.bool.isRequired,
    createIncidentModalId: PropTypes.string.isRequired,
    allProjectLength: PropTypes.number,
    modalList: PropTypes.array,
    page: PropTypes.number,
    componentSlug: PropTypes.string,
    showProjectName: PropTypes.bool,
};

export default IncidentProjectBox;
