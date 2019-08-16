import React from 'react';
import PropTypes from 'prop-types';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin'

let errorStyle = {
  color: 'red',
  topMargin: '5px'
};

const SubProjectSelector = ({ input, id, className, meta: {touched, error }, subProjects, style }) => (
  <span>
    <select {...input} className={className} id={id} style={style}>
        <option value="">Select Sub-Project</option>
        {
            subProjects.map((subProject)=>(
              <RenderIfSubProjectAdmin subProjectId={subProject._id} key={subProject._id}>
                <option value={subProject._id}>
                    {subProject.name}
                </option>
              </RenderIfSubProjectAdmin>
            ))
        }
    </select>
    {touched && error && <span style={errorStyle}>{error}</span>}
  </span>
)

SubProjectSelector.displayName = 'SubProjectSelector';

SubProjectSelector.propTypes = {
  meta: PropTypes.object.isRequired,
  input: PropTypes.object.isRequired,
  id: PropTypes.string,
  subProjects: PropTypes.array.isRequired,
  className: PropTypes.array.isRequired,
  style: PropTypes.array.isRequired,
}

export default SubProjectSelector