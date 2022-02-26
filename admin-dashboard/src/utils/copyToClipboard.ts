/**
 * @param {string} text the content to copy to clipboard
 * @description copies text to clipboard
 */

export default function(text: $TSFixMe) {
    /* Get the text field */
    const el = document.createElement('textarea');
    el.value = text;

    /* make it readonly and hidden from the display */
    el.setAttribute('readonly', '');
    el.style.display = 'hidden';
    document.body.appendChild(el);

    // Check if there is any content selected previously
    // Store selection if found
    const selected =
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        document.getSelection().rangeCount > 0
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            ? document.getSelection().getRangeAt(0)
            : false;

    el.select();
    el.setSelectionRange(0, 99999); /*For mobile devices*/

    document.execCommand('copy');
    document.body.removeChild(el);

    /* If a selection existed before copying;
    Unselect everything on the HTML document;
    Restore the original selection */
    if (selected) {
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        document.getSelection().removeAllRanges();
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        document.getSelection().addRange(selected);
    }
}
