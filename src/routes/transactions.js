const express = require('express')
const axios   = require('axios')
const router  = express.Router()

/**
 * POST /transactions
 * Recibe una transacción, la agrega a pendientes y la propaga a los peers
 * Header X-Propagated: true evita re-propagación infinita
 */
router.post('/', async (req, res) => {
  const blockchain  = req.app.get('blockchain')
  const propagado   = req.headers['x-propagated'] === 'true'

  const camposRequeridos = ['personaId', 'institucionId', 'programaId', 'tituloObtenido', 'fechaFin', 'firmadoPor']
  const faltantes = camposRequeridos.filter(c => !req.body[c])

  if (faltantes.length > 0) {
    return res.status(400).json({ error: `Campos requeridos: ${faltantes.join(', ')}` })
  }

  const tx = blockchain.agregarTransaccion(req.body)

  // Propagar a peers solo si no es un mensaje ya propagado
  if (!propagado) {
    const nodos = blockchain.getNodos()
    const propagaciones = nodos.map(nodo =>
      axios.post(`${nodo}/transactions`, req.body, {
        headers: { 'X-Propagated': 'true' }
      }).catch(err => console.warn(`[Propagacion] Fallo nodo ${nodo}: ${err.message}`))
    )
    await Promise.allSettled(propagaciones)
  }

  res.status(201).json({
    mensaje:       'Transacción agregada',
    transaccion:   tx,
    propagada:     !propagado,
    indiceBloque:  blockchain.chain.length,
  })
})

module.exports = router
