import React from 'react';

export default function(Cm: $TSFixMe) {
    return (props: $TSFixMe) => (
            <div className="bs-BIM">
                <div className="ContextualLayer-layer--topleft ContextualLayer-layer--anytop ContextualLayer-layer--anyleft ContextualLayer-context--topleft ContextualLayer-context--anytop ContextualLayer-context--anyleft ContextualLayer-container ContextualLayer--pointerEvents">
                    <Cm {...props} />
                </div>
            </div>
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'Ele... Remove this comment to see the full error message
        ).displayName = 'ContextModal';
}
