"use strict";

const host = process.env.PG_HOST || '127.0.0.1';
const port = parseInt(process.env.PG_PORT || 5432);
const user = process.env.PG_USER || 'postgres';
const password = process.env.PG_PASS || 'unittest';
const database = process.env.PG_DB || undefined;

//noinspection JSUnusedGlobalSymbols
module.exports = {

    postgres: {
        my_database: {
            pool: {
                host,
                port,
                user,
                password,
                database,
                allowExitOnIdle: true
            },
        },
    },

};