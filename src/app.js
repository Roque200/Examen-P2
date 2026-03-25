require('dotenv').config()

const express    = require('express')
const Blockchain = require('./blockchain/Blockchain')
const logger     = require('./middleware/logger')

const chainRoutes       = require('./routes/chain')
const mineRoutes        = require('./routes/mine')
const transactionRoutes = require('./routes/transactions')
const nodeRoutes        = require('./routes/nodes')

async function startServer() {
  const app  = express()
  const PORT = process.env.PORT || 8001

  // Inicializar blockchain (carga desde Supabase o crea génesis)
  const blockchain = new Blockchain()
  await blockchain.inicializar()
  app.set('blockchain', blockchain)

  app.use(express.json())
  app.use(logger)

  app.use('/chain',        chainRoutes)
  app.use('/mine',         mineRoutes)
  app.use('/transactions', transactionRoutes)
  app.use('/nodes',        nodeRoutes)

  app.get('/health', (req, res) => {
    res.json({
      status:     'ok',
      nodeId:     process.env.NODE_ID || 'nodo-1',
      port:       PORT,
      bloques:    blockchain.chain.length,
      pendientes: blockchain.transaccionesPendientes.length,
      peers:      blockchain.getNodos(),
    })
  })

  app.use((req, res) => {
    res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` })
  })

  app.use((err, req, res, next) => {
    console.error(`[Error] ${err.message}`)
    res.status(500).json({ error: 'Error interno del servidor' })
  })

  app.listen(PORT, () => {
    console.log(`\n Nodo blockchain corriendo`)
    console.log(`   NODE_ID : ${process.env.NODE_ID || 'nodo-1'}`)
    console.log(`   Puerto  : ${PORT}`)
    console.log(`   PoW     : ${'0'.repeat(parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3'))}...\n`)
  })
}

startServer().catch(err => {
  console.error('[Fatal] No se pudo iniciar el servidor:', err.message)
  process.exit(1)
})
