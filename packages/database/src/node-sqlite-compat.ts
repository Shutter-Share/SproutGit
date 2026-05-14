/**
 * Compatibility adapter: wraps Node.js built-in `node:sqlite` (DatabaseSync)
 * to expose the same interface that `drizzle-orm/better-sqlite3` expects.
 *
 * `better-sqlite3` is incompatible with Electron 42's V8 API, so we use the
 * built-in `node:sqlite` module (available since Node 22.5 / Electron 32).
 */
import { DatabaseSync, StatementSync, type SQLInputValue } from 'node:sqlite';

// ─── Row types ───────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type RunResult = { changes: number; lastInsertRowid: number | bigint };

// ─── Statement wrapper ───────────────────────────────────────────────────────

interface RawStatement {
  get(...params: unknown[]): unknown[] | undefined;
  all(...params: unknown[]): unknown[][];
}

interface CompatStatement {
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): RunResult;
  raw(): RawStatement;
}

function wrapStatement(stmt: StatementSync): CompatStatement {
  const rawWrapper: RawStatement = {
    get(...params: unknown[]): unknown[] | undefined {
      const row = stmt.get(...(params as SQLInputValue[])) as Row | undefined;
      if (row == null) return undefined;
      return Object.values(row);
    },
    all(...params: unknown[]): unknown[][] {
      const rows = stmt.all(...(params as SQLInputValue[])) as Row[];
      return rows.map((r) => Object.values(r));
    },
  };

  return {
    get(...params: unknown[]): Row | undefined {
      return stmt.get(...(params as SQLInputValue[])) as Row | undefined;
    },
    all(...params: unknown[]): Row[] {
      return stmt.all(...(params as SQLInputValue[])) as Row[];
    },
    run(...params: unknown[]): RunResult {
      return stmt.run(...(params as SQLInputValue[])) as unknown as RunResult;
    },
    raw(): RawStatement {
      return rawWrapper;
    },
  };
}

// ─── Transaction wrapper ─────────────────────────────────────────────────────

type AnyFn = (...args: unknown[]) => unknown;

type TransactionHandle = {
  deferred: AnyFn;
  immediate: AnyFn;
  exclusive: AnyFn;
} & AnyFn;

function wrapTransaction(raw: DatabaseSync, fn: AnyFn): TransactionHandle {
  function runInTransaction(behavior: string) {
    return (...args: unknown[]): unknown => {
      raw.exec(behavior === 'deferred' ? 'BEGIN' : `BEGIN ${behavior.toUpperCase()}`);
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  }

  const deferred = runInTransaction('deferred');
  const immediate = runInTransaction('immediate');
  const exclusive = runInTransaction('exclusive');

  return Object.assign(deferred, { deferred, immediate, exclusive }) as TransactionHandle;
}

// ─── Database wrapper ─────────────────────────────────────────────────────────

export interface CompatDatabase {
  prepare(sql: string): CompatStatement;
  exec(sql: string): this;
  pragma(pragma: string): unknown;
  transaction(fn: AnyFn): TransactionHandle;
  close(): void;
}

/**
 * Opens a SQLite database using the built-in `node:sqlite` module and returns
 * an object with the same API surface that `drizzle-orm/better-sqlite3` uses.
 */
export function openNodeSqlite(path: string): CompatDatabase {
  const raw = new DatabaseSync(path);

  const db: CompatDatabase = {
    prepare(sql: string): CompatStatement {
      return wrapStatement(raw.prepare(sql));
    },
    exec(sql: string): typeof db {
      raw.exec(sql);
      return db;
    },
    /** Executes a PRAGMA statement. Return value is ignored by our callers. */
    pragma(pragma: string): unknown {
      raw.exec(`PRAGMA ${pragma}`);
      return [];
    },
    transaction(fn: AnyFn): TransactionHandle {
      return wrapTransaction(raw, fn);
    },
    close(): void {
      raw.close();
    },
  };

  return db;
}
