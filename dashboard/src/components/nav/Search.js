import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { history } from '../../store';
import { addCurrentComponent } from '../../actions/component';
import { animateSidebar } from '../../actions/animateSidebar';
import { resetSearch, search } from '../../actions/search';
import { fetchMonitors } from '../../actions/monitor';
import { IS_LOCALHOST, User } from '../../config';
import { switchStatusPage } from '../../actions/statusPage';
import isSubProjectViewer from '../../utils/isSubProjectViewer';
import { addScheduleEvent } from '../../actions/scheduledEvent';

class Search extends Component {
    state = {
        scroll: 0,
        sectionActive: 0,
    };

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoardScroll);
    }
    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoardScroll);
    }
    ArrowUp = () => {
        const searchObj = this.props.searcResult;
        for (let i = 0; i < searchObj.length; i++) {
            if (i === this.state.sectionActive) {
                if (this.state.scroll === 0) {
                    return this.setState({
                        sectionActive:
                            this.state.sectionActive === 0
                                ? 0
                                : this.state.sectionActive - 1,

                        scroll:
                            this.state.sectionActive !== 0
                                ? searchObj[this.state.sectionActive - 1].values
                                      .length - 1
                                : this.state.scroll === 0
                                ? 0
                                : this.state.scroll - 1,
                    });
                } else {
                    return this.setState({
                        scroll: this.state.scroll - 1,
                    });
                }
            }
        }
    };
    ArrowDown = () => {
        const searchObj = this.props.searcResult;
        for (let i = 0; i < searchObj.length; i++) {
            if (i === this.state.sectionActive) {
                //check if its the last section
                if (searchObj[i].values.length - 1 === this.state.scroll) {
                    return this.setState({
                        sectionActive:
                            searchObj.length - 1 === this.state.sectionActive &&
                            searchObj[i].values.length - 1 === this.state.scroll
                                ? 0
                                : this.state.sectionActive + 1,
                        scroll: 0,
                    });
                } else {
                    return this.setState({
                        scroll: this.state.scroll + 1,
                    });
                }
            }
        }
    };

    //generate monitor url
    generateUrlLink(searchObj) {
        const { currentProject } = this.props;
        const baseUrl = `/dashboard/project/${currentProject.slug}/${searchObj.componentSlug}/`;
        let route = '';
        switch (searchObj.type) {
            case 'website':
            case 'device':
            case 'manual':
            case 'api':
            case 'server':
            case 'script':
            case 'incomingHttpRequest':
            case 'kubernetes':
            case 'IP':
                route = 'monitoring';
                break;
            case 'application security':
                route = 'security/application';
                break;
            case 'container security':
                route = 'security/container';
                break;
            case 'log container':
                route = 'application-logs';
                break;
            case 'error tracker':
                route = 'error-trackers';
                break;
            default:
                break;
        }
        return `${baseUrl}${route}/${searchObj.monitorSlug}`;
    }

    switchStatusPages = (searchObj, path) => {
        this.props.switchStatusPage(searchObj);
        history.push(path);
    };
    loadComponent = (currentProject, searchObj) => {
        history.push(
            '/dashboard/project/' + currentProject.slug + '/' + searchObj.url
        );
        window.location.reload();
    };
    navigate = (type, searchObj) => {
        const { currentProject, componentList } = this.props;
        let component, publicStatusPageUrl, path, userId;
        switch (type) {
            case 'Monitors':
            case 'Components':
                component =
                    componentList &&
                    componentList.components
                        .filter(
                            project => project._id === searchObj.projectId
                        )[0]
                        .components.filter(
                            component => component._id === searchObj.componentId
                        )[0];
                setTimeout(
                    () => {
                        type === 'Monitors'
                            ? history.push(this.generateUrlLink(searchObj))
                            : this.loadComponent(currentProject, searchObj);

                        this.props.animateSidebar(false);
                    },
                    type === 'Monitors' ? 500 : 200
                );
                this.props.animateSidebar(true);
                this.props.addCurrentComponent(component);
                break;
            case 'Status Pages':
                path = `/dashboard/project/${currentProject.slug}/sub-project/${searchObj.projectId._id}/status-page/${searchObj.statusPageSlug}`;
                userId = User.getUserId();
                if (IS_LOCALHOST) {
                    publicStatusPageUrl = `http://${searchObj.statusPageSlug}.localhost:3006`;
                } else {
                    publicStatusPageUrl =
                        window.location.origin +
                        '/status-page/' +
                        searchObj.statusPageSlug;
                }

                isSubProjectViewer(userId, currentProject)
                    ? window.open(publicStatusPageUrl, '_blank')
                    : this.switchStatusPages(searchObj.statusPage, path);
                break;
            case 'Team Members':
                history.push('/dashboard/profile/' + searchObj.userId);
                break;
            case 'On-Call Duty':
                history.push(
                    `/dashboard/project/${currentProject.slug}/sub-project/${searchObj.projectId}/schedule/${searchObj.scheduleSlug}`
                );
                break;
            case 'Schedule Events':
                history.push(
                    `/dashboard/project/${currentProject.slug}/scheduledEvents/${searchObj.scheduleEventSlug}`
                );
                this.props.addScheduleEvent(searchObj.scheduleEvents);
                break;
            default:
                return null;
        }
    };
    handleEnter = () => {
        if (
            this.props.searcResult.length > 0 &&
            this.props.searchValues &&
            this.props.searchValues.search !== ''
        ) {
            const searchObj = this.props.searcResult[this.state.sectionActive]
                .values[this.state.scroll];
            const type = this.props.searcResult[this.state.sectionActive].title;
            this.navigate(type, searchObj);
            this.handleBlur();
        }
    };
    handleSearchClick = (sectionActive, scroll) => {
        const searchObj = this.props.searcResult[sectionActive].values[scroll];
        const type = this.props.searcResult[sectionActive].title;
        this.navigate(type, searchObj);
        this.handleBlur();
    };
    handleKeyBoardScroll = e => {
        switch (e.key) {
            case 'ArrowUp':
                return this.ArrowUp();
            case 'ArrowDown':
                return this.ArrowDown();
            case 'Enter':
                return this.handleEnter();
            default:
                return false;
        }
    };
    handleBlur = () => {
        this.props.resetSearch();
    };
    handleSearch = val => {
        if (val) {
            this.props.search(this.props.currentProject._id, { search: val });
        } else {
            this.setState({
                scroll: 0,
                sectionActive: 0,
            });
        }
    };
    render() {
        const searchObj = this.props.searcResult;
        const searchValues = this.props.searchValues;
        return (
            <>
                <Field
                    className="db-BusinessSettings-input TextInput bs-TextInput"
                    component={RenderField}
                    type="text"
                    name="search"
                    id="search"
                    placeholder="Search"
                    autofilled={'off'}
                    onChange={(e, newValue) => this.handleSearch(newValue)}
                />
                <div className="search-list-li">
                    <ul
                        style={{
                            backgroundColor: '#fff',
                            boxShadow: '0 2px 15px rgb(84 96 103 / 25%)',
                            borderRadius: '4px',
                        }}
                    >
                        {searchValues &&
                            searchValues.search &&
                            searchObj.length > 0 &&
                            searchObj.map((result, j) => (
                                <>
                                    <h3
                                        style={{
                                            paddingLeft: '10px',
                                            paddingTop: '7px',
                                        }}
                                        key={result.title}
                                    >
                                        {result.title}
                                    </h3>
                                    {result.values.map((val, i) => {
                                        return (
                                            <li
                                                key={val.name + i}
                                                style={{
                                                    padding: '5px 10px',

                                                    background:
                                                        this.state.scroll ===
                                                            i &&
                                                        j ===
                                                            this.state
                                                                .sectionActive
                                                            ? '#eee'
                                                            : '',
                                                }}
                                                tabIndex="0"
                                                onClick={() =>
                                                    this.handleSearchClick(j, i)
                                                }
                                            >
                                                {val.name}
                                            </li>
                                        );
                                    })}
                                    <div
                                        style={{
                                            backgroundColor: '#dbdbdb',
                                            width: '100%',
                                            height: '1px',
                                            marginTop: '8px',
                                            marginBottom: '8px',
                                        }}
                                    ></div>
                                </>
                            ))}
                    </ul>
                </div>
            </>
        );
    }
}
Search.displayName = 'Search';

const SearchBox = new reduxForm({
    form: 'search',
    enableReinitialize: true,
})(Search);

Search.propTypes = {
    searcResult: PropTypes.array,
    searchValues: PropTypes.object,
    addCurrentComponent: PropTypes.func,
    animateSidebar: PropTypes.func,
    componentList: PropTypes.object,
    resetSearch: PropTypes.func,
    search: PropTypes.func,
    currentProject: PropTypes.object,
    switchStatusPage: PropTypes.func,
    addScheduleEvent: PropTypes.func,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            addCurrentComponent,
            animateSidebar,
            resetSearch,
            search,
            fetchMonitors,
            switchStatusPage,
            addScheduleEvent,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    const searcResult = state.search.search;
    return {
        initialValues: { search: '' },
        searcResult,
        searchValues: state.form.search && state.form.search.values,
        currentProject: state.project.currentProject,
        componentList: state.component.componentList,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(SearchBox);
