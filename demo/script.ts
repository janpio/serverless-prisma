import { Prisma, PrismaClient } from '@prisma/client'
import { Client as PgClient } from 'pg'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

import { Retry } from './retry';

async function main() {

  const pgClient = new PgClient('postgresql://root2:prisma@localhost:5432/postgres?schema=public')
  pgClient.connect()
  
  let clients = []

  const max = 20

  for (let i = 1; i < max; i++) {
    console.log(i)

    // create new QE and create connection
    let prisma = new PrismaClient()

    prisma.$use(async (params, next) => {
      // Manipulate params here
      const result = await next(params);
      // See results here
      return result;
  })

    clients.push(prisma)
    try {
      await prisma.$queryRaw(`SET application_name to 'Prisma #${i}'`)
      let all = await prisma.user.findMany() //prisma.$connect()

      let conns = await pgClient.query(`SELECT sum(numbackends) FROM pg_stat_database WHERE datname = 'tests';`)

      console.log(i + ': connection successful, ', all, 'open connections: ', conns.rows[0].sum)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientInitializationError) {
        if (e.message.includes('Error querying the database: db error: FATAL: sorry, too many clients already')) {
          console.log("RETRY HERE")
        }
      }
      console.log(i + ': error', e)
      process.exit()
    }

    // output # open connections via other connection

    // kill the oldest connection to free up
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
  where usename='prisma'
  ;`
  
    const r = await pgClient.query(query)
    //console.log('r.rows', r.rows)
    const pids = r.rows.map((r) => r['process_id'])
    console.log({ pids })
  
    // terminate if more than 20 open connections
    if(pids.length >= 5) {
      const terminate = `
    SELECT 
        ${pids.map((pid) => `pg_terminate_backend(${pid})`).join(',')}
    FROM 
        pg_stat_activity 
    WHERE 
        -- don't kill my own connection!
        pid <> pg_backend_pid()
        -- don't kill the connections to other databases
        AND datname = 'tests'
    ;
      `
      await sleep(1000) // wait 1 second for monitoring to pick up connection # before terminating
      const t = await pgClient.query(terminate)
      const res = t.rows
      console.log({ res })
    }

    // sleep for a few ms
    await sleep(50)

    //process.exit()

  }

  //console.log('clients', clients)

  // add retry to client3
  clients[3].$use(Retry())

  try {
    console.log('client 3, retry 1')
    // TODO measure how long this takes to crash
    let all = await clients[3].user.findMany()
    console.log('retry 1', all)
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
    await sleep(5000)
    process.exit()
  })