import { Prisma, PrismaClient } from "@prisma/client";

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getRunningProcesses(prisma: PrismaClient) {
    // get open connections
    const open_connections = `
select pid as process_id, 
    usename as username, 
    datname as database_name, 
    client_addr as client_address, 
    application_name,
    backend_start,
    state,
    state_change
from pg_stat_activity
where usename = 'prisma' --TODO
  and datname = 'tests'
	and state = 'idle'
order by state_change ASC
    ;`
  
    const r = await prisma.$queryRaw(open_connections)
    //console.log(r)
    const pids = r.map((row: { process_id: any; }) => row.process_id)
    //console.log('running processes', { pids })
    return pids
}

export async function manageConnections(prisma: PrismaClient) {

  let running_processes = await getRunningProcesses(prisma);
  // TODO debug
  console.log({ before: running_processes.length }, running_processes);

  // terminate if more than x open connections
  const manage_threshhold = 7 // TODO
  const num_connections_to_manage = 3 // TODO
  if(running_processes.length >= manage_threshhold) { 

    let connections_to_manage = running_processes.slice(0, num_connections_to_manage)
    console.log({ connections_to_manage })

    // wait 1 second for monitoring to pick up connection # before managing connections
    await sleep(1000) 

    const manage_connections = `
      SELECT 
        ${connections_to_manage.map((pid: number) => `pg_terminate_backend(${pid})`).join(',')}
      FROM 
        pg_stat_activity 
      WHERE 
        -- don't kill my own connection!
        pid <> pg_backend_pid()
        -- only kill the connections to this databases
        AND datname = 'tests' -- TODO
      ;
    `
    // console.log({ manage_connections })
    let managed_connections = await prisma.$queryRaw(manage_connections)
    // console.log({ managed_connections })

    // TODO debug
    const after_connections = await getRunningProcesses(prisma)
    console.log({ after: after_connections.length}, after_connections);
  }
}



/*
 * Middleware
 */

export class PrismaServerlessRetryError extends Error {
  constructor(error: string) {
    super(error)
    this.name = 'PrismaServerlessRetryError';
  }
}

export const ServerlessPrisma = (): Prisma.Middleware => {
  return async (params, next) => {
    let maxRetries = 3
    let retries = 0;
    let lastError = undefined
    do {
      try {
        //console.log('outofconnections middleware retries', retries)
        const result = await next(params);
        return result;
      } catch (err) {
        //console.log('outofconnections middleware error', err.message.substring(0, 200))
        if (
          (
            err instanceof Prisma.PrismaClientInitializationError &&
            err.message.includes('Error querying the database: db error: FATAL: sorry, too many clients already')
          ) || (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P1017" // Server has closed the connection.
          ) || (
            err instanceof Prisma.PrismaClientUnknownRequestError &&
            err.message.includes('57P01') // terminating connection due to administrator command
          ) || (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2010" // Raw query failed
            // && err.meta && err.meta.code === '57P01' // TODO Why does this not work?
          )
        ) {

          if(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2010") {
            console.log("THIS SHOULD NOT REALLY HAPPEN", params)
            console.log(err)
          }

          //console.log('outofconnections middleware error', err)
          retries += 1;

          // TODO Add some variable backoff or strategy
          sleep(500)

          // store error for if we can not resolve the problem
          lastError = err

          continue;
        }

        // not one of our expected errors, so let's just rethrow and not worry about it
        throw err;
      }
    } while (retries < maxRetries);

    // well, could not resolve the error so let's rethrow itlet's do it this way then
    throw new PrismaServerlessRetryError(lastError.toString()) // TODO better solution than toString here with this error?
  }
}