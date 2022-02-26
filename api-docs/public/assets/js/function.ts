if (typeof String.prototype.startsWith != 'function') {
    // see below for better implementation!
    String.prototype.startsWith = function (str){
        return this.indexOf(str) === 0;
    };
}

function scrollDivToElement(div: $TSFixMe, element: $TSFixMe, moreOffset: $TSFixMe) {
    var addedPosition = moreOffset ? moreOffset:0;
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'firstPosition'.
    firstPosition = div.children().eq(0).offset().top;
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'elHeight'.
    elHeight =  element.height();
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'elPosition'.
    elPosition = element.offset().top;
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'elHeight'.
    div.scrollTop(elHeight + elPosition - firstPosition + addedPosition);
}
// @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
$(document).ready(function(){
   // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
   $('#navSelect').change(function(this: $TSFixMe) {
        var section = this.value.split('-');
        if(this.value.startsWith('cf-section-')){
            window.location.href = section[section.length - 1] + '.html';
        } else if(this.value.startsWith('cf-external-')){
            window.location.href = section[section.length - 1];
        } else {
            window.location.hash = this.value;
        }

    });
    // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
    $('.reference-object').click(function(this: $TSFixMe) {
        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $(this).next('.reference-container').toggleClass('open');
        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $(this).children().children().children('.object-arrow').toggleClass('rotate');
    });

});
// window.addEventListener('orientationchange', function(){
//     var exampleContainerWidth = $('.dev-doc-example').width();
//     var docItemContainerWidth = $('.dev-doc-item').width() + 55;
//     var languageHeader = $('#languageHeader');
//     var navigationHeader = $('#navigationHeader');
//     languageHeader.css({width: exampleContainerWidth + 'px'});
//     navigationHeader.css({width: docItemContainerWidth + 'px'});
// });
// @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
$('.dev-doc-item-container').waypoint({
    handler: function(direction: $TSFixMe) {
        var elementId = this.element.id;
        if(elementId.length){
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            var subMenuItem = $('.' + elementId + '.menu-link');
            var subMenuClass = subMenuItem.attr('title');
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            var categoryItem = $('.doc-category[title="'+ subMenuClass + '"]');
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            $('.menu-link').removeClass('active');
            subMenuItem.addClass('active');
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            $('.doc-category').removeClass('active');
            categoryItem.addClass('active');
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            $('.' + elementId + '.doc-category').addClass('active');
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            $('.category-list').removeClass('open');
            categoryItem.parent().addClass('open');
            //if(categoryItem.length > 0){
            //    scrollDivToElement($('.cf-sidebar'), categoryItem);
            //}
        }
    },
    offset: 100
});

// @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
$(function() {
    // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
    $('a[href*=#]:not([href=#])').click(function(this: $TSFixMe) {
        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $('.menu-link').removeClass('active');
        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        $(this).addClass('active');
        if (location.pathname.replace(/^\//,'') == this.pathname.replace(/^\//,'') && location.hostname == this.hostname) {
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            var target = $(this.hash);
            // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
            target = target.length ? target : $('[name=' + this.hash.slice(1) +']');
            if (target.length) {
                // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
                $('html,body').animate({
                    scrollTop: target.offset().top
                }, 0);
                return false;
            }
        }
    });
});
// Hide Header on on scroll down
var didScroll;
var lastScrollTop = 0;
var delta = 5;
// @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
var navBar = $('#languageHeader');
var navbarHeight = navBar.outerHeight();
// @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
$(window).scroll(function(event: $TSFixMe){
    didScroll = true;
});
//setInterval(function() {
//    if (didScroll) {
//        hasScrolled();
//        didScroll = false;
//    }
//}, 250);
function hasScrolled(this: $TSFixMe) {
    // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
    var st = $(this).scrollTop();
    // Make sure they scroll more than delta
    if(Math.abs(lastScrollTop - st) <= delta)
        return;
    // If they scrolled down and are past the navbar, add class .nav-up.
    // This is necessary so you never see what is "behind" the navbar.
    if (st > lastScrollTop && st > navbarHeight){
        // Scroll Down

        navBar.removeClass('nav-down').addClass('nav-up');
    } else {
        // Scroll Up
        // @ts-expect-error ts-migrate(2581) FIXME: Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        if(st + $(window).height() < $(document).height()) {
            navBar.removeClass('nav-up').addClass('nav-down');
        }
    }
    lastScrollTop = st;
}

(function($){
    $.fn.serializeObject = function(){

        var self = this,
            json = {},
            push_counters = {},
            patterns = {
                "validate": /^[a-zA-Z][a-zA-Z0-9_]*(?:\[(?:\d*|[a-zA-Z0-9_]+)\])*$/,
                "key":      /[a-zA-Z0-9_]+|(?=\[\])/g,
                "push":     /^$/,
                "fixed":    /^\d+$/,
                "named":    /^[a-zA-Z0-9_]+$/
            };


        this.build = function(base: $TSFixMe, key: $TSFixMe, value: $TSFixMe){
            base[key] = value;
            return base;
        };

        this.push_counter = function(key: $TSFixMe){
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            if(push_counters[key] === undefined){
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                push_counters[key] = 0;
            }
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            return push_counters[key]++;
        };

        $.each($(this).serializeArray(), function(this: $TSFixMe) {

            // skip invalid keys
            if(!patterns.validate.test(this.name)){
                return;
            }

            var k,
                keys = this.name.match(patterns.key),
                merge = this.value,
                reverse_key = this.name;

            while((k = keys.pop()) !== undefined){

                // adjust reverse_key
                reverse_key = reverse_key.replace(new RegExp("\\[" + k + "\\]$"), '');

                // push
                if(k.match(patterns.push)){
                    merge = self.build([], self.push_counter(reverse_key), merge);
                }

                // fixed
                else if(k.match(patterns.fixed)){
                    merge = self.build([], k, merge);
                }

                // named
                else if(k.match(patterns.named)){
                    merge = self.build({}, k, merge);
                }
            }

            json = $.extend(true, json, merge);
        });

        return json;
    };
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jQuery'.
})(jQuery);