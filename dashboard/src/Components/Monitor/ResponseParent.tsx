import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { Component } from 'react';
import PropTypes from 'prop-types';

import { FieldArray } from 'redux-form';

import { Field } from 'redux-form';
import { ValidateField } from '../../config';
import RenderOptions from '../basic/RenderOptions';
import { RenderSelect } from '../basic/RenderSelect';

interface ResponseParentProps {
    fields: unknown[] | object;
    bodyfield?: unknown[] | object;
    level?: number;
    type?: string;
    criterionType?: string;
}

export class ResponseParent extends Component<ResponseParentProps>{
    public static displayName = '';
    public static propTypes = {};
    // eslint-disable-next-line
    constructor(props: $TSFixMe) {
        super(props);
    }
    override render() {

        const { fields, bodyfield, level, type, criterionType } = this.props;
        return (
            <ul id={fields.name} data-testId={`${criterionType}_criteria_list`}>
                {bodyfield && bodyfield.length
                    ? fields.map((newval: $TSFixMe, j: $TSFixMe) => {
                        return (
                            <React.Fragment key={j}>
                                {Object.keys(bodyfield[j]).includes(
                                    'match'
                                ) ? (
                                    <li>
                                        <div
                                            className="bs-Fieldset-row"
                                            style={{
                                                padding: '10px 4px 5px 4px',
                                                display: 'inline-block',
                                                marginLeft: `${level > 1
                                                    ? level * 10
                                                    : 10
                                                    }px`,
                                            }}
                                        >
                                            <label
                                                className="bs-Fieldset-label"
                                                style={{ padding: '6px' }}
                                            >
                                                Match
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    className="db-select-nw db-select-nw-100"
                                                    component={RenderSelect}
                                                    name={`${newval}.match`}
                                                    id="match"
                                                    placeholder="match"
                                                    disabled={false}
                                                    validate={
                                                        ValidateField.select
                                                    }
                                                    message="of the following rules :"
                                                    options={[
                                                        {
                                                            value: '',
                                                            label: 'None',
                                                        },
                                                        {
                                                            value: 'all',
                                                            label: 'All',
                                                        },
                                                        {
                                                            value: 'any',
                                                            label: 'Any',
                                                        },
                                                    ]}
                                                />
                                            </div>
                                        </div>
                                    </li>
                                ) : (
                                    ''
                                )}

                                <div style={{ marginLeft: 10 }}>
                                    <RenderOptions
                                        bodyfield={bodyfield[j]}
                                        level={level}
                                        addField={() =>
                                            fields.insert(j + 1, {
                                                responseType: '',
                                                filter: '',
                                                field1: '',
                                                field2: '',
                                                field3: false,
                                            })
                                        }
                                        removeField={(
                                            removeArrayField: $TSFixMe,
                                            updateCriteriaField: $TSFixMe
                                        ) => {
                                            const lastCriteriaIndex = fields.name.lastIndexOf(
                                                'criteria'
                                            );

                                            if (
                                                bodyfield[j] &&
                                                Object.keys(
                                                    bodyfield[j]
                                                ).includes('match')
                                            ) {
                                                if (bodyfield[j + 1]) {
                                                    const updateVal = bodyfield.map(
                                                        (field: $TSFixMe, i: $TSFixMe) => {
                                                            if (i === j + 1) {
                                                                if (
                                                                    bodyfield[
                                                                    j
                                                                    ] &&
                                                                    bodyfield[
                                                                        j
                                                                    ]
                                                                        .criteria &&
                                                                    bodyfield[
                                                                        j
                                                                    ].criteria
                                                                        .length >
                                                                    0
                                                                ) {
                                                                    field = {
                                                                        ...field,
                                                                        match:
                                                                            bodyfield[
                                                                                j
                                                                            ]
                                                                                .match,
                                                                        field3: true,
                                                                        criteria: [
                                                                            ...(bodyfield[
                                                                                i
                                                                            ] &&
                                                                                bodyfield[
                                                                                    i
                                                                                ]
                                                                                    .criteria
                                                                                ? bodyfield[
                                                                                    i
                                                                                ]
                                                                                    .criteria
                                                                                : []),
                                                                            ...bodyfield[
                                                                                j
                                                                            ]
                                                                                .criteria,
                                                                        ],
                                                                    };
                                                                } else {
                                                                    field = {
                                                                        ...field,
                                                                        match:
                                                                            bodyfield[
                                                                                j
                                                                            ]
                                                                                .match,
                                                                    };
                                                                }
                                                            }
                                                            return field;
                                                        }
                                                    );
                                                    if (
                                                        lastCriteriaIndex >= 0
                                                    ) {
                                                        updateCriteriaField(
                                                            fields.name.substring(
                                                                0,
                                                                lastCriteriaIndex -
                                                                1
                                                            ),
                                                            updateVal,
                                                            false
                                                        );
                                                    } else {
                                                        updateCriteriaField(
                                                            fields.name,
                                                            updateVal,
                                                            true
                                                        );
                                                    }
                                                }
                                                fields.remove(j);
                                            } else if (
                                                bodyfield[j] &&
                                                bodyfield[j].criteria &&
                                                bodyfield[j].criteria.length >
                                                0
                                            ) {
                                                if (bodyfield[j + 1]) {
                                                    const updateVal = bodyfield.map(
                                                        (field: $TSFixMe, i: $TSFixMe) => {
                                                            if (i === j + 1) {
                                                                field = {
                                                                    ...field,
                                                                    field3: true,
                                                                    criteria: [
                                                                        ...(bodyfield[
                                                                            j +
                                                                            1
                                                                        ] &&
                                                                            bodyfield[
                                                                                j +
                                                                                1
                                                                            ]
                                                                                .criteria
                                                                            ? bodyfield[
                                                                                j +
                                                                                1
                                                                            ]
                                                                                .criteria
                                                                            : []),
                                                                        ...(bodyfield[
                                                                            j
                                                                        ] &&
                                                                            bodyfield[
                                                                                j
                                                                            ]
                                                                                .criteria
                                                                            ? bodyfield[
                                                                                j
                                                                            ]
                                                                                .criteria
                                                                            : []),
                                                                    ],
                                                                };
                                                            }
                                                            return field;
                                                        }
                                                    );
                                                    if (
                                                        lastCriteriaIndex >= 0
                                                    ) {
                                                        updateCriteriaField(
                                                            fields.name.substring(
                                                                0,
                                                                lastCriteriaIndex -
                                                                1
                                                            ),
                                                            updateVal,
                                                            false
                                                        );
                                                    } else {
                                                        updateCriteriaField(
                                                            fields.name,
                                                            updateVal,
                                                            true
                                                        );
                                                    }
                                                } else if (bodyfield[j - 1]) {
                                                    const updateVal = bodyfield.map(
                                                        (field: $TSFixMe, i: $TSFixMe) => {
                                                            if (i === j - 1) {
                                                                field = {
                                                                    ...field,
                                                                    field3: true,
                                                                    criteria: [
                                                                        ...(bodyfield[
                                                                            j -
                                                                            1
                                                                        ] &&
                                                                            bodyfield[
                                                                                j -
                                                                                1
                                                                            ]
                                                                                .criteria
                                                                            ? bodyfield[
                                                                                j -
                                                                                1
                                                                            ]
                                                                                .criteria
                                                                            : []),
                                                                        ...(bodyfield[
                                                                            j
                                                                        ] &&
                                                                            bodyfield[
                                                                                j
                                                                            ]
                                                                                .criteria
                                                                            ? bodyfield[
                                                                                j
                                                                            ]
                                                                                .criteria
                                                                            : []),
                                                                    ],
                                                                };
                                                            }
                                                            return field;
                                                        }
                                                    );
                                                    if (
                                                        lastCriteriaIndex >= 0
                                                    ) {
                                                        updateCriteriaField(
                                                            fields.name.substring(
                                                                0,
                                                                lastCriteriaIndex -
                                                                1
                                                            ),
                                                            updateVal,
                                                            false
                                                        );
                                                    } else {
                                                        updateCriteriaField(
                                                            fields.name,
                                                            updateVal,
                                                            true
                                                        );
                                                    }
                                                }
                                                fields.remove(j);
                                            } else {
                                                fields.remove(j);
                                            }
                                        }}
                                        fieldnameprop={newval}
                                        type={type}
                                        criterionType={criterionType}
                                    />
                                </div>

                                {//level < 3 &&
                                    bodyfield[j] && bodyfield[j].field3 ? (
                                        <FieldArray
                                            name={`${newval}.criteria`}
                                            component={ResponseParent}

                                            type={this.props.type}
                                            bodyfield={bodyfield[j].criteria}
                                            level={level + 1}
                                        />
                                    ) : (
                                        ''
                                    )}
                            </React.Fragment>
                        );
                    })
                    : ''}
            </ul>
        );
    }
}


ResponseParent.displayName = 'ResponseParent';


ResponseParent.propTypes = {
    fields: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired,
    bodyfield: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
    level: PropTypes.number,
    type: PropTypes.string,
    criterionType: PropTypes.string,
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({}, dispatch);


export default connect({}, mapDispatchToProps)(ResponseParent);
