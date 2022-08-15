"use strict";

const debug = require('debug')('pg');
const { Pool } = require('pg')


/**
 * Postgres Database service
 */
class PostgresService {

    /**
     * Constructor
     * @param {OkanjoApp} app
     * @param {Object} config
     */
    constructor(app, config) {
        this.app = app;
        this.config = config;

        // No config = no dice.
        if (!this.config) {
            throw new Error('PostgresService: `config` must be defined on initialization!');
        }

        app.registerServiceConnector(async () => this.connect());
    }

    /**
     * Connects to the Postgres database, and initializes the connection pool
     */
    async connect() {
        // Luckily, all we have to do here is define the pool
        debug('Starting connection pool');
        this.pool = new Pool(this.config);
    }

    /**
     * Closes down the connection pool.
     * @returns {Promise<void>}
     */
    async close() {
        debug('Closing connection pool');
        if (this.pool) await this.pool.end();
    }

    /**
     * Issues a SQL query with parameterized arguments.
     * @param {string} sql – Query string
     * @param {[*]} [args] – Query argument values
     * @param {{client:*?, suppress:number?}} [options] – Query functionality options
     * @returns {Promise<*>}
     */
    query(sql, args=[], options={}) { // eslint-disable-line no-unused-vars
        return new Promise((resolve, reject) => {
            let { client, suppress } = options;

            // if a session was given, resolve it otherwise fetch a new session from the pool
            let resolveConnection;
            let releaseClientOnFinish = false;
            if (client) {
                debug('Using supplied client for query');
                resolveConnection = Promise.resolve(client);
            } else {
                debug('Getting a client from the pool');
                resolveConnection = this.getConnection();
                releaseClientOnFinish = true;
            }

            resolveConnection
                .then(client => {
                    // execute the query
                    debug('Executing query:\n%s\nArguments:\n%O', sql, args);
                    return client.query(sql, args)
                        .then(res => {
                            // debug('Query completed');
                            debug('Query completed: %O', res);

                            // handle the response of the query
                            if (releaseClientOnFinish) client.release();
                            return resolve(res);
                        })
                        .catch(async err => {
                            // Report error if not suppressed
                            if (!suppress || !(suppress instanceof RegExp) || !suppress.test(err.message)) {
                                debug('Query failed');
                                await this.app.report('PostgresService: Failed to execute query', err, { sql: sql, args: args, options: options });
                            }

                            if (releaseClientOnFinish) client.release();
                            return reject(err);
                        })
                    ;
                }, /* istanbul ignore next: oos */ err => {
                    this.app.report('PostgresService: Failed to acquire query client', err, { sql: sql, args: args, options: options });
                    return reject(err);
                })
            ;
        });
    }

    /**
     * Gets a fresh client from the pool - MAKE SURE TO RELEASE IT WHEN FINISHED!
     * @returns {Promise<Client>}
     */
    getConnection() {
        return this.pool.connect()
    }
}

module.exports = PostgresService;