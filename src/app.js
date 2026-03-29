require('dotenv').config()

const express    = require('express')
const crypto     = require('crypto')
const path       = require('path')
const Blockchain = require('./blockchain/Blockchain')
const logger     = require('./middleware/logger')

const chainRoutes       = require('./routes/chain')
const mineRoutes        = require('./routes/mine')
const transactionRoutes = require('./routes/transactions')
const nodeRoutes        = require('./routes/nodes')

const cors = require('cors')

// ─── Swagger: path ABSOLUTO para evitar problemas de CWD ─────────────────────
let swaggerUi, swaggerDoc
try {
  swaggerUi  = require('swagger-ui-express')
  const YAML = require('yamljs')
  // __dirname apunta a src/, swagger.yaml está en la raíz del proyecto
  const swaggerPath = path.join(__dirname, '..', 'swagger.yaml')
  swaggerDoc = YAML.load(swaggerPath)
  console.log('[Swagger] Documentación cargada correctamente')
} catch (e) {
  console.warn(`[Swagger] No se pudo cargar swagger.yaml: ${e.message}`)
  console.warn('[Swagger] El servidor seguirá funcionando sin /docs')
  swaggerUi  = null
  swaggerDoc = null
}

const DIFFICULTY   = parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3')
const PROOF_PREFIX = '0'.repeat(DIFFICULTY)

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers de compatibilidad entre formatos de bloque
// ─────────────────────────────────────────────────────────────────────────────

function esFormatoCompanero(bloque) {
  return !!(bloque.persona_id || bloque.institucion_id || bloque.titulo_obtenido)
}

function calcularHashCompanero({ persona_id, institucion_id, titulo_obtenido, fecha_fin, hash_anterior, nonce }) {
  const data = `${persona_id}${institucion_id}${titulo_obtenido}${fecha_fin}${hash_anterior}${nonce}`
  return crypto.createHash('sha256').update(data).digest('hex')
}

function normalizarCamposHash(bloque) {
  return {
    hashAnterior: bloque.hash_anterior ?? bloque.hashAnterior ?? bloque.previousHash ?? bloque.previous_hash,
    hashActual:   bloque.hash_actual   ?? bloque.hashActual   ?? bloque.hash         ?? bloque.current_hash,
  }
}

function validarPoWBloque(bloque) {
  const { hashActual } = normalizarCamposHash(bloque)
  if (!hashActual) return false

  if (esFormatoCompanero(bloque)) {
    const hashRecalculado = calcularHashCompanero({
      persona_id:      bloque.persona_id,
      institucion_id:  bloque.institucion_id,
      titulo_obtenido: bloque.titulo_obtenido,
      fecha_fin:       bloque.fecha_fin,
      hash_anterior:   bloque.hash_anterior,
      nonce:           bloque.nonce,
    })
    const valido = hashRecalculado === hashActual && hashActual.startsWith(PROOF_PREFIX)
    if (!valido) {
      console.warn(`[PoW compañero] recalculado: ${hashRecalculado}`)
      console.warn(`[PoW compañero] recibido   : ${hashActual}`)
    }
    return valido
  }

  return hashActual.startsWith(PROOF_PREFIX)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Recepción de bloques propagados por peers
// ─────────────────────────────────────────────────────────────────────────────

function procesarBloqueRecibido(req, res, blockchain) {
  const body = req.body

  const bloque = body.bloque || body.block || (
    (body.hashActual || body.hash || body.hash_actual || body.persona_id) ? body : null
  )

  if (!bloque) {
    return res.status(400).json({ error: 'Se requiere el bloque' })
  }

  const ultimoLocal                     = blockchain.ultimoBloque
  const { hashAnterior, hashActual }    = normalizarCamposHash(bloque)
  const { hashActual: hashActualLocal } = normalizarCamposHash(ultimoLocal)

  console.log(`[Bloque recibido] formato          : ${esFormatoCompanero(bloque) ? 'compañero (plano)' : 'propio'}`)
  console.log(`[Bloque recibido] hashAnterior     : ${hashAnterior}`)
  console.log(`[Bloque recibido] último hash local: ${hashActualLocal}`)

  const hashAnteriorEsNulo = hashAnterior === null || hashAnterior === undefined
  if (!hashAnteriorEsNulo && hashAnterior !== hashActualLocal) {
    console.warn(`[Bloque recibido] 409 — hashAnterior no coincide`)
    return res.status(409).json({
      error: 'El hash anterior no coincide — usa /nodes/resolve para sincronizar',
      hashAnteriorRecibido: hashAnterior,
      hashActualLocal,
    })
  }

  if (!validarPoWBloque(bloque)) {
    return res.status(400).json({ error: 'El bloque no cumple Proof of Work' })
  }

  blockchain.chain.push(bloque)
  console.log(`[Red] Bloque aceptado desde peer`)

  // Persistir en Supabase según formato
  if (esFormatoCompanero(bloque)) {
    const supabase = require('./db/supabase')
    const { id, creado_en, ...datos } = bloque
    supabase.from('grados').insert(datos)
      .then(({ error }) => {
        if (error) console.error('[DB] Error al persistir bloque del compañero:', error.message)
        else console.log(`[DB] Bloque del compañero persistido`)
      })
  } else {
    const { persistirBloque } = require('./db/grados')
    const nodeId = process.env.NODE_ID || 'nodo-1'
    persistirBloque(bloque, nodeId)
      .catch(err => console.error('[DB] Error al persistir bloque propio recibido:', err.message))
  }

  res.json({ mensaje: 'Bloque aceptado', bloque })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Arranque del servidor
// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  const app  = express()
  const PORT = parseInt(process.env.PORT) || 8001

  // ── Inicializar blockchain con manejo de errores explícito ────────────────
  let blockchain
  try {
    blockchain = new Blockchain()
    await blockchain.inicializar()
  } catch (e) {
    console.error('[Fatal] Error al inicializar blockchain:', e.message)
    console.error(e.stack)
    process.exit(1)
  }

  app.set('blockchain', blockchain)

  app.use(express.json())
  app.use(cors())
  app.use(logger)

  // ── Frontend estático ─────────────────────────────────────────────────────
  // Busca public/ en la raíz del proyecto (un nivel arriba de src/)
  const publicDir = path.join(__dirname, '..', 'public')
  app.use(express.static(publicDir))
  console.log(`[Static] Sirviendo frontend desde: ${publicDir}`)

  // ── Rutas API ─────────────────────────────────────────────────────────────
  app.use('/chain',        chainRoutes)
  app.use('/mine',         mineRoutes)
  app.use('/transactions', transactionRoutes)
  app.use('/nodes',        nodeRoutes)

  // ── Swagger (solo si se cargó correctamente) ──────────────────────────────
  if (swaggerUi && swaggerDoc) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc))
  } else {
    app.get('/docs', (req, res) => {
      res.status(503).send('Swagger no disponible — revisa swagger.yaml')
    })
  }

  // ── Endpoints de recepción de bloques (múltiples alias) ───────────────────
  const recibirBloque = (req, res) => procesarBloqueRecibido(req, res, blockchain)
  app.post('/block',          recibirBloque)
  app.post('/blocks/receive', recibirBloque)
  app.post('/blocks',         recibirBloque)
  app.post('/chain/receive',  recibirBloque)
  app.post('/receive-block',  recibirBloque)
  app.post('/receive',        recibirBloque)

  // ── Health check ──────────────────────────────────────────────────────────
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

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` })
  })

  // ── Error handler global (Express 5 requiere 4 parámetros) ───────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(`[Error] ${err.message}`)
    console.error(err.stack)
    res.status(500).json({ error: 'Error interno del servidor' })
  })

  // ── Levantar servidor ─────────────────────────────────────────────────────
  const server = app.listen(PORT, () => {
    console.log(`\n Nodo blockchain corriendo`)
    console.log(`   NODE_ID  : ${process.env.NODE_ID || 'nodo-1'}`)
    console.log(`   Puerto   : ${PORT}`)
    console.log(`   PoW      : ${PROOF_PREFIX}...`)
    console.log(`   Frontend : http://localhost:${PORT}/`)
    console.log(`   Docs     : http://localhost:${PORT}/docs\n`)
  })

  // ── Keepalive: evitar clean exit ──────────────────────────────────────────
  // Node.js sale automáticamente cuando no hay handles activos.
  // Forzamos que el servidor permanezca vivo ante cualquier error no capturado.
  server.keepAliveTimeout = 65000

  process.on('uncaughtException', (err) => {
    console.error('[UncaughtException]', err.message)
    console.error(err.stack)
    // No cerramos el proceso — el servidor sigue vivo
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[UnhandledRejection]', reason)
    // No cerramos el proceso
  })

  return server
}

startServer().catch(err => {
  console.error('[Fatal] No se pudo iniciar el servidor:', err.message)
  console.error(err.stack)
  process.exit(1)
})