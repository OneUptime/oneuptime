import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

class SearchBox extends Component {
    constructor(props) {
        super(props);
        this.state = {
            keyword: '',
        };
        this.onChange$ = new Subject();
        this.onChange = this.onChange.bind(this);
    }
    // update the state locally here
    onChange = event => {
        const keyword = event.target.value;
        this.setState({
            keyword,
        });
        // send updated word to the listener
        this.onChange$.next(keyword);
    };
    componentDidMount() {
        this.onChange$.pipe(debounceTime(700)).subscribe(updatedWord => {
            // wait a while for the user to complete typing, then send the word to the calling component
            this.props.onChange(updatedWord);
        });
    }
    render() {
        const { placeholder, style } = this.props;
        return (
            <div>
                <input
                    type="text"
                    value={this.state.keyword}
                    name="keyword"
                    onChange={this.onChange}
                    placeholder={placeholder}
                    style={style}
                />
            </div>
        );
    }
}
SearchBox.displayName = 'SearchBox';
SearchBox.propTypes = {
    onChange: PropTypes.func,
    placeholder: PropTypes.string,
    style: PropTypes.object,
};
export default SearchBox;
