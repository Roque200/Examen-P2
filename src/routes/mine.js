const express = require('express')
const axios   = require('axios')
const router  = express.Router()

/**
 * POST /mine
 *
 * Mina las transacciones pendientes y propaga el bloque a todos los peers.
 *
 * COMPATIBILIDAD:
 * El compañero espera recibir el bloque en POST /block con el bloque
 * DIRECTO como body (sin wrapper { bloque: ... }).
 *
 * Su propagacion.js hace:
 *   axios.post(`${nodo}/block`, bloque, { timeout })
 *
 * Nosotros hacemos lo mismo al propagar — intentamos /block primero,
 * con fallback a /blocks/receive y /nodes/block.
 */
router.post('/', async (req, res) => {
  const blockchain = req.app.get('blockchain')
  const nodeId     = process.env.NODE_ID || 'nodo-desconocido'

  try {
    const bloque = await blockchain.minar(nodeId)
    const nodos  = blockchain.getNodos()

    // Propagar a cada peer probando endpoints en orden
    const propagaciones = nodos.map(async nodo => {
      const endpoints = ['/block', '/blocks/receive', '/nodes/block']

      for (const endpoint of endpoints) {
        try {
          // El compañero espera el bloque DIRECTO (sin wrapper)
          // Mandamos el bloque directamente para máxima compatibilidad
          await axios.post(`${nodo}${endpoint}`, bloque, {
            headers: { 'X-Propagated': 'true' },
            timeout: 5000,
          })
          console.log(`[Propagacion] Bloque → ${nodo}${endpoint} OK`)
          return { nodo, ok: true, endpoint }
        } catch (err) {
          if (err.response?.status === 404) {
            // Endpoint no existe, probar el siguiente
            continue
          }
          // Error real (409 conflicto, 400 PoW inválido, etc.) — no reintentar
          console.warn(`[Propagacion] Fallo ${nodo}${endpoint}: ${err.response?.status} — ${JSON.stringify(err.response?.data)}`)
          return { nodo, ok: false, endpoint, error: err.response?.data || err.message }
        }
      }

      return { nodo, ok: false, error: 'Ningún endpoint de bloques respondió (no 404)' }
    })

    const resultados = await Promise.allSettled(propagaciones)

    res.json({
      mensaje:    'Bloque minado y propagado',
      bloque,
      nodosMine:  nodeId,
      propagadoA: nodos,
      resultados: resultados.map(r => r.value || r.reason),
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

module.exports = router