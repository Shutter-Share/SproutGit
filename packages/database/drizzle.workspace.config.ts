import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/workspace.ts',
  out: './migrations/workspace',
  dbCredentials: { url: ':memory:' },
});
