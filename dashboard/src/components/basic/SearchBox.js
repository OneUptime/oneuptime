import React, { Component } from 'react';

class SearchBox extends Component {
    constructor(props) {
        super(props);
        this.state = {
            keyword: '',
        };
    }
    onChange = event => {
        this.setState({
            keyword: event.target.value,
        });
    };
    render() {
        return (
            <div>
                <input
                    type="text"
                    value={this.state.keyword}
                    name="keyword"
                    onChange={this.onChange}
                />
            </div>
        );
    }
}
SearchBox.displayName = 'SearchBox';
export default SearchBox;
