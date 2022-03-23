import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { IS_LOCALHOST } from '../../config';
import { fetchIncidentStatusPages } from '../../actions/statusPage';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';

interface IncidentStatusPagesProps {
    statusPages: object;
    requesting: boolean;
    projectId: string;
    incidentId: string;
    skip?: number;
    limit?: number;
    count?: number;
    fetchIncidentStatusPages: Function;
}

const IncidentStatusPages = ({
    statusPages,
    fetchIncidentStatusPages,
    requesting,
    projectId,
    incidentId,
    skip,
    count,
    limit
}: IncidentStatusPagesProps) => {
    const [page, setPage] = useState(1);
    const numberOfPages = Math.ceil(parseInt(count) / 10);
    const nextPage = () => {
        const nextSkip = skip + limit;
        if (nextSkip < count) {
            fetchIncidentStatusPages(projectId, incidentId, nextSkip, limit);
            setPage(page < numberOfPages ? page + 1 : numberOfPages);
        }
    };
    const previousPage = () => {
        const nextSkip = skip - limit;
        if (nextSkip >= 0) {
            fetchIncidentStatusPages(projectId, incidentId, nextSkip, limit);
            setPage(page > 1 ? page - 1 : 1);
        }
    };

    return (
        <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
            <div className="Box-root">
                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span style={{ textTransform: 'capitalize' }}>
                                    Status Pages where this incident is visible
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Here is a list of status pages where this
                                    incident is visible for your team or your
                                    customers.
                                </span>
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root"></div>
                        </div>
                    </div>
                </div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    {statusPages && statusPages.length ? (
                        <table className="Table">
                            <thead className="Table-body">
                                <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                    {['Status Page Name', 'ACTIONS'].map(
                                        headerName => (
                                            <td
                                                key={headerName}
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        {headerName}
                                                    </span>
                                                </div>
                                            </td>
                                        )
                                    )}
                                </tr>
                            </thead>
                            <tbody id="statusPagesListContainer">
                                {statusPages &&
                                    statusPages.map((statusPage: $TSFixMe) => {
                                        const statusPageLink = IS_LOCALHOST
                                            ? `http://${statusPage.slug}.localhost:3006`
                                            : window.location.origin +
                                            `/status-page/${statusPage.slug}`;
                                        return (
                                            <tr
                                                key={statusPage._id}
                                                className="Table-row db-ListViewItem bs-ActionsParent statusPageListItem"
                                            >
                                                <td
                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized 
                                        Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord Padding-all-8"
                                                >
                                                    <div className="bs-ObjectList-cell bs-u-v-middle Padding-left--24">
                                                        <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                                            {statusPage.name ||
                                                                'Unknown'}
                                                        </div>

                                                        <div
                                                            id="domainSet"
                                                            className="bs-ObjectList-row db-UserListRow db-UserListRow--withNamebs-ObjectList-cell-row bs-is-muted"
                                                        >
                                                            <a
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                href={
                                                                    statusPageLink
                                                                }
                                                            >
                                                                {statusPageLink}
                                                            </a>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td
                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized 
                                            Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    marginRight:
                                                                        '4px',
                                                                }}
                                                            >
                                                                <button
                                                                    className="Button"
                                                                    style={{
                                                                        height:
                                                                            '48px',
                                                                    }}
                                                                    id="viewStatusPage"
                                                                >
                                                                    <a
                                                                        className="bs-Button"
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        href={
                                                                            statusPageLink
                                                                        }
                                                                    >
                                                                        View
                                                                        Status
                                                                        Page
                                                                    </a>
                                                                </button>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    ) : (
                        <div
                            className="Padding-all--24"
                            style={{ textAlign: 'center' }}
                        >
                            This incident is not visible in any status pages
                        </div>
                    )}
                </div>
                <ShouldRender if={requesting && statusPages.length === 0}>
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
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                {numberOfPages > 0
                                    ? `Page ${page} of ${numberOfPages} (${count} Status Page${count === 1 ? '' : 's'
                                    })`
                                    : `${count} Status Page${count === 1 ? '' : 's'
                                    }`}
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    className={`Button bs-ButtonLegacy ${!(skip > 0) ? 'Is--disabled' : ''
                                        }`}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    disabled={!(skip > 0)}
                                    type="button"
                                    onClick={() => previousPage()}
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
                                    className={`Button bs-ButtonLegacy ${!(skip + limit < count)
                                        ? 'Is--disabled'
                                        : ''
                                        }`}
                                    data-db-analytics-name="list_view.pagination.next"
                                    disabled={!(skip + limit < count)}
                                    type="button"
                                    onClick={() => nextPage()}
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
};

IncidentStatusPages.displayName = 'IncidentStatusPage';

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchIncidentStatusPages,
        },
        dispatch
    );
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        requesting: state.statusPage.requesting,
        projectId: state.project.currentProject._id,
        incidentId: state.incident.incident._id,
        statusPages: state.statusPage.incidentStatusPages.statusPages,
        skip:
            state.statusPage.incidentStatusPages &&
            state.statusPage.incidentStatusPages.skip,
        limit:
            state.statusPage.incidentStatusPages &&
            state.statusPage.incidentStatusPages.limit,
        count:
            state.statusPage.incidentStatusPages &&
            state.statusPage.incidentStatusPages.count,
    };
};
IncidentStatusPages.propTypes = {
    statusPages: PropTypes.object.isRequired,
    requesting: PropTypes.bool.isRequired,
    projectId: PropTypes.string.isRequired,
    incidentId: PropTypes.string.isRequired,
    skip: PropTypes.number,
    limit: PropTypes.number,
    count: PropTypes.number,
    fetchIncidentStatusPages: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentStatusPages);
