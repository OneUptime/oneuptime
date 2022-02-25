import React from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ApplicationLogDetail from './ApplicationLogDetail';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';

export function ApplicationLogList(props) {
    const applicationLogs = props.applicationLogs ? props.applicationLogs : [];
    let applicationLogDetails = null;
    const skip = props.skip;
    const limit = props.limit;
    const count = props.count;
    const page = props.page;
    const canNext =
        applicationLogs && count && count > skip + limit ? true : false;
    const canPrev = applicationLogs && skip <= 0 ? false : true;
    const numberOfPages = props.numberOfPage
        ? props.numberOfPage
        : Math.ceil(parseInt(count) / limit);

    if (props.applicationLogs && props.applicationLogs.length > 0) {
        applicationLogDetails = props.applicationLogs.map(
            (applicationLog, i) => (
                <div id={`applicationLog${i}`} key={applicationLog._id}>
                    <ApplicationLogDetail
                        componentId={props.componentId}
                        index={applicationLog._id}
                        key={applicationLog._id}
                        componentSlug={props.componentSlug}
                    />
                </div>
            )
        );
    }

    return (
        <div>
            {applicationLogDetails}

            <div className="Box-root Card-shadow--medium" tabIndex="0">
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span
                                    id={`applicationlog_count`}
                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                >
                                    <ShouldRender if={numberOfPages > 0}>
                                        Page {page ? page : 1} of{' '}
                                        {numberOfPages} (
                                        <ShouldRender if={applicationLogs}>
                                            <span id="numberOfMonitors">
                                                {count}
                                            </span>{' '}
                                            {count > 1
                                                ? 'total application logs'
                                                : 'Application log'}{' '}
                                        </ShouldRender>
                                        )
                                    </ShouldRender>
                                    <ShouldRender if={!(numberOfPages > 0)}>
                                        <span id="numberOfMonitors">
                                            {count}{' '}
                                            {count > 1
                                                ? 'total application logs'
                                                : 'Application log'}
                                        </span>
                                    </ShouldRender>
                                </span>
                            </span>
                        </span>
                    </div>
                    {props.fetchingPage ? <ListLoader /> : null}
                    {props.error ? (
                        <div
                            style={{
                                color: 'red',
                            }}
                        >
                            {props.error}
                        </div>
                    ) : null}
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    onClick={() =>
                                        props.prevClicked(
                                            props.projectId,
                                            props.componentId,
                                            skip,
                                            limit
                                        )
                                    }
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canPrev ? '' : 'Is--disabled')
                                    }
                                    disabled={!canPrev}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    type="button"
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
                                    onClick={() =>
                                        props.nextClicked(
                                            props.projectId,
                                            props.componentId,
                                            skip,
                                            limit
                                        )
                                    }
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canNext ? '' : 'Is--disabled')
                                    }
                                    disabled={!canNext}
                                    data-db-analytics-name="list_view.pagination.next"
                                    type="button"
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
}

ApplicationLogList.displayName = 'ApplicationLogList';

ApplicationLogList.propTypes = {
    projectId: PropTypes.string,
    applicationLogs: PropTypes.array,
    componentId: PropTypes.string,
    componentSlug: PropTypes.string,
    prevClicked: PropTypes.func,
    nextClicked: PropTypes.func,
    error: PropTypes.string,
    skip: PropTypes.number,
    limit: PropTypes.number,
    page: PropTypes.number,
    count: PropTypes.number,
    numberOfPage: PropTypes.number,
    fetchingPage: PropTypes.bool,
};

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

const mapStateToProps = state => ({
    currentProject: state.project.currentProject,
});

export default connect(mapStateToProps, mapDispatchToProps)(ApplicationLogList);
