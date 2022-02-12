import React, { Component } from 'react';

export default class TableTitle extends Component {

    constructor(props) {
        super(props);
    }

    render() {
        const { title } = this.props;

        return (
            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                <span>
                    {title}{' '}
                    <span
                        style={{
                            textTransform: 'lowercase',
                        }}
                    >
                        for
                    </span>{' '}
                    {props.showProjectName
                        ? props.subProjectName
                        : props.subProjectName}
                </span>
            </span>
        )
    }
}
