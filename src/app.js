require('dotenv').config()

const express    = require('express')
const crypto     = require('crypto')
const Blockchain = require('./blockchain/Blockchain')
const logger     = require('./middleware/logger')

const chainRoutes       = require('./routes/chain')
const mineRoutes        = require('./routes/mine')
const transactionRoutes = require('./routes/transactions')
const nodeRoutes        = require('./routes/nodes')

const swaggerUi  = require('swagger-ui-express')
const YAML       = require('yamljs')
const swaggerDoc = YAML.load('./swagger.yaml')
const cors       = require('cors')

const DIFFICULTY   = parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3')
const PROOF_PREFIX = '0'.repeat(DIFFICULTY)

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers de compatibilidad
// ─────────────────────────────────────────────────────────────────────────────

function esFormatoCompanero(bloque) {
  return !!(bloque.persona_id || bloque.institucion_id || bloque.titulo_obtenido)
}

function calcularHashCompanero({ persona_id, institucion_id, titulo_obtenido, fecha_fin, hash_anterior, nonce }) {
  const data = `${persona_id}${institucion_id}${titulo_obtenido}${fecha_fin}${hash_anterior}${nonce}`
  return crypto.createHash('sha256').update(data).digest('hex')
}

/**
 * Extrae hashAnterior y hashActual normalizados.
 * Para el compañero usa snake_case, para nosotros camelCase.
 */
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
      hash_anterior:   bloque.hash_anterior,  // puede ser null — se convierte a "null" en el string
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
//  Función central de recepción de bloques
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

  console.log(`[Bloque recibido] formato         : ${esFormatoCompanero(bloque) ? 'compañero (plano)' : 'propio'}`)
  console.log(`[Bloque recibido] hashAnterior    : ${hashAnterior}`)
  console.log(`[Bloque recibido] último hash local: ${hashActualLocal}`)

  // ── Validar encadenamiento ────────────────────────────────────────────────
  //
  // CASO ESPECIAL — primer bloque del compañero (hash_anterior = null):
  // Su cadena no tiene génesis. Su primer bloque apunta a null.
  // Nosotros sí tenemos génesis, así que los hashes nunca coincidirían.
  //
  // Solución: si el hashAnterior recibido es null/undefined Y el bloque
  // cumple PoW válido, lo aceptamos como "bloque ancla" del compañero
  // y sincronizamos desde ahí.
  //
  const hashAnteriorEsNulo = hashAnterior === null || hashAnterior === undefined

  if (!hashAnteriorEsNulo && hashAnterior !== hashActualLocal) {
    console.warn(`[Bloque recibido] 409 — hashAnterior no coincide`)
    return res.status(409).json({
      error: 'El hash anterior no coincide — usa /nodes/resolve para sincronizar',
      hashAnteriorRecibido: hashAnterior,
      hashActualLocal,
    })
  }

  // ── Validar Proof of Work ─────────────────────────────────────────────────
  if (!validarPoWBloque(bloque)) {
    return res.status(400).json({ error: 'El bloque no cumple Proof of Work' })
  }

  blockchain.chain.push(bloque)
  console.log(`[Red] Bloque aceptado desde peer`)

  // ── Persistir en Supabase ─────────────────────────────────────────────────
  // Si es formato del compañero (bloque plano con campos snake_case),
  // lo insertamos directamente en la tabla grados.
  // Si es nuestro formato (bloque con data.transacciones), usamos persistirBloque.
  if (esFormatoCompanero(bloque)) {
    const supabase = require('./db/supabase')
    const { id, creado_en, ...datos } = bloque  // dejar que Supabase genere id y creado_en
    supabase.from('grados').insert(datos)
      .then(({ error }) => {
        if (error) console.error('[DB] Error al persistir bloque del compañero:', error.message)
        else console.log(`[DB] Bloque del compañero persistido: ${bloque.hash_actual?.slice(0, 16)}...`)
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
//  Arranque
// ─────────────────────────────────────────────────────────────────────────────

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

  // Todos los endpoints que el compañero puede intentar
  app.post('/block',          (req, res) => procesarBloqueRecibido(req, res, blockchain))
  app.post('/blocks/receive', (req, res) => procesarBloqueRecibido(req, res, blockchain))
  app.post('/blocks',         (req, res) => procesarBloqueRecibido(req, res, blockchain))
  app.post('/chain/receive',  (req, res) => procesarBloqueRecibido(req, res, blockchain))
  app.post('/receive-block',  (req, res) => procesarBloqueRecibido(req, res, blockchain))

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
    console.log(`   PoW     : ${PROOF_PREFIX}...\n`)
  })
}

startServer().catch(err => {
  console.error('[Fatal] No se pudo iniciar el servidor:', err.message)
  process.exit(1)
})