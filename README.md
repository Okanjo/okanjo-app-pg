# Okanjo Postgres Service

[![Node.js CI](https://github.com/Okanjo/okanjo-app-pg/actions/workflows/node.js.yml/badge.svg)](https://github.com/Okanjo/okanjo-app-pg/actions/workflows/node.js.yml) [![Coverage Status](https://coveralls.io/repos/github/Okanjo/okanjo-app-pg/badge.svg?branch=master)](https://coveralls.io/github/Okanjo/okanjo-app-pg?branch=master)

Service for interfacing with Postgres for the Okanjo App ecosystem.

## Installing

Add to your project like so: 

```sh
npm install okanjo-app-pg
```

Note: requires the [`okanjo-app`](https://github.com/okanjo/okanjo-app) module.

# Classes

 * [PostgresService](#postgresservice) – Postgres interface service
 * [PostgresCrudService](#postgrescrudservice) – CRUD base class for Postgres relational tables. Depends on PostgresService.


# PostgresService

Postgres management class. Must be instantiated to be used.

```js
const { PostgresService } = require('okanjo-app-pg');
```

## Properties
* `service.app` – (read-only) The OkanjoApp instance provided when constructed
* `service.config` – (read-only) The Postgres service configuration provided when constructed
* `service.pool` – (read-only) The underlying [postgres connection pool](https://node-postgres.com/features/pooling)

## Methods

### `new PostgresService(app, config)`

Creates a new postgres service instance.

* `app` – The OkanjoApp instance to bind to
* `config` – (Required) The postgres service configuration object.
  * `config.host` – Server hostname or ip address
  * `config.port` – Server port
  * `config.user` – Username to login as 
  * `config.password` – Password for the user 
  * `config.database` – (optional) Sets the context database if given.
  * See [connection options](https://node-postgres.com/api/client) for additional connection/pool options.

### `async service.connect()`
Initializes the connection pool client. Automatically called when app starts.

### `async service.close()`
Closes down the connection pool client.

### `service.query(sql, args, [options])`
Executes a query on the connection pool.
* `sql` – SQL string to execute
* `args` – Query arguments for prepared statements.
* `options` – (optional) Query options
  * `options.client` – to execute the query on. If none given, a new Client will be pulled from the pool.
  * `options.suppress` – A regular expression to match against error messages (suppressed if matched)
* Returns `Promise<rows>`

### `service.getConnection()`
Gets a dedicated client from the pool. You must release it back to the pool when you are finished with it.
* Returns `Promise<Client>`
  
> Note: You must call `client.release();` when you have finished using the session to return it back to the pool.

## Events

This class does not emit events.


# PostgresCrudService

Base class for building services based on relational Postgres tables. The idea of using PostgresCrudService is to:
 * Stop duplicating logic across every service you have to write (CRUDL)
 * Automatically handle and report errors on common operations so you don't need to in the business logic
 * Provide base functions that can be used in the service.
 * Provide hooks to create non-existent schemas and tables.
 * Conceal deleted rows without actually deleting them.
   * We don't like to permanently delete data. Instead, we like to leave tombstones behind so we can audit before cleaning up later. This is also very handy for syncing to data lakes. Do you know what rows were deleted in the last 15 minutes?
   * When a row is deleted, its `status` column is just set to `dead`. 
   * The `find`, `retrieve`, `bulkUpdate`, `bulkDelete` and `bulkPermanentlyDelete` helpers automatically deal with dead rows, pretending like they were really deleted.

Note: you should extend this class to make it useful!

```js
const { PostgresCrudService } = require('okanjo-app-pg');
```

## Properties
* `service.app` – (read-only) The OkanjoApp instance provided when constructed
* `service.service` – (read-only) The PostgresService instance managing the connection pool
* `service.schema` – (read-only) The string name of the database schema the table is in 
* `service.table` – (read-only) The string name of the table this service is treating as a resource collection
* `service.idField` – (read-only) The field that is expected to be unique, like a single-column primary key.
* `service.statusField` – (read-only) The field that is used for row status, such as `dead` statuses
* `service.updatedField` – (read-only) The field that is automatically set to `new Date()` when updating
* `service._modifiableKeys` – (read-only) What column names are assumed to be safe to copy from user-data
* `service._deletedStatus` – (read-only) The status to set docs to when "deleting" them
* `service._concealDeadResources` – (read-only) Whether this service should actively prevent "deleted" (status=dead) resources from returning in _retrieve and _find  

## Methods

### `new PostgresCrudService(app, options)`
Creates a new instance. Ideally, you would extend it and call it via `super(app, options)`.
* `app` – The OkanjoApp instance to bind to
* `options` – Service configuration options
  * `options.service` – (Required) The PostgresService instance managing the connection pool
  * `options.schema` – (Optionalish) The string name of the database the table. Defaults to `service.config.database` if not defined.
  * `options.table` – (Required) The string name of the table this service is managing
  * `options.idField` – (Optional) The field that is expected to be unique, like a single-column primary key. Defaults to `id`.
  * `options.statusField` – (Optional) The field that is used for row status, such as `dead` statuses. Defaults to `status`.
  * `options.updatedField` – (Optional) The field that is automatically set to `new Date()` when updating. Defaults to `updated`.
  * `options.modifiableKeys` – (Optional) What column names are assumed to be safe to copy from user-data. Defaults to `[]`.
  * `options.deletedStatus` – (Optional) The status to set docs to when "deleting" them. Defaults to `dead`.
  * `options.concealDeadResources` – (Optional) Whether this service should actively prevent "deleted" (status=dead) resources from returning in `_retrieve`, `_find`, `_bulkUpdate`, `_bulkDelete`, and `_bulkDeletePermanently`. Defaults to `true`.

### `async _createSchema(client)`
Hook fired during `init()` if the database schema does not exist. By default, the schema will be created.
Override this function to change or enhance functionality. For example, use it to create stored procedures, triggers, views, etc.  
 * `client` – The active connection Client.
 * No return value
 
### `async _updateSchema(client)`
Hook fired during `init()` if the database schema already exists. By default, this function does nothing. 
Override this function to change or enhance functionality. For example, use it to create stored procedures, triggers, views, etc.  
* `client` – The active connection Client.
* No return value

### `async _createTable(client)`
Hook fired during `init()` if the table does not exist in the schema. By default, this function will throw an exception.
Override this function to create your table.
* `client` – The active connection Client.
* No return value

> Note: you must override this method if you want `init` to auto-create your table. 

### `async _updateTable(client)`
Hook fired during `init()` if the table already exists in the schema. By default, this function does nothing.
Override this function to update your table definitions or enhance functionality.
* `client` – The active connection Client.
* No return value

### `async init()`
Initializes the database and table. Uses the aforementioned hook functions to create or update the schema and table.

### `create(data, [options])`
Creates a new row.
* `data` – The row object to store
* `options` – (Optional) Query options
  * `options.client` – The connection to execute the query on. Defaults to the service pool.
* Returns `Promise<doc>`

### `retrieve(id, [options])`
Retrieves a single row from the table.
* `id` – The id of the row.
* `options` – (Optional) Query options
  * `options.client` – The connection to execute the query on. Defaults to the service pool.
* Returns `Promise<doc>`
  
### `find(criteria, [options])`
Finds rows matching the given criteria. Supports pagination, field selection and more!
* `criteria` – Object with field-value pairs. Supports some special [mongo-like operators](#special-operators)
* `options` – (Optional) Additional query options
  * `options.skip` – Offsets the result set by this many records (pagination). Default is unset.  
  * `options.take` – Returns this many records (pagination). Default is unset.
  * `options.fields` – Returns only the given fields (same syntax as mongo selects, e.g. `{ field: 1, exclude: 0 }` ) Default is unset.
  * `options.sort` – Sorts the results by the given fields (same syntax as mongo sorts, e.g. `{ field: 1, reverse: -1 }`). Default is unset.
  * `options.conceal` – Whether to conceal dead resources. Default is `true`. 
  * `options.mode` – (Internal) Query mode, used to toggle query modes like SELECT COUNT(*) queries
  * `options.client` – The connection to execute the query on. Defaults to the service pool.
* Returns `Promise<rows>`

#### Special operators
Mongo uses a JSON-like query syntax that is robust and easy to use. Postgres uses SQL, which means translating from JSON isn't wonderful.
Instead, we opted to support some mongo-like operators for consistency with our okanjo-app-mongo version of CrudService.

* `{ field: value }` – Equal – Translates to `WHERE field = value`
* `{ field: [ values... ]` – IN – Translates to `WHERE field IN (values...)`
* `{ field: { $ne: value } }` - Not-Equal – Translates to `WHERE field != value`
* `{ field: { $ne: [ values... ] } }` - Not-IN– Translates to `WHERE field NOT IN (values...)`
* `{ field: { $gt: value } }` - Greater-Than – Translates to `WHERE field > value`
* `{ field: { $gte: value } }` - Greater-Than-Or-Equal – Translates to `WHERE field >= value`
* `{ field: { $lt: value } }` - Less-Than – Translates to `WHERE field < value`
* `{ field: { $lte: value } }` - Less-Than-Or-Equal – Translates to `WHERE field <= value`

### `count(criteria, [options])`
Counts the number of matched records.
* `criteria` – Object with field-value pairs. Supports some special [mongo-like operators](#special-operators)
* `options` – (Optional) Additional query options
  * `options.conceal` – Whether to conceal dead resources. Default is `true`.
  * `options.client` – The connection to execute the query on. Defaults to the service pool.
* Returns `Promise<BigInt>`

### `update(row, [data], [options])`
Updates the given row and optionally applies user-modifiable fields, if service is configured to do so.
* `doc` – The row to update. Must include configured id field.  
* `data` – (Optional) Additional pool of key-value fields. Only keys that match `service._modifiableKeys` will be copied if present. Useful for passing in a request payload and copying over pre-validated data as-is.
* `options` – (Optional) Query options
  * `options.client` – The connection to execute the query on. Defaults to the service pool.  
* Returns `Promise<doc>`
  
### `bulkUpdate(criteria, data, [options])`
Updates all rows matching the given criteria with the new column values.
* `criteria` – Object with field-value pairs. Supports some special [mongo-like operators](#special-operators)
* `data` – Field-value pairs to set on matched rows
* `options` – (Optional) Additional query options
  * `options.conceal` – Whether to conceal dead resources. Default is `true`.
  * `options.client` – The connection to execute the query on. Defaults to the service pool.
* Returns `Promise<Result>`

### `delete(row, [options])`
Fake-deletes a row from the table. In reality, it just sets its status to `dead` (or whatever the value of `service._deletedStatus` is).
* `doc` – The row to delete. Must include configured id field.
* `options` – (Optional) Query options
  * `options.client` – The connection to execute the query on. Defaults to the service pool.  
* Returns `Promise<doc>`
  
### `bulkDelete(criteria, [options])`
Fake-deletes all rows matching the given criteria.
* `criteria` – Object with field-value pairs. Supports some special [mongo-like operators](#special-operators)
* `options` – (Optional) Additional query options
  * `options.conceal` – Whether to conceal dead resources. Default is `true`.
  * `options.client` – The connection to execute the query on. Defaults to the service pool.
* Returns `Promise<Result>`

### `deletePermanently(row, [options])`
Permanently deletes a row from the table. This is destructive!
* `doc` – The row to delete. Must include configured id field.
* `options` – (Optional) Query options
  * `options.client` – The connection to execute the query on. Defaults to the service pool.   
* Returns `Promise<doc>`

### `bulkDeletePermanently(criteria, [options])`
Permanently deletes all rows matching the given criteria.
* `criteria` – Object with field-value pairs. Supports some special [mongo-like operators](#special-operators)
* `options` – (Optional) Additional query options
  * `options.conceal` – Whether to conceal dead resources. Default is `true`.
  * `options.client` – The connection to execute the query on. Defaults to the service pool.
* Returns `Promise<Result>`
  
## Events

This class does not emit events.

## Debugging
Both PostgresService and PostgresCrudService utilize the [debug](https://www.npmjs.com/package/debug) module for service-level diagnostics. 

 * For PostgresService debugging, set the environment variable `DEBUG=pg*`

## Extending and Contributing 

Our goal is quality-driven development. Please ensure that 100% of the code is covered with testing.

Before contributing pull requests, please ensure that changes are covered with unit tests, and that all are passing. 

### Testing

Before you can run the tests, you'll need a working Postgres server. We suggest using docker.

For example:

```bash
docker pull postgres:14
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=unittest postgres:14

```

To run unit tests and code coverage:
```sh
PG_HOST=localhost PG_PORT=5432 PG_USER=root PG_PASS=unittest npm run report
```


Update the `PG_*` environment vars to match your docker host (e.g. host, port, user, pass etc)

This will perform:
* Unit tests
* Code coverage report
* Code linting

Sometimes, that's overkill to quickly test a quick change. To run just the unit tests:
 
```sh
npm test
```

or if you have mocha installed globally, you may run `mocha test` instead.
