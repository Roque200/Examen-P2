const express = require('express')
const axios   = require('axios')
const router  = express.Router()

/**
 * Normaliza un bloque para que tenga campos en ambos formatos:
 * - camelCase (nuestro formato interno)
 * - snake_case (formato del compañero Express)
 *
 * Así cualquier nodo puede leerlo sin importar qué convención use.
 */
function normalizarBloqueParaPropagar(bloque) {
  // Extraer la primera transacción si existe
  const tx = bloque.data?.transacciones?.[0] || {}

  return {
    // ── Campos blockchain ─────────────────────────────────────────────────
    // camelCase (nuestro formato)
    index:        bloque.index,
    timestamp:    bloque.timestamp,
    nonce:        bloque.nonce,
    hashActual:   bloque.hashActual,
    hashAnterior: bloque.hashAnterior,
    data:         bloque.data,
    // snake_case (formato del compañero)
    hash_actual:   bloque.hashActual,
    hash_anterior: bloque.hashAnterior,
    firmado_por:   process.env.NODE_ID || 'nodo-1',

    // ── Campos de grado académico (snake_case para el compañero) ─────────
    persona_id:      tx.personaId      || tx.persona_id      || null,
    institucion_id:  tx.institucionId  || tx.institucion_id  || null,
    programa_id:     tx.programaId     || tx.programa_id     || null,
    titulo_obtenido: tx.tituloObtenido || tx.titulo_obtenido || null,
    fecha_fin:       tx.fechaFin       || tx.fecha_fin       || null,
    fecha_inicio:    tx.fechaInicio    || tx.fecha_inicio    || null,
    numero_cedula:   tx.numeroCedula   || tx.numero_cedula   || null,
    titulo_tesis:    tx.tituloTesis    || tx.titulo_tesis    || null,
    menciones:       tx.menciones      || null,
  }
}

const ENDPOINTS_BLOQUE = [
  '/blocks/receive',  // compañero Express (Angel)
  '/block',           // formato anterior / genérico
  '/receive',         // alias del compañero Express
  '/nodes/block',     // nuestros propios nodos internos
  '/chain/receive',
  '/receive-block',
]

async function propagarANodo(nodo, bloqueNormalizado) {
  for (const endpoint of ENDPOINTS_BLOQUE) {
    try {
      await axios.post(`${nodo}${endpoint}`, bloqueNormalizado, {
        headers: { 'X-Propagated': 'true' },
        timeout: 5000,
      })
      console.log(`[Propagacion] ✓ Bloque → ${nodo}${endpoint}`)
      return { nodo, ok: true, endpoint }
    } catch (err) {
      const status = err.response?.status
      if (status === 404) continue
      console.warn(`[Propagacion] ✗ ${nodo}${endpoint} → ${status}: ${JSON.stringify(err.response?.data)}`)
      return { nodo, ok: false, endpoint, status, error: err.response?.data || err.message }
    }
  }
  return { nodo, ok: false, error: 'Ningún endpoint respondió' }
}

router.post('/', async (req, res) => {
  const blockchain = req.app.get('blockchain')
  const nodeId     = process.env.NODE_ID || 'nodo-desconocido'

  try {
    const bloque           = await blockchain.minar(nodeId)
    const bloqueNormalizado = normalizarBloqueParaPropagar(bloque)
    const nodos            = blockchain.getNodos()

    const resultados = await Promise.allSettled(
      nodos.map(nodo => propagarANodo(nodo, bloqueNormalizado))
    )

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