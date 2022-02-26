/*eslint-disable*/
function readConfig(t: $TSFixMe) {
    function n(t: $TSFixMe) {
        return String(t).replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&#x2F;/g, 'index.html').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
    var e = /^[\],:{}\s]*$/,
        i = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,
        o = /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,
        r = /(?:^|:|,)(?:\s*\[)+/g,
        a = document.getElementById(t);
    if (!a) return null;
    var s = n((a.textContent || a.innerHTML).replace(/^\s+|\s+$/gm, ''));
    return e.test(s.replace(i, '@').replace(o, ']').replace(r, '')) ? window.JSON && window.JSON.parse ? window.JSON.parse(s) : new Function('return ' + s)() : void 0
}

function globalNavDropdowns(this: $TSFixMe, t: $TSFixMe) {
    if(!document.querySelector(t)){
        return
    }
    var n = this;
    this.container = document.querySelector(t), this.root = this.container.querySelector('.navRoot'), this.primaryNav = this.root.querySelector('.navSection.primary'), this.primaryNavItem = this.root.querySelector('.navSection.primary .rootLink:last-child'), this.secondaryNavItem = this.root.querySelector('.navSection.secondary .rootLink:first-child'), this.checkCollision(), window.addEventListener('load', this.checkCollision.bind(this)), window.addEventListener('resize', this.checkCollision.bind(this)), this.container.classList.add('noDropdownTransition'), this.dropdownBackground = this.container.querySelector('.dropdownBackground'), this.dropdownBackgroundAlt = this.container.querySelector('.alternateBackground'), this.dropdownContainer = this.container.querySelector('.dropdownContainer'), this.dropdownArrow = this.container.querySelector('.dropdownArrow'), this.dropdownRoots = Strut.queryArray('.hasDropdown', this.root), this.dropdownSections = Strut.queryArray('.dropdownSection', this.container).map(function(t) {
        return {
            el: t,
            name: t.getAttribute('data-dropdown'),
            content: t.querySelector('.dropdownContent')
        }
    });
    var e = window.PointerEvent ? {
        end: 'pointerup',
        enter: 'pointerenter',
        leave: 'pointerleave'
    } : {
        end: 'touchend',
        enter: 'mouseenter',
        leave: 'mouseleave'
    };
    this.dropdownRoots.forEach(function(t: $TSFixMe) {
        t.addEventListener(e.end, function(e: $TSFixMe) {
            e.preventDefault(), e.stopPropagation(), n.toggleDropdown(t)
        }), t.addEventListener(e.enter, function(e: $TSFixMe) {
            'touch' != e.pointerType && (n.stopCloseTimeout(), n.openDropdown(t))
        }), t.addEventListener(e.leave, function(t: $TSFixMe) {
            'touch' != t.pointerType && n.startCloseTimeout()
        })
    }), this.dropdownContainer.addEventListener(e.end, function(t: $TSFixMe) {
        t.stopPropagation()
    }), this.dropdownContainer.addEventListener(e.enter, function(t: $TSFixMe) {
        'touch' != t.pointerType && n.stopCloseTimeout()
    }), this.dropdownContainer.addEventListener(e.leave, function(t: $TSFixMe) {
        'touch' != t.pointerType && n.startCloseTimeout()
    }), document.body.addEventListener(e.end, function() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'touch' does not exist on type '{ random:... Remove this comment to see the full error message
        Strut.touch.isDragging || n.closeDropdown()
    })
}

function globalNavPopup(this: $TSFixMe, t: $TSFixMe) {
    
    if(!document.querySelector(t) || !document.querySelector(t).querySelector('.popup')){
        return
    }

    var n = this,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'touch' does not exist on type '{ random:... Remove this comment to see the full error message
        e = Strut.touch.isSupported ? 'touchend' : 'click';
    this.activeClass = 'globalPopupActive', this.root = document.querySelector(t), this.link = this.root.querySelector('.rootLink'), this.popup = this.root.querySelector('.popup'), this.closeButton = this.root.querySelector('.popupCloseButton'), this.link.addEventListener(e, function(t: $TSFixMe) {
        t.stopPropagation(), n.togglePopup()
    }), this.popup.addEventListener(e, function(t: $TSFixMe) {
        t.stopPropagation()
    }), this.popup.addEventListener('transitionend', function() {
        if (n.isOpening) {
            n.isOpening = !1;
            var t = n.popup.getBoundingClientRect().top + window.scrollY;
            if (t < 15) {
                var e = 15 - t;
                n.popup.style.transform = 'translateY(' + e + 'px)'
            }
        }
    }), this.closeButton && this.closeButton.addEventListener(e, function() {
        n.closeAllPopups()
    }), document.body.addEventListener(e, function() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'touch' does not exist on type '{ random:... Remove this comment to see the full error message
        Strut.touch.isDragging || n.closeAllPopups()
    }, !1)
// @ts-expect-error ts-migrate(2695) FIXME: Left side of comma operator is unused and has no s... Remove this comment to see the full error message
}! function() {
    function t() {
        e(), n()
    }

    function n() {
        o.classList.add('dismissed')
    }

    function e() {
        var t = new Date,
            n = a + '=ack';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setYear' does not exist on type 'Date'.
        t.setYear(t.getFullYear() + 10), n += ';expires=' + t.toGMTString(), n += ';domain=' + document.domain, document.cookie = n
    }

    function i() {
        o = document.querySelector('[rel="cookie-notification"]'), (r = document.querySelector('[rel="dismiss-cookie-notification"]')) && r.addEventListener('click', t)
    }
    var o: $TSFixMe, r, a = 'cookie_banner_ack';
    document.addEventListener('DOMContentLoaded', i)
}(),
function() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property '$' does not exist on type 'Window & type... Remove this comment to see the full error message
    window.$ && window.$.ajaxPrefilter && $(function() {
        var t: $TSFixMe;
        return t = function() {
            var t, n;
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            return t = $('form input[name=csrf-token]'), t.length > 0 ? t.attr('value') : (n = $('meta[name=csrf-token]'), n.length > 0 ? n.attr('content') : '')
        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        }, $.ajaxPrefilter(function(n: $TSFixMe, e: $TSFixMe, i: $TSFixMe) {
            var o;
            return o = t(), i.setRequestHeader('x-oneuptime-csrf-token', o)
        });
    })
}.call(this);
var Strut = {
    random: function(t: $TSFixMe, n: $TSFixMe) {
        return Math.random() * (n - t) + t
    },
    arrayRandom: function(t: $TSFixMe) {
        return t[Math.floor(Math.random() * t.length)]
    },
    interpolate: function(t: $TSFixMe, n: $TSFixMe, e: $TSFixMe) {
        return t * (1 - e) + n * e
    },
    rangePosition: function(t: $TSFixMe, n: $TSFixMe, e: $TSFixMe) {
        return (e - t) / (n - t)
    },
    clamp: function(t: $TSFixMe, n: $TSFixMe, e: $TSFixMe) {
        return Math.max(Math.min(t, e), n)
    },
    queryArray: function(t: $TSFixMe, n: $TSFixMe) {
        return n || (n = document.body), Array.prototype.slice.call(n.querySelectorAll(t))
    },
    ready: function(t: $TSFixMe) {
        'loading' !== document.readyState ? t() : document.addEventListener('DOMContentLoaded', t)
    }
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'isRetina' does not exist on type '{ rand... Remove this comment to see the full error message
Strut.isRetina = window.devicePixelRatio > 1.3, Strut.mobileViewportWidth = 670, Strut.isMobileViewport = window.innerWidth < Strut.mobileViewportWidth, window.addEventListener('resize', function() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isMobileViewport' does not exist on type... Remove this comment to see the full error message
        Strut.isMobileViewport = window.innerWidth < Strut.mobileViewportWidth
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'touch' does not exist on type '{ random:... Remove this comment to see the full error message
    }), Strut.touch = {
        isSupported: 'ontouchstart' in window || navigator.maxTouchPoints,
        isDragging: !1
    }, document.addEventListener('DOMContentLoaded', function() {
        document.body.addEventListener('touchmove', function() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'touch' does not exist on type '{ random:... Remove this comment to see the full error message
            Strut.touch.isDragging = !0
        }), document.body.addEventListener('touchstart', function() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'touch' does not exist on type '{ random:... Remove this comment to see the full error message
            Strut.touch.isDragging = !1
        })
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'load' does not exist on type '{ random: ... Remove this comment to see the full error message
    }), Strut.load = {
        images: function(t: $TSFixMe, n: $TSFixMe) {
            'string' == typeof t && (t = [t]);
            var e = -t.length;
            t.forEach(function(t: $TSFixMe) {
                var i = new Image;
                i.src = t, i.onload = function() {
                    0 === ++e && n && n()
                }
            })
        },
        css: function(t: $TSFixMe, n: $TSFixMe) {
            var e = document.createElement('link'),
                i = window.readConfig('strut_files') || {},
                o = i[t];
            if (!o) throw new Error('CSS file "' + t + '" not found in strut_files config');
            e.href = o, e.rel = 'stylesheet', document.head.appendChild(e), n && (e.onload = n)
        },
        js: function(t: $TSFixMe, n: $TSFixMe) {
            var e = document.createElement('script'),
                i = window.readConfig('strut_files') || {},
                o = i[t];
            if (!o) throw new Error('Javascript file "' + t + '" not found in strut_files config');
            e.src = o, e.async = !1, document.head.appendChild(e), n && (e.onload = n)
        }
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'supports' does not exist on type '{ rand... Remove this comment to see the full error message
    }, Strut.supports = {
        es6: function() {
            try {
                return new Function('(a = 0) => a'), !0
            } catch (t) {
                return !1
            }
        }(),
        pointerEvents: function() {
            var t = document.createElement('a').style;
            return t.cssText = 'pointer-events:auto', 'auto' === t.pointerEvents
        }(),
        positionSticky: Boolean(window.CSS && CSS.supports('(position: -webkit-sticky) or (position: sticky)')),
        masks: function() {
            return !/MSIE|Trident|Edge/i.test(navigator.userAgent);
        }()
    }, globalNavDropdowns.prototype.checkCollision = function() {
        var t = this;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isMobileViewport' does not exist on type... Remove this comment to see the full error message
        if (!Strut.isMobileViewport)
            if (1 == t.compact) {
                var n = document.body.clientWidth,
                    e = t.primaryNav.getBoundingClientRect();
                e.left + e.width / 2 > n / 2 && (t.container.classList.remove('compact'), t.compact = !1)
            } else {
                var i = t.primaryNavItem.getBoundingClientRect(),
                    o = t.secondaryNavItem.getBoundingClientRect();
                i.right > o.left && (t.container.classList.add('compact'), t.compact = !0)
            }
    }, globalNavDropdowns.prototype.openDropdown = function(t: $TSFixMe) {
        var n = this;
        if (this.activeDropdown !== t) {
            this.container.classList.add('overlayActive'), this.container.classList.add('dropdownActive'), this.activeDropdown = t, this.dropdownRoots.forEach(function(t: $TSFixMe) {
                t.classList.remove('active')
            }), t.classList.add('active');
            var e, i, o, r = t.getAttribute('data-dropdown'),
                a = 'left';
            this.dropdownSections.forEach(function(t: $TSFixMe) {
                t.el.classList.remove('active'), t.el.classList.remove('left'), t.el.classList.remove('right'), t.name == r ? (t.el.classList.add('active'), a = 'right', e = t.content.offsetWidth, i = t.content.offsetHeight, t.content.getAttribute('data-fixed') ? t.content.setAttribute('data-fixed', !0) : (t.content.style.width = e + 'px', t.content.style.height = i + 'px'), o = t.content) : t.el.classList.add(a)
            });
            var s = 380,
                c = 400,
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                d = e / s,
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                l = i / c,
                u = t.getBoundingClientRect(),
                // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
                p = u.left + u.width / 2 - e / 2;
            p = Math.round(Math.max(p, 10)), clearTimeout(this.disableTransitionTimeout), this.enableTransitionTimeout = setTimeout(function() {
                n.container.classList.remove('noDropdownTransition')
            }, 50), this.dropdownBackground.style.transform = 'translateX(' + p + 'px) scaleX(' + d + ') scaleY(' + l + ')', this.dropdownContainer.style.transform = 'translateX(' + p + 'px)', this.dropdownContainer.style.width = e + 'px', this.dropdownContainer.style.height = i + 'px';
            var w = Math.round(u.left + u.width / 2);
            this.dropdownArrow.style.transform = 'translateX(' + w + 'px) rotate(45deg)';
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            var f = o.children[0].offsetHeight / l;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalytics' does not exist on type 'W... Remove this comment to see the full error message
            this.dropdownBackgroundAlt.style.transform = 'translateY(' + f + 'px)', window.siteAnalytics && window.siteAnalytics.trackGlobalNavDropdownOpen && window.siteAnalytics.trackGlobalNavDropdownOpen(r)
        }
    }, globalNavDropdowns.prototype.closeDropdown = function() {
        var t = this;
        this.activeDropdown && (this.dropdownRoots.forEach(function(t: $TSFixMe) {
            t.classList.remove('active')
        }), clearTimeout(this.enableTransitionTimeout), this.disableTransitionTimeout = setTimeout(function() {
            t.container.classList.add('noDropdownTransition')
        }, 50), this.container.classList.remove('overlayActive'), this.container.classList.remove('dropdownActive'), this.activeDropdown = undefined)
    }, globalNavDropdowns.prototype.toggleDropdown = function(t: $TSFixMe) {
        this.activeDropdown === t ? this.closeDropdown() : this.openDropdown(t)
    }, globalNavDropdowns.prototype.startCloseTimeout = function() {
        var t = this;
        t.closeDropdownTimeout = setTimeout(function() {
            t.closeDropdown()
        }, 50)
    }, globalNavDropdowns.prototype.stopCloseTimeout = function() {
        var t = this;
        clearTimeout(t.closeDropdownTimeout)
    }, globalNavPopup.prototype.togglePopup = function() {
        var t = this.root.classList.contains(this.activeClass);
        this.closeAllPopups(!0), t || (this.root.classList.add(this.activeClass), this.isOpening = !0)
    }, globalNavPopup.prototype.closeAllPopups = function() {
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        for (var t = document.getElementsByClassName(this.activeClass), n = 0; n < t.length; n++) t[n].querySelector('.popup').style.transform = null, t[n].classList.remove(this.activeClass)
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'supports' does not exist on type '{ rand... Remove this comment to see the full error message
    }, Strut.supports.pointerEvents || Strut.load.css('v3/shared/navigation_ie10.html'), Strut.ready(function() {
        // @ts-expect-error ts-migrate(7009) FIXME: 'new' expression, whose target lacks a construct s... Remove this comment to see the full error message
        new globalNavDropdowns('.globalNav'), new globalNavPopup('.globalNav .navSection.mobile'), new globalNavPopup('.globalFooterNav .select.country'), new globalNavPopup('.globalFooterNav .select.language')
    }),
    function() {
        'use strict';

        function t() {
            var t = [].slice.call(arguments);
            o() && console.log.apply(console, t)
        }

        function n() {
            var t = {},
                n = document.getElementById('site-analytics-config');
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | null' is not assignable... Remove this comment to see the full error message
            return n && (t = JSON.parse(n.textContent)), t
        }

        function e() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'generalAnalyticsConfig' does not exist o... Remove this comment to see the full error message
            return n().generalAnalyticsConfig || {}
        }

        function i() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteSpecificAnalyticsConfig' does not ex... Remove this comment to see the full error message
            return n().siteSpecificAnalyticsConfig || {}
        }

        function o() {
            // @ts-expect-error ts-migrate(7015) FIXME: Element implicitly has an 'any' type because index... Remove this comment to see the full error message
            return !!window[b]
        }

        function r(t: $TSFixMe, n: $TSFixMe) {
            d('action', t, n)
        }

        function a(t: $TSFixMe, n: $TSFixMe) {
            d('actionOnce', t, n)
        }

        function s(t: $TSFixMe, n: $TSFixMe) {
            d('modal', t, n)
        }

        function c(t: $TSFixMe, n: $TSFixMe) {
            d('viewed', t, n)
        }

        function d(t: $TSFixMe, n: $TSFixMe, e: $TSFixMe) {
            window.Analytics ? l(t, n, e) : p(t, n, e)
        }

        function l(n: $TSFixMe, e: $TSFixMe, i: $TSFixMe) {
            u();
            var o = f(i);
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            window.Analytics[n](e, o), t('emit', n, e, o)
        }

        function u() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'configure' does not exist on type '{}'.
            A || (window.Analytics.configure(e()), A = !0, t('Sent config data'))
        }

        function p(n: $TSFixMe, e: $TSFixMe, i: $TSFixMe) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 0 arguments, but got 4.
            S.push([n, e, i]), g(), t('enqueue', n, e, i)
        }

        function w() {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 0 arguments, but got 1.
            t('Flushing event queue'), u(), S.forEach(function(this: $TSFixMe, t) {
                l.apply(this, t)
            })
        }

        function f(t: $TSFixMe) {
            var n = e();
            return Object.keys(t || {}).forEach(function(e) {
                n[e] = t[e]
            }), n
        }

        function g() {
            v || (v = setTimeout(m, L), L *= k)
        }

        function m() {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 0 arguments, but got 1.
            v = null, window.Analytics ? (w(), L = E) : (g(), t('Ready timer waiting ' + L + 'ms'))
        }

        function y(this: $TSFixMe, t: $TSFixMe) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ga' does not exist on type 'Window & typ... Remove this comment to see the full error message
            window.ga && window.ga.apply(this, t)
        }

        function h() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            window.siteAnalyticsUtil.analyticsConfigData || (g(), window.siteAnalyticsUtil.debugActive = o, window.siteAnalyticsUtil.emitAction = r, window.siteAnalyticsUtil.emitActionOnce = a, window.siteAnalyticsUtil.emitModal = s, window.siteAnalyticsUtil.emitViewed = c, window.siteAnalyticsUtil.siteAnalyticsConfig = i, window.siteAnalyticsUtil.sendToGoogleAnalytics = y, window.siteAnalyticsUtil.generalAnalyticsConfig = e)
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalytics' does not exist on type 'W... Remove this comment to see the full error message
        window.siteAnalytics = window.siteAnalytics || {}, window.siteAnalyticsUtil = window.siteAnalyticsUtil || {};
        var v: $TSFixMe, A = !1,
            b = 'SITE_ANALYTICS_DEBUG',
            S: $TSFixMe = [],
            E = 250,
            L = E,
            k = 1.3;
        h()
    }(),
    function() {
        function t(t: $TSFixMe) {
            var e = n(t),
                i = {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'action' does not exist on type '{}'.
            return e.getAttribute(r) && (i.action = e.getAttribute(r)), e.getAttribute(s) && (i.modal = e.getAttribute(s)), e.getAttribute(a) && (i.params = {
                source: e.getAttribute(a)
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'googleAnalyticsParams' does not exist on... Remove this comment to see the full error message
            }), e.getAttribute(c) && (i.googleAnalyticsParams = JSON.parse(e.getAttribute(c))), i
        }

        // @ts-expect-error ts-migrate(7023) FIXME: 'n' implicitly has return type 'any' because it do... Remove this comment to see the full error message
        function n(t: $TSFixMe) {
            return t.getAttribute(r) || t.getAttribute(s) ? t : t.parentNode && 'BODY' !== t.tagName ? n(t.parentNode) : null
        }

        function e(t: $TSFixMe) {
            return !!n(t)
        }

        function i(n: $TSFixMe) {
            var e = t(n);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'modal' does not exist on type '{}'.
            e.modal && window.siteAnalyticsUtil.emitModal(e.modal, e.params), e.action && window.siteAnalyticsUtil.emitAction(e.action, e.params), e.googleAnalyticsParams && window.siteAnalyticsUtil.sendToGoogleAnalytics(e.googleAnalyticsParams)
        }

        function o() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalytics' does not exist on type 'W... Remove this comment to see the full error message
            window.siteAnalytics.hasAnalyticsAttributes = e, window.siteAnalytics.trackByAttributes = i
        }
        var r = 'data-analytics-action',
            a = 'data-analytics-source',
            s = 'data-analytics-modal',
            c = 'data-analytics-ga';
        o()
    }(),
    function() {
        function t(t: $TSFixMe) {
            return t.matches('form *')
        }

        function n(n: $TSFixMe) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            t(n.target) && window.siteAnalyticsUtil.emitAction(o, {
                name: n.target.getAttribute('name'),
                value: n.target.value
            })
        }

        function e(t: $TSFixMe) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            'FORM' === t.target.tagName && window.siteAnalyticsUtil.emitAction(r)
        }

        function i() {
            document.addEventListener('change', n), document.addEventListener('submit', e)
        }
        var o = 'form_input',
            r = 'form_submit';
        i()
    }(),
    function() {
        function t(t: $TSFixMe) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            i[t] || (i[t] = !0, window.siteAnalyticsUtil.emitAction(e, {
                dropdown: t
            }))
        }

        function n() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalytics' does not exist on type 'W... Remove this comment to see the full error message
            window.siteAnalytics.trackGlobalNavDropdownOpen = t
        }
        var e = 'nav_dropdown_open',
            i = {};
        n()
    }(),
    function() {
        function t() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            window.siteAnalyticsUtil.emitActionOnce(c)
        }

        function n() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            window.siteAnalyticsUtil.emitActionOnce(d)
        }

        function e(t: $TSFixMe) {
            var n = t.innerText.trim().toLowerCase();
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            f[n] || (f[n] = !0, window.siteAnalyticsUtil.emitAction(l, {
                text: n
            }))
        }

        function i(t: $TSFixMe) {
            var n = t.innerText.trim().toLowerCase();
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            g[n] || (f[n] = !0, window.siteAnalyticsUtil.emitAction(u, {
                text: n
            }))
        }

        function o(t: $TSFixMe) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            window.siteAnalyticsUtil.emitAction(p, {
                category: t
            })
        }

        function r(t: $TSFixMe) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            window.siteAnalyticsUtil.emitAction(p, {
                query: t
            })
        }

        function a() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            window.siteAnalyticsUtil.emitActionOnce(w)
        }

        function s() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalytics' does not exist on type 'W... Remove this comment to see the full error message
            window.siteAnalytics.trackConnectRoutingDiagram = i, window.siteAnalytics.trackHomePageNotebook = e, window.siteAnalytics.trackRadarIcosahedron = t, window.siteAnalytics.trackRadarFraudChart = n, window.siteAnalytics.trackSigmaQueryCategory = o, window.siteAnalytics.trackSigmaQueryExample = r, window.siteAnalytics.trackSigmaPricingSlider = a
        }
        var c = 'radar_icosahedron',
            d = 'radar_fraud_chart',
            l = 'home_page_notebook',
            u = 'connect_routing_diagram',
            p = 'query_category',
            w = 'pricing_slider',
            f = {},
            g = {};
        s()
    }(),
    function() {
        function t(t: $TSFixMe) {
            return !!t.getAttribute('href')
        }

        function n(t: $TSFixMe) {
            return t.trim().replace(/\s+/g, ' ');
        }

        function e(t: $TSFixMe) {
            var n = t.className.toLowerCase(),
                e = t.getAttribute('href');
            return /\.pdf$|\.pdf#|\.pdf\?/i.test(t.href) ? d : -1 !== n.indexOf('button') || '#' === e ? c : s;
        }

        function i(t: $TSFixMe) {
            var i = e(t),
                o = {
                    text: n(t.innerText)
                };
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            window.siteAnalyticsUtil.emitAction(i, o)
        }

        // @ts-expect-error ts-migrate(7023) FIXME: 'o' implicitly has return type 'any' because it do... Remove this comment to see the full error message
        function o(t: $TSFixMe) {
            return 'A' === t.tagName ? t : t.parentNode ? o(t.parentNode) : null
        }

        function r(n: $TSFixMe) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalytics' does not exist on type 'W... Remove this comment to see the full error message
            if (window.siteAnalytics.hasAnalyticsAttributes(n.target)) return void window.siteAnalytics.trackByAttributes(n.target);
            var e = o(n.target);
            e && t(e) && i(e)
        }

        function a() {
            document.addEventListener('click', r)
        }
        var s = 'inline_link',
            c = 'button',
            d = 'pdf_link';
        a()
    }(),
    function() {
        function t() {
            if (n()) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
                var t = window.siteAnalyticsUtil.generalAnalyticsConfig(),
                    e = document.documentElement.id;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
                window.siteAnalyticsUtil.emitViewed(e, t)
            }
        }

        function n() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            return !!document.documentElement.id && !!window.siteAnalyticsUtil.siteAnalyticsConfig().trackPageViewed
        }

        function e() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalytics' does not exist on type 'W... Remove this comment to see the full error message
            window.siteAnalytics.pageLoadTracking || (window.siteAnalytics.pageLoadTracking = {
                trackPageView: t
            }, window.addEventListener('load', t))
        }
        e()
    }(),
    function() {
        function t(t: $TSFixMe) {
            return i(d, t)
        }

        function n(t: $TSFixMe) {
            return i(u, t)
        }

        function e(t: $TSFixMe) {
            return i(l, t)
        }

        function i(t: $TSFixMe, n: $TSFixMe) {
            var e = n;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalyticsUtil' does not exist on typ... Remove this comment to see the full error message
            'string' != typeof n && (e = r(n)), window.siteAnalyticsUtil.emitAction(t, {
                video: e
            })
        }

        function o(t: $TSFixMe) {
            return t.currentSrc || t.getAttribute('src') || t.querySelector('source').getAttribute('src')
        }

        function r(t: $TSFixMe) {
            var n = o(t),
                e = n.slice(n.lastIndexOf('index.html') + 1);
            return e.slice(0, e.lastIndexOf('.'))
        }

        function a(t: $TSFixMe) {
            'VIDEO' === t.target.tagName && n(t.target)
        }

        function s(t: $TSFixMe) {
            'VIDEO' === t.target.tagName && e(t.target)
        }

        function c() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'siteAnalytics' does not exist on type 'W... Remove this comment to see the full error message
            document.addEventListener('play', a, !0), document.addEventListener('ended', s, !0), window.siteAnalytics.trackVideoExpand = t, window.siteAnalytics.trackVideoPlay = n, window.siteAnalytics.trackVideoEnd = e
        }
        var d = 'video_expand',
            l = 'video_end',
            u = 'video_play';
        c()
    }();

    