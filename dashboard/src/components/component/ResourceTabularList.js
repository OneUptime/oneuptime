import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { history } from '../../store';
import { ListLoader } from '../basic/Loader';

class ResourceTabularList extends Component {
    generateUrlLink(componentResource) {
        const { currentProject, componentId } = this.props;
        const baseUrl = `/dashboard/project/${currentProject._id}/${componentId}/`;
        let route = '';
        switch (componentResource.type) {
            case 'monitor':
                route = 'monitoring';
                break;
            case 'application-security':
                route = 'security/application';
                break;
            case 'container-security':
                route = 'security/container';
                break;
            case 'application-log':
                route = 'application-logs';
                break;
            default:
                break;
        }
        return `${baseUrl}${route}/${componentResource._id}`;
    }
    render() {
        const { componentResource, componentId, currentProject } = this.props;

        if (
            componentResource &&
            componentResource.skip &&
            typeof componentResource.skip === 'string'
        ) {
            componentResource.skip = parseInt(componentResource.skip, 10);
        }
        if (
            componentResource &&
            componentResource.limit &&
            typeof componentResource.limit === 'string'
        ) {
            componentResource.limit = parseInt(componentResource.limit, 10);
        }
        if (componentResource && !componentResource.skip)
            componentResource.skip = 0;
        if (componentResource && !componentResource.limit)
            componentResource.limit = 0;

        let canNext =
            componentResource &&
            componentResource.count &&
            componentResource.count >
                componentResource.skip + componentResource.limit
                ? true
                : false;
        let canPrev =
            componentResource && componentResource.skip <= 0 ? false : true;

        if (
            componentResource &&
            (componentResource.requesting || !componentResource)
        ) {
            canNext = false;
            canPrev = false;
        }

        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '210px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Resource Name</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Resource Type</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="placeholder-left"
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '48px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Action</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="placeholder-left"
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '48px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {componentResource &&
                            componentResource.componentResources &&
                            componentResource.componentResources.length > 0 ? (
                                componentResource.componentResources.map(
                                    (componentResource, i) => {
                                        return (
                                            <tr
                                                id={`componentResource_${i}`}
                                                key={componentResource._id}
                                                className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                                style={{
                                                    height: '50px',
                                                    borderBottom:
                                                        '#f7f7f7 solid',
                                                }}
                                            >
                                                <td
                                                    className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        minWidth: '210px',
                                                    }}
                                                >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Margin-right--16">
                                                                <span>
                                                                    {
                                                                        componentResource.name
                                                                    }
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </td>
                                                <td
                                                    className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{ height: '1px' }}
                                                >
                                                    <div className="db-ListViewItem-link">
                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                            <div
                                                                className={`Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}
                                                            >
                                                                <span
                                                                    id={`monitor_status_${i}`}
                                                                    className={`Badge-text Text-typeface--upper Text-color--green Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper`}
                                                                >
                                                                    {
                                                                        componentResource.type
                                                                    }
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td
                                                    id="placeholder-left"
                                                    className="Table-cell Table-cell--align--left  Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{
                                                        height: '1px',
                                                        maxWidth: '48px',
                                                        minWidth: '48px',
                                                        width: '48px',
                                                    }}
                                                >
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                                    </div>
                                                </td>
                                                <td
                                                    className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                    style={{ height: '1px' }}
                                                >
                                                    <button
                                                        id={`view-resource-${componentResource.name}`}
                                                        className="bs-Button"
                                                        type="button"
                                                        onClick={() => {
                                                            history.push(
                                                                this.generateUrlLink(
                                                                    componentResource
                                                                )
                                                            );
                                                        }}
                                                    >
                                                        <span>View</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    }
                                )
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {!componentResource || componentResource?.requesting ? (
                    <ListLoader />
                ) : null}
                <div
                    style={{
                        textAlign: 'center',
                        marginTop: '10px',
                        padding: '0 10px',
                    }}
                >
                    {componentResource &&
                    (!componentResource.componentResources ||
                        !componentResource.componentResources.length) &&
                    !componentResource.requesting &&
                    !componentResource.error
                        ? "We don't have any resources added yet"
                        : null}
                    {componentResource && componentResource.error
                        ? componentResource.error
                        : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {componentResource &&
                                    componentResource.count
                                        ? componentResource.count +
                                          (componentResource &&
                                          componentResource.count > 1
                                              ? ' Resources'
                                              : ' Resource')
                                        : null}
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    onClick={() => {
                                        this.props.prevClicked(
                                            currentProject._id,
                                            componentId,
                                            componentResource.skip,
                                            componentResource.limit
                                        );
                                    }}
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
                                    onClick={() => {
                                        this.props.nextClicked(
                                            currentProject._id,
                                            componentId,
                                            componentResource.skip,
                                            componentResource.limit
                                        );
                                    }}
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
        );
    }
}

ResourceTabularList.displayName = 'ResourceTabularList';

function mapStateToProps(state, props) {
    let componentResource = null;
    if (state.component.componentResourceList) {
        componentResource =
            state.component.componentResourceList[props.componentId];
    }
    return {
        componentResource,
    };
}

ResourceTabularList.propTypes = {
    componentResource: PropTypes.object,
    currentProject: PropTypes.object,
    componentId: PropTypes.string,
};

export default connect(mapStateToProps)(ResourceTabularList);
