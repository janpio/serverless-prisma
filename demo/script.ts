import { Prisma, PrismaClient } from '@prisma/client'
import { ServerlessPrisma, manageConnections } from './serverless-prisma'

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {  
  let clients = []

  /* 
   * loop creation of new Prisma Clients to simulate multiple Lambda environments
   */
  const max = 20
  for (let i = 1; i < max; i++) {
    console.log(i)

    let prisma = new PrismaClient()
    prisma.$use(ServerlessPrisma())

    // run queries
    await prisma.$executeRaw(`SET application_name to 'Prisma #${i}'`)
    let all = await prisma.user.findMany() //prisma.$connect()

    // log success
    let open_connections = await prisma.$queryRaw(`SELECT sum(numbackends) FROM pg_stat_database; --TODO WHERE datname = 'tests';`)
    console.log(i + ': connection successful, ', all, 'open connections: ', open_connections[0].sum)

    // manage connections
    await manageConnections(prisma)

    // store client for later
    clients.push(prisma)

    // sleep for a few ms so we can visually process the output
    await sleep(50)
  }

  //console.log('clients', clients)


  /*
   * then use one of those clients again to see how it handles its connection having been killed
   */

  await sleep(500)

  
  // add retry to client #3
  // clients[3].$use(Retry())

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
    await sleep(5000)
    process.exit()
  })