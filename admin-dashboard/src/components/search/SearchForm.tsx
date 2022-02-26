import React, { Component } from 'react';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';

class Search extends Component {
    render() {
        return (
            <div style={{ width: 300 }}>
                <div
                    className="Box-root Margin-right--8"
                    style={{ width: '100px' }}
                >
                    <Field
                        className="db-BusinessSettings-input TextInput bs-TextInput"
                        component="input"
                        type="text"
                        name="search"
                        required="required"
                    />
                </div>
                <div className="Box-root">
                    <button
                        id="btnSearch"
                        className="bs-Button bs-Button--blue"
                        type="submit"
                    >
                        Search
                    </button>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Search.displayName = 'Search';

const mapStateToProps = () => {
    return {};
};

const SearchForm = reduxForm({
    form: 'Search',
})(Search);

export default connect(mapStateToProps)(SearchForm);
