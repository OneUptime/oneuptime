import React from 'react';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { AlertTableRows, AlertTableHeader } from '../alert/AlertTable';
import { ListLoader } from '../basic/Loader';

const AlertProjectBox = ({
    currentProjectId,
    subProjectAlert,
    subProjectName,
    canPrev,
    canNext,
    nextClicked,
    prevClicked,
    isRequesting,
    error,
    subProjects,
}) => (
    <div className="Box-root">
        <div>
            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                            <span style={{ textTransform: 'capitalize' }}>
                                {currentProjectId !== subProjectAlert._id
                                    ? subProjectName
                                    : subProjects.length > 0
                                    ? 'Project'
                                    : ''}{' '}
                                Alert Log
                            </span>
                        </span>
                        <span
                            style={{ textTransform: 'lowercase' }}
                            className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                        >
                            <span>
                                Here&#39;s a log of all the alerts that were
                                sent to{' '}
                                {currentProjectId !== subProjectAlert._id
                                    ? `${subProjectName} sub-project`
                                    : `${subProjectName} project`}{' '}
                                team.
                            </span>
                        </span>
                    </div>
                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                        <div></div>
                    </div>
                </div>
            </div>
            <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                <table className="Table">
                    <thead className="Table-body">
                        <AlertTableHeader />
                    </thead>

                    <tbody
                        className="Table-body"
                        style={{ pointerEvents: 'none' }}
                    >
                        <AlertTableRows
                            alerts={subProjectAlert.alerts}
                            isRequesting={isRequesting}
                        />
                    </tbody>
                </table>
            </div>
            <ShouldRender
                if={!isRequesting && subProjectAlert.alerts.length === 0}
            >
                <div
                    className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                    style={{
                        textAlign: 'center',
                        marginTop: '20px',
                        padding: '0 10px',
                    }}
                >
                    There are no alerts at this time!
                </div>
            </ShouldRender>

            <ShouldRender if={isRequesting}>
                <ListLoader />
            </ShouldRender>

            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                <ShouldRender if={!error}>
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {subProjectAlert.count} Alert
                                    {subProjectAlert.count === 1 ? '' : 's'}
                                </span>
                            </span>
                        </span>
                    </div>
                </ShouldRender>
                <ShouldRender if={error}>
                    <div className="bs-Tail-copy" style={{ padding: '10px' }}>
                        <div
                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                            style={{
                                textAlign: 'center',
                                marginTop: '10px',
                                padding: '0 10px',
                            }}
                        >
                            <div className="Box-root Margin-right--8">
                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                            </div>
                            <div className="Box-root">
                                <span style={{ color: 'red' }}>{error}</span>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
                <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                        <div className="Box-root Margin-right--8">
                            <button
                                className={
                                    'Button bs-ButtonLegacy' +
                                    (canPrev ? '' : 'Is--disabled')
                                }
                                disabled={!canPrev}
                                data-db-analytics-name="list_view.pagination.previous"
                                type="button"
                                onClick={() => {
                                    prevClicked(
                                        subProjectAlert._id,
                                        subProjectAlert.skip,
                                        subProjectAlert.limit
                                    );
                                }}
                            >
                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                    <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                        <span>Previous</span>
                                    </span>
                                </div>
                            </button>
                        </div>
                        <div className="Box-root">
                            <button
                                className={`Button bs-ButtonLegacy ${
                                    canNext ? '' : 'Is--disabled'
                                }`}
                                disabled={!canNext}
                                data-db-analytics-name="list_view.pagination.next"
                                type="button"
                                onClick={() => {
                                    nextClicked(
                                        subProjectAlert._id,
                                        subProjectAlert.skip,
                                        subProjectAlert.limit
                                    );
                                }}
                            >
                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                    <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                        <span>Next</span>
                                    </span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

AlertProjectBox.displayName = 'AlertProjectBox';

AlertProjectBox.propTypes = {
    canPrev: PropTypes.bool.isRequired,
    canNext: PropTypes.bool.isRequired,
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    subProjectAlert: PropTypes.object.isRequired,
    subProjectName: PropTypes.string.isRequired,
    error: PropTypes.string,
    currentProjectId: PropTypes.string.isRequired,
    isRequesting: PropTypes.bool.isRequired,
    subProjects: PropTypes.array,
};

export default AlertProjectBox;
