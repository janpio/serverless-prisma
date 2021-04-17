import { Prisma } from "@prisma/client";
import { Client as PgClient } from 'pg'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  
    // TODO Use current Prisma Client!
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
    // console.log({ terminate })
    await sleep(1000) // wait 1 second for monitoring to pick up connection # before terminating

    // TODO Use current Prisma Client!
    const t = await pgClient.query(terminate)
    const res = t.rows
    console.log('killresults', { res })

    await getOpenConnections();
  }
}


// control connection
const pgClient = new PgClient('postgresql://root2:prisma@localhost:5432/postgres?schema=public')
pgClient.connect()

export const ServerlessPrisma = (): Prisma.Middleware => {
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

          // TODO: Having this here in the middleware makes no sense at all!
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