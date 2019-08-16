import React from 'react';

 export default function (CM){
    return (props) => (
        <div className="bs-BIM">
            <div
                className="ContextualLayer-layer--topleft ContextualLayer-layer--anytop ContextualLayer-layer--anyleft ContextualLayer-context--topleft ContextualLayer-context--anytop ContextualLayer-context--anyleft ContextualLayer-container ContextualLayer--pointerEvents"
            >
                <CM {...props} />
            </div>
        </div>
    ).displayName = 'ContextModal'
}

