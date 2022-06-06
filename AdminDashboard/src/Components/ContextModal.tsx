import React from 'react';

export default function (Cm: $TSFixMe) {
    return (props: $TSFixMe) => {
        return ((
            <div className="bs-BIM">
                <div className="ContextualLayer-layer--topleft ContextualLayer-layer--anytop ContextualLayer-layer--anyleft ContextualLayer-context--topleft ContextualLayer-context--anytop ContextualLayer-context--anyleft ContextualLayer-container ContextualLayer--pointerEvents">
                    <Cm {...props} />
                </div>
            </div>
        ).displayName = 'ContextModal');
    };
}
