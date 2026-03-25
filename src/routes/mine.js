const express = require('express')
const axios   = require('axios')
const router  = express.Router()

/**
 * POST /mine
 * Mina las transacciones pendientes, genera un bloque y lo propaga
 */
router.post('/', async (req, res) => {
  const blockchain = req.app.get('blockchain')
  const nodeId     = process.env.NODE_ID || 'nodo-desconocido'

  try {
    const bloque = blockchain.minar(nodeId)

    // Propagar bloque minado a todos los peers
    const nodos = blockchain.getNodos()
    const propagaciones = nodos.map(nodo =>
      axios.post(`${nodo}/nodes/block`, { bloque }, {
        headers: { 'X-Propagated': 'true' }
      }).catch(err => console.warn(`[Propagacion] Fallo nodo ${nodo}: ${err.message}`))
    )
    await Promise.allSettled(propagaciones)

    res.json({
      mensaje:    'Bloque minado y propagado',
      bloque,
      nodosMine:  nodeId,
      propagadoA: nodos,
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

module.exports = router
