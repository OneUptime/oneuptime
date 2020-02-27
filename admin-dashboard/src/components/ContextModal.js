import React from 'react';

export default function(Cm) {
    return props =>
        ((
            <div className="bs-BIM">
                <div className="ContextualLayer-layer--topleft ContextualLayer-layer--anytop ContextualLayer-layer--anyleft ContextualLayer-context--topleft ContextualLayer-context--anytop ContextualLayer-context--anyleft ContextualLayer-container ContextualLayer--pointerEvents">
                    <Cm {...props} />
                </div>
            </div>
        ).displayName = 'ContextModal');
}
