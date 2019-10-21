import React from 'react';
import PropTypes from 'prop-types'
import { Field } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import RemoveSubProject from '../modals/RemoveSubProject';
import uuid from 'uuid';

const removeModalId = uuid.v4();
const SubProject = ({ fields, meta: { error, submitFailed }, ...props }) => {
    return (
        <ul>
            {
                fields.map((val, i) => {
                    return (
                        <li key={i}>
                            <div className="bs-Fieldset-row">
                                <label className="bs-Fieldset-label">Sub Project Name</label>
                                <div className="bs-Fieldset-fields">
                                    <Field
                                        id={`sub_project_name_${i}`}
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        type="text"
                                        name={`${val}.name`}
                                        component="input"
                                        placeholder="Home"
                                    />
                                </div>
                            </div>
                                <div className="bs-Fieldset-row">
                                    <label className="bs-Fieldset-label"></label>
                                    <div className="bs-Fieldset-fields">
                                        <div className="Box-root Flex-flex Flex-alignItems--center">
                                            <button
                                                id={`btnRemoveSubproject${i}`}
                                                className="bs-Button bs-DeprecatedButton"
                                                type="button"
                                                onClick={() => {
                                                    if(fields.get(i)._id){
                                                        props.openModal({
                                                            id: removeModalId,
                                                            onClose: () => '',
                                                            onConfirm: () => {
                                                                return new Promise((resolve)=>{
                                                                    fields.remove(i)
                                                                    resolve(true)
                                                                })
                                                            },
                                                            content: RemoveSubProject
                                                        })      
                                                    }else{
                                                        fields.remove(i)
                                                    }
                                                }
                                                }
                                            >
                                                Remove
                                            </button>
                                        
                                        </div>
                                    </div>
                                </div>
                        </li>
                    )
                })
            }

            <li>
                <div className="bs-Fieldset-row">
                    <label className="bs-Fieldset-label"></label>
                    <div className="bs-Fieldset-fields">
                        <div className="Box-root Flex-flex Flex-alignItems--center">
                            <div>

                                    <button
                                        id="btnAddSubProjects"
                                        type="button"
                                        className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                        onClick={() => fields.push({name: ''})}
                                    >
                                        Add Subproject
                                    </button>
                                    <ShouldRender if={submitFailed && error}>
                                        <span>{error}</span>
                                    </ShouldRender>

                            </div>
                        </div>
                        <p className="bs-Fieldset-explanation">
                            <span>
                                You can add any number of sub projects for this Fyipe Project.
                            </span>
                        </p>
                    </div>
                </div>
            </li>
        </ul>
    )
}

SubProject.displayName = 'SubProject'

const mapStateToProps = () => {
    return {}
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {
        openModal,
        closeModal,
    }, dispatch
)

SubProject.propTypes = {
    meta: PropTypes.object.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired,
    openModal: PropTypes.func.isRequired
}

export default connect(mapStateToProps, mapDispatchToProps)(SubProject)