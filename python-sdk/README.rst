===============
Getting started
===============

| A fyipe sdk for application logger that can be used to send logs about your applications created on your fypie dashboard which can also used for error tracking

Install
-------

To install::

    pip install fyipe-sdk

Overview
--------

The usual way to use `fyipe_sdk` application log is something like below::

   from fyipe_sdk import logger

    # constructor
    fyipeLogger = logger.FyipeLogger(
        'API_URL', # https://fyipe.com/api
        'APPLICATION_LOG_ID',
        'APPLICATION_LOG_KEY'
    )

   # Sending a string log to the server

    item = 'This is a simple log'
    response = fyipeLogger.log(item)
    print(response)

   # Sending an object log to the server

    item = {
        'user': 'Test User',
        'page': 'Landing Page'
    }

    response = fyipeLogger.log(item)
    print(response)


The usual way to use `fyipe_sdk` error tracker is something like below::

   from fyipe_sdk import tracker

    # set up tracking configurations    
    options = {
        "maxTimeline": 50,
        "captureCodeSnippet": True
    }   

    # constructor
    fyipeTracker = tracker.FyipeTracker(
        'API_URL', # https://fyipe.com/api
        'ERROR_TRACKER_ID',
        'ERROR_TRACKER_KEY',
        options
    )

   # capturing error exception manually and sent to your fyipe dashboard
    try:
        # your code logic
        result = 5/0 # Should throw a division by zero error
    catch Exception as error:
        fyipeTracker.captureException(error)

   

Documentation
-------------

Please, `read documentation here : <README.md>`_