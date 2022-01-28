===============
Getting started
===============

| A oneuptime sdk for application logger that can be used to send logs about your applications created on your fypie dashboard which can also used for error tracking

Install
-------

To install::

    pip install oneuptime-sdk

Overview
--------

The usual way to use `oneuptime_sdk` application log is something like below::

   from oneuptime_sdk import logger

    # constructor
    oneuptimeLogger = logger.OneUptimeLogger(
        'API_URL', # https://oneuptime.com/api
        'APPLICATION_LOG_ID',
        'APPLICATION_LOG_KEY'
    )

   # Sending a string log to the server

    item = 'This is a simple log'
    response = oneuptimeLogger.log(item)
    print(response)

   # Sending an object log to the server

    item = {
        'user': 'Test User',
        'page': 'Landing Page'
    }

    response = oneuptimeLogger.log(item)
    print(response)


The usual way to use `oneuptime_sdk` error tracker is something like below::

   from oneuptime_sdk import tracker

    # set up tracking configurations    
    options = {
        "maxTimeline": 50,
        "captureCodeSnippet": True
    }   

    # constructor
    oneuptimeTracker = tracker.OneUptimeTracker(
        'API_URL', # https://oneuptime.com/api
        'ERROR_TRACKER_ID',
        'ERROR_TRACKER_KEY',
        options
    )

   # capturing error exception manually and sent to your oneuptime dashboard
    try:
        # your code logic
        result = 5/0 # Should throw a division by zero error
    catch Exception as error:
        oneuptimeTracker.captureException(error)

   

Documentation
-------------

Please, `read documentation here : <README.md>`_