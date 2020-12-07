import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { fetchComponentIssues } from '../../actions/component';
import { history } from '../../store';
import ShouldRender from '../basic/ShouldRender';

class ComponentIssue extends Component {
    componentDidMount() {
        const {
            component,
            fetchComponentIssues,
            currentProjectId,
        } = this.props;
        fetchComponentIssues(currentProjectId, component._id);
    }
    generateUrlLink(componentIssue) {
        const { currentProjectId, component } = this.props;
        return `/dashboard/project/${currentProjectId}/${component._id}/error-trackers/${componentIssue.errorTrackerId._id}`;
    }
    render() {
        const { component, currentProjectId, componentIssueList } = this.props;
        return (
            <ShouldRender
                if={
                    componentIssueList &&
                    componentIssueList.componentIssues &&
                    componentIssueList.componentIssues.length > 0
                }
            >
                <div
                    className="Box-root Card-shadow--medium"
                    tabIndex="0"
                    onKeyDown={this.handleKeyBoard}
                >
                    <div className="db-Trends-header">
                        <div className="db-Trends-controls">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span className="Box-root Flex-flex Flex-direction--row">
                                            <span
                                                className="db-SideNav-icon db-SideNav-icon--square db-SideNav-icon--selected"
                                                style={{
                                                    backgroundRepeat:
                                                        'no-repeat',
                                                    backgroundSize: '15px',
                                                    backgroundPosition:
                                                        'center',
                                                    margin: '3px 3px',
                                                }}
                                            />
                                            <span
                                                id="component-content-header"
                                                className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                            >
                                                <span
                                                    id={`component-title-${component.name}`}
                                                >
                                                    {component.name}
                                                </span>
                                            </span>
                                        </span>
                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                Here&apos;s a list of unresolved
                                                errors which belong to this
                                                component.
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <button
                                    id={`more-details-${component.name}`}
                                    className="bs-Button"
                                    type="button"
                                    style={{
                                        padding: '5px',
                                        display: 'flex',
                                        justifyContent: 'center',
                                    }}
                                    onClick={() => {
                                        history.push(
                                            '/dashboard/project/' +
                                                currentProjectId +
                                                '/' +
                                                component._id +
                                                '/error-tracker'
                                        );
                                    }}
                                >
                                    <svg
                                        height="15px"
                                        viewBox="-192 0 512 512"
                                        width="20px"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path d="m128 256c0 35.347656-28.652344 64-64 64s-64-28.652344-64-64 28.652344-64 64-64 64 28.652344 64 64zm0 0" />
                                        <path d="m128 64c0 35.347656-28.652344 64-64 64s-64-28.652344-64-64 28.652344-64 64-64 64 28.652344 64 64zm0 0" />
                                        <path d="m128 448c0 35.347656-28.652344 64-64 64s-64-28.652344-64-64 28.652344-64 64-64 64 28.652344 64 64zm0 0" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="db-RadarRulesLists-page">
                            <div className="Box-root Margin-bottom--12">
                                <div className="">
                                    <div className="Box-root">
                                        <div>
                                            <div>
                                                <div
                                                    style={{
                                                        overflow: 'hidden',
                                                        overflowX: 'auto',
                                                    }}
                                                >
                                                    <table className="Table">
                                                        <thead className="Table-body">
                                                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                                                <td
                                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                    style={{
                                                                        height:
                                                                            '1px',
                                                                        minWidth:
                                                                            '400px',
                                                                    }}
                                                                >
                                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                            <span>
                                                                                Title
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </td>

                                                                <td
                                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                    style={{
                                                                        height:
                                                                            '1px',
                                                                    }}
                                                                >
                                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                            <span>
                                                                                Type
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td
                                                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                    style={{
                                                                        height:
                                                                            '1px',
                                                                    }}
                                                                >
                                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                            <span>
                                                                                Error
                                                                                Tracker
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td
                                                                    className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                    style={{
                                                                        height:
                                                                            '1px',
                                                                    }}
                                                                >
                                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                            <span>
                                                                                Action
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="Table-body">
                                                            {componentIssueList &&
                                                            componentIssueList.componentIssues &&
                                                            componentIssueList
                                                                .componentIssues
                                                                .length > 0
                                                                ? componentIssueList.componentIssues.map(
                                                                      componentIssue => {
                                                                          return (
                                                                              <tr
                                                                                  key={
                                                                                      componentIssue._id
                                                                                  }
                                                                                  className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                                                                  style={{
                                                                                      height:
                                                                                          '50px',
                                                                                  }}
                                                                                  onClick={() => {
                                                                                      history.push(
                                                                                          this.generateUrlLink(
                                                                                              componentIssue
                                                                                          )
                                                                                      );
                                                                                  }}
                                                                              >
                                                                                  <td
                                                                                      className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                                      style={{
                                                                                          height:
                                                                                              '1px',
                                                                                          minWidth:
                                                                                              '400px',
                                                                                      }}
                                                                                  >
                                                                                      <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                                          <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                              <div className="Box-root Margin-right--16 Flex-flex Flex-direction--row resourceName-width">
                                                                                                  <span className="Text-fontSize--16 Padding-right--4">
                                                                                                      {componentIssue.name
                                                                                                          ? componentIssue.name
                                                                                                          : 'Unknown Error Event'}
                                                                                                  </span>{' '}
                                                                                                  <span className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart Text-color--slate">
                                                                                                      {componentIssue.description
                                                                                                          ? componentIssue
                                                                                                                .description
                                                                                                                .length >
                                                                                                            100
                                                                                                              ? ` - ${componentIssue.description.substr(
                                                                                                                    0,
                                                                                                                    100
                                                                                                                )} ...`
                                                                                                              : ` - ${componentIssue.description}`
                                                                                                          : ''}
                                                                                                  </span>
                                                                                              </div>
                                                                                          </span>
                                                                                      </div>
                                                                                  </td>
                                                                                  <td
                                                                                      className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                                      style={{
                                                                                          height:
                                                                                              '1px',
                                                                                      }}
                                                                                  >
                                                                                      <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                                          <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                              <div className="Box-root Margin-right--16 Flex-flex Flex-direction--row">
                                                                                                  <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                                                                      <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                                          <span>
                                                                                                              {
                                                                                                                  componentIssue.type
                                                                                                              }
                                                                                                          </span>
                                                                                                      </span>
                                                                                                  </div>
                                                                                              </div>
                                                                                          </span>
                                                                                      </div>
                                                                                  </td>
                                                                                  <td
                                                                                      className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                                      style={{
                                                                                          height:
                                                                                              '1px',
                                                                                      }}
                                                                                  >
                                                                                      <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                                          <div
                                                                                              className={` Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 resourceType-width`}
                                                                                          >
                                                                                              <span
                                                                                                  id={`resource_type_${componentIssue.name}`}
                                                                                                  className={`Badge-text Text-lineHeight--16 Text-typeface--capitalize Text-fontWeight--bold`}
                                                                                              >
                                                                                                  {componentIssue.errorTrackerId &&
                                                                                                      componentIssue
                                                                                                          .errorTrackerId
                                                                                                          .name}
                                                                                              </span>
                                                                                          </div>
                                                                                      </div>
                                                                                  </td>

                                                                                  <td
                                                                                      className="Table-cell Table-cell--align--right  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell Padding-right--20"
                                                                                      style={{
                                                                                          height:
                                                                                              '1px',
                                                                                      }}
                                                                                  >
                                                                                      <button
                                                                                          id={`view-resource-${componentIssue.name}`}
                                                                                          className="bs-Button"
                                                                                          type="button"
                                                                                      >
                                                                                          <span>
                                                                                              View
                                                                                          </span>
                                                                                      </button>
                                                                                  </td>
                                                                              </tr>
                                                                          );
                                                                      }
                                                                  )
                                                                : null}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </ShouldRender>
        );
    }
}
const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchComponentIssues,
        },
        dispatch
    );
};
function mapStateToProps(state, ownProps) {
    const componentIssueList =
        state.component.componentIssueList[ownProps.component._id];
    return {
        currentProject: state.project.currentProject,
        subProject: state.subProject,
        componentIssueList,
    };
}
ComponentIssue.displayName = 'ComponentIssue';
ComponentIssue.propTypes = {
    currentProjectId: PropTypes.string.isRequired,
    component: PropTypes.object,
    fetchComponentIssues: PropTypes.string,
    componentIssueList: PropTypes.object,
};
export default connect(mapStateToProps, mapDispatchToProps)(ComponentIssue);
