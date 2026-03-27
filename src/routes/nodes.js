const express = require('express')
const axios   = require('axios')
const router  = express.Router()
const { sha256 } = require('../utils/hash')

/**
 * POST /nodes/register
 * Acepta "nodos" (español) o "nodes" (inglés)
 */
router.post('/register', (req, res) => {
  const blockchain = req.app.get('blockchain')
  const nodos = req.body.nodos || req.body.nodes

  if (!nodos || !Array.isArray(nodos) || nodos.length === 0) {
    return res.status(400).json({ error: 'Se requiere un array "nodos" o "nodes" con al menos una dirección' })
  }

  nodos.forEach(n => blockchain.registrarNodo(n))

  res.json({
    mensaje:      'Nodos registrados',
    nodosActivos: blockchain.getNodos(),
  })
})

/**
 * Lógica compartida para recibir un bloque propagado.
 * Usada en POST /nodes/block y POST /blocks/receive (alias del compañero)
 */
function recibirBloque(req, res) {
  const blockchain = req.app.get('blockchain')
  const bloque = req.body.bloque || req.body.block

  if (!bloque) {
    return res.status(400).json({ error: 'Se requiere el campo "bloque" o "block"' })
  }

  const ultimoLocal = blockchain.ultimoBloque
  const difficulty  = parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3')

  // Normalizar campos: aceptar hashAnterior o previousHash
  const hashAnteriorRecibido = bloque.hashAnterior || bloque.previousHash || bloque.previous_hash
  const hashActualRecibido   = bloque.hashActual   || bloque.hash         || bloque.current_hash

  if (hashAnteriorRecibido !== ultimoLocal.hashActual && hashAnteriorRecibido !== ultimoLocal.hash) {
    return res.status(409).json({ error: 'El hash anterior no coincide — posible conflicto, usa /nodes/resolve' })
  }

  if (!hashActualRecibido || !hashActualRecibido.startsWith('0'.repeat(difficulty))) {
    return res.status(400).json({ error: 'El bloque no cumple Proof of Work' })
  }

  blockchain.chain.push(bloque)
  console.log(`[Red] Bloque #${bloque.index} aceptado desde peer`)

  res.json({ mensaje: 'Bloque aceptado', bloque })
}

// Ruta propia
router.post('/block', recibirBloque)

/**
 * GET /nodes/resolve
 * Algoritmo de consenso: adopta la cadena válida más larga de los peers
 */
router.get('/resolve', async (req, res) => {
  const blockchain = req.app.get('blockchain')
  const nodos      = blockchain.getNodos()

  if (nodos.length === 0) {
    return res.json({ mensaje: 'Sin peers registrados, cadena local mantenida', reemplazada: false })
  }

  let reemplazada = false

  const consultas = nodos.map(nodo =>
    axios.get(`${nodo}/chain`)
      .then(response => {
        // Aceptar { chain } o { blockchain } según el nodo del compañero
        const chain = response.data.chain || response.data.blockchain
        if (chain && blockchain.reemplazarCadena(chain)) {
          reemplazada = true
          console.log(`[Consenso] Cadena adoptada desde ${nodo}`)
        }
      })
      .catch(err => console.warn(`[Consenso] No se pudo consultar ${nodo}: ${err.message}`))
  )

  await Promise.allSettled(consultas)

  res.json({
    mensaje:    reemplazada ? 'Cadena reemplazada por una más larga' : 'Cadena local es la más larga',
    reemplazada,
    longitud:   blockchain.chain.length,
  })
})

/**
 * GET /nodes
 * Lista todos los nodos registrados
 */
router.get('/', (req, res) => {
  const blockchain = req.app.get('blockchain')
  res.json({ nodos: blockchain.getNodos() })
})

module.exports = router