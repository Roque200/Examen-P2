require('dotenv').config()

const express    = require('express')
const Blockchain = require('./blockchain/Blockchain')
const logger     = require('./middleware/logger')

const chainRoutes       = require('./routes/chain')
const mineRoutes        = require('./routes/mine')
const transactionRoutes = require('./routes/transactions')
const nodeRoutes        = require('./routes/nodes')

const swaggerUi   = require('swagger-ui-express')
const YAML        = require('yamljs')
const swaggerDoc  = YAML.load('./swagger.yaml')
const cors        = require('cors')
const { sha256 }  = require('./utils/hash')

async function startServer() {
  const app  = express()
  const PORT = process.env.PORT || 8001

  const blockchain = new Blockchain()
  await blockchain.inicializar()
  app.set('blockchain', blockchain)

  app.use(express.json())
  app.use(cors())
  app.use(logger)

  app.use('/chain',        chainRoutes)
  app.use('/mine',         mineRoutes)
  app.use('/transactions', transactionRoutes)
  app.use('/nodes',        nodeRoutes)
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc))

  /**
   * POST /blocks/receive
   * Alias de /nodes/block para compatibilidad con el nodo del compañero (Laravel/Next/Express)
   * que propaga bloques a esta ruta en lugar de /nodes/block
   */
  app.post('/blocks/receive', (req, res) => {
    const bloque   = req.body.bloque || req.body.block
    const difficulty = parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3')

    if (!bloque) {
      return res.status(400).json({ error: 'Se requiere el campo "bloque" o "block"' })
    }

    const ultimoLocal          = blockchain.ultimoBloque
    const hashAnteriorRecibido = bloque.hashAnterior || bloque.previousHash || bloque.previous_hash
    const hashActualRecibido   = bloque.hashActual   || bloque.hash         || bloque.current_hash

    if (hashAnteriorRecibido !== ultimoLocal.hashActual && hashAnteriorRecibido !== ultimoLocal.hash) {
      return res.status(409).json({ error: 'El hash anterior no coincide — usa /nodes/resolve' })
    }

    if (!hashActualRecibido || !hashActualRecibido.startsWith('0'.repeat(difficulty))) {
      return res.status(400).json({ error: 'El bloque no cumple Proof of Work' })
    }

    blockchain.chain.push(bloque)
    console.log(`[Red] Bloque #${bloque.index} aceptado en /blocks/receive desde peer`)

    res.json({ mensaje: 'Bloque aceptado', bloque })
  })

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