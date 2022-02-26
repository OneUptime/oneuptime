// @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
$(document).ready(function() {
    setTimeout(() => {
        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $('div.bar').tipsy({
            gravity: 'se',
            html: true,
            offset: 1,
        });
    }, 1000);
});
