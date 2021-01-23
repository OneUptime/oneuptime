// process_title

const outbound = require('./outbound');

function setupInterval(title, server) {
    // Set up a timer to update title
    return setInterval(() => {
        // Connections per second
        const av_cps =
            Math.round((server.notes.pt_connections / process.uptime()) * 100) /
            100;
        const cps = server.notes.pt_connections - server.notes.pt_cps_diff;
        if (cps > server.notes.pt_cps_max) server.notes.pt_cps_max = cps;
        server.notes.pt_cps_diff = server.notes.pt_connections;
        // Recipients per second
        const av_rps =
            Math.round((server.notes.pt_recipients / process.uptime()) * 100) /
            100;
        const rps = server.notes.pt_recipients - server.notes.pt_rps_diff;
        if (rps > server.notes.pt_rps_max) server.notes.pt_rps_max = rps;
        server.notes.pt_rps_diff = server.notes.pt_recipients;
        // Recipients per message
        const rpm =
            Math.round(
                (server.notes.pt_recipients / server.notes.pt_messages) * 100
            ) / 100 || 0;
        // Messages per second
        const av_mps =
            Math.round((server.notes.pt_messages / process.uptime()) * 100) /
            100;
        const mps = server.notes.pt_messages - server.notes.pt_mps_diff;
        if (mps > server.notes.pt_mps_max) server.notes.pt_mps_max = mps;
        server.notes.pt_mps_diff = server.notes.pt_messages;
        // Messages per connection
        const mpc =
            Math.round(
                (server.notes.pt_messages / server.notes.pt_connections) * 100
            ) / 100 || 0;

        const out = server.notes.pt_out_stats || outbound.get_stats();
        if (/\(worker\)/.test(title)) {
            process.send({ event: 'process_title.outbound_stats', data: out });
        }
        // Update title
        let new_title = `${title} cn=${server.notes.pt_connections} cc=${server.notes.pt_concurrent} cps=${cps}/${av_cps}/${server.notes.pt_cps_max} rcpts=${server.notes.pt_recipients}/${rpm} rps=${rps}/${av_rps}/${server.notes.pt_rps_max} msgs=${server.notes.pt_messages}/${mpc} mps=${mps}/${av_mps}/${server.notes.pt_mps_max} out=${out} `;
        if (/\(master\)/.test(title)) {
            new_title += `respawn=${server.notes.pt_child_exits} `;
        }
        process.title = new_title;
    }, 1000);
}

exports.hook_init_master = function(next, server) {
    server.notes.pt_connections = 0;
    server.notes.pt_concurrent = 0;
    server.notes.pt_cps_diff = 0;
    server.notes.pt_cps_max = 0;
    server.notes.pt_recipients = 0;
    server.notes.pt_rps_diff = 0;
    server.notes.pt_rps_max = 0;
    server.notes.pt_messages = 0;
    server.notes.pt_mps_diff = 0;
    server.notes.pt_mps_max = 0;
    server.notes.pt_child_exits = 0;
    let title = 'Haraka';
    if (server.cluster) {
        title = 'Haraka (master)';
        process.title = title;
        server.notes.pt_concurrent_cluster = {};
        server.notes.pt_new_out_stats = [0, 0, 0, 0];
        const cluster = server.cluster;
        const recvMsg = msg => {
            let count;
            switch (msg.event) {
                case 'process_title.connect':
                    server.notes.pt_connections++;
                    server.notes.pt_concurrent_cluster[msg.wid]++;
                    count = 0;
                    Object.keys(server.notes.pt_concurrent_cluster).forEach(
                        id => {
                            count += server.notes.pt_concurrent_cluster[id];
                        }
                    );
                    server.notes.pt_concurrent = count;
                    break;
                case 'process_title.disconnect':
                    server.notes.pt_concurrent_cluster[msg.wid]--;
                    count = 0;
                    Object.keys(server.notes.pt_concurrent_cluster).forEach(
                        id => {
                            count += server.notes.pt_concurrent_cluster[id];
                        }
                    );
                    server.notes.pt_concurrent = count;
                    break;
                case 'process_title.recipient':
                    server.notes.pt_recipients++;
                    break;
                case 'process_title.message':
                    server.notes.pt_messages++;
                    break;
                case 'process_title.outbound_stats': {
                    const out_stats = msg.data.split('/');
                    for (let i = 0; i < out_stats.length; i++) {
                        server.notes.pt_new_out_stats[i] += parseInt(
                            out_stats[i],
                            10
                        );
                    }
                    server.notes.pt_new_out_stats[3]++;
                    // Check if we got all results back yet
                    if (
                        server.notes.pt_new_out_stats[3] ===
                        Object.keys(cluster.workers).length
                    ) {
                        server.notes.pt_out_stats = server.notes.pt_new_out_stats
                            .slice(0, 3)
                            .join('/');
                        server.notes.pt_new_out_stats = [0, 0, 0, 0];
                    }
                }
                // fall through
                default:
                // Unknown message
            }
        };
        // Register any new workers
        cluster.on('fork', worker => {
            server.notes.pt_concurrent_cluster[worker.id] = 0;
            cluster.workers[worker.id].on('message', recvMsg);
        });
        cluster.on('exit', worker => {
            delete server.notes.pt_concurrent_cluster[worker.id];
            // Update concurrency
            let count = 0;
            Object.keys(server.notes.pt_concurrent_cluster).forEach(id => {
                count += server.notes.pt_concurrent_cluster[id];
            });
            server.notes.pt_concurrent = count;
            server.notes.pt_child_exits++;
        });
    }
    this._interval = setupInterval(title, server);
    return next();
};

exports.hook_init_child = function(next, server) {
    server.notes.pt_connections = 0;
    server.notes.pt_concurrent = 0;
    server.notes.pt_cps_diff = 0;
    server.notes.pt_cps_max = 0;
    server.notes.pt_recipients = 0;
    server.notes.pt_rps_diff = 0;
    server.notes.pt_rps_max = 0;
    server.notes.pt_messages = 0;
    server.notes.pt_mps_diff = 0;
    server.notes.pt_mps_max = 0;
    const title = 'Haraka (worker)';
    process.title = title;
    this._interval = setupInterval(title, server);
    return next();
};

exports.shutdown = function() {
    this.logdebug(`Shutting down interval: ${this._interval}`);
    clearInterval(this._interval);
};

exports.hook_connect_init = (next, connection) => {
    const server = connection.server;
    connection.notes.pt_connect_run = true;
    if (server.cluster) {
        const worker = server.cluster.worker;
        worker.send({ event: 'process_title.connect', wid: worker.id });
    }
    server.notes.pt_connections++;
    server.notes.pt_concurrent++;
    return next();
};

exports.hook_disconnect = (next, connection) => {
    const server = connection.server;
    // Check that the hook above ran
    // It might not if the disconnection is immediate
    // echo "QUIT" | nc localhost 25
    // will exhibit this behaviour.
    let worker;
    if (!connection.notes.pt_connect_run) {
        if (server.cluster) {
            worker = server.cluster.worker;
            worker.send({ event: 'process_title.connect', wid: worker.id });
        }
        server.notes.pt_connections++;
        server.notes.pt_concurrent++;
    }
    if (server.cluster) {
        worker = server.cluster.worker;
        worker.send({ event: 'process_title.disconnect', wid: worker.id });
    }
    server.notes.pt_concurrent--;
    return next();
};

exports.hook_rcpt = (next, connection) => {
    const server = connection.server;
    if (server.cluster) {
        const worker = server.cluster.worker;
        worker.send({ event: 'process_title.recipient' });
    }
    server.notes.pt_recipients++;
    return next();
};

exports.hook_data = (next, connection) => {
    const server = connection.server;
    if (server.cluster) {
        const worker = server.cluster.worker;
        worker.send({ event: 'process_title.message' });
    }
    server.notes.pt_messages++;
    return next();
};
