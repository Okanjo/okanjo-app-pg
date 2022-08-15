"use strict";


const should = require('should');

describe('PostgresCrudService', () => {

    const PostgresService = require('../PostgresService');
    const PostgresCrudService = require('../PostgresCrudService');
    const OkanjoApp = require('okanjo-app');
    const config = require('./config');

    const now = new Date('2017-11-30T17:17:34-06:00');

    let app, crud;

    const purgeTable = async () => {
        await app.services.db.query('DELETE FROM crud_test.user WHERE true;');
    };

    const createDummyRecord = async (data) => {
        const doc = await crud.create(data || {
            id: 'a',
            username: 'a',
            email: 'a@a.com',
            first_name: null,
            last_name: null,
            status: 'active',
            created: now,
            updated: now
        });
        should(doc).be.ok();

        if (!data) {
            doc.id.should.be.exactly('a');
            doc.username.should.be.exactly('a');
            doc.email.should.be.exactly('a@a.com');
            should(doc.first_name).be.exactly(null);
            should(doc.last_name).be.exactly(null);
            doc.status.should.be.exactly('active');
            doc.created.toString().should.be.equal(now.toString());
            doc.updated.toString().should.be.equal(now.toString());
        }
    };

    before(async () => {

        app = new OkanjoApp(config);

        app.services = {
            db: new PostgresService(app, app.config.postgres.my_database.pool)
        };

        await app.connectToServices();
        
        app.services.db.pool.should.be.ok();

        let res = await app.services.db.query('DROP SCHEMA IF EXISTS crud_test cascade;');
        should(res).be.ok();
        res = await app.services.db.query('CREATE SCHEMA crud_test;');
        should(res).be.ok();

        // // Drop existing test database and table
        // await app.services.db.query('DROP DATABASE IF EXISTS `crud_test`;', (err) => {
        //     should(err).not.be.ok();
        //
        //     app.services.db.query('CREATE DATABASE `crud_test`;', (err) => {
        //         should(err).not.be.ok();

                // Create test database and table
        res = await app.services.db.query(`
            CREATE TABLE "crud_test"."user" (
              "id" varchar(255) NOT NULL PRIMARY KEY,
              "username" varchar(255) NOT NULL UNIQUE,
              "email" varchar(255) DEFAULT NULL,
              "first_name" varchar(255) DEFAULT NULL,
              "last_name" varchar(255) DEFAULT NULL,
              "status" varchar(255) NOT NULL,
              "created" timestamp NOT NULL,
              "updated" timestamp NOT NULL
            );`
        );
        should(res).be.ok();

        // should instantiate
        crud = new PostgresCrudService(app, {
            service: app.services.db,
            schema: 'crud_test',
            table: 'user'
        });

        should(crud).be.ok();

    });

    after(async () => {
        // close the pool, since it'll hold open the app
        await app.services.db.close();
    });

    describe('constructor', () => {

        it('should accept various options', () => {

            let crud = new PostgresCrudService(app, {
                service: app.services.db,
                schema: 'crud_test',
                table: 'user',
                modifiableKeys: ['hi'],
                deletedStatus: 'kaput',
                concealDeadResources: false
            });

            // noinspection JSAccessibilityCheck
            crud._modifiableKeys.should.deepEqual(['hi']);
            // noinspection JSAccessibilityCheck
            crud._deletedStatus.should.be.exactly('kaput');
            // noinspection JSAccessibilityCheck
            crud._concealDeadResources.should.be.exactly(false);

        });

        it('should throw when missing options ', () => {

            (() => new PostgresCrudService(app)).should.throw(/options/);

            (() => new PostgresCrudService(app, {})).should.throw(/service/);
            (() => new PostgresCrudService(app, {service: app.services.db})).should.throw(/schema/);
            (() => new PostgresCrudService(app, {service: app.services.db, schema: 'crud_test'})).should.throw(/table/);

        });

    });

    describe('init', () => {

        describe('basic usage', () => {

            let crud;
            let shouldNotExist = true;

            before(async () => {
                await app.services.db.query('DROP SCHEMA IF EXISTS "unittest_rel_init" cascade;');

                class UnitTestService extends PostgresCrudService {

                    constructor(app) {
                        super(app, {
                            service: app.services.db,
                            schema: 'unittest_rel_init',
                            table: 'things'
                        });
                    }

                    async _createTable(client) {
                        const res = await this.service.query(`
                            CREATE TABLE ${this.schema}.${this.table} (
                                "id" varchar(255) NOT NULL PRIMARY KEY,
                                "name" varchar(255) NOT NULL,
                                "status" varchar(255) NOT NULL,
                                "created" timestamp NOT NULL,
                                "updated" timestamp NOT NULL
                            );
                        `, [], { client });

                        should(res).be.ok();
                        shouldNotExist.should.be.exactly(true);
                        shouldNotExist = false;
                    }

                }

                crud = new UnitTestService(app);
            });

            it('it should create the database and table', async () => {
                await crud.init();
            });

            it('it should have no problem if everything exists already', async () => {
                await crud.init()
            });

        });

        describe('should error if someone forgot to implement _createTable', () => {

            let crud;

            before(async () => {
                await app.services.db.query('DROP SCHEMA IF EXISTS unittest_rel_init CASCADE;');

                class UnitTestService extends PostgresCrudService {

                    constructor(app) {
                        super(app, {
                            service: app.services.db,
                            schema: 'unittest_rel_init',
                            table: 'things'
                        });
                    }
                }

                crud = new UnitTestService(app);
            });

            it('it should error', async () => {
                await crud.init().should.be.rejectedWith(/_createTable/);
            });

        });

        describe('power usage', () => {

            let crud;
            let firedCreateSchema = false;
            let firedCreateTable = false;
            let firedUpdateSchema = false;
            let firedUpdateTable = false;

            before(async () => {

                await app.services.db.query('DROP SCHEMA IF EXISTS unittest_rel_init CASCADE;');

                class UnitTestService extends PostgresCrudService {

                    constructor(app) {
                        super(app, {
                            service: app.services.db,
                            schema: 'unittest_rel_init',
                            table: 'things'
                        });
                    }

                    async _createSchema(client) {
                        should(client).be.ok();
                        firedCreateSchema.should.be.exactly(false);
                        firedCreateSchema = true;
                        await super._createSchema(client);
                    }

                    async _updateSchema(client) {
                        should(client).be.ok();
                        firedUpdateSchema.should.be.exactly(false);
                        firedUpdateSchema = true;
                    }

                    async _createTable(client) {
                        should(client).be.ok();
                        const res = await this.service.query(`
                            CREATE TABLE ${this.schema}.${this.table} (
                                "id" varchar(255) NOT NULL PRIMARY KEY,
                                "name" varchar(255) NOT NULL,
                                "status" varchar(255) NOT NULL,
                                "created" timestamp NOT NULL,
                                "updated" timestamp NOT NULL
                            );
                        `, [], { client });

                        should(res).be.ok();
                        firedCreateTable.should.be.exactly(false);
                        firedCreateTable = true;
                    }

                    async _updateTable(client) {
                        should(client).be.ok();
                        firedUpdateTable.should.be.exactly(false);
                        firedUpdateTable = true;
                    }

                }

                crud = new UnitTestService(app);
            });

            it('it should create the database and table', async () => {
                firedCreateSchema = false;
                firedUpdateSchema = false;
                firedCreateTable = false;
                firedUpdateTable = false;

                await crud.init();
                firedCreateSchema.should.be.exactly(true);
                firedUpdateSchema.should.be.exactly(false);
                firedCreateTable.should.be.exactly(true);
                firedUpdateTable.should.be.exactly(false);
            });

            it('it should have no problem if everything exists already', async () => {
                firedCreateSchema = false;
                firedUpdateSchema = false;
                firedCreateTable = false;
                firedUpdateTable = false;

                await crud.init();
                firedCreateSchema.should.be.exactly(false);
                firedUpdateSchema.should.be.exactly(true);
                firedCreateTable.should.be.exactly(false);
                firedUpdateTable.should.be.exactly(true);
            });

        });

    });

    describe('_create', () => {

        before(async () => {
            await purgeTable();
        });

        it('should create a record', async () => {
            const doc = await crud.create({
                id: 'a',
                username: 'a',
                email: 'a@a.com',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            should(doc).be.ok();

            doc.id.should.be.exactly('a');
            doc.username.should.be.exactly('a');
            doc.email.should.be.exactly('a@a.com');
            should(doc.first_name).be.exactly(null);
            should(doc.last_name).be.exactly(null);
            doc.status.should.be.exactly('active');
            doc.created.toString().should.be.exactly(now.toString());
            doc.updated.toString().should.be.equal(now.toString());
        });

        it('should fail to create with collision', async () => {

            await crud.create({
                id: 'a',
                username: 'aa',
                email: 'a@a.com',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            }).should.be.rejectedWith(/duplicate key/);

        });

    });

    describe('_retrieve', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord();
        });

        it('should callback null with no id present', async () => {
            let doc = await crud.retrieve(undefined);
            should(doc).be.exactly(null);

            doc = await crud.retrieve(null);
            should(doc).be.exactly(null);
        });

        it('should not retrieve a bogus record', async () => {
            const doc = await crud.retrieve('bogus');
            should(doc).be.exactly(null);
        });

        it('should retrieve a record', async () => {
            const doc = await crud.retrieve('a');
            should(doc).be.ok();

            // console.log(doc);

            doc.id.should.be.exactly('a');
            doc.username.should.be.exactly('a');
            doc.email.should.be.exactly('a@a.com');
            should(doc.first_name).be.exactly(null);
            should(doc.last_name).be.exactly(null);
            doc.status.should.be.exactly('active');
            doc.created.toISOString().should.be.equal(now.toISOString());
            doc.updated.toISOString().should.be.equal(now.toISOString());

        });

        it('should not retrieve a dead resource', async () => {
            let doc = await crud.create({
                id: 'dead',
                username: 'dead',
                email: 'dead@dead.com',
                first_name: null,
                last_name: null,
                status: 'dead',
                created: now,
                updated: now
            });
            should(doc).be.ok();

            doc.id.should.be.exactly('dead');
            doc.username.should.be.exactly('dead');
            doc.email.should.be.exactly('dead@dead.com');
            should(doc.first_name).be.exactly(null);
            should(doc.last_name).be.exactly(null);
            doc.status.should.be.exactly('dead');
            doc.created.toString().should.be.equal(now.toString());
            doc.updated.toString().should.be.equal(now.toString());

                // now try fetching it
            doc = await crud.retrieve('dead');
            should(doc).not.be.ok();
        });

        it('should retrieve dead resource if concealment is disabled', async () => {
            crud._concealDeadResources = false;
            let doc = await crud.retrieve('dead');
            should(doc).be.ok();

            doc.id.should.be.exactly('dead');
            doc.username.should.be.exactly('dead');
            doc.email.should.be.exactly('dead@dead.com');
            should(doc.first_name).be.exactly(null);
            should(doc.last_name).be.exactly(null);
            doc.status.should.be.exactly('dead');
            doc.created.toISOString().should.be.equal(now.toISOString());
            doc.updated.toISOString().should.be.equal(now.toISOString());

            crud._concealDeadResources = true;
        });

    });

    describe('_find', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord();
            await createDummyRecord({
                id: 'b',
                email: 'b@b.com',
                username: 'b',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'c',
                email: 'c@c.com',
                username: 'c',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'd',
                email: 'd@d.com',
                username: 'd',
                first_name: null,
                last_name: null,
                status: 'dead',
                created: now,
                updated: now
            }); // dead
        });

        it('should find all alive resources', async () => {
            const docs = await crud.find({});
            should(docs).be.ok();
            docs.length.should.be.exactly(3); // a, b, c
        });

        it('should find all resources if concealment is disabled', async () => {
            crud._concealDeadResources = false;
            const docs = await crud.find({});
            crud._concealDeadResources = true;
            should(docs).be.ok();

            docs.length.should.be.exactly(4); // a, b, c, dead
        });

        it('should find all resources if concealment explicitly disabled', async () => {
            const docs = await crud.find({}, { conceal: false });
            should(docs).be.ok();

            docs.length.should.be.exactly(4); // a, b, c, dead
        });

        it('should find all resources if concealment is disabled and criteria is empty', async () => {
            crud._concealDeadResources = false;
            const docs = await crud.find(null);
            crud._concealDeadResources = true;
            should(docs).be.ok();

            docs.length.should.be.exactly(4); // a, b, c, dead
        });

        it('should combine status and concealment args', async () => {
            const docs = await crud.find({ status: 'active' });
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // a, b, c
        });

        it('should include concealment with an empty criteria set', async () => {
            const docs = await crud.find(null);
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // a, b, c
        });

        it('should return only the fields asked for if specified', async () => {
            const docs = await crud.find({}, { fields: { username: 1 } });
            should(docs).be.ok();
            // console.log(docs);

            docs.length.should.be.exactly(3); // a, b, c
            docs.forEach((doc) => {
                should(doc.id).be.ok(); // id should be present even if you didn't ask for it
                should(doc.username).be.ok();
                should(doc.email).not.be.ok();
            });
        });

        it('should return only the fields asked for if specified with no id', async () => {
            const docs = await crud.find({}, { fields: { id: 0, username: 1 } });
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // a, b, c
            docs.forEach((doc) => {
                should(doc.id).not.be.ok(); // id was explicitly disabled
                should(doc.username).be.ok();
                should(doc.email).not.be.ok();
            });
        });

        it('should sort by a given field or fields', async () => {
            const docs = await crud.find({}, { sort: { id: -1, username: 1 } });
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // c, b, a
            docs.forEach((doc, i) => {
                switch(i) {
                    case 0: doc.id.should.be.exactly('c'); break;
                    case 1: doc.id.should.be.exactly('b'); break;
                    case 2: doc.id.should.be.exactly('a'); break;
                    default:
                        throw new Error('not supposed to be here');
                }
            });
        });

        it('should handle pagination', async () => {
            let docs = await crud.find({}, { skip: 0, take: 2 });
            should(docs).be.ok();

            docs.length.should.be.exactly(2); // a, b
            docs.forEach((doc, i) => {
                switch(i) {
                    case 0: doc.id.should.be.exactly('a'); break;
                    case 1: doc.id.should.be.exactly('b'); break;
                    default:
                        throw new Error('not supposed to be here');
                }
            });

            docs = await crud.find({}, { skip: 2, take: 2 });
            should(docs).be.ok();

            docs.length.should.be.exactly(1); // c
            docs[0].id.should.be.exactly('c');
        });

        it('should handle offset, no limit', async () => {
            const docs = await crud.find({}, { skip: 1 });
            should(docs).be.ok();

            docs.length.should.be.exactly(2); // b, c
            docs.forEach((doc, i) => {
                switch (i) {
                    case 0:
                        doc.id.should.be.exactly('b');
                        break;
                    case 1:
                        doc.id.should.be.exactly('c');
                        break;
                    default:
                        throw new Error('not supposed to be here');
                }
            });
        });

        it('should handle limit, no offset', async () => {
            const docs = await crud.find({}, { take: 2 });
            should(docs).be.ok();


            docs.length.should.be.exactly(2); // a, b
            docs.forEach((doc, i) => {
                switch (i) {
                    case 0:
                        doc.id.should.be.exactly('a');
                        break;
                    case 1:
                        doc.id.should.be.exactly('b');
                        break;
                    default:
                        throw new Error('not supposed to be here');
                }
            });
        });

        it('should handle special operator: array (in)', async () => {
            const docs = await crud.find({ id: ['a','b'] });
            should(docs).be.ok();

            docs.length.should.be.exactly(2); // a, b
        });

        it('should handle special operator: $ne array (not in)', async () => {
            const docs = await crud.find({ id: { $ne: ['a','b'] } });
            should(docs).be.ok();

            docs.length.should.be.exactly(1); // c
        });

        it('should handle special operator: $gt', async () => {
            const docs = await crud.find({ created: { $gt: new Date('2017-11-29T17:17:34-06:00')} });
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // a, b, c
        });

        it('should handle special operator: $gte', async () => {
            const docs = await crud.find({ created: { $gte: now } });
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // a, b, c
        });

        it('should handle special operator: $lt', async () => {
            const docs = await crud.find({ created: { $lt: new Date('2017-12-01T17:17:34-06:00')} });
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // a, b, c
        });

        it('should handle special operator: $lte', async () => {
            const docs = await crud.find({ created: { $lte: now } });
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // a, b, c
        });

        it('should handle special operator: $ne', async () => {
            const docs = await crud.find({ id: { $ne: 'a' } });
            should(docs).be.ok();

            docs.length.should.be.exactly(2); // b, c
        });

        it('should handle regular operator: =', async () => {
            const docs = await crud.find({ id: 'a' });
            should(docs).be.ok();

            docs.length.should.be.exactly(1); // a
        });

        it('should warn when you are crazy', async () => {
            const docs = await crud.find({ created: { $crazy: 'yes' } });
            should(docs).be.ok();

            docs.length.should.be.exactly(3); // a, b, c
        });

    });

    describe('_count', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord();
            await createDummyRecord({
                id: 'b',
                email: 'b@b.com',
                username: 'b',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'c',
                email: 'c@c.com',
                username: 'c',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'd',
                email: 'd@d.com',
                username: 'd',
                first_name: null,
                last_name: null,
                status: 'dead',
                created: now,
                updated: now
            });
        });

        it('should get a count', async () => {
            const count = await crud.count({});
            should(count).be.ok();

            count.should.be.exactly(3n);
        });

        it('should get a count with no options', async () => {
            const count = await crud.count({});
            should(count).be.ok();

            count.should.be.exactly(3n);
        });

        it('should get a count with options', async () => {
            const count = await crud.count({ }, { conceal: false });
            should(count).be.ok();

            count.should.be.exactly(4n);
        });

        it('should get a zero count', async () => {
            const count = await crud.count({ id: 'nope' }, { conceal: false });
            count.should.be.exactly(0n);
        });

    });

    describe('_update', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord();
            await createDummyRecord({
                id: 'b',
                email: 'b@b.com',
                username: 'b',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'c',
                email: 'c@c.com',
                username: 'c',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'd',
                email: 'd@d.com',
                username: 'd',
                first_name: null,
                last_name: null,
                status: 'dead',
                created: now,
                updated: now
            });
        });

        it('should update a doc', async () => {
            let doc = await crud.retrieve('a');
            should(doc).be.ok();

            doc.first_name = 'unit';
            doc.last_name = 'test';

            let doc2 = await crud.update(doc);
            should(doc2).be.ok();

            // The reference SHOULD HAVE been broken
            doc.should.not.be.exactly(doc2);

            // The updated time should have changed
            doc2.updated.toISOString().should.not.be.exactly(now.toISOString());

            // Fetch a clean copy
            doc = await crud.retrieve('a');
            should(doc).be.ok();

            doc.first_name.should.be.exactly('unit');
            doc.last_name.should.be.exactly('test');
        });

        it('should apply modifiable fields', async () => {
            let doc = await crud.retrieve('a');
            should(doc).be.ok();

            crud._modifiableKeys = ['first_name', 'last_name'];

            let doc2 = await crud.update(doc, {first_name: 'unit2', last_name: 'test2'});
            should(doc2).be.ok();

            doc2.first_name.should.be.exactly('unit2');
            doc2.last_name.should.be.exactly('test2');
        });

        it('should handle disabling updatedField', async () => {
            let doc = await crud.retrieve('b');
            should(doc).be.ok();

            crud.updatedField = null;
            let doc2 = await crud.update(doc);
            should(doc2).be.ok();
            crud.updatedField = 'updated';

            // The reference should have been broken
            doc.should.not.be.exactly(doc2);

            // The updated time should have changed
            doc2.updated.toISOString().should.be.exactly(now.toISOString());

            // Fetch a clean copy
            doc = await crud.retrieve('b');
            should(doc).be.ok();

            doc.updated.toISOString().should.be.exactly(now.toISOString());
        });

        it('should error if you do not identify your object', async () => {
            const doc = { username: 'bogus' };
            await crud.update(doc).should.be.rejectedWith(/Cannot update row if id field not provided/);
        });

        it('should error if you botch a data type', async () => {
            let doc = await crud.retrieve('a');
            should(doc).be.ok();

            doc.created = 'KABOOM';

            await crud.update(doc, {}).should.be.rejectedWith(/invalid input syntax for type timestamp/);
        });

    });

    describe('_bulkUpdate', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord();
            await createDummyRecord({
                id: 'b',
                email: 'b@b.com',
                username: 'b',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'c',
                email: 'c@c.com',
                username: 'c',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'd',
                email: 'd@d.com',
                username: 'd',
                first_name: null,
                last_name: null,
                status: 'dead',
                created: now,
                updated: now
            });
        });

        it('should bulk update matched records', async () => {
            const res = await crud.bulkUpdate({ id: ['a','b'] }, { first_name: 'bulk' });
            should(res).be.ok();
            console.log(res);
            res.rowCount.should.be.exactly(2);
        });

        it('should not set updated when configured to do so', async () => {
            crud.updatedField = null;
            const res = await crud.bulkUpdate({ id: ['a','b'] }, { first_name: 'bulk' }, null);
            crud.updatedField = 'updated';
            should(res).be.ok();

            res.rowCount.should.be.exactly(2); // we looked at 2 rows
        });

        it('should update all rows if no criteria set', async () => {
            const res = await crud.bulkUpdate({ }, { first_name: null });
            should(res).be.ok();

            res.rowCount.should.be.exactly(3); // a, b, c  (dead not affected)
        });

        it('should update all rows if no criteria set, without concealment', async () => {
            const res = await crud.bulkUpdate({ }, { first_name: 'bulkers' }, { conceal: false });
            should(res).be.ok();

            res.rowCount.should.be.exactly(4); // a, b, c, dead
        });

        it('should update all rows if falsey criteria set, without concealment', async () => {
            const res = await crud.bulkUpdate(null, { first_name: 'bulkers' }, { conceal: false });
            should(res).be.ok();

            res.rowCount.should.be.exactly(4); // a, b, c, dead
        });

        it('should update all rows and merge status criteria, with concealment', async () => {
            const res = await crud.bulkUpdate({ status: 'active' }, { first_name: 'merge' }, { conceal: true });
            should(res).be.ok();

            res.rowCount.should.be.exactly(3); // a, b, c
        });

        it('should handle errors', async () => {
            await crud.bulkUpdate({ id: ['a','b'] }, { created: 'KABOOM' }).should.be.rejectedWith(/invalid input syntax for type timestamp/)
        });

    });

    describe('_delete', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord({
                id: 'c',
                email: 'c@c.com',
                username: 'c',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
        });

        it('should fake delete a record', async () => {
            let doc = { id: 'c' };
            const doc2 = await crud.delete(doc);
            should(doc).be.ok();

            doc2.should.not.be.exactly(doc);
            doc2.status.should.be.exactly('dead');

            doc = await crud.retrieve('c');
            should(doc).be.exactly(null);
        });

    });

    describe('_bulkDelete', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord();
            await createDummyRecord({
                id: 'b',
                email: 'b@b.com',
                username: 'b',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'c',
                email: 'c@c.com',
                username: 'c',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'd',
                email: 'd@d.com',
                username: 'd',
                first_name: null,
                last_name: null,
                status: 'dead',
                created: now,
                updated: now
            });
        });

        it('should bulk delete with no options', async () => {
            const res = await crud.bulkDelete({ status: 'active' });
            should(res).be.ok();

            res.rowCount.should.be.exactly(3);
        });

        it('should bulk delete with options', async () => {
            const res = await crud.bulkDelete({ id: 'c' }, { conceal: false });
            should(res).be.ok();

            res.rowCount.should.be.exactly(1); // c
        });

    });

    describe('_deletePermanently', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord({
                id: 'b',
                email: 'b@b.com',
                username: 'b',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
        });

        it('should really delete a record', async () => {
            const doc = { id: 'b' };
            const doc2 = await crud.deletePermanently(doc);
            should(doc2).be.ok();

            doc2.should.not.be.exactly(doc);

            const docs = await crud.find({}, { conceal: false });
            should(docs).be.ok();

            docs.length.should.be.exactly(0);
        });

        it('should error when no id given', async () => {
            const doc = {};
            await crud.deletePermanently(doc).should.be.rejectedWith(/Cannot delete row if id field not provided/);
        });

        // it('trying to delete something that was already deleted should warn', async () => {
        //     const doc = { id: 'b' };
        //     const doc2 = await crud.deletePermanently(doc);
        //     should(doc2).be.ok();
        // });

    });

    describe('_bulkDeletePermanently', () => {

        before(async () => {
            await purgeTable();
            await createDummyRecord();
            await createDummyRecord({
                id: 'b',
                email: 'b@b.com',
                username: 'b',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'c',
                email: 'c@c.com',
                username: 'c',
                first_name: null,
                last_name: null,
                status: 'dead',
                created: now,
                updated: now
            });
            await createDummyRecord({
                id: 'd',
                email: 'd@d.com',
                username: 'd',
                first_name: null,
                last_name: null,
                status: 'dead',
                created: now,
                updated: now
            });
        });

        it('should bulk delete everything (no criteria, no opts)', async () => {
            const res = await crud.bulkDeletePermanently(null);
            should(res).be.ok();

            res.rowCount.should.be.exactly(2); // a,b
        });

        it('should bulk delete no conceal', async () => {
            const res = await crud.bulkDeletePermanently({ id: 'd' }, { conceal: false });
            should(res).be.ok();

            res.rowCount.should.be.exactly(1); // d
        });

        it('should bulk delete conceal with status', async () => {
            const res = await crud.bulkDeletePermanently({ status: 'dead' }, { conceal: true });
            should(res).be.ok();

            res.rowCount.should.be.exactly(0); // lol dead things are concealed, so duh 0
        });

        it('should bulk delete no conceal with falsey criteria', async () => {
            const res = await crud.bulkDeletePermanently(null, { conceal: false });
            should(res).be.ok();

            res.rowCount.should.be.exactly(1); // dead, c
        });

        it('should handle errors', async () => {
            await crud.bulkDeletePermanently({ bogus: true }).should.be.rejectedWith(/column "bogus" does not exist/);
        });

    });

    describe('Transactions', () => {

        // All crud functions should work in a transaction w/ options
        let client;

        before(async () => {
            client = await app.services.db.getConnection();
            await app.services.db.query('BEGIN', [], { client });
        });

        after(async () => {
            await app.services.db.query('COMMIT', [], { client });
            client.release();
        });

        it('_create in transaction', async () => {
            const doc = await crud.create({
                id: 'txn',
                username: 'txn',
                email: 'txn@txn.com',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            }, { client });
            should(doc).be.ok();
        });

        it('_create in transaction 2', async () => {
            const doc = await crud.create({
                id: 'txn2',
                username: 'txn2',
                email: 'txn2@txn2.com',
                first_name: null,
                last_name: null,
                status: 'active',
                created: now,
                updated: now
            }, { client });
            should(doc).be.ok();
        });

        it('_retrieve in transaction', async () => {
            const doc = await crud.retrieve('txn', { client });
            should(doc).be.ok();
        });

        it('_find in transaction', async () => {
            const docs = await crud.find({ id: 'txn2' }, { client });
            should(docs).be.ok();
            docs.length.should.be.exactly(1);
        });

        it('_count in transaction', async () => {
            const count = await crud.count({ id: 'txn2' }, { client });
            should(count).be.ok();
            count.should.be.exactly(1n);
        });

        it('_update in transaction', async () => {
            const doc = await crud.update({ id: 'txn', first_name: 'changed' }, {}, { client });
            should(doc).be.ok();
        });

        it('_bulkUpdate in transaction', async () => {
            const res = await crud.bulkUpdate({ id: 'txn' }, { last_name: 'bulk' }, { client });
            should(res).be.ok();

            res.rowCount.should.be.exactly(1);
        });

        it('_delete in transaction', async () => {
            const doc = await crud.delete({ id: 'txn2' }, { client });
            should(doc).be.ok();
        });

        it('_bulkDelete in transaction', async () => {
            const res = await crud.bulkDelete({ id: 'txn2' }, { client });

            res.rowCount.should.be.exactly(0);
        });

        it('_deletePermanently in transaction', async () => {
            const doc = await crud.deletePermanently({ id: 'txn2' }, { client });
            should(doc).be.ok();
        });

        it('_bulkDeletePermanently in transaction', async () => {
            const res = await crud.bulkDeletePermanently({ id: 'txn' }, { client });

            res.rowCount.should.be.exactly(1);
        });


    });

});