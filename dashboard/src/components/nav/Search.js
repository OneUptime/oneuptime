import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { history } from '../../store';
import { addCurrentComponent } from '../../actions/component';
import { animateSidebar } from '../../actions/animateSidebar';
import { resetSearch } from '../../actions/search';

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
                //if not
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
    handleEnter = () => {
        const { currentProject, componentList } = this.props;
        if (
            this.props.searcResult.length > 0 &&
            this.props.searchValues &&
            this.props.searchValues.search !== ''
        ) {
            const searchObj = this.props.searcResult[this.state.sectionActive]
                .values[this.state.scroll];
            const component =
                componentList &&
                componentList.components
                    .filter(project => project._id === searchObj.projectId)[0]
                    .components.filter(
                        component => component._id === searchObj.componentId
                    )[0];

            setTimeout(() => {
                history.push(
                    '/dashboard/project/' +
                        currentProject.slug +
                        '/' +
                        searchObj.url
                );
                this.props.animateSidebar(false);
            }, 500);
            this.props.animateSidebar(true);
            this.props.addCurrentComponent(component);
        }
    };
    handleSearchClick = (sectionActive, scroll) => {
        const { currentProject, componentList } = this.props;
        const searchObj = this.props.searcResult[sectionActive].values[scroll];
        const component =
            componentList &&
            componentList.components
                .filter(project => project._id === searchObj.projectId)[0]
                .components.filter(
                    component => component._id === searchObj.componentId
                )[0];
        setTimeout(() => {
            history.push(
                '/dashboard/project/' +
                    currentProject.slug +
                    '/' +
                    searchObj.url
            );
            this.props.animateSidebar(false);
        }, 500);
        this.props.animateSidebar(true);
        this.props.addCurrentComponent(component);
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
    handleFocus = () => {
        console.log('hey baby i am so fucussed on you');
    };
    handleBlur = () => {
        this.props.resetSearch()
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
                    handleFocus={this.handleFocus}
                    handleBlur={this.handleBlur}
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
                                                key={val.name}
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
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            addCurrentComponent,
            animateSidebar,
            resetSearch,
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
