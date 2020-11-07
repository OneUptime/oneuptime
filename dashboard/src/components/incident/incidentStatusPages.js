import React from 'react';
import PropTypes  from "prop-types";
import StatusPage from '../statusPage/RowData'
import { switchStatusPage, fetchIncidentStatusPages } from "../../actions/statusPage";
import { bindActionCreators } from 'redux';
import {connect} from 'react-redux';
import { history } from '../../store';
import ShouldRender from '../basic/ShouldRender';


const IncidentStatusPages = ({statusPages, switchStatusPage, fetchIncidentStatusPages, requesting, projectId, incidentId, skip, count, limit}) => {

    const switchStatusPages = (statusPage, path) => {
        switchStatusPage(statusPage);
        history.push(path);
    };

    const nextPage = () => {
        const nextSkip =  skip+ limit
        if(nextSkip < count) {
            fetchIncidentStatusPages(projectId, incidentId, nextSkip, limit)
        }
    }
    const previousPage = () => {
        const nextSkip =  skip - limit
        if(nextSkip >= 0) {

            fetchIncidentStatusPages(projectId, incidentId, nextSkip, limit)
        }
    }
    return (
        // <div>
        //     {incidentStatusPages.statusPages && incidentStatusPages.statusPages.map(statusPage => {
        //         return ( <StatusPage
        //         switchStatusPages = {switchStatusPages}
        //         key={statusPage._id}
        //         statusPage={statusPage}
        //         projectId = { statusPage.projectId.parentProjectId || statusPage.projectId._id}
        //         subProjectId = {statusPage.projectId._id}
        //     />)
        //     })}
        // </div>
        <div className="bs-ContentSection Card-root Card-shadow--medium Margin-bottom--12">
        <div className="Box-root">
            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                            <span style={{ textTransform: 'capitalize' }}>
                               Status Pages For This Incident
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
                            
                        </div>
                    </div>
                </div>
            </div>
            <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                <table className="Table">
                    <thead className="Table-body">
                        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                            <td>
                                <div className="bs-ObjectList-cell">Name</div>
                            </td>
                            <td>
                                <div className="bs-ObjectList-cell">
                                    Description
                                </div>
                            </td>
                            <td>
                                <div className="bs-ObjectList-cell">
                                    Monitors
                                </div>
                            </td>

                            <td
                                colSpan="6"
                                style={{ float: 'right', marginRight: '100px' }}
                                className="status-page-btn-action-col"
                            >
                                <div
                                    className="bs-ObjectList-cell table-row-cell"
                                    style={{ paddingLeft: '124px' }}
                                >
                                    Action
                                </div>
                            </td>
                        </tr>
                    </thead>
                    <tbody id="statusPagesListContainer">
                    {statusPages && statusPages.map(statusPage => {
                            return ( <StatusPage
                            switchStatusPages = {switchStatusPages}
                            key={statusPage._id}
                            statusPage={statusPage}
                            projectId = { statusPage.projectId.parentProjectId || statusPage.projectId._id}
                            subProjectId = {statusPage.projectId._id}
                        />)
                        })}
                    </tbody>
                </table>
            </div>
            <ShouldRender
                if={
                    requesting &&
                    statusPages.length === 0
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
                                Status Pages
                                       
                        </span>
                    </span>
                </div>
                <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                        <div className="Box-root Margin-right--8">
                            <button
                                id="btnPrev"
                                className={`Button bs-ButtonLegacy ${
                                    ! (skip > 0)
                                        ? 'Is--disabled'
                                        : ''
                                }`}
                                data-db-analytics-name="list_view.pagination.previous"
                                disabled={! (skip > 0)}
                                type="button"
                                onClick={() =>
                                    previousPage()
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
                                    ! (skip + limit < count)
                                        ? 'Is--disabled'
                                        : ''
                                }`}
                                data-db-analytics-name="list_view.pagination.next"
                                disabled={! (skip + limit < count)}
                                type="button"
                                onClick={() =>
                                    nextPage()
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
        </div>
    )
}

IncidentStatusPages.displayName = 'IncidentStatusPage'

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            
            switchStatusPage,
            fetchIncidentStatusPages,

        },
        dispatch
    );
};

const mapStateToProps = state => {
    return {
        requesting : state.statusPage.requesting,
        projectId : state.project.currentProject._id,
        incidentId : state.incident.incident._id,
        statusPages : state.statusPage.incidentStatusPages.statusPages,
        skip : state.statusPage.incidentStatusPages && state.statusPage.incidentStatusPages.skip,
        limit : state.statusPage.incidentStatusPages && state.statusPage.incidentStatusPages.limit,
        count : state.statusPage.incidentStatusPages && state.statusPage.incidentStatusPages.count,
    }
}
IncidentStatusPages.propTypes = {
    statusPages : PropTypes.object.isRequired,
    switchStatusPage : PropTypes.func.isRequired,
    requesting : PropTypes.bool.isRequired,
    projectId : PropTypes.string.isRequired,
    incidentId : PropTypes.string.isRequired,
    skip : PropTypes.number,
    limit : PropTypes.number,
    count : PropTypes.number,
    fetchIncidentStatusPages : PropTypes.func.isRequired
    
}

export default connect(mapStateToProps, mapDispatchToProps) (IncidentStatusPages)
