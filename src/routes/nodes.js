const express = require('express')
const axios   = require('axios')
const crypto  = require('crypto')
const router  = express.Router()

const DIFFICULTY   = parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3')
const PROOF_PREFIX = '0'.repeat(DIFFICULTY)

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers de compatibilidad
// ─────────────────────────────────────────────────────────────────────────────

function esFormatoCompanero(bloque) {
  return !!(bloque.persona_id || bloque.institucion_id || bloque.titulo_obtenido)
}

function normalizarCamposHash(bloque) {
  return {
    hashAnterior: bloque.hash_anterior ?? bloque.hashAnterior ?? bloque.previousHash ?? bloque.previous_hash,
    hashActual:   bloque.hash_actual   ?? bloque.hashActual   ?? bloque.hash         ?? bloque.current_hash,
  }
}

function calcularHashCompanero({ persona_id, institucion_id, titulo_obtenido, fecha_fin, hash_anterior, nonce }) {
  const data = `${persona_id}${institucion_id}${titulo_obtenido}${fecha_fin}${hash_anterior}${nonce}`
  return crypto.createHash('sha256').update(data).digest('hex')
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
    return hashRecalculado === hashActual && hashActual.startsWith(PROOF_PREFIX)
  }

  return hashActual.startsWith(PROOF_PREFIX)
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /nodes/register
// ─────────────────────────────────────────────────────────────────────────────

router.post('/register', (req, res) => {
  const blockchain = req.app.get('blockchain')
  const nodos = req.body.nodos || req.body.nodes

  if (!nodos || !Array.isArray(nodos) || nodos.length === 0) {
    return res.status(400).json({
      error: 'Se requiere un array "nodos" o "nodes" con al menos una dirección'
    })
  }

  nodos.forEach(n => blockchain.registrarNodo(n))

  res.json({
    mensaje:      'Nodos registrados',
    nodosActivos: blockchain.getNodos(),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /nodes/remove
//  Elimina un peer de la lista de nodos conocidos
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/remove', (req, res) => {
  const blockchain = req.app.get('blockchain')
  const { url, nodo } = req.body
  const direccion = url || nodo

  if (!direccion) {
    return res.status(400).json({ error: 'Se requiere el campo "url" con la dirección del nodo a eliminar' })
  }

  const dir = direccion.replace(/\/$/, '')
  const existia = blockchain.nodos.has(dir)

  if (!existia) {
    return res.status(404).json({ error: `Nodo ${dir} no está registrado` })
  }

  blockchain.nodos.delete(dir)
  console.log(`[Red] Nodo eliminado: ${dir}. Total nodos: ${blockchain.nodos.size}`)

  res.json({
    mensaje:      'Nodo eliminado',
    eliminado:    dir,
    nodosActivos: blockchain.getNodos(),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  POST /nodes/block
// ─────────────────────────────────────────────────────────────────────────────

router.post('/block', (req, res) => {
  const blockchain = req.app.get('blockchain')
  const body       = req.body

  const bloque = body.bloque || body.block || (
    (body.hashActual || body.hash || body.hash_actual || body.persona_id) ? body : null
  )

  if (!bloque) {
    return res.status(400).json({
      error: 'Se requiere el bloque (directo en body, o en campo "bloque"/"block")'
    })
  }

  const ultimoLocal                     = blockchain.ultimoBloque
  const { hashAnterior, hashActual }    = normalizarCamposHash(bloque)
  const { hashActual: hashActualLocal } = normalizarCamposHash(ultimoLocal)

  console.log(`[/nodes/block] formato          : ${esFormatoCompanero(bloque) ? 'compañero' : 'propio'}`)
  console.log(`[/nodes/block] hashAnterior     : ${hashAnterior}`)
  console.log(`[/nodes/block] último hash local: ${hashActualLocal}`)

  const hashAnteriorEsNulo = hashAnterior === null || hashAnterior === undefined
  if (!hashAnteriorEsNulo && hashAnterior !== hashActualLocal) {
    return res.status(409).json({
      error: 'El hash anterior no coincide — usa /nodes/resolve'
    })
  }

  if (!validarPoWBloque(bloque)) {
    return res.status(400).json({ error: 'El bloque no cumple Proof of Work' })
  }

  blockchain.chain.push(bloque)
  console.log(`[Red] Bloque aceptado vía /nodes/block`)

  res.json({ mensaje: 'Bloque aceptado', bloque })
})

// ─────────────────────────────────────────────────────────────────────────────
//  GET /nodes/resolve
// ─────────────────────────────────────────────────────────────────────────────

router.get('/resolve', async (req, res) => {
  const blockchain = req.app.get('blockchain')
  const nodos      = blockchain.getNodos()

  if (nodos.length === 0) {
    return res.json({
      mensaje:     'Sin peers registrados, cadena local mantenida',
      reemplazada: false
    })
  }

  let reemplazada = false

  const consultas = nodos.map(nodo =>
    axios.get(`${nodo}/chain`, { timeout: 5000 })
      .then(response => {
        const cadena = response.data.chain || response.data.blockchain
        if (!cadena || !Array.isArray(cadena)) return

        if (cadena.length <= blockchain.chain.length) return

        if (blockchain.reemplazarCadena(cadena)) {
          reemplazada = true
          console.log(`[Consenso] Cadena adoptada desde ${nodo} (${cadena.length} bloques)`)
        } else {
          console.log(`[Consenso] Cadena de ${nodo} rechazada (inválida o más corta)`)
        }
      })
      .catch(err => console.warn(`[Consenso] No se pudo consultar ${nodo}: ${err.message}`))
  )

  await Promise.allSettled(consultas)

  res.json({
    mensaje:     reemplazada
      ? 'Cadena reemplazada por una más larga'
      : 'Cadena local es la más larga o la única válida',
    reemplazada,
    longitud:    blockchain.chain.length,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  GET /nodes
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const blockchain = req.app.get('blockchain')
  res.json({ nodos: blockchain.getNodos() })
})

module.exports = router