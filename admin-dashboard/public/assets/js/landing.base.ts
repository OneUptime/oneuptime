$(document).ready(function() {
  setTimeout(()=>{
      $('div.bar').tipsy({
        gravity: 'se',
        html: true,
        offset: 1
      });
    },1000);
});