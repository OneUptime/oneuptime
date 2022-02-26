// @ts-expect-error ts-migrate(1345) FIXME: An expression of type 'void' cannot be tested for ... Remove this comment to see the full error message
! function () {
    function n(n: $TSFixMe, e: $TSFixMe) {
        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $('.hidden', n)
            .eq(e)
            .css({
                transitionDelay: Math.random() + Math.random() + 's',
                transitionDuration: 2 * Math.random() + .2 + 's'
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            }), $('.hidden', n)
            .eq(e)
            .attr('class', 'shown')
    }
    
    function e(n: $TSFixMe, e: $TSFixMe) {
        if (n.hasClass('is-visible')) {
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            const a = $('.shown', n)
                .eq(e);
            a.attr('class', 'hidden'), setTimeout(function () {
                a.attr('class', 'shown')
            }, 3e3)
        }
    }
    // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
    $('.card')
        .each(function (e: $TSFixMe, a: $TSFixMe) {
            if (window.IntersectionObserver) a.observer = new IntersectionObserver(e => {
                e.forEach(e => {
                    if (e.isIntersecting || e.intersectionRatio > 0) {
                        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
                        $(a)
                            .addClass('is-visible');
                        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
                        for (let t = $('.hidden', a)
                                .length; t >= 0; t--) n(a, t)
                    // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
                    } else $(a)
                        .removeClass('is-visible')
                })
            }), a.observer.observe(a);
            else {
                // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
                $(a)
                    .addClass('is-visible');
                // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
                for (let t = $('.hidden', a)
                        .length; t >= 0; t--) n(a, t)
            }
        }), setInterval(function () {
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            let n = $('.card')
                // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
                .eq(Math.floor(Math.random() * $('.card')
                    .length));
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            e(n, Math.floor(Math.random() * $('.shown', n)
                .length));
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            n = $('.card')
                // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
                .eq(Math.floor(Math.random() * $('.card')
                    .length));
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            e(n, Math.floor(Math.random() * $('.shown', n)
                .length))
        }, 600)
}();
