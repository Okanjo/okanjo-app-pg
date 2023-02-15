"use strict";

const debug = require('debug')('pg:crud');

/**
 * Base service that all object CRUD services should inherit
 */
class PostgresCrudService {

    /**
     * Constructor
     * @param app
     * @param options
     */
    constructor(app, options) {
        this.app = app;

        if (!options) {
            throw new Error('PostgresCrudService: `options` are required.');
        }

        // Required settings
        /**
         * Underlying postgres service instance
         * @type {PostgresService}
         */
        this.service = options.service;

        if (!this.service) {
            throw new Error('PostgresCrudService: `service` must be defined on initialization');
        }

        this.schema = options.schema;
        this.table = options.table;

        if (!this.schema) {
            throw new Error('PostgresCrudService: `schema` must be defined on initialization');
        }

        if (!this.table) {
            throw new Error('PostgresCrudService: `table` must be defined on initialization');
        }

        // Optional settings
        this.idField = options.idField || 'id';
        this.statusField = options.statusField || 'status';
        this.updatedField = options.updatedField || 'updated';

        /**
         * Base number of times that
         * @type {number}
         * @protected
         */
        this._createRetryCount = options.createRetryCount || 3;

        /**
         * Model keys that can be updated via ._update(model, data)
         * @type {Array}
         * @protected
         */
        this._modifiableKeys = options.modifiableKeys || [];

        /**
         * The status to set models to when "deleted"
         * @type {string}
         * @protected
         */
        this._deletedStatus = options.deletedStatus || 'dead';

        /**
         * Whether to actively prevent dead resources from returning in find and retrieve calls
         * @type {boolean}
         * @protected
         */
        this._concealDeadResources = options.concealDeadResources !== undefined ? options.concealDeadResources : true;
    }

    /**
     * Hook to create the schema if it does not exist
     * @param {Client} client - Active client
     * @returns {Promise<void>}
     * @protected
     */
    async _createSchema(client) {
        debug('Creating schema %s', this.schema);
        await this.service.query(`CREATE SCHEMA "${this.schema}";`, [], { client });
    }

    // noinspection JSMethodCanBeStatic
    /**
     * Hook to update the schema if it already exists
     * @param {Client} client - Active session
     * @returns {Promise<void>}
     * @protected
     */
    async _updateSchema(client) { // eslint-disable-line no-unused-vars
        // Could add/remove views, triggers, procedures, you name it...
    }

    /**
     * Hook to create the schema table if it does not exist
     * @param {Client} client – Active session
     * @returns {Promise<void>}
     * @protected
     */
    async _createTable(client) { // eslint-disable-line no-unused-vars
        const err = new Error('PostgresCrudService: Method _createTable must be overridden to properly create your table');
        await this.app.report(err, { schema: this.schema, table: this.table });
        throw err;
    }

    /**
     * Hook to update a table if it already exists
     * @param {Client} client – Active session
     * @returns {Promise<void>}
     * @protected
     */
    async _updateTable(client) { // eslint-disable-line no-unused-vars
        // Could add/remove columns, indices, FK's, you name it...
    }

    /**
     * Initializes the schema and table. Use this._createSchema, this._createTable, this._updateSchema, this._updateTable hooks for implementation
     * @returns {Promise<void>}
     */
    async init() {
        // Get a new session
        const client = await this.service.getConnection();

        try {
            // Start a transaction to prevent races
            await client.query('BEGIN');

            // Schema exists?
            debug('Checking if schema %s exists', this.schema);
            let schemas = await this.service.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`, [this.schema], { client: client });
            let exists = schemas.rowCount > 0;
            if (!exists) {
                // No, let the operator create it
                debug('Schema does not exist, creating...');
                await this._createSchema(client);
            } else {
                // Let the app update anything it wants to here
                debug('Schema exists, calling _updateSchema hook...');
                await this._updateSchema(client)
            }

            // Table exists?
            debug('Checking if table %s exists...', this.table);
            const tables = await this.service.query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 AND tablename = $2`, [this.schema, this.table], { client: client });
            exists = tables.rowCount > 0;
            if (!exists) {
                // No, let the operator create it
                debug('Table does not exist, creating...');
                await this._createTable(client);
            } else {
                // Let the app update anything it wants to here
                debug('Table exists, calling _updateTable hook...');
                await this._updateTable(client);
            }

            // Commit the results
            await client.query('COMMIT');

        } catch (err) {
            await this.app.report('PostgresCrudService: Failed to initialize', err, { schema: this.schema, table: this.table });

            // Abort
            await client.query('ROLLBACK');

            // rethrow
            throw err;

        } finally {
            // Release the client back to the pool
            await client.release();
        }
    }

    /**
     * Creates a new model
     * @param {*} data - Record properties
     * @param {*} [options] – Query options
     * @returns {Promise<Result>}
     */
    create(data, options) {
        const args = Object.values(data);

        // Build query and args
        let sql = `INSERT INTO "${this.schema}"."${this.table}" (${Object.keys(data).map(field => `"${field}"`).join(', ')}) VALUES (${Object.keys(data).map((field, i) => '$'+(i+1)).join(', ')}) RETURNING *`;

        return this.service.query(
            sql,
            args,
            options
        )
            .then(res => res.rows[0]);
    }

    /**
     * Retrieves a model given an identifier.
     *
     * WARNING: this _can_ retrieve dead statuses
     *
     * @param {string} id - Row identifier
     * @param {*} [options] – Query options
     * @returns {Promise<Result>}
     */
    retrieve(id, options={}) {
        const { client } = options;

        // Only do a query if there's something to query for
        if (id !== undefined && id !== null) {
            let sql = `SELECT * FROM "${this.schema}"."${this.table}" WHERE "${this.idField}" = $1`;
            const args = [id];

            // If conceal mode is activated, prevent dead resources from returning
            if (this._concealDeadResources) {
                sql += ` AND "${this.statusField}" != $2`;
                args.push(this._deletedStatus);
            }

            sql += ' LIMIT 1';

            return this.service.query(
                sql,
                args,
                { client }
            )
                .then(res => {
                    return res.rows[0] || null;
                })
            ;

        } else {
            // id has no value - so... womp.
            return Promise.resolve(null);
        }
    }

    /**
     * Retrieves one or more records that match the given criteria
     * @param {*} criteria - Filter criteria
     * @param {{[skip]:number, [take]:number, [fields]:string|*, [sort]:*, [mode]:string}} [options] - Query options
     * @return {Query}
     */
    find(criteria, options={}) {
        const { client } = options;

        let where = [];
        let args = [];

        // Strip options out so we can stick them into the query builder
        let skip, limit, fields, sort, conceal = true, mode;
        if (typeof options.skip !== "undefined") { skip = options.skip; delete options.skip; }
        if (typeof options.take !== "undefined") { limit = options.take; delete options.take; }
        if (typeof options.fields !== "undefined") { fields = options.fields; delete options.fields; }
        if (typeof options.sort !== "undefined") { sort = options.sort; delete options.sort; }
        if (typeof options.conceal !== "undefined") { conceal = options.conceal; delete options.conceal; }
        if (typeof options.mode !== "undefined") { mode = options.mode; delete options.mode; fields = undefined; }

        // Actively prevent dead resources from returning, even if a status was given
        if (this._concealDeadResources && conceal) {

            // Check if we were even given criteria
            if (criteria) {

                // Check if we were given a status filter
                if (criteria[this.statusField]) {

                    // Composite both status requirements together
                    where.push(`"${this.statusField}" = $${args.length+1} AND "${this.statusField}" != $${args.length+2}`);
                    args.push(criteria[this.statusField]);
                    args.push(this._deletedStatus);

                    // Remove the original status filter from criteria
                    delete criteria[this.statusField];

                } else {
                    // No status given, default it to conceal dead things
                    criteria[this.statusField] = { $ne: this._deletedStatus };
                }
            } else {
                // No criteria given, default it to conceal dead things
                criteria = { [this.statusField]: { $ne: this._deletedStatus } };
            }
        }

        // Build the query where args
        this._buildCriteria(criteria || {}, where, args);

        // Build the fields clause
        let fieldsSql = mode === PostgresCrudService._QUERY_MODE.COUNT ? 'COUNT(*) AS count' : '*';
        if (typeof fields !== "undefined") {
            if (fields && typeof fields.id === "undefined") {
                fields.id = 1;
            }
            const allowedFields = Object.keys(fields).filter((field) => fields[field]);
            fieldsSql = allowedFields.map((field) => `"${field}"`).join(', ');
        }

        let sql = `SELECT ${fieldsSql} FROM "${this.schema}"."${this.table}"`;

        // Attach the where clause
        if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;

        // Attach order by clause
        if (sort !== undefined) {
            sql += ' ORDER BY ' + Object.keys(sort).map((field) => {
                return `"${field}" ${sort[field] > 0 ? 'ASC' : 'DESC'}`
            });
        }

        // Attach limit clause
        if (typeof skip !== "undefined") {
            sql += ` OFFSET $${args.length+1}`;
            args.push(skip);
        }

        if (typeof limit !== "undefined") {
            sql += ` LIMIT $${args.length+1}`;
            args.push(limit);
        }

        return this.service.query(
            sql,
            args,
            { client }
        )
            .then(res => res.rows)
        ;
    }

    /**
     * Converts object criteria into a WHERE query clause parts
     * @param criteria
     * @param where
     * @param args
     * @param equality
     * @private
     */
    _buildCriteria(criteria, where, args, equality = true) {
        // For each field present in the criteria
        Object.keys(criteria).forEach(async (field) => {
            const value = criteria[field];

            // Handle special types of values
            if (Array.isArray(value)) {
                // Arrays turn to WHERE IN ...
                where.push(`"${field}" ${!equality ? 'NOT ' : ''}IN (${value.map(val => { args.push(val); return '$'+args.length; }).join(', ')})`);
            } else if (typeof value === 'object' && value !== null && !(value instanceof Date) && !Buffer.isBuffer(value)) {
                // Value is an object, try to keep some similarity here between mongo
                const startingWhereLength = where.length;

                // { field: { $ne: value } }
                if (value.$ne) {
                    this._buildCriteria({ [field]: value.$ne }, where, args, false);
                }

                // { field: { $gt: value } }
                if (value.$gt) {
                    where.push(`"${field}" > $${args.length+1}`);
                    args.push(value.$gt);
                }

                // { field: { $gte: value } }
                if (value.$gte) {
                    where.push(`"${field}" >= $${args.length+1}`);
                    args.push(value.$gte);
                }

                // { field: { $lt: value } }
                if (value.$lt) {
                    where.push(`"${field}" < $${args.length+1}`);
                    args.push(value.$lt);
                }

                // { field: { $lte: value } }
                if (value.$lte) {
                    where.push(`"${field}" <= $${args.length+1}`);
                    args.push(value.$lte);
                }

                // case-insensitive equals
                // { field: { $eqi: value } }
                if (value.$eqi) {
                    where.push(`LOWER("${field}") = LOWER($${args.length+1})`);
                    args.push(value.$eqi);
                }

                // case-insensitive not-equals
                // { field: { $nei: value } }
                if (value.$nei) {
                    where.push(`LOWER("${field}") != LOWER($${args.length+1})`);
                    args.push(value.$nei);
                }

                if (startingWhereLength === where.length) {
                    await this.app.report('PostgresCrudService: No object modifier set on object query criteria', { field, value });
                }
            } else {
                // Standard value
                where.push(`"${field}" ${!equality ? '!' : ''}= $${args.length+1}`);
                args.push(value);
            }
        });
    }

    /**
     * Performs a find-based query but is optimized to only return the count of matching records, not the records themselves
     * @param {*} criteria - Filter criteria
     * @param {{[skip]:number, [take]:number, [fields]:string|*, [sort]:*, [exec]:boolean}} [options] - Query options
     * @return {*}
     */
    count(criteria, options={}) {
        // Don't execute, we want the query so we can fudge it
        options.mode = PostgresCrudService._QUERY_MODE.COUNT;
        delete options.skip;
        delete options.take;
        delete options.sort;
        delete options.fields;

        // Exec the count query
        return this.find(criteria, options)
            .then(rows => {
                return BigInt(rows && rows.length && rows[0].count);
            })
        ;
    }

    /**
     * Applies the data properties to the row
     * @param {*} doc - Row to update
     * @param {*} [data] - Data to apply to the row before saving
     * @protected
     */
    _applyUpdates(doc, data) {
        // When given a data object, apply those keys to the model when allowed to do so
        if (data && typeof data === "object") {
            this._modifiableKeys.forEach(function (property) {
                /* istanbul ignore else: too edge casey to test this way */
                if (data[property]) {
                    doc[property] = data[property];
                }
            });
        }
    }

    /**
     * Update an existing row
     * @param doc - row to update
     * @param [data] - Data to apply to the row before saving
     * @param [options] – Query options
     */
    update(doc, data, options={}) {

        const { client } = options;

        // Apply any given key updates, if given
        this._applyUpdates(doc, data);

        // Ensure when you update an object, no matter what it is, we update our auditing field
        if (this.updatedField) doc[this.updatedField] = new Date();

        // Make sure we know what we are updating!
        if (doc[this.idField] === undefined) {
            this.app.report('PostgresCrudService: Cannot update row if id field not provided!', { doc, data, idField: this.idField })
            return Promise.reject(new Error('PostgresCrudService: Cannot update row if id field not provided'));
        } else {

            // Remove the id field from the query so we're not randomly setting id=id in there
            const args = [];
            const setData = Object.assign({}, doc);
            delete setData[this.idField];
            const sets = Object.keys(setData).map((field) => {
                args.push(setData[field]);
                return `"${field}" = $${args.length}`;
            });


            let sql = `UPDATE "${this.schema}"."${this.table}" SET ${sets.join(', ')} WHERE "${this.idField}" = $${args.length+1} RETURNING *`;
            args.push(doc[this.idField]);

            return this.service.query(
                sql,
                args,
                { client }
            )
                .then(res => res.rows[0])
            ;
        }
    }

    /**
     * Updates all records that match the given criteria with the given properties
     * @param {*} criteria – Query criteria (just like _find)
     * @param {*} data – Column-value properties to set on each matched record
     * @param {{client:*, conceal:boolean}} [options] – Additional options
     */
    bulkUpdate(criteria, data, options={}) {
        const { client, conceal = true } = (options || {});

        // Normalize criteria
        criteria = criteria || {};

        // Automatically bump updated time on matched records if configured to do so
        if (this.updatedField) data[this.updatedField] = new Date();

        const args = [];
        const setData = Object.assign({}, data);
        delete setData[this.idField];

        const sets = Object.keys(setData).map((field) => {
            args.push(setData[field]);
            return `"${field}" = $${args.length}`;
        });

        let sql = `UPDATE "${this.schema}"."${this.table}" SET ${sets.join(', ')}`;

        let where = [];

        // Actively prevent dead resources from updating, even if a status was given
        if (this._concealDeadResources && conceal) {

            // Check if we were given a status filter
            if (criteria[this.statusField]) {

                // Composite both status requirements together
                where.push(`"${this.statusField}" = $${args.length+1} AND "${this.statusField}" != $${args.length+2}`);
                args.push(criteria[this.statusField]);
                args.push(this._deletedStatus);

                // Remove the original status filter from criteria
                delete criteria[this.statusField];

            } else {
                // No status given, default it to conceal dead things
                criteria[this.statusField] = { $ne: this._deletedStatus };
            }
        }

        // Add criteria to query
        this._buildCriteria(criteria, where, args);
        if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;

        return this.service.query(
            sql,
            args,
            { client }
        );
    }

    /**
     * Fake-deletes a row from the table (by changing its status to dead and updating the row)
     * @param {*} doc - Row to update
     * @param {*} [options] – Query options
     */
    delete(doc, options) {
        doc[this.statusField] = this._deletedStatus;
        return this.update(doc, null, options);
    }

    /**
     * Fake-deletes all matching rows from the table (by changing status to dead)
     * @param {*} criteria – Query criteria (just like _find)
     * @param {{conceal:boolean}} [options] – Additional options
     */
    bulkDelete(criteria, options={}) {
        return this.bulkUpdate(criteria, { [this.statusField]: this._deletedStatus }, options);
    }

    /**
     * Permanently removes a row from the table
     * @param {*} doc - row to delete
     * @param {*} [options] - Query options
     */
    deletePermanently(doc, options={}) {
        const { client } = options;

        // Make sure we know what we are deleting!
        if (doc[this.idField] === undefined) {
            this.app.report('PostgresCrudService: Cannot delete row if id field not provided!', { doc, idField: this.idField });
            return Promise.reject(new Error('PostgresCrudService: Cannot delete row if id field not provided'));
        } else {

            let sql = `DELETE FROM "${this.schema}"."${this.table}" WHERE "${this.idField}" = $1 RETURNING *`;
            let args = [doc[this.idField]];

            return this.service.query(
                sql,
                args,
                { client }
            );
        }
    }

    /**
     * Permanently removes all records matching the given criteria from the table
     * @param {*} criteria – Query criteria (just like _find)
     * @param {{conceal:boolean}} [options] – Additional options
     */
    bulkDeletePermanently(criteria, options={}) {

        const { client, conceal=true } = options;

        // Normalize criteria
        criteria = criteria || {};

        let sql = `DELETE FROM "${this.schema}"."${this.table}"`;
        let args = [];
        let where = [];

        // Actively prevent dead resources from updating, even if a status was given
        if (this._concealDeadResources && conceal) {

            // Check if we were given a status filter
            if (criteria[this.statusField]) {

                // Composite both status requirements together
                where.push(`"${this.statusField}" = $1 AND "${this.statusField}" != $2`);
                args.push(criteria[this.statusField]);
                args.push(this._deletedStatus);

                // Remove the original status filter from criteria
                delete criteria[this.statusField];

            } else {
                // No status given, default it to conceal dead things
                criteria[this.statusField] = { $ne: this._deletedStatus };
            }
        }

        // Add criteria to query
        this._buildCriteria(criteria, where, args);
        if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;

        return this.service.query(
            sql,
            args,
            { client }
        );
    }
}

/**
 * Query mode for _find
 * @type {{COUNT: string}}
 * @private
 */
PostgresCrudService._QUERY_MODE = {
    COUNT: 'COUNT'
};

// I hope you don't really need to do this
PostgresCrudService.MAX_VALUE = Number.MAX_VALUE;

module.exports = PostgresCrudService;
