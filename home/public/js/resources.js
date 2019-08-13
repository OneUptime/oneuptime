! function () {
    function n(n, e) {
        $('.hidden', n)
            .eq(e)
            .css({
                transitionDelay: Math.random() + Math.random() + 's',
                transitionDuration: 2 * Math.random() + .2 + 's'
            }), $('.hidden', n)
            .eq(e)
            .attr('class', 'shown')
    }
    
    function e(n, e) {
        if (n.hasClass('is-visible')) {
            var a = $('.shown', n)
                .eq(e);
            a.attr('class', 'hidden'), setTimeout(function () {
                a.attr('class', 'shown')
            }, 3e3)
        }
    }
    $('.card')
        .each(function (e, a) {
            if (window.IntersectionObserver) a.observer = new IntersectionObserver(e => {
                e.forEach(e => {
                    if (e.isIntersecting || e.intersectionRatio > 0) {
                        $(a)
                            .addClass('is-visible');
                        for (var t = $('.hidden', a)
                                .length; t >= 0; t--) n(a, t)
                    } else $(a)
                        .removeClass('is-visible')
                })
            }), a.observer.observe(a);
            else {
                $(a)
                    .addClass('is-visible');
                for (var t = $('.hidden', a)
                        .length; t >= 0; t--) n(a, t)
            }
        }), setInterval(function () {
            var n = $('.card')
                .eq(Math.floor(Math.random() * $('.card')
                    .length));
            e(n, Math.floor(Math.random() * $('.shown', n)
                .length));
            n = $('.card')
                .eq(Math.floor(Math.random() * $('.card')
                    .length));
            e(n, Math.floor(Math.random() * $('.shown', n)
                .length))
        }, 600)
}();
