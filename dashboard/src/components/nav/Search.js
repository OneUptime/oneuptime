import React, { Component } from 'react';
import { reduxForm, Field } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { connect } from 'react-redux';

class Search extends Component {
    state = {
        scroll: 0,
        sectionActive: 0,
        searchObj: [
            {
                title: 'Component',
                values: ['kolawole'],
            },
            {
                title: 'Monitors',
                values: ['messi'],
            },
            {
                title: 'Monitors',
                values: ['messi'],
            },
            {
                title: 'Monitorss',
                values: ['messi'],
            },
        ],
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
    handleKeyBoardScroll = e => {
        switch (e.key) {
            case 'ArrowUp':
                return this.ArrowUp();
            case 'ArrowDown':
                return this.ArrowDown();
            default:
                return false;
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
                    autofilled={false}
                />
                <div>
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
                                    {result.values.map((name, i) => {
                                        return (
                                            <li
                                                key={name}
                                                style={{
                                                    padding: '5px 10px',

                                                    background:
                                                        this.state.scroll ===
                                                            i &&
                                                        j ===
                                                            this.state
                                                                .sectionActive
                                                            ? '#f7f7f7'
                                                            : '',
                                                }}
                                            >
                                                {name}
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

function mapStateToProps(state) {
    const searcResult = state.search.search;
    return {
        initialValues: { search: '' },
        searcResult,
        searchValues: state.form.search && state.form.search.values,
    };
}
export default connect(mapStateToProps)(SearchBox);
