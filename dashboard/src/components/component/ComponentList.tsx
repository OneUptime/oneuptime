import React from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import RenderIfUserInSubProject from '../basic/RenderIfUserInSubProject';
import ComponentDetail from './ComponentDetail';
// import sortByName from '../../utils/sortByName';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';

interface ComponentListProps {
    components?: unknown[];
    skip?: number;
    limit?: number;
    count?: number;
    shouldRenderProjectType?: boolean;
    projectId?: string;
    projectName?: string;
    projectType?: string;
    numberOfPage?: number;
    // fetchComponents: PropTypes.func,
    page?: number;
    nextClicked?: Function;
    prevClicked?: Function;
    requestErrorObject?: object;
}

function ComponentList(props: ComponentListProps) {
    let componentDetails = null;

    const components = props.components ? props.components : [];
    const skip = props.skip;
    const limit = props.limit;
    const count = props.count;
    const page = props.page;
    const canNext = components && count && count > skip + limit ? true : false;
    const canPrev = components && skip <= 0 ? false : true;
    const numberOfPages = props.numberOfPage
        ? props.numberOfPage
        : Math.ceil(parseInt(count) / limit);

    if (components && components.length > 0) {
        componentDetails = components.map((component: $TSFixMe, i: $TSFixMe) => (
            <div id={`component${i}`} key={component._id}>
                <RenderIfUserInSubProject
                    subProjectId={
                        component.projectId._id || component.projectId
                    }
                >
                    <ComponentDetail
                        shouldRenderProjectType={props.shouldRenderProjectType}
                        projectId={props.projectId}
                        projectName={props.projectName}
                        projectType={props.projectType}
                        component={component}
                        index={component._id}
                        key={component._id}
                    />
                </RenderIfUserInSubProject>
            </div>
        ));
    }

    return (
        <div>
            {componentDetails}


            <div className="Box-root Card-shadow--medium" tabIndex="0">
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span
                                    id={`incident_count`}
                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                >
                                    <ShouldRender if={numberOfPages > 0}>
                                        Page {page ? page : 1} of{' '}
                                        {numberOfPages} (
                                        <ShouldRender if={components}>
                                            <span id="numberOfComponents">
                                                {count}
                                            </span>{' '}
                                            {count > 1
                                                ? 'total components'
                                                : 'Component'}{' '}
                                        </ShouldRender>
                                        )
                                    </ShouldRender>
                                    <ShouldRender if={!(numberOfPages > 0)}>
                                        <span id="numberOfComponents">
                                            {count}{' '}
                                            {count > 1
                                                ? 'total components'
                                                : 'Component'}
                                        </span>
                                    </ShouldRender>
                                </span>
                            </span>
                        </span>
                    </div>
                    {props.requestErrorObject ? (
                        props.requestErrorObject.requesting ? (
                            <ListLoader />
                        ) : null
                    ) : null}
                    {props.requestErrorObject ? (
                        props.requestErrorObject.error ? (
                            <div
                                style={{
                                    color: 'red',
                                }}
                            >
                                {props.requestErrorObject.error}
                            </div>
                        ) : null
                    ) : null}
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    onClick={() =>
                                        props.prevClicked(
                                            props.projectId,
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

ComponentList.displayName = 'ComponentList';

ComponentList.propTypes = {
    components: PropTypes.array,
    skip: PropTypes.number,
    limit: PropTypes.number,
    count: PropTypes.number,
    shouldRenderProjectType: PropTypes.bool,
    projectId: PropTypes.string,
    projectName: PropTypes.string,
    projectType: PropTypes.string,
    numberOfPage: PropTypes.number,
    // fetchComponents: PropTypes.func,
    page: PropTypes.number,
    nextClicked: PropTypes.func,
    prevClicked: PropTypes.func,
    requestErrorObject: PropTypes.object,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({}, dispatch);

const mapStateToProps = (state: $TSFixMe) => ({
    currentProject: state.project.currentProject
});

export default connect(mapStateToProps, mapDispatchToProps)(ComponentList);
