"use strict";

const should = require('should');

describe('PostgresService', () => {

    const PostgresService = require('../PostgresService');
    const OkanjoApp = require('okanjo-app');
    const config = require('./config');

    let app;

    before(async () => {

        app = new OkanjoApp(config);

        app.services = {
            db: new PostgresService(app, app.config.postgres.my_database.pool)
        };

        await app.connectToServices();

        app.services.db.pool.should.be.ok();

    });

    after(async function () {
        this.timeout(20000);

        // close the pool, since it'll hold open the app
        // console.log({
        //     totalCount: app.services.db.pool.totalCount,
        //     idleCount: app.services.db.pool.idleCount,
        //     waitingCount: app.services.db.pool.waitingCount,
        // });

        await app.services.db.close();
    });

    it('should explode if no config given', () => {
        (() => { new PostgresService(app) }).should.throw(/config/);
    });

    it('should be able to handle a close even if the pool has not started', async () => {
        const app = new OkanjoApp({ postgres: { } });
        const service = new PostgresService(app, app.config.postgres);
        await service.close();
    });

    it('should query', async () => {
        const res = await app.services.db.query('SELECT datname FROM pg_database');
        // console.log(res);
        should(res).be.ok();
        res.rowCount.should.be.greaterThan(0);
    });

    it('should query w/ options', async () => {
        const res = await app.services.db.query('SELECT datname FROM pg_database WHERE $1;', [1]);
        // console.log(res);
        should(res).be.ok();
        res.rowCount.should.be.greaterThan(0);
    });

    it('should report query errors', async () => {
        await app.services.db.query('SHOW DATATHINGS;')
            .should.be.rejectedWith(/unrecognized configuration parameter/);
    });

    it('should suppress query errors', async () => {
        await app.services.db.query('SHOW DATATHINGS;', [], { suppress: /unrecognized configuration parameter/})
            .should.be.rejectedWith(/unrecognized configuration parameter/);
    });

    it('should get a connection', async () => {
        const client = await app.services.db.getConnection();
        should(client).be.an.Object();

        // Issue a query using that connection
        const res = await app.services.db.query('SELECT datname FROM pg_database;', [], { client });
        res.rowCount.should.be.greaterThan(0);

        await app.services.db.query('SHOW DATATHINGS;', [], { client })
            .should.be.rejectedWith(/unrecognized configuration parameter/);

        client.release();
    });

    // it('should error if you send query bad args', (done) => {
    //     app.services.db.query(1, (err) => {
    //         err.should.be.an.Object();
    //         err.message.should.match(/argument position/);
    //         done();
    //     });
    // });
    //
    // it('should error if you send query bad args w/ promise', (done) => {
    //     app.services.db.query(1).catch((err) => {
    //         err.should.be.an.Object();
    //         err.message.should.match(/argument position/);
    //         done();
    //     });
    // });

});