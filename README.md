# serverless-prisma

Small packages that help Prisma handle a serverless environment better, partially inspired by [serverless-mysql](https://github.com/jeremydaly/serverless-mysql) and [serverless-pg](https://github.com/MatteoGioioso/serverless-pg)

## Problem

When running a Prisma based application in a serverless environment, you might end up with all your database connections being "in use" by serverless environments (that even might not actively be responding to requests right now). This is not Prisma's fault, as you would get the same behavior with any other database client in a serverless environment. But of course this fundamentally does not matter - as a user I want to be able to use Prisma in a serverless environment.

## Solutions

### Primitive

- On "Too many connections" error, retry creating connection a few times instead of directly failing (different strategies)
- After successful execution, close own connection when high connection usage on database server detected

### Advanced

- Handle own connection (from previous connection usage) being gone and retry instead of just failing
- After successful execution, kill _other_ connections that have been idle (not been used) for some time

## Implementation plan

1. Test that reliably produces "too many connections" errors (via serverless deployment)
2. Implement "Too many connections" retry as [Prisma Middleware](https://www.prisma.io/docs/concepts/components/prisma-client/middleware)
3. Implement method that closes own connection via `$disconnect` in high connection usage situation
4. Implement "connection gone" (or whatever it presents as) error as [Prisma Middleware](https://www.prisma.io/docs/concepts/components/prisma-client/middleware) as well (big hammer: `$disconnect`, then query again)
5. Implement method that kills other connections
