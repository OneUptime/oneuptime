import React, { useEffect } from 'react';
import StatusPageForm from './StatusPageForm';
import ShouldRender from '../basic/ShouldRender';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import DataPathHoC from '../DataPathHoC';
import StatusPage from './RowData';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';
import sortByName from '../../utils/sortByName';

const StatusPageProjectBox = props => {
    const statusPages = props.statusPages ? sortByName(props.statusPages) : [];
    const numberOfPages = Math.ceil(
        parseInt(
            props.subProjectStatusPage && props.subProjectStatusPage.count
        ) / 10
    );

    const handleKeyboard = event => {
        const { modalList, allStatusPageLength } = props;

        if (allStatusPageLength === 1) {
            if (event.target.localName === 'body' && event.key) {
                switch (event.key) {
                    case 'N':
                    case 'n':
                        if (modalList.length === 0) {
                            event.preventDefault();
                            return document
                                .getElementById(
                                    `btnCreateStatusPage_${props.subProjectName}`
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

    useEffect(() => {
        window.addEventListener('keydown', handleKeyboard);
        return () => {
            window.removeEventListener('keydown', handleKeyboard);
        };
    });
    return (
        <div className="Box-root">
            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                            <span style={{ textTransform: 'capitalize' }}>
                                {props.currentProjectId !==
                                props.subProjectStatusPage._id
                                    ? props.subProjectName
                                    : props.subProjects.length > 0
                                    ? 'Project'
                                    : ''}{' '}
                                status page
                            </span>
                        </span>
                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                Status Pages helps your team and your customers
                                to view real-time status and health of your
                                monitors. Status Page helps improve transparency
                                and trust in your organization and with your
                                customers.{' '}
                            </span>
                        </span>
                    </div>
                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                        <div className="Box-root">
                            <RenderIfSubProjectAdmin
                                subProjectId={props.subProjectStatusPage._id}
                            >
                                <button
                                    id={`btnCreateStatusPage_${props.subProjectName}`}
                                    onClick={() => {
                                        props.openModal({
                                            id: props.statusPageModalId,
                                            content: DataPathHoC(
                                                StatusPageForm,
                                                {
                                                    projectId:
                                                        props
                                                            .subProjectStatusPage
                                                            ._id,
                                                }
                                            ),
                                        });
                                    }}
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                >
                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <div className="Box-root Margin-right--8">
                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                        </div>
                                        {props.allStatusPageLength === 1 ? (
                                            <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                                <span>Create Status Page</span>
                                                <span className="new-btn__keycode">
                                                    N
                                                </span>
                                            </span>
                                        ) : (
                                            <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                <span>Create Status Page</span>
                                            </span>
                                        )}
                                    </div>
                                </button>
                            </RenderIfSubProjectAdmin>
                        </div>
                    </div>
                </div>
            </div>
            <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                <table className="Table">
                    <thead className="Table-body">
                        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                            <td>
                                <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                                    Name
                                </div>
                            </td>
                            <td>
                                <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                                    Description
                                </div>
                            </td>
                            <td>
                                <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                                    Monitors
                                </div>
                            </td>

                            <td
                                colSpan="6"
                                style={{ float: 'right' }}
                                className="status-page-btn-action-col"
                            >
                                <div
                                    className="bs-ObjectList-cell table-row-cell Text-typeface--upper Text-fontWeight--medium"
                                    style={{
                                        paddingLeft: '124px',
                                        paddingRight: '24px',
                                    }}
                                >
                                    Actions
                                </div>
                            </td>
                        </tr>
                    </thead>
                    <tbody id="statusPagesListContainer">
                        {statusPages.map((o, i) => {
                            return (
                                <StatusPage
                                    projectId={props.currentProjectId}
                                    subProjectId={
                                        props.subProjectStatusPage._id
                                    }
                                    switchStatusPages={props.switchStatusPages}
                                    key={i}
                                    statusPage={o}
                                    project={props.project}
                                />
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {props.statusPage.requesting ? <ListLoader /> : null}
            <ShouldRender
                if={
                    !props.statusPage.requesting &&
                    props.statusPages.length === 0
                }
            >
                <div
                    className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                    style={{
                        textAlign: 'center',
                        marginTop: '20px',
                        padding: '0 10px',
                    }}
                >
                    You don&#39;t have any status page at this time!
                </div>
            </ShouldRender>
            <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                        <span>
                            <span
                                id={`status_page_count_${props.subProjectName}`}
                                className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                            >
                                {numberOfPages > 0
                                    ? `Page ${
                                          props.pages
                                      } of ${numberOfPages} (${
                                          props.subProjectStatusPage.count
                                      } Status Page${
                                          props.subProjectStatusPage.count === 1
                                              ? ''
                                              : 's'
                                      })`
                                    : `${
                                          props.subProjectStatusPage.count
                                      } Status Page${
                                          props.subProjectStatusPage.count === 1
                                              ? ''
                                              : 's'
                                      }`}
                            </span>
                        </span>
                    </span>
                </div>
                <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                        <div className="Box-root Margin-right--8">
                            <button
                                id="btnPrev"
                                className={`Button bs-ButtonLegacy ${
                                    !props.canPaginateBackward
                                        ? 'Is--disabled'
                                        : ''
                                }`}
                                data-db-analytics-name="list_view.pagination.previous"
                                disabled={!props.canPaginateBackward}
                                type="button"
                                onClick={() =>
                                    props.prevClicked(
                                        props.subProjectStatusPage._id,
                                        props.skip,
                                        props.limit
                                    )
                                }
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
                                id="btnNext"
                                className={`Button bs-ButtonLegacy ${
                                    !props.canPaginateForward
                                        ? 'Is--disabled'
                                        : ''
                                }`}
                                data-db-analytics-name="list_view.pagination.next"
                                disabled={!props.canPaginateForward}
                                type="button"
                                onClick={() =>
                                    props.nextClicked(
                                        props.subProjectStatusPage._id,
                                        props.skip,
                                        props.limit
                                    )
                                }
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
    );
};

StatusPageProjectBox.displayName = 'StatusPageProjectBox';

StatusPageProjectBox.propTypes = {
    switchStatusPages: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    subProjectStatusPage: PropTypes.object.isRequired,
    statusPages: PropTypes.array.isRequired,
    canPaginateBackward: PropTypes.bool.isRequired,
    canPaginateForward: PropTypes.bool.isRequired,
    skip: PropTypes.oneOfType([
        PropTypes.number.isRequired,
        PropTypes.string.isRequired,
    ]),
    limit: PropTypes.oneOfType([
        PropTypes.number.isRequired,
        PropTypes.string.isRequired,
    ]),
    subProjectName: PropTypes.string.isRequired,
    currentProjectId: PropTypes.string.isRequired,
    statusPageModalId: PropTypes.string.isRequired,
    statusPage: PropTypes.object.isRequired,
    subProjects: PropTypes.array,
    allStatusPageLength: PropTypes.number,
    modalList: PropTypes.array,
    project: PropTypes.object,
    pages: PropTypes.number,
};

export default StatusPageProjectBox;
