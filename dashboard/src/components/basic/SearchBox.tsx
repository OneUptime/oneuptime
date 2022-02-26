import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

class SearchBox extends Component {
    onChange$: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            keyword: '',
        };
        this.onChange$ = new Subject();
        this.onChange = this.onChange.bind(this);
    }
    // update the state locally here
    onChange = (event: $TSFixMe) => {
        const keyword = event.target.value;
        this.setState({
            keyword,
        });
        // send updated word to the listener
        this.onChange$.next(keyword);
    };
    componentDidMount() {
        this.onChange$.pipe(debounceTime(700)).subscribe((updatedWord: $TSFixMe) => {
            // wait a while for the user to complete typing, then send the word to the calling component
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onChange' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.onChange(updatedWord);
        });
    }
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'placeholder' does not exist on type 'Rea... Remove this comment to see the full error message
        const { placeholder, style } = this.props;
        return (
            <div>
                <input
                    type="text"
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'keyword' does not exist on type 'Readonl... Remove this comment to see the full error message
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
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SearchBox.displayName = 'SearchBox';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SearchBox.propTypes = {
    onChange: PropTypes.func,
    placeholder: PropTypes.string,
    style: PropTypes.object,
};
export default SearchBox;
