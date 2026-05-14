import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/config.ts',
  out: './migrations/config',
  dbCredentials: { url: ':memory:' },
});
