const amqp = require('amqp');
const logger = require('./logger');

let rabbitqueue;
let exchangeName;
let queueName;
let deliveryMode;
let connExchange_;
let connQueue_;
let routing_;
exports.exchangeMapping = {};

//This method registers the hook and try to initialize the connection to rabbitmq server for later use.
exports.register = function() {
    logger.logdebug('About to connect and initialize queue object');
    this.init_rabbitmq_server();
    logger.logdebug(
        `Finished initiating : ${
            exports.exchangeMapping[exchangeName + queueName]
        }`
    );
};

//Actual magic of publishing message to rabbit when email comes happen here.
exports.hook_queue = (next, connection) => {
    //Calling the get_data method and when it gets the data on callback, publish the message to queue with routing key.
    connection.transaction.message_stream.get_data(buffere => {
        const exchangeData = exports.exchangeMapping[exchangeName + queueName];
        logger.logdebug(
            `Sending the data: ${queueName} Routing : ${exchangeData} exchange :${connExchange_}`
        );
        if (connExchange_ && routing_) {
            //This is publish function of rabbitmq amqp library, currently direct queue is configured and routing is fixed.
            //Needs to be changed.
            connExchange_.publish(
                routing_,
                buffere,
                { deliveryMode },
                error => {
                    if (error) {
                        //There was some error while sending the email to queue.
                        logger.logdebug(
                            'queueFailure: #{JSON.stringify(error)}'
                        );
                        exports.init_rabbitmq_server();
                        return next();
                    } else {
                        //Queueing was successful, send ok as reply
                        logger.logdebug('queueSuccess');
                        return next(OK, 'Successfully Queued! in rabbitmq');
                    }
                }
            );
        } else {
            //Seems like connExchange is not defined , lets create one for next call
            exports.init_rabbitmq_server();
            return next();
        }
    });
};

//This initializes the connection to rabbitmq server, It reads values from rabbitmq.ini file in config directory.
exports.init_rabbitmq_server = function() {
    const plugin = this;
    // this is called during init of rabbitmq

    //Read the config file rabbitmq
    const config = plugin.config.get('rabbitmq.ini');
    //Just putting the defaults
    const options = {};
    let confirm = true;
    let durable = true;
    let autoDelete = false;
    let exchangeType = 'direct';

    //Getting the values from config file rabbitmq.ini
    if (config.rabbitmq) {
        options.host = config.rabbitmq.server_ip || '127.0.0.1';
        options.port = config.rabbitmq.server_port || '5672';
        options.login = config.rabbitmq.user || 'guest';
        options.password = config.rabbitmq.password || 'guest';
        exchangeName = config.rabbitmq.exchangeName || 'emailMessages';
        exchangeType = config.rabbitmq.exchangeType || 'direct';
        confirm = config.rabbitmq.confirm === 'true' || true;
        durable = config.rabbitmq.durable === 'true' || true;
        autoDelete = config.rabbitmq.autoDelete === 'true' || false;
        deliveryMode = config.rabbitmq.deliveryMode || 2;
        queueName = config.rabbitmq.queueName || 'emails';
    } else {
        //If config file is not available , lets get the default values
        queueName = 'emails';
        exchangeName = 'emailMessages';
        deliveryMode = 2;
        durable = true;
    }

    //Create connection to the rabbitmq server
    logger.logdebug('About to Create connection with server');
    rabbitqueue = amqp.createConnection(options);

    //Declaring listerner on error on connection.
    rabbitqueue.on('error', error => {
        logger.logdebug(`There was some error on the connection : ${error}`);
    });

    //Declaring listerner on close on connection.
    rabbitqueue.on('close', close => {
        logger.logdebug(` Connection  is beingclosed : ${close}`);
    });

    /* Declaring the function to perform when connection is established and ready, function involves like:
     *    1. Creating or connecting to Exchange.
     *  2. Creating or connecting to Queue.
     *  3. Binding the Exchange and Queue.
     *  4. Saving some variables in global to be used while publishing message.
     */

    rabbitqueue.on('ready', () => {
        logger.logdebug('Connection is ready, will try making exchange');
        // Now connection is ready will try to open exchange with config data.
        rabbitqueue.exchange(
            exchangeName,
            { type: exchangeType, confirm, durable },
            connExchange => {
                logger.logdebug(
                    `connExchange with server ${connExchange} autoDelete : ${autoDelete}`
                );

                //Exchange is now open, will try to open queue.
                return rabbitqueue.queue(
                    queueName,
                    { autoDelete, durable },
                    connQueue => {
                        logger.logdebug(`connQueue with server ${connQueue}`);

                        //Creating the Routing key to bind the queue and exchange.
                        const routing = `${queueName}Routing`;

                        // Will try to bing queue and exchange which was created above.
                        connQueue.bind(connExchange, routing);
                        const key = exchangeName + queueName;

                        //Save the variables for publising later.
                        if (!exports.exchangeMapping[key]) {
                            exports.exchangeMapping[key] = [];
                        }
                        connExchange_ = connExchange;
                        connQueue_ = connQueue;
                        routing_ = routing;
                        exports.exchangeMapping[key].push({
                            exchange: connExchange_,
                            queue: connQueue_,
                            routing: routing_,
                            queueName,
                        });
                        logger.logdebug(
                            `exchange: ${exchangeName}, queue: ${queueName}  exchange : ${connExchange_} queue : ${connQueue_}`
                        );
                    }
                );
            }
        );
    });
};
