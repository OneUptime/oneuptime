if (typeof String.prototype.startsWith != 'function') {
    // see below for better implementation!
    String.prototype.startsWith = function (str){
        return this.indexOf(str) === 0;
    };
}

function scrollDivToElement(div, element, moreOffset) {
    var addedPosition = moreOffset ? moreOffset:0;
    firstPosition = div.children().eq(0).offset().top;
    elHeight =  element.height();
    elPosition = element.offset().top;
    div.scrollTop(elHeight + elPosition - firstPosition + addedPosition);
}
$(document).ready(function(){
   $('#navSelect').change(function(){
        var section = this.value.split('-');
        if(this.value.startsWith('cf-section-')){
            window.location.href = section[section.length - 1] + '.html';
        } else if(this.value.startsWith('cf-external-')){
            window.location.href = section[section.length - 1];
        } else {
            window.location.hash = this.value;
        }

    });
    $('.reference-object').click(function(){
        $(this).next('.reference-container').toggleClass('open');
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
$('.dev-doc-item-container').waypoint({
    handler: function(direction) {
        var elementId = this.element.id;
        if(elementId.length){
            var subMenuItem = $('.' + elementId + '.menu-link');
            var subMenuClass = subMenuItem.attr('title');
            var categoryItem = $('.doc-category[title="'+ subMenuClass + '"]');
            $('.menu-link').removeClass('active');
            subMenuItem.addClass('active');
            $('.doc-category').removeClass('active');
            categoryItem.addClass('active');
            $('.' + elementId + '.doc-category').addClass('active');
            $('.category-list').removeClass('open');
            categoryItem.parent().addClass('open');
            //if(categoryItem.length > 0){
            //    scrollDivToElement($('.cf-sidebar'), categoryItem);
            //}
        }
    },
    offset: 100
});

$(function() {
    $('a[href*=#]:not([href=#])').click(function() {
        $('.menu-link').removeClass('active');
        $(this).addClass('active');
        if (location.pathname.replace(/^\//,'') == this.pathname.replace(/^\//,'') && location.hostname == this.hostname) {
            var target = $(this.hash);
            target = target.length ? target : $('[name=' + this.hash.slice(1) +']');
            if (target.length) {
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
var navBar = $('#languageHeader');
var navbarHeight = navBar.outerHeight();
$(window).scroll(function(event){
    didScroll = true;
});
//setInterval(function() {
//    if (didScroll) {
//        hasScrolled();
//        didScroll = false;
//    }
//}, 250);
function hasScrolled() {
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


        this.build = function(base, key, value){
            base[key] = value;
            return base;
        };

        this.push_counter = function(key){
            if(push_counters[key] === undefined){
                push_counters[key] = 0;
            }
            return push_counters[key]++;
        };

        $.each($(this).serializeArray(), function(){

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
})(jQuery);