import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaClientUnknownRequestError } from '@prisma/client/runtime';
import { Client as PgClient } from 'pg'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

import { Retry } from './retry';


async function getOpenConnections() {
    // get open connections
    const query = `
    select pid as process_id, 
    usename as username, 
    datname as database_name, 
    client_addr as client_address, 
    application_name,
    backend_start,
    state,
    state_change
    from pg_stat_activity
    where usename='prisma' -- TODO
    ;`
  
    const r = await pgClient.query(query)
    //console.log('r.rows', r.rows)
    const pids = r.rows.map((r) => r['process_id'])
    console.log('running processes', { pids })
    return pids
}

async function killConnections() {

  let pids = await getOpenConnections();

  // terminate if more than x open connections
  if(pids.length >= 5) { // TODO 5

    let to_kill = pids.slice(0,5) // TODO 5
    console.log({ to_kill })

    const terminate = `
  SELECT 
      ${to_kill.map((pid) => `pg_terminate_backend(${pid})`).join(',')}
  FROM 
      pg_stat_activity 
  WHERE 
      -- don't kill my own connection!
      pid <> pg_backend_pid()
      -- only kill the connections to this databases
      AND datname = 'tests' -- TODO
  ;
    `
    console.log({ terminate })
    await sleep(1000) // wait 1 second for monitoring to pick up connection # before terminating
    const t = await pgClient.query(terminate)
    const res = t.rows
    console.log('killresults', { res })

    await getOpenConnections();
  }
}

const ServerlessPrisma = (): Prisma.Middleware => {
  return async (params, next) => {
    let maxRetries = 3
    let retries = 0;
    do {
      try {
        //console.log('outofconnections middleware retries', retries)
        const result = await next(params);
        return result;
      } catch (err) {
        //console.log('outofconnections middleware error', err.message.substring(0, 200))
        if (
          err instanceof Prisma.PrismaClientInitializationError &&
          err.message.includes('Error querying the database: db error: FATAL: sorry, too many clients already')
        ) {
          //console.log('outofconnections middleware error', err)

          // cleanup
          await killConnections()
          //process.exit()

          retries += 1;
          continue;
        }
        throw err;
      }
    } while (retries < maxRetries);
    throw new Error()
  }
}

// control connection
const pgClient = new PgClient('postgresql://root2:prisma@localhost:5432/postgres?schema=public')
pgClient.connect()

async function main() {  
  let clients = []

  const max = 20
  for (let i = 1; i < max; i++) {
    console.log(i)

    let prisma = new PrismaClient()
    prisma.$use(ServerlessPrisma())

    // run queries
    await prisma.$queryRaw(`SET application_name to 'Prisma #${i}'`)
    let all = await prisma.user.findMany() //prisma.$connect()

    // log success
    let open_connections = await pgClient.query(`SELECT sum(numbackends) FROM pg_stat_database; --WHERE datname = 'tests';`)
    console.log(i + ': connection successful, ', all, 'open connections: ', open_connections.rows[0].sum)

    // store client for later
    clients.push(prisma)

    // sleep for a few ms
    await sleep(50)
  }

  //console.log('clients', clients)

  // add retry to client3
  clients[3].$use(Retry())

  await sleep(500)

  try {
    console.log('client 3, retry 1')
    // TODO measure how long this takes to crash
    let all = await clients[3].user.findMany()
    console.log('retry 1', all)

    await clients[3].$queryRaw(`SET application_name to 'RETRIED CLIENT'`)

  } catch(e) {
    console.log(e)
  }
  
  try {
    console.log('client 3, retry 2')
    let all = await clients[3].user.findMany()
    console.log('retry 2', all)
  } catch(e) {
    console.log(e)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    //await prisma.$disconnect()
    await sleep(500000)
    process.exit()
  })