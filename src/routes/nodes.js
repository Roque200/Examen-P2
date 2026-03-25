const express = require('express')
const axios   = require('axios')
const router  = express.Router()

/**
 * POST /nodes/register
 * Registra uno o varios nodos peers en la red
 */
router.post('/register', (req, res) => {
  const blockchain = req.app.get('blockchain')
  const { nodos }  = req.body

  if (!nodos || !Array.isArray(nodos) || nodos.length === 0) {
    return res.status(400).json({ error: 'Se requiere un array "nodos" con al menos una dirección' })
  }

  nodos.forEach(n => blockchain.registrarNodo(n))

  res.json({
    mensaje:      'Nodos registrados',
    nodosActivos: blockchain.getNodos(),
  })
})

/**
 * POST /nodes/block
 * Recibe un bloque propagado por otro nodo y lo valida antes de aceptarlo
 */
router.post('/block', (req, res) => {
  const blockchain = req.app.get('blockchain')
  const { bloque } = req.body

  if (!bloque) {
    return res.status(400).json({ error: 'Se requiere el campo "bloque"' })
  }

  const ultimoLocal = blockchain.ultimoBloque

  // Validaciones básicas del bloque recibido
  if (bloque.hashAnterior !== ultimoLocal.hashActual) {
    return res.status(409).json({ error: 'El hash anterior no coincide — posible conflicto, usa /nodes/resolve' })
  }

  if (!bloque.hashActual.startsWith('0'.repeat(parseInt(process.env.PROOF_OF_WORK_DIFFICULTY || '3')))) {
    return res.status(400).json({ error: 'El bloque no cumple Proof of Work' })
  }

  blockchain.chain.push(bloque)
  console.log(`[Red] Bloque #${bloque.index} aceptado desde peer`)

  res.json({ mensaje: 'Bloque aceptado', bloque })
})

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
        const { chain } = response.data
        if (blockchain.reemplazarCadena(chain)) {
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
