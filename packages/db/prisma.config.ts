import { defineConfig } from 'prisma/config'

// Used only for `prisma generate` and `prisma migrate diff` while developing Tala.
// Consumers never run Prisma CLI commands; they run `tala-db migrate`.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.TALA_DEV_DATABASE_URL ?? 'postgresql://localhost:5432/tala_dev',
  },
})
