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

The usual way to use `fyipe_sdk` is something like below::

   from fyipe_sdk import FyipeLogger

    # constructor
    logger = FyipeLogger(
        'API_URL', # https://fyipe.com/api
        'APPLICATION_LOG_ID',
        'APPLICATION_LOG_KEY'
    )

   # Sending a string log to the server

    item = 'This is a simple log'
    response = logger.log(item)
    print(response)

   # Sending an object log to the server

    item = {
        'user': 'Test User',
        'page': 'Landing Page'
    }

    response = logger.log(item)
    print(response)

   

Documentation
-------------

Please, `read documentation here : <README.md>`_